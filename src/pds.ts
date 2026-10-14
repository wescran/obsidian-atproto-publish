/**
 * Everything that talks to the network: finding an account's PDS, reading the
 * publication, logging in, and reading/writing document records and blobs.
 *
 * Functions that take a `Client` are unit-tested against a fake PDS
 * (test/fake-pds.ts). `resolveAccount` and `connect` need the real network and
 * are covered by test/live.test.ts (opt-in).
 */
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

/** File extensions of the image types that can be uploaded. */
const IMAGE_EXTENSIONS = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'avif']);
const UPLOADABLE_TYPES = 'PNG, JPEG, GIF, WebP or AVIF';

/** Handle → DID (DNS or HTTPS), then DID → DID document (PLC or did:web), checked both ways. Stateless, so built once. */
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

/** The bytes of an ASCII string, for file signatures that are readable text. */
const ascii = (text: string): number[] => [...text].map((char) => char.charCodeAt(0));

/** Image file signatures ("magic bytes"). See `detectImageType` for where each one appears. */
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

/**
 * Handle (or DID) → DID and PDS.
 *
 * Use `LocalActorResolver` from `@atcute/identity-resolver`, with a
 * `CompositeHandleResolver` (DNS via `DohJsonHandleResolver`, e.g.
 * `https://mozilla.cloudflare-dns.com/dns-query`, plus
 * `WellKnownHandleResolver`) and a `CompositeDidDocumentResolver`
 * (`PlcDidDocumentResolver`, `WebDidDocumentResolver`). It verifies that the
 * handle and DID point at each other.
 *
 * Any failure → `PublishError` naming the identifier.
 */
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
			throw new PublishError(`There's no atproto account with the handle "${identifier}". Check "Handle" in the plugin settings.`, {
				cause: error,
			});
		}
		throw new PublishError(`Couldn't find the account "${identifier}". Check "Handle" in the plugin settings.`, { cause: error });
	}
}

/** An unauthenticated client for a PDS (`simpleFetchHandler`), for public reads. */
export function publicClient(pds: string): Client {
	return new Client({ handler: simpleFetchHandler({ service: pds }) });
}

/**
 * Logs in with an app password and returns an authenticated client
 * (`PasswordSession.login({ service: account.pds, identifier, password })`,
 * then `new Client({ handler: session })`). Keep the session in memory only.
 *
 * Wrong credentials (`AuthenticationRequired` and similar) → `PublishError`
 * telling the author to check the handle and app password in settings.
 */
export async function connect(account: Account, identifier: string, password: string): Promise<Client> {
	try {
		const session = await PasswordSession.login({ service: account.pds, identifier, password });
		return new Client({ handler: session });
	} catch (error) {
		throw loginError(error, identifier, account.pds);
	}
}

/** A message for every way logging in can fail. Never includes the password. */
function loginError(error: unknown, identifier: string, pds: string): PublishError {
	if (!(error instanceof ClientResponseError)) {
		return new PublishError(`Couldn't reach ${new URL(pds).host}. Check your internet connection.`, { cause: error });
	}
	switch (error.error) {
		case 'AuthenticationRequired':
			return new PublishError(`Couldn't log in as ${identifier}: the handle or app password is wrong. Check them in the plugin settings.`);
		case 'AuthFactorTokenRequired':
			return new PublishError(
				`${identifier} has two-factor sign-in, so it needs an app password (Bluesky: Settings → Privacy and security → App passwords).`,
			);
		case 'AccountTakedown':
			return new PublishError(`The account ${identifier} has been taken down by its PDS.`);
		case 'RateLimitExceeded':
			return new PublishError('Too many login attempts. Wait a few minutes, then try again.');
		default:
			return new PublishError(`Couldn't log in as ${identifier}: ${error.description ?? error.error}`, { cause: error });
	}
}

/**
 * Reads a `site.standard.publication` record (public `getRecord` on the
 * owner's PDS) and returns its URL, without a trailing slash, and name.
 *
 * - `uri` not shaped like `at://<did>/site.standard.publication/<rkey>` →
 *   `PublishError` mentioning "publication", without making a request.
 * - Record not found (`RecordNotFound`), or no `url` string on it →
 *   `PublishError` mentioning "publication".
 */
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
		throw new PublishError(`The publication ${uri} has no "url", so there's no site to publish to. Add one to the record.`);
	}
	return { url: withoutTrailingSlash(url), name: typeof name === 'string' ? name : '' };
}

/**
 * Refuses a file whose extension isn't an uploadable image type (any case):
 * png, jpg/jpeg, gif, webp, avif. Anything else (including svg, and no
 * extension) → `PublishError` naming the file. The type to upload with comes
 * from the file's contents (`imageTypeOf`); this only stops obviously wrong
 * files early, with a clear message.
 */
export function checkImageExtension(path: string): void {
	const ext = /\.([^./]+)$/.exec(path)?.[1] ?? '';
	if (!IMAGE_EXTENSIONS.has(ext.toLowerCase())) {
		throw new PublishError(`"${path}" can't be uploaded: only ${UPLOADABLE_TYPES} images can.`);
	}
}

/**
 * The real image type of a file, from its first bytes ("magic bytes"), or
 * `undefined` if it isn't one of the six uploadable types. Never reads past
 * the end of a short file.
 *
 * | Type       | Signature                                                     |
 * |------------|---------------------------------------------------------------|
 * | image/png  | bytes 0–7: `89 50 4E 47 0D 0A 1A 0A`                           |
 * | image/jpeg | bytes 0–2: `FF D8 FF`                                          |
 * | image/gif  | bytes 0–5: ASCII `GIF87a` or `GIF89a`                          |
 * | image/webp | bytes 0–3: ASCII `RIFF`, and bytes 8–11: ASCII `WEBP`          |
 * | image/avif | bytes 4–7: ASCII `ftyp`, and bytes 8–11: ASCII `avif` or `avis` |
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
 * The MIME type to upload an image with, checking both its name and its
 * contents:
 * 1. `checkImageExtension(path)` first, so obviously wrong files (doc.pdf) are
 *    refused with a clear message before looking at their bytes.
 * 2. Then `detectImageType(bytes)`. If it's `undefined` (e.g. a HEIC photo
 *    renamed to .jpg) → `PublishError` naming the file.
 * 3. Return the *detected* type: the bytes are the truth when the extension
 *    is a different image type (a WebP saved as .png).
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

/** Cover images over `MAX_COVER_BYTES` → `PublishError` naming the file and the limit. */
export function checkCoverSize(path: string, bytes: number): void {
	if (bytes > MAX_COVER_BYTES) {
		const megabytes = (bytes / 1_000_000).toFixed(1);
		throw new PublishError(`The cover image "${path}" is ${megabytes} MB, but covers can be at most 1 MB. Use a smaller image.`);
	}
}

/**
 * Uploads image bytes (`com.atproto.repo.uploadBlob`) and returns the blob
 * reference. The client sends no content type for binary input, so pass
 * `headers: { 'content-type': mimeType }` yourself.
 */
export async function uploadImage(rpc: Client, bytes: Uint8Array, mimeType: string): Promise<Blob> {
	const data = await ok(
		rpc.post('com.atproto.repo.uploadBlob', {
			input: bytes,
			headers: { 'content-type': mimeType },
		}),
	);
	return data.blob;
}

/**
 * `com.atproto.repo.getRecord` for one document.
 * Found → `{ value, cid }`. `RecordNotFound` → `undefined`. Other errors propagate.
 */
export async function getDocument(
	rpc: Client,
	did: Did,
	rkey: string,
): Promise<{ value: DocumentRecord; cid: string } | undefined> {
	const response = await rpc.get('com.atproto.repo.getRecord', {
		params: {
			repo: did,
			collection: DOCUMENT_COLLECTION,
			rkey: rkey,
		}
	});
	if (!response.ok) {
		switch (response.data.error) {
			case 'RecordNotFound':
				return undefined;
			default:
				throw new ClientResponseError(response);
		}
	}
	const cid = response.data.cid;
	if (!cid) throw new Error(`The PDS returned ${response.data.uri} without a CID.`);

	return {value: response.data.value as DocumentRecord, cid: cid};
}

/**
 * Every document in the repo (`com.atproto.repo.listRecords`, `limit: 100`),
 * following `cursor` until there is none.
 */
export async function listDocuments(
	rpc: Client,
	did: Did,
): Promise<Array<{ uri: string; cid: string; value: DocumentRecord }>> {
	const docArray: Array<{ uri: string; cid: string; value: DocumentRecord }> = [];
	let cursor: string | undefined;
	do {
		const response = await rpc.get('com.atproto.repo.listRecords', {
			params: {
				repo: did,
				collection: DOCUMENT_COLLECTION,
				limit: 100,
				cursor: cursor,
			}
		});
		if (!response.ok) throw new ClientResponseError(response);
		docArray.push(...response.data.records.map((r) => ({
			uri: r.uri,
			cid: r.cid,
			value: r.value as DocumentRecord,
		})));
		cursor = response.data.cursor;
	} while (cursor);

	return docArray;
}

/**
 * `com.atproto.repo.putRecord` with `validate: false` (PDSes don't know
 * site.standard.*). `swapRecord: null` means "must not exist yet"; a CID means
 * "must still be this version". A failed swap (`InvalidSwap`) → `PublishError`
 * telling the author the record changed on the PDS and to publish again.
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

/** `com.atproto.repo.deleteRecord` with `swapRecord`. `InvalidSwap` → same `PublishError` as `putDocument`. */
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

/**
 * A failed `swapRecord` means someone else changed the document between our
 * read and our write; that's for the author to retry. Anything else passes
 * through unchanged.
 */
function explainSwap(error: unknown, action: 'Publish' | 'Unpublish'): unknown {
	if (error instanceof ClientResponseError && error.error === 'InvalidSwap') {
		return new PublishError(`This document changed on your PDS while you were working on it. Run "${action} document" again.`);
	}
	return error;
}
