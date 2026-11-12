// The files a server pack serves (task e_mejvx37k): GET /x/<pack>/files/<id>, and the one mounted at setup on
// /connect/setup.mjs. Each is a file of the pack's files/ folder, sent as it is but for the values the kernel fills in
// ({origin}, {tokens}, {version}, {rules}), and only those its declaration names. Its version is the hash of what its
// pack hands out (every file it declares, as written, and the working rules); a session whose hook says another
// version is told its folder is behind (src/hook-answers.ts).
//
// What is public is only what whoever runs the server put in a pack's folder: nothing here reads a map.

import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import type { ServerResponse } from 'node:http';
import { join } from 'node:path';
import { GUARD, json, PRIVATE } from './reply.ts';
import { loadServerPacks, type ServerPack, type ServerPackFile } from '../../../src/server-packs.ts';
import type { FILLS } from '../../../src/server-reach.ts';
import { workingRules } from '../../../src/working-rules.ts';

export interface FileCall {
  /** The address this server is reached at. */
  origin: string;
  /** Whether this server asks for a token. */
  tokens: boolean;
  /** The pack's folder; found among the server's packs by the pack's id when not given. */
  folder?: string;
}

type Fill = (typeof FILLS)[number];

/** The working rules as handed out, read once. */
let rules: string | undefined;
const theRules = () => (rules ??= workingRules());

/** The server's own packs, read once, for a call that does not say where a pack's folder is. */
let own: ServerPack[] | undefined;
const ownPacks = () => (own ??= loadServerPacks().packs);
const folderOf = (pack: ServerPackFile, at: FileCall) => at.folder ?? ownPacks().find((p) => p.file.id === pack.id)?.folder;

const raw = (folder: string, file: string) => readFileSync(join(folder, 'files', file), 'utf8');

/** The version of what a pack hands out: a mark that moves when any file it declares does, or the rules. */
export function filesVersion(pack: ServerPackFile, folder: string): string {
  const files = [...(pack.reach.server.files ?? [])].sort((a, b) => a.id.localeCompare(b.id));
  return createHash('sha256')
    .update([...files.map((f) => `${f.id}\n${raw(folder, f.file)}`), theRules()].join('\n'))
    .digest('hex')
    .slice(0, 12);
}

/**
 * A file filled with the values its declaration names, each where {name} stands: in a script as a JavaScript value
 * (a string or a boolean, so `const ORIGIN = {origin};`), in any other file as its text. One pass, so a value that
 * holds {name} (the rules may) is not filled again.
 */
export function filled(pack: ServerPackFile, folder: string, id: string, at: FileCall): { type: string; body: string } | undefined {
  const f = pack.reach.server.files?.find((x) => x.id === id);
  if (!f) return undefined;
  const fill = new Set<string>(f.fill ?? []);
  const values: Record<Fill, () => string | boolean> = { origin: () => at.origin, tokens: () => at.tokens, version: () => filesVersion(pack, folder), rules: theRules };
  const said = (v: string | boolean) => (f.type === 'text/javascript' ? JSON.stringify(v) : String(v));
  const body = raw(folder, f.file).replace(/\{(origin|tokens|version|rules)\}/g, (whole, name: Fill) => (fill.has(name) ? said(values[name]()) : whole));
  return { type: f.type, body };
}

/** Send a file of a pack's files/ folder, filled: public, kept by nobody. */
export async function serveFile(res: ServerResponse, pack: ServerPackFile, id: string, at: FileCall): Promise<unknown> {
  const folder = folderOf(pack, at);
  const file = folder ? filled(pack, folder, id, at) : undefined;
  if (!file) return json(res, 404, { error: 'Not found' }, PRIVATE);
  res.writeHead(200, { ...GUARD, 'cache-control': 'no-store', 'content-type': `${file.type}; charset=utf-8` });
  return res.end(file.body);
}

/** The pack that hands the setup out (mounts.setup), with the file it mounts there, if one does. */
export function setupPack(packs: ServerPack[] = ownPacks()): { pack: ServerPack; id: string } | undefined {
  for (const pack of packs) {
    const id = pack.file.reach.server.mounts?.setup;
    if (id) return { pack, id };
  }
  return undefined;
}

/** The version of the kernel's own setup, said by src/connect.ts: what a folder is checked against while no pack hands one out. */
let handedOut: string | undefined;
export const handsOut = (version: string) => void (handedOut = version);

/** The version a session's folder is checked against: the setup pack's, or else the kernel's own. */
export function setupVersion(packs?: ServerPack[]): string | undefined {
  const setup = setupPack(packs);
  return setup ? filesVersion(setup.pack.file, setup.pack.folder) : handedOut;
}

/** Whether a session's folder is behind what this server hands out, by the version its hook says. */
export const setupBehind = (said: string | undefined, packs?: ServerPack[]): boolean => {
  const version = setupVersion(packs);
  return version !== undefined && said !== version;
};
