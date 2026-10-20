/** Network access: identity resolution, login, and document and blob records. */
import type {} from '@atcute/atproto'; // registers com.atproto.* types with Client
import { Client, ClientResponseError, ok, simpleFetchHandler } from '@atcute/client';
import {
	CompositeDidDocumentResolver,
	CompositeHandleResolver,
	DidNotFoundError,
	DohJsonHandleResolver,
	FailedDocumentResolutionError,
	FailedHandleResolutionError,
	LocalActorResolver,
	PlcDidDocumentResolver,
	WebDidDocumentResolver,
	WellKnownHandleResolver,
} from '@atcute/identity-resolver';
import type { ActorIdentifier, Blob, Did } from '@atcute/lexicons';
import { PasswordSession } from '@atcute/password-session';

import { PublishError } from './convert/document.ts';
import type { DocumentRecord } from './convert/record.ts';

export const DOCUMENT_COLLECTION = 'site.standard.document';
export const PUBLICATION_COLLECTION = 'site.standard.publication';

/** The lexicon's limit for `coverImage`. */
export const MAX_COVER_BYTES = 1_000_000;

export interface Account {
	did: Did;
	/** PDS base URL, e.g. https://weslandia.ca */
	pds: string;
}

const IMAGE_EXTENSIONS = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'avif']);
const UPLOADABLE_TYPES = 'PNG, JPEG, GIF, WebP or AVIF';

/** Resolves handles (DNS or HTTPS) and DIDs (PLC or did:web), verified both ways. */
const actorResolver = new LocalActorResolver({
	handleResolver: new CompositeHandleResolver({
		methods: {
			dns: new DohJsonHandleResolver({ dohUrl: 'https://mozilla.cloudflare-dns.com/dns-query' }),
			http: new WellKnownHandleResolver(),
		},
	}),
	didDocumentResolver: new CompositeDidDocumentResolver({
		methods: {
			plc: new PlcDidDocumentResolver(),
			web: new WebDidDocumentResolver(),
		},
	}),
});

const withoutTrailingSlash = (url: string): string => url.replace(/\/+$/, '');

const ascii = (text: string): number[] => [...text].map((char) => char.charCodeAt(0));

/** Image file signatures ("magic bytes"); offsets are in `detectImageType`. */
const SIGNATURES = {
	png: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a],
	jpeg: [0xff, 0xd8, 0xff],
	gif87a: ascii('GIF87a'),
	gif89a: ascii('GIF89a'),
	riff: ascii('RIFF'),
	webp: ascii('WEBP'),
	ftyp: ascii('ftyp'),
	avif: ascii('avif'),
	avis: ascii('avis'),
} as const;

/** Handle or DID → DID and PDS. */
export async function resolveAccount(identifier: string): Promise<Account> {
	try {
		const actor = await actorResolver.resolve(identifier as ActorIdentifier);
		return { did: actor.did, pds: withoutTrailingSlash(actor.pds) };
	} catch (error) {
		// LocalActorResolver throws an ActorResolutionError; the reason is its cause.
		const cause = error instanceof Error ? error.cause : undefined;
		if (cause instanceof FailedHandleResolutionError || cause instanceof FailedDocumentResolutionError) {
			throw new PublishError(`Couldn't look up "${identifier}". Check your internet connection.`, { cause: error });
		}
		if (cause instanceof DidNotFoundError) {
			throw new PublishError(
				`There's no atproto account with the handle "${identifier}". Check "Handle" in the plugin settings.`,
				{
					cause: error,
				},
			);
		}
		throw new PublishError(`Couldn't find the account "${identifier}". Check "Handle" in the plugin settings.`, {
			cause: error,
		});
	}
}

/** An unauthenticated client for public reads. */
export function publicClient(pds: string): Client {
	return new Client({ handler: simpleFetchHandler({ service: pds }) });
}

/** Logs in with an app password. The session is kept in memory only. */
export async function connect(account: Account, identifier: string, password: string): Promise<Client> {
	try {
		const session = await PasswordSession.login({ service: account.pds, identifier, password });
		return new Client({ handler: session });
	} catch (error) {
		throw loginError(error, identifier, account.pds);
	}
}

/** Never includes the password. */
function loginError(error: unknown, identifier: string, pds: string): PublishError {
	if (!(error instanceof ClientResponseError)) {
		return new PublishError(`Couldn't reach ${new URL(pds).host}. Check your internet connection.`, { cause: error });
	}
	switch (error.error) {
		case 'AuthenticationRequired':
			return new PublishError(
				`Couldn't log in as ${identifier}: the handle or app password is wrong. Check them in the plugin settings.`,
			);
		case 'AuthFactorTokenRequired':
			return new PublishError(
				`${identifier} has two-factor sign-in, so it needs an app password (Bluesky: Settings → Privacy and security → App passwords).`,
			);
		case 'AccountTakedown':
			return new PublishError(`The account ${identifier} has been taken down by its PDS.`);
		case 'RateLimitExceeded':
			return new PublishError('Too many login attempts. Wait a few minutes, then try again.');
		default:
			return new PublishError(`Couldn't log in as ${identifier}: ${error.description ?? error.error}`, {
				cause: error,
			});
	}
}

/** A publication's URL (without a trailing slash) and name. */
export async function getPublication(rpc: Client, uri: string): Promise<{ url: string; name: string }> {
	const uriMatches = /^at:\/\/(did:[^/]+)\/site\.standard\.publication\/([^/]+)$/.exec(uri);
	const [, repo, rkey] = uriMatches ?? [];
	if (!repo || !rkey) {
		throw new PublishError(
			`"${uri}" isn't a publication link. Set "Publication" in the plugin settings to at://<your DID>/site.standard.publication/<record key>.`,
		);
	}

	const response = await rpc.get('com.atproto.repo.getRecord', {
		params: { repo: repo as Did, collection: PUBLICATION_COLLECTION, rkey },
	});
	if (!response.ok) {
		if (response.data.error === 'RecordNotFound') {
			throw new PublishError(`The publication ${uri} doesn't exist. Check "Publication" in the plugin settings.`);
		}
		throw new ClientResponseError(response);
	}

	const { url, name } = response.data.value as { url?: unknown; name?: unknown };
	if (typeof url !== 'string' || !url) {
		throw new PublishError(
			`The publication ${uri} has no "url", so there's no site to publish to. Add one to the record.`,
		);
	}
	return { url: withoutTrailingSlash(url), name: typeof name === 'string' ? name : '' };
}

/** Refuses files without an uploadable image extension (SVG included). */
export function checkImageExtension(path: string): void {
	const ext = /\.([^./]+)$/.exec(path)?.[1] ?? '';
	if (!IMAGE_EXTENSIONS.has(ext.toLowerCase())) {
		throw new PublishError(`"${path}" can't be uploaded: only ${UPLOADABLE_TYPES} images can.`);
	}
}

/**
 * The image type from a file's first bytes, or `undefined` if it isn't
 * uploadable. WebP is `RIFF` + `WEBP` at byte 8; AVIF is `ftyp` at byte 4 +
 * `avif`/`avis` at byte 8.
 */
export function detectImageType(bytes: Uint8Array): string | undefined {
	const matches = (offset: number, signature: readonly number[]) =>
		signature.every((byte, i) => bytes[offset + i] === byte);

	if (matches(0, SIGNATURES.png)) return 'image/png';
	if (matches(0, SIGNATURES.jpeg)) return 'image/jpeg';
	if (matches(0, SIGNATURES.gif87a) || matches(0, SIGNATURES.gif89a)) return 'image/gif';
	if (matches(0, SIGNATURES.riff) && matches(8, SIGNATURES.webp)) return 'image/webp';
	if (matches(4, SIGNATURES.ftyp) && (matches(8, SIGNATURES.avif) || matches(8, SIGNATURES.avis))) return 'image/avif';
	return undefined;
}

/**
 * The MIME type to upload with. Checks the extension first for a clear error,
 * then trusts the bytes (a WebP saved as .png uploads as WebP).
 */
export function imageTypeOf(path: string, bytes: Uint8Array): string {
	checkImageExtension(path);
	const imageType = detectImageType(bytes);
	if (!imageType) {
		throw new PublishError(
			`"${path}" isn't a ${UPLOADABLE_TYPES} image. It may be another format, like HEIC, saved with an image extension.`,
		);
	}
	return imageType;
}

export function checkCoverSize(path: string, bytes: number): void {
	if (bytes > MAX_COVER_BYTES) {
		const megabytes = (bytes / 1_000_000).toFixed(1);
		throw new PublishError(
			`The cover image "${path}" is ${megabytes} MB, but covers can be at most 1 MB. Use a smaller image.`,
		);
	}
}

export async function uploadImage(rpc: Client, bytes: Uint8Array, mimeType: string): Promise<Blob> {
	const data = await ok(
		rpc.post('com.atproto.repo.uploadBlob', {
			input: bytes,
			// The client sends no content type for binary input.
			headers: { 'content-type': mimeType },
		}),
	);
	return data.blob;
}

/** A document and its CID, or `undefined` if it doesn't exist. */
export async function getDocument(
	rpc: Client,
	did: Did,
	rkey: string,
): Promise<{ value: DocumentRecord; cid: string } | undefined> {
	const response = await rpc.get('com.atproto.repo.getRecord', {
		params: { repo: did, collection: DOCUMENT_COLLECTION, rkey },
	});
	if (!response.ok) {
		if (response.data.error === 'RecordNotFound') return undefined;
		throw new ClientResponseError(response);
	}
	const cid = response.data.cid;
	if (!cid) throw new Error(`The PDS returned ${response.data.uri} without a CID.`);

	return { value: response.data.value as DocumentRecord, cid };
}

/** Every document in the repo, following the cursor. */
export async function listDocuments(
	rpc: Client,
	did: Did,
): Promise<Array<{ uri: string; cid: string; value: DocumentRecord }>> {
	const documents: Array<{ uri: string; cid: string; value: DocumentRecord }> = [];
	let cursor: string | undefined;
	do {
		const response = await rpc.get('com.atproto.repo.listRecords', {
			params: { repo: did, collection: DOCUMENT_COLLECTION, limit: 100, cursor },
		});
		if (!response.ok) throw new ClientResponseError(response);
		for (const record of response.data.records) {
			documents.push({ uri: record.uri, cid: record.cid, value: record.value as DocumentRecord });
		}
		cursor = response.data.cursor;
	} while (cursor);
	return documents;
}

/**
 * Writes a document with `validate: false`, since PDSes don't know
 * site.standard.*. `swapRecord: null` means "must not exist yet".
 */
export async function putDocument(
	rpc: Client,
	did: Did,
	rkey: string,
	record: DocumentRecord,
	swapRecord: string | null,
): Promise<{ uri: string; cid: string }> {
	try {
		const data = await ok(
			rpc.post('com.atproto.repo.putRecord', {
				input: { repo: did, collection: DOCUMENT_COLLECTION, rkey, record, swapRecord, validate: false },
			}),
		);
		return { uri: data.uri, cid: data.cid };
	} catch (error) {
		throw explainSwap(error, 'Publish');
	}
}

export async function deleteDocument(rpc: Client, did: Did, rkey: string, swapRecord: string): Promise<void> {
	try {
		await ok(
			rpc.post('com.atproto.repo.deleteRecord', {
				input: { repo: did, collection: DOCUMENT_COLLECTION, rkey, swapRecord },
			}),
		);
	} catch (error) {
		throw explainSwap(error, 'Unpublish');
	}
}

/** A failed swap means the record changed between our read and write. */
function explainSwap(error: unknown, action: 'Publish' | 'Unpublish'): unknown {
	if (error instanceof ClientResponseError && error.error === 'InvalidSwap') {
		return new PublishError(
			`This document changed on your PDS while you were working on it. Run "${action} document" again.`,
		);
	}
	return error;
}
