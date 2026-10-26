// The live map, here: `npm run pull` copies the map this machine is connected to (PELAGO_URL, with its agent
// token) into the local server's data folder, so a change is tried on real data before it is pushed.
// `npm run pull -- <name>` copies another map this machine is connected to instead: the MCP server of that name, as
// Claude Code reaches it from here (.mcp.json, this project's servers in ~/.claude.json, then the user's).
//
// The copy is the whole workspace, private items included, as the owner lets agents download it (Workspace page,
// Backups): every item and link at the head of its log, with its keys wrapped again under this machine's sealing key so
// it opens here as it did there, and no link to an item the copy does not hold. It acts on nothing outside: its
// automations are paused and its secrets left behind (those in its settings were sealed with the hosted server's key,
// so here they read as not set). What was in the data folder is kept beside it, as data-backup-<time>.
//
// With the local server stopped, the copy goes in place at once. Under `npm run dev` the server is asked to
// restart, and the copy goes in place while it is down. Under `npm start`, stop it first.

import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { gzipSync } from 'node:zlib';
import { parseBackup, parseVault, readable, restore, type Dump } from './backup.ts';
import { rewrap, type VaultDump } from './vault.ts';
import { loadConfig } from './config.ts';
import { openDb } from './db.ts';
import { configureSecrets } from './secrets.ts';

/** Where a pulled copy waits until the data folder can be swapped for it. */
export const pulledDir = (dataDir: string) => `${dataDir}.pulled`;

/** Put a pulled copy in place of the data folder, keeping the old one beside it. Only with no server on the folder. */
export function takePulled(dataDir: string): string | undefined {
  const pulled = pulledDir(dataDir);
  if (!existsSync(pulled)) return undefined;
  const kept = `${dataDir}-backup-${new Date().toISOString().replaceAll(':', '-')}`;
  if (existsSync(dataDir)) renameSync(dataDir, kept);
  renameSync(pulled, dataDir);
  return kept;
}

/**
 * A downloaded backup made a data folder beside `dataDir`, to go in place of it: its keys, sent wrapped under `keys.key`,
 * wrapped again under the sealing key of the server on `dataDir`, kept where that server keeps it (src/server.ts).
 * Under a key of this process only, the copy's keys would open nothing once it ends. Its secrets stay behind and its
 * automations are paused, so the copy acts on nothing outside.
 */
export async function takeIn(dataDir: string, backup: Dump, keys?: { vault: VaultDump; key: Buffer }) {
  configureSecrets(join(dataDir, '..', 'workspaces'));
  if (keys) backup.vault = { ...rewrap(keys.vault, keys.key), secrets: [] };
  const target = pulledDir(dataDir);
  rmSync(target, { recursive: true, force: true });
  const db = await openDb(target);
  try {
    // Its items as the file's log makes them, read before they go in, so its automations can be paused on the way.
    const clear = await readable(db, backup);
    let paused = 0;
    for (const row of clear.tables.entity ?? []) if (row.type === 'sys.automation' && row.status === 'enabled') (row.status = 'paused'), paused++;
    return { counts: await restore(db, clear, 'default'), paused, vault: backup.vault };
  } finally {
    await db.close();
  }
}

type Server = { url?: string; headers?: Record<string, string> };
const readJson = (file: string): any => {
  try {
    return JSON.parse(readFileSync(file, 'utf8'));
  } catch {
    return undefined;
  }
};

/** A map this machine reaches under a name, as Claude Code does from cwd: its address and agent token, never printed. */
export function connection(name: string, cwd = process.cwd(), home = homedir(), env = process.env): { url: string; token: string } | undefined {
  const norm = (p: string) => `${p.replaceAll('\\', '/').replace(/\/$/, '').toLowerCase()}/`;
  const user = readJson(join(home, '.claude.json')) ?? {};
  // A project's servers apply in it and in every folder under it (a worktree of it too), the nearest first.
  const projects = Object.entries((user.projects ?? {}) as Record<string, { mcpServers?: Record<string, Server> }>)
    .filter(([dir]) => norm(cwd).startsWith(norm(dir)))
    .sort(([a], [b]) => b.length - a.length)
    .map(([, p]) => p.mcpServers);
  const server: Server | undefined = [readJson(join(cwd, '.mcp.json'))?.mcpServers, ...projects, user.mcpServers].map((s) => s?.[name]).find(Boolean);
  // As Claude Code reads it: ${NAME} and ${NAME:-default} from the environment.
  const expand = (v = '') => v.replace(/\$\{(\w+)(?::-([^}]*))?\}/g, (_, k: string, d = '') => env[k] || d);
  const url = expand(server?.url).replace(/\/mcp\/?$/, '');
  const token = expand(Object.entries(server?.headers ?? {}).find(([k]) => k.toLowerCase() === 'authorization')?.[1]).replace(/^Bearer\s+/i, '');
  return url && token ? { url, token } : undefined;
}

const fail = (why: string): never => {
  console.error(why);
  process.exit(1);
};

async function pull() {
  const name = process.argv[2];
  const named = name ? connection(name) : undefined;
  if (name && !named) return fail(`No map named "${name}" is connected here: no MCP server of that name with an address and a token.`);
  const url = (named?.url ?? process.env.PELAGO_URL)?.replace(/\/$/, '');
  const token = named?.token ?? process.env.PELAGO_AGENT_TOKEN;
  if (!url || !token) return fail('This machine is not connected to a hosted map: PELAGO_URL and PELAGO_AGENT_TOKEN are set by the setup.');
  if (['localhost', '127.0.0.1', '[::1]'].includes(new URL(url).hostname)) return fail(`PELAGO_URL is this machine (${url}): there is nothing to pull.`);
  const { dataDir, port } = loadConfig();

  const asked = await fetch(`${url}/agent/query`, { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify({ name: 'backup_download' }) });
  const answer = (await asked.json().catch(() => ({}))) as { result?: { path: string; vault_path?: string; vault_key?: string; name: string; taken: string }; error?: string };
  if (!answer.result) return fail(`${url} gave no backup: ${answer.error ?? `HTTP ${asked.status}`}`);
  const got = await fetch(url + answer.result.path);
  if (!got.ok) return fail(`The backup link gave HTTP ${got.status}: ask again.`);
  const file = Buffer.from(await got.arrayBuffer());
  const saved = join(dirname(dataDir), 'backups', 'pulled', answer.result.name);
  mkdirSync(dirname(saved), { recursive: true });
  writeFileSync(saved, file);

  // A sealed backup's keys, under the key the answer gave, wrapped again under this machine's own and kept beside it.
  let keys: { vault: VaultDump; key: Buffer } | undefined;
  if (answer.result.vault_path && answer.result.vault_key) {
    const got = await fetch(url + answer.result.vault_path);
    if (!got.ok) return fail(`The link to its keys gave HTTP ${got.status}: ask again.`);
    keys = { vault: parseVault(Buffer.from(await got.arrayBuffer())), key: Buffer.from(answer.result.vault_key, 'base64url') };
  }
  const target = pulledDir(dataDir);
  const { counts, paused, vault } = await takeIn(dataDir, parseBackup(file), keys);
  if (vault) writeFileSync(saved.replace('.json.gz', '.vault.json.gz'), gzipSync(JSON.stringify(vault)));
  console.log(`Pulled ${url} as of ${answer.result.taken}: ${counts.entity} items, ${counts.relation} links, ${counts.event} events; ${paused} automations paused. Kept as ${saved}`);

  const health = () => fetch(`http://127.0.0.1:${port}/health`).then((r) => r.json() as Promise<{ started: string }>, () => undefined);
  const before = await health();
  if (!before) return console.log(`In place in ${dataDir}; what was there is kept as ${takePulled(dataDir) ?? 'nothing'}.`);
  const restart = await fetch(`http://127.0.0.1:${port}/agent/revise`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action: 'restart' }) }).then((r) => r.ok, () => false);
  if (!restart) return console.log(`The local server is not in dev mode: stop it, and the copy waiting in ${target} goes in place when it next starts under npm run dev.`);
  for (let i = 0; i < 60; i++) {
    await new Promise((r) => setTimeout(r, 500));
    const now = await health();
    if (now && now.started !== before.started)
      return existsSync(target)
        ? console.log(`The local server restarted, but npm run dev was started before it knew to take the copy: stop it and start it again, and the copy in ${target} goes in place.`)
        : console.log(`The local server restarted on the pulled map (http://127.0.0.1:${port}).`);
  }
  fail(`The local server did not come back within 30 seconds: see runs/dev-server.log. The copy is in ${existsSync(target) ? target : dataDir}.`);
}

if (import.meta.main) await pull();
