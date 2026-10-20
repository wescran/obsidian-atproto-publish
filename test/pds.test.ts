import { describe, expect, it } from 'vitest';

import { PublishError } from '../src/convert/document.ts';
import type { DocumentRecord } from '../src/convert/record.ts';
import {
	checkCoverSize,
	deleteDocument,
	detectImageType,
	getDocument,
	getPublication,
	checkImageExtension,
	imageTypeOf,
	listDocuments,
	MAX_COVER_BYTES,
	putDocument,
	uploadImage,
} from '../src/pds.ts';
import { fakePds, xrpcError } from './fake-pds.ts';

const DID = 'did:plc:abc123';
const CID = 'bafyreihdwdcefgh4dqkjv67uzcmw7ojee6xedzdetojuzjevtenxquvyku';
const BLOB_CID = 'bafkreidbaxlmy5vpiabsl2knlcgoken6lp63w45ug7ofd3fehel5pjb6hu';
const RKEY = '3mxd2abcdef22';
const DOC_URI = `at://${DID}/site.standard.document/${RKEY}`;
const PUBLICATION_URI = `at://${DID}/site.standard.publication/3mxcsltpg2k26`;

const RECORD: DocumentRecord = {
	$type: 'site.standard.document',
	site: PUBLICATION_URI,
	path: '/articles/welcome',
	title: 'Welcome',
	publishedAt: '2026-09-28T00:00:00.000Z',
	textContent: 'Hi',
	content: { $type: 'at.markpub.markdown', flavor: 'gfm', text: { $type: 'at.markpub.text', markdown: '# Hi' } },
};

/** Awaits a promise expected to reject with a PublishError, and returns its message. */
async function publishErrorFrom(promise: Promise<unknown>): Promise<string> {
	const error = await promise.then(
		() => undefined,
		(e: unknown) => e,
	);
	expect(error).toBeInstanceOf(PublishError);
	return (error as Error).message;
}

describe('checkImageExtension', () => {
	it.each(['photo.png', 'img/cat.jpg', 'pic.jpeg', 'anim.gif', 'pic.webp', 'pic.avif'])('accepts %s', (path) => {
		expect(() => checkImageExtension(path)).not.toThrow();
	});

	it.each(['CAT.JPEG', 'IMG_0001.JPG', 'Photo.Png'])('accepts an uppercase extension: %s', (path) => {
		expect(() => checkImageExtension(path)).not.toThrow();
	});

	it.each(['doc.pdf', 'logo.svg', 'noextension', 'photos.png/readme'])('refuses %s, naming it', (path) => {
		expect(() => checkImageExtension(path)).toThrow(PublishError);
		expect(() => checkImageExtension(path)).toThrow(path);
	});
});

/** Builds a fake file from ASCII strings and byte arrays, padded so it isn't suspiciously short. */
function file(...parts: Array<string | number[]>): Uint8Array {
	const bytes = parts.flatMap((part) => (typeof part === 'string' ? [...part].map((c) => c.charCodeAt(0)) : part));
	return new Uint8Array([...bytes, ...new Array<number>(16).fill(0)]);
}

const PNG = file([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const JPEG = file([0xff, 0xd8, 0xff, 0xe0]);
const GIF87 = file('GIF87a');
const GIF89 = file('GIF89a');
const WEBP = file('RIFF', [0x24, 0, 0, 0], 'WEBP', 'VP8 ');
const AVIF = file([0, 0, 0, 0x1c], 'ftyp', 'avif');
const AVIS = file([0, 0, 0, 0x1c], 'ftyp', 'avis');
const HEIC = file([0, 0, 0, 0x18], 'ftyp', 'heic');
const PDF = file('%PDF-1.7');

describe('detectImageType', () => {
	it.each([
		['PNG', PNG, 'image/png'],
		['JPEG', JPEG, 'image/jpeg'],
		['GIF87a', GIF87, 'image/gif'],
		['GIF89a', GIF89, 'image/gif'],
		['WebP', WEBP, 'image/webp'],
		['AVIF', AVIF, 'image/avif'],
		['AVIF sequence', AVIS, 'image/avif'],
	])('recognises %s', (_name, bytes, mime) => {
		expect(detectImageType(bytes)).toBe(mime);
	});

	it.each([
		['HEIC (an iPhone photo)', HEIC],
		['PDF', PDF],
		['a WAV file (RIFF, but not WebP)', file('RIFF', [0, 0, 0, 0], 'WAVE')],
		['GIF88a (not a real GIF version)', file('GIF88a')],
		['text', file('# Just a note')],
	])('does not recognise %s', (_name, bytes) => {
		expect(detectImageType(bytes)).toBeUndefined();
	});

	it.each([
		['an empty file', new Uint8Array([])],
		['the start of a PNG signature', new Uint8Array([0x89, 0x50])],
		['a bare RIFF header', new Uint8Array([...'RIFF'].map((c) => c.charCodeAt(0)))],
	])('copes with %s', (_name, bytes) => {
		expect(detectImageType(bytes)).toBeUndefined();
	});
});

describe('imageTypeOf', () => {
	it('returns the type when the name and contents agree', () => {
		expect(imageTypeOf('cat.png', PNG)).toBe('image/png');
	});

	it('trusts the contents when the extension names a different image type', () => {
		expect(imageTypeOf('cat.png', WEBP)).toBe('image/webp');
	});

	it('refuses a non-image renamed to an image extension, naming the file', () => {
		expect(() => imageTypeOf('photo.jpg', HEIC)).toThrow(PublishError);
		expect(() => imageTypeOf('photo.jpg', HEIC)).toThrow('photo.jpg');
	});

	it('refuses a non-image extension before looking at the contents', () => {
		expect(() => imageTypeOf('doc.pdf', PNG)).toThrow(PublishError);
		expect(() => imageTypeOf('doc.pdf', PNG)).toThrow('doc.pdf');
	});
});

describe('checkCoverSize', () => {
	it('allows a cover up to the limit', () => {
		expect(() => checkCoverSize('cover.png', MAX_COVER_BYTES)).not.toThrow();
	});

	it('refuses a bigger cover, naming the file', () => {
		expect(() => checkCoverSize('cover.png', MAX_COVER_BYTES + 1)).toThrow(PublishError);
		expect(() => checkCoverSize('cover.png', MAX_COVER_BYTES + 1)).toThrow('cover.png');
	});
});

describe('uploadImage', () => {
	const blob = { $type: 'blob', ref: { $link: BLOB_CID }, mimeType: 'image/png', size: 3 };

	it('posts the bytes with their content type and returns the blob', async () => {
		const pds = fakePds(() => ({ body: { blob } }));
		const bytes = new Uint8Array([1, 2, 3]);

		expect(await uploadImage(pds.client, bytes, 'image/png')).toEqual(blob);

		expect(pds.requests).toHaveLength(1);
		const [request] = pds.requests;
		expect(request?.method).toBe('POST');
		expect(request?.nsid).toBe('com.atproto.repo.uploadBlob');
		expect(request?.headers.get('content-type')).toBe('image/png');
		expect(request?.body).toEqual(bytes);
	});

	it('passes errors through', async () => {
		const pds = fakePds(() => xrpcError('PayloadTooLarge', 413));
		await expect(uploadImage(pds.client, new Uint8Array([1]), 'image/png')).rejects.toThrow();
	});
});

describe('getDocument', () => {
	it('asks for the document by repo, collection and record key', async () => {
		const pds = fakePds(() => ({ body: { uri: DOC_URI, cid: CID, value: RECORD } }));
		await getDocument(pds.client, DID, RKEY);
		expect(pds.requests[0]).toMatchObject({
			method: 'GET',
			nsid: 'com.atproto.repo.getRecord',
			params: { repo: DID, collection: 'site.standard.document', rkey: RKEY },
		});
	});

	it('returns the record and its CID', async () => {
		const pds = fakePds(() => ({ body: { uri: DOC_URI, cid: CID, value: RECORD } }));
		expect(await getDocument(pds.client, DID, RKEY)).toEqual({ value: RECORD, cid: CID });
	});

	it('returns undefined when the record does not exist', async () => {
		const pds = fakePds(() => xrpcError('RecordNotFound'));
		expect(await getDocument(pds.client, DID, RKEY)).toBeUndefined();
	});

	it('passes other errors through', async () => {
		const pds = fakePds(() => xrpcError('InternalServerError', 500));
		await expect(getDocument(pds.client, DID, RKEY)).rejects.toThrow();
	});
});

describe('listDocuments', () => {
	const entry = (n: number) => ({ uri: `at://${DID}/site.standard.document/${n}`, cid: CID, value: RECORD });

	it('follows the cursor through every page', async () => {
		const pds = fakePds((request) =>
			request.params.cursor === 'page-2'
				? { body: { records: [entry(3)] } }
				: { body: { records: [entry(1), entry(2)], cursor: 'page-2' } },
		);

		expect(await listDocuments(pds.client, DID)).toEqual([entry(1), entry(2), entry(3)]);

		expect(pds.requests).toHaveLength(2);
		expect(pds.requests[0]).toMatchObject({
			nsid: 'com.atproto.repo.listRecords',
			params: { repo: DID, collection: 'site.standard.document', limit: '100' },
		});
		expect(pds.requests[0]?.params).not.toHaveProperty('cursor');
		expect(pds.requests[1]?.params.cursor).toBe('page-2');
	});

	it('returns a single page (no cursor) in full', async () => {
		const pds = fakePds(() => ({ body: { records: [entry(1), entry(2)] } }));
		expect(await listDocuments(pds.client, DID)).toEqual([entry(1), entry(2)]);
		expect(pds.requests).toHaveLength(1);
	});

	it('returns an empty list for a repo with no documents', async () => {
		const pds = fakePds(() => ({ body: { records: [] } }));
		expect(await listDocuments(pds.client, DID)).toEqual([]);
	});
});

describe('putDocument', () => {
	it('writes the record without lexicon validation, as a create', async () => {
		const pds = fakePds(() => ({ body: { uri: DOC_URI, cid: CID } }));

		expect(await putDocument(pds.client, DID, RKEY, RECORD, null)).toEqual({ uri: DOC_URI, cid: CID });

		expect(pds.requests[0]).toMatchObject({ method: 'POST', nsid: 'com.atproto.repo.putRecord' });
		expect(pds.requests[0]?.body).toEqual({
			repo: DID,
			collection: 'site.standard.document',
			rkey: RKEY,
			record: RECORD,
			validate: false,
			swapRecord: null,
		});
	});

	it('sends the previous CID for an update', async () => {
		const pds = fakePds(() => ({ body: { uri: DOC_URI, cid: CID } }));
		await putDocument(pds.client, DID, RKEY, RECORD, 'bafyreiprevious');
		expect(pds.requests[0]?.body).toMatchObject({ swapRecord: 'bafyreiprevious' });
	});

	it('explains a failed swap', async () => {
		const pds = fakePds(() => xrpcError('InvalidSwap'));
		expect(await publishErrorFrom(putDocument(pds.client, DID, RKEY, RECORD, null))).toMatch(/changed/i);
	});

	it('passes other errors through unchanged', async () => {
		const pds = fakePds(() => xrpcError('InternalServerError', 500));
		const error = await putDocument(pds.client, DID, RKEY, RECORD, null).catch((e: unknown) => e);
		expect(error).toBeInstanceOf(Error);
		expect(error).not.toBeInstanceOf(PublishError);
	});
});

describe('deleteDocument', () => {
	it('deletes with a swap on the current CID', async () => {
		const pds = fakePds(() => ({ body: {} }));
		await deleteDocument(pds.client, DID, RKEY, CID);
		expect(pds.requests[0]).toMatchObject({ method: 'POST', nsid: 'com.atproto.repo.deleteRecord' });
		expect(pds.requests[0]?.body).toEqual({
			repo: DID,
			collection: 'site.standard.document',
			rkey: RKEY,
			swapRecord: CID,
		});
	});

	it('explains a failed swap', async () => {
		const pds = fakePds(() => xrpcError('InvalidSwap'));
		expect(await publishErrorFrom(deleteDocument(pds.client, DID, RKEY, CID))).toMatch(/changed/i);
	});
});

describe('getPublication', () => {
	it('reads the publication record and returns its URL and name', async () => {
		const pds = fakePds(() => ({
			body: {
				uri: PUBLICATION_URI,
				cid: CID,
				value: { $type: 'site.standard.publication', url: 'https://cranlab.ca/', name: 'CranLab' },
			},
		}));

		expect(await getPublication(pds.client, PUBLICATION_URI)).toEqual({ url: 'https://cranlab.ca', name: 'CranLab' });
		expect(pds.requests[0]).toMatchObject({
			nsid: 'com.atproto.repo.getRecord',
			params: { repo: DID, collection: 'site.standard.publication', rkey: '3mxcsltpg2k26' },
		});
	});

	it.each(['', 'https://cranlab.ca', DOC_URI, `at://${DID}/site.standard.publication/`])(
		'refuses %j without asking the PDS',
		async (uri) => {
			const pds = fakePds(() => ({ body: {} }));
			expect(await publishErrorFrom(getPublication(pds.client, uri))).toMatch(/publication/i);
			expect(pds.requests).toHaveLength(0);
		},
	);

	it('explains a publication that does not exist', async () => {
		const pds = fakePds(() => xrpcError('RecordNotFound'));
		expect(await publishErrorFrom(getPublication(pds.client, PUBLICATION_URI))).toMatch(/publication/i);
	});

	it('explains a publication without a URL', async () => {
		const pds = fakePds(() => ({
			body: { uri: PUBLICATION_URI, cid: CID, value: { $type: 'site.standard.publication', name: 'CranLab' } },
		}));
		expect(await publishErrorFrom(getPublication(pds.client, PUBLICATION_URI))).toMatch(/publication/i);
	});
});
