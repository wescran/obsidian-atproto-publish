/**
 * Live tests against the real network. Skipped unless LIVE=1:
 *
 *   LIVE=1 npx vitest run test/live.test.ts
 *
 * Add ATPROTO_APP_PASSWORD=… to also test logging in. Use an app password,
 * never your main password, and don't put it in a file.
 *
 * Read-only: nothing here writes to the PDS.
 */
import { describe, expect, it } from 'vitest';

import { PublishError } from '../src/convert/document.ts';
import { connect, getPublication, publicClient, resolveAccount } from '../src/pds.ts';

// The project has no Node types on purpose (the plugin also runs on mobile); tests run in Node.
declare const process: { env: Record<string, string | undefined> };

const HANDLE = 'cranlab.ca';
const DID = 'did:plc:ogl52fc2rdooori2ayf74can';
const PDS = 'https://weslandia.ca';
const PUBLICATION = `at://${DID}/site.standard.publication/3mxcsltpg2k26`;

const password = process.env.ATPROTO_APP_PASSWORD;

describe.skipIf(!process.env.LIVE)('live: identity and publication', () => {
	it('resolves a handle to its DID and PDS', async () => {
		expect(await resolveAccount(HANDLE)).toEqual({ did: DID, pds: PDS });
	});

	it('resolves a DID too', async () => {
		expect(await resolveAccount(DID)).toEqual({ did: DID, pds: PDS });
	});

	it('explains a handle that does not exist', async () => {
		await expect(resolveAccount('no-such-handle.invalid')).rejects.toBeInstanceOf(PublishError);
	});

	it('reads the publication from its PDS', async () => {
		expect(await getPublication(publicClient(PDS), PUBLICATION)).toEqual({ url: 'https://cranlab.ca', name: 'CranLab' });
	});
});

describe.skipIf(!process.env.LIVE || !password)('live: logging in', () => {
	it('logs in with the app password', async () => {
		const account = await resolveAccount(HANDLE);
		const rpc = await connect(account, HANDLE, password ?? '');
		const session = await rpc.get('com.atproto.server.getSession', {});
		expect(session.ok && session.data.did).toBe(DID);
	});

	it('explains a wrong password', async () => {
		const account = await resolveAccount(HANDLE);
		await expect(connect(account, HANDLE, 'wrong-wrong-wrong-wrong')).rejects.toBeInstanceOf(PublishError);
	});
});
