// Server packs: what a server does that no one workspace's map can (sell a workspace, take a payment's webhook), by
// the pack contract. A server pack is a folder with a pack.json marked tier "server" and a handler.js, kept in one of
// the folders the server's configuration names (PELAGO_SERVER_PACKS, separated as PATH is): so a private one is a
// folder on the machine the server runs on, never a file of this repository. Being there enables it; no workspace
// owner can. Its handler runs in the same sandbox as any pack's (src/packhost.ts), one process for the server.
//
// What it may declare: public pages and entries, and webhooks, all under /x/<pack>/ (src/server-routes.ts); and the
// server acts it may ask for, from the kernel's closed list (src/server-acts.ts). It gets no database, no map, no
// token and no secret: the kernel checks a webhook's signature with a secret only the server's environment holds.

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { delimiter, join, resolve } from 'node:path';
import { env } from './env.ts';

/** The acts a server pack may ask the kernel for, each only if it declares it. */
export const SERVER_ACTS = ['workspace.create', 'workspace.admit', 'workspace.limit', 'signin.link', 'mail.send'] as const;
export type ServerAct = (typeof SERVER_ACTS)[number];

const ID = /^[a-z][a-z0-9_]{0,39}$/;
const NAME = /^[a-z][a-z0-9_]{0,39}$/;
const FILE = /^[a-z0-9][a-z0-9_.-]{0,60}\.(html|js|css|svg|png|webp)$/;

export interface ServerPackFile {
  id: string;
  version: string;
  title: string;
  description?: string;
  tier: 'server';
  /** The server acts it may ask for. */
  acts?: ServerAct[];
  /** Entries of its handler anyone may call with no login, as POST /x/<pack>/<id>, each answering JSON. */
  entries?: { id: string; description?: string; limit_ms?: number }[];
  /** Pages anyone may open, as GET /x/<pack>/<id>: an HTML file in its public/ folder, under a strict policy. */
  pages?: { id: string; file: string }[];
  /** POST /x/<pack>/hook/<id>, checked before the handler sees it: the HMAC-SHA256 of the raw body with the secret named. */
  webhooks?: { id: string; secret: string; header?: string; format?: 'prefixed' | 'hex' }[];
}

export interface ServerPack {
  file: ServerPackFile;
  folder: string;
}

/** Why a pack.json is not a server pack it may be, as sentences; none when it is. */
export function checkServerPack(p: Partial<ServerPackFile>, folder: string): string[] {
  const problems: string[] = [];
  if (!p.id || !ID.test(p.id)) problems.push('its id is lowercase letters, digits and underscores, starting with a letter');
  if (p.tier !== 'server') problems.push('it is not marked tier "server"');
  if (!p.version || !p.title) problems.push('it needs a version and a title');
  for (const act of p.acts ?? []) if (!(SERVER_ACTS as readonly string[]).includes(act)) problems.push(`"${act}" is not a server act: one of ${SERVER_ACTS.join(', ')}`);
  const names = [...(p.entries ?? []), ...(p.pages ?? [])].map((e) => e.id);
  for (const name of names) if (!NAME.test(name) || name === 'hook' || name === 'public') problems.push(`"${name}" cannot name an entry or a page`);
  if (new Set(names).size !== names.length) problems.push('an entry and a page share a name');
  for (const page of p.pages ?? []) if (!FILE.test(page.file) || !existsSync(join(folder, 'public', page.file))) problems.push(`page "${page.id}" names no file in its public/ folder`);
  for (const hook of p.webhooks ?? []) {
    if (!NAME.test(hook.id) || !NAME.test(hook.secret ?? '')) problems.push(`webhook "${hook.id}" needs an id and the name of its secret`);
    if (hook.format && !['prefixed', 'hex'].includes(hook.format)) problems.push(`webhook "${hook.id}": its format is prefixed (sha256=<hex>) or hex`);
  }
  if ((p.entries?.length || p.webhooks?.length) && !existsSync(join(folder, 'handler.js'))) problems.push('it has entries or webhooks and no handler.js');
  return problems;
}

/** The folders server packs are kept in, from the configuration. */
export const serverPackDirs = (given = env('SERVER_PACKS')): string[] => (given ?? '').split(delimiter).map((d) => d.trim()).filter(Boolean).map((d) => resolve(d));

/** Every server pack in those folders. One that is not right is left out and said why, never half loaded. */
export function loadServerPacks(dirs = serverPackDirs()): { packs: ServerPack[]; refused: { folder: string; why: string[] }[] } {
  const packs: ServerPack[] = [];
  const refused: { folder: string; why: string[] }[] = [];
  for (const dir of dirs) {
    if (!existsSync(dir)) {
      refused.push({ folder: dir, why: ['there is no such folder'] });
      continue;
    }
    for (const name of readdirSync(dir, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name).sort()) {
      const folder = join(dir, name);
      const at = join(folder, 'pack.json');
      if (!existsSync(at)) continue;
      let file: Partial<ServerPackFile>;
      try {
        file = JSON.parse(readFileSync(at, 'utf8'));
      } catch (err) {
        refused.push({ folder, why: [`its pack.json is not JSON: ${(err as Error).message}`] });
        continue;
      }
      const why = checkServerPack(file, folder);
      if (!why.length && packs.some((p) => p.file.id === file.id)) why.push(`another server pack is "${file.id}" already`);
      if (why.length) refused.push({ folder, why });
      else packs.push({ file: file as ServerPackFile, folder });
    }
  }
  return { packs, refused };
}

/** The secret a webhook is checked with, from the server's environment: PELAGO_SECRET_<PACK>_<NAME>. */
export const serverSecret = (pack: string, name: string): string | undefined => env(`SECRET_${pack}_${name}`.toUpperCase());
