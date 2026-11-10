// What the server's tests share: a server on its own port, with in-memory workspaces, closed when the file ends.
import { mkdtempSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after } from 'node:test';
import type { Limit } from '../src/limit.ts';
import { normalEmail, setMailer, type Mail } from '../src/mail.ts';
import { linkFor } from '../src/members.ts';
import { createHttpServer } from '../src/server.ts';
import { Workspaces } from '../src/workspaces.ts';

// The mail the servers would send is kept here instead.
export const mailbox: Mail[] = [];
setMailer(async (mail) => void mailbox.push(mail));
/** The code in the newest sign-in mail to an address, for its workspace named `name` (or the first). */
export const codeSentTo = (email: string, name?: string) => {
  const text = mailbox.findLast((m) => m.to === email)?.text ?? '';
  return [...text.matchAll(/^(.+): ([0-9A-Z]{4}-[0-9A-Z]{4})$/gm)].find((m) => !name || m[1] === name)?.[2];
};

// What this machine keeps for its own sessions stays out of the tests: a setup run here would keep it again.
for (const name of ['PELAGO_URL', 'PELAGO_AGENT_TOKEN']) delete process.env[name];

export const closers: (() => Promise<void>)[] = [];
after(async () => {
  for (const close of closers) await close();
});

/**
 * A server on its own port with in-memory databases and the repository's packs, read in place (test/map.ts). A folder
 * given is read in their place (packsWith in test/map.ts, for a test pack beside them); a list is read after them, as
 * PELAGO_PACKS names more folders (src/config.ts).
 */
export async function serve(auth: 'off' | 'tokens', limits?: { open?: Limit; deliveries?: Limit; refused?: Limit; token?: Limit; signIn?: Limit }, sites?: Record<string, string>, packs: string | string[] = []) {
  const root = mkdtempSync(join(tmpdir(), 'pelago-platform-'));
  const packsDir = typeof packs === 'string' ? packs : join(import.meta.dirname, '..', 'packs');
  // Every server here also draws the canvas as a flow by default, as the canvas pack did before it went to the hosted
  // service (test/fixtures/house/flowing): the look these browser tests were written against.
  const more = [...(typeof packs === 'string' ? [] : packs), join(import.meta.dirname, 'fixtures', 'house')];
  const workspaces = new Workspaces({ dataDir: null, rootDir: join(root, 'workspaces'), packsDir, packDirs: [packsDir, ...more] });
  // The server checks the Host header against its port, so the port must be known first.
  const probe = createHttpServer(workspaces, 0);
  await new Promise<void>((r) => probe.listen(0, '127.0.0.1', r));
  const port = (probe.address() as AddressInfo).port;
  await new Promise((r) => probe.close(r));
  // Drawn as on a dev server: a page on 127.0.0.1 frames its drawings at localhost (src/draw-host.ts).
  const server = createHttpServer(workspaces, port, { auth, limits, sites, draw: { loopback: auth === 'off' } });
  await new Promise<void>((r) => server.listen(port, '127.0.0.1', r));
  closers.push(async () => {
    server.close();
    await workspaces.closeAll();
  });

  const base = `http://127.0.0.1:${port}`;
  const call = async (path: string, token?: string, body?: unknown, method = 'POST') => {
    const res = await fetch(base + path, {
      method,
      headers: { ...(method === 'POST' && { 'content-type': 'application/json' }), ...(token && { authorization: `Bearer ${token}` }) },
      body: method === 'POST' ? JSON.stringify(body ?? {}) : undefined,
    });
    const text = await res.text();
    let json: any;
    try {
      json = JSON.parse(text);
    } catch {
      json = { text };
    }
    return { status: res.status, ...json };
  };
  /**
   * Add a member as an admin does, and sign them in: their token. The mail carries only a code, and asking for one is
   * limited to once a minute an address, so the sign-in is made here the way the server makes one, and traded at the door.
   */
  const member = async (admin: string, body: { email: string; name?: string; admin?: boolean }) => {
    const added = await call('/api/member_add', admin, body);
    if (added.status !== 200) throw new Error(added.error);
    const workspace = (await call('/whoami', admin, undefined, 'GET')).workspace.id as string;
    const link = await linkFor((await workspaces.get(workspace)).pelago.db, workspace, normalEmail(body.email)!, 60_000);
    return (await call('/connect/join', undefined, { code: link.split('/join/')[1] })).token as string;
  };
  return { workspaces, call, base, member };
}
