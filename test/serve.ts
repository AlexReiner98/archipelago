// What the server's tests share: a server on its own port, with in-memory workspaces, closed when the file ends.
import { cpSync, mkdtempSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after } from 'node:test';
import type { GithubApp } from '../src/github-app.ts';
import type { Limit } from '../src/limit.ts';
import { createHttpServer } from '../src/server.ts';
import { Workspaces } from '../src/workspaces.ts';

// What this machine keeps for its own sessions stays out of the tests: a setup run here would take it for a
// machine connected before, and keep it again under the new names.
for (const name of ['PELAGO_URL', 'PELAGO_AGENT_TOKEN', 'LATTICE_URL', 'LATTICE_AGENT_TOKEN']) delete process.env[name];

export const closers: (() => Promise<void>)[] = [];
after(async () => {
  for (const close of closers) await close();
});

/** A server on its own port with in-memory databases and its own copy of the packs. */
export async function serve(auth: 'off' | 'tokens', github?: (origin: string) => GithubApp, limits?: { open?: Limit; deliveries?: Limit; refused?: Limit }) {
  const root = mkdtempSync(join(tmpdir(), 'pelago-platform-'));
  cpSync(join(import.meta.dirname, '..', 'packs'), join(root, 'packs'), { recursive: true });
  const workspaces = new Workspaces({ dataDir: null, rootDir: join(root, 'workspaces'), packsDir: join(root, 'packs') });
  // The server checks the Host header against its port, so the port must be known first.
  const probe = createHttpServer(workspaces, 0);
  await new Promise<void>((r) => probe.listen(0, '127.0.0.1', r));
  const port = (probe.address() as AddressInfo).port;
  await new Promise((r) => probe.close(r));
  const server = createHttpServer(workspaces, port, { auth, github: github?.(`http://127.0.0.1:${port}`), limits });
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
  return { workspaces, call, base };
}
