/**
 * A fake PDS for unit tests: a `Client` whose requests are recorded and
 * answered by a function, with no network involved.
 */
import { Client, type FetchHandler } from '@atcute/client';

export interface FakeRequest {
	method: string;
	/** e.g. `com.atproto.repo.getRecord` */
	nsid: string;
	params: Record<string, string>;
	headers: Headers;
	/** Parsed JSON for JSON bodies, raw bytes for binary bodies, undefined for none. */
	body: unknown;
}

export interface Reply {
	status?: number;
	body?: unknown;
}

export function fakePds(reply: (request: FakeRequest) => Reply | Promise<Reply>) {
	const requests: FakeRequest[] = [];

	const handler: FetchHandler = async (pathname, init) => {
		const url = new URL(pathname, 'https://pds.test');
		const request: FakeRequest = {
			method: (init.method ?? 'GET').toUpperCase(),
			nsid: url.pathname.replace(/^\/xrpc\//, ''),
			params: Object.fromEntries(url.searchParams),
			headers: new Headers(init.headers),
			body: await readBody(init.body),
		};
		requests.push(request);

		const { status = 200, body = {} } = await reply(request);
		return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
	};

	return { client: new Client({ handler }), requests };
}

/** An XRPC error reply, as a PDS sends it. */
export function xrpcError(error: string, status = 400): Reply {
	return { status, body: { error, message: `${error} (from the fake PDS)` } };
}

async function readBody(body: RequestInit['body']): Promise<unknown> {
	if (body === undefined || body === null) return undefined;
	if (typeof body === 'string') return JSON.parse(body);
	if (body instanceof ArrayBuffer) return new Uint8Array(body);
	if (ArrayBuffer.isView(body)) return new Uint8Array(body.buffer, body.byteOffset, body.byteLength);
	return new Uint8Array(await new Response(body).arrayBuffer());
}
