// What the server's tests share: a server on its own port, with in-memory workspaces, closed when the file ends.
import { mkdtempSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after } from 'node:test';
import type { Limit } from '../src/limit.ts';
import { setMailer, type Mail } from '../src/mail.ts';
import { createHttpServer } from '../src/server.ts';
import { Workspaces } from '../src/workspaces.ts';

// The mail the servers would send is kept here instead.
export const mailbox: Mail[] = [];
setMailer(async (mail) => void mailbox.push(mail));
/** The code in the newest link sent to an address. */
export const codeSentTo = (email: string) => /#\/join\/(inv_[a-z0-9-]+_[0-9a-f]{40})/.exec(mailbox.findLast((m) => m.to === email)?.text ?? '')?.[1];

// What this machine keeps for its own sessions stays out of the tests: a setup run here would take it for a
// machine connected before, and keep it again under the new names.
for (const name of ['PELAGO_URL', 'PELAGO_AGENT_TOKEN', 'LATTICE_URL', 'LATTICE_AGENT_TOKEN']) delete process.env[name];

export const closers: (() => Promise<void>)[] = [];
after(async () => {
  for (const close of closers) await close();
});

/** A server on its own port with in-memory databases and the repository's packs, read in place (test/map.ts). */
export async function serve(auth: 'off' | 'tokens', limits?: { open?: Limit; deliveries?: Limit; refused?: Limit; token?: Limit }, sites?: Record<string, string>) {
  const root = mkdtempSync(join(tmpdir(), 'pelago-platform-'));
  const workspaces = new Workspaces({ dataDir: null, rootDir: join(root, 'workspaces'), packsDir: join(import.meta.dirname, '..', 'packs') });
  // The server checks the Host header against its port, so the port must be known first.
  const probe = createHttpServer(workspaces, 0);
  await new Promise<void>((r) => probe.listen(0, '127.0.0.1', r));
  const port = (probe.address() as AddressInfo).port;
  await new Promise((r) => probe.close(r));
  const server = createHttpServer(workspaces, port, { auth, limits, sites });
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
  /** Add a member as an admin does, and sign them in by the link they were sent: their token. */
  const member = async (admin: string, body: { email: string; name?: string; admin?: boolean }) => {
    const added = await call('/api/member_add', admin, body);
    if (added.status !== 200) throw new Error(added.error);
    return (await call('/connect/join', undefined, { code: codeSentTo(body.email) })).token as string;
  };
  return { workspaces, call, base, member };
}
