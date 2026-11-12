// The folders workspace packs are read from: the server's own (packsDir), then those PELAGO_PACKS names, so a pack the
// hosted service keeps to itself is a folder on its machine, never a file of the open repository. One id is one pack.
// A server pack (reach.server, src/server-packs.ts) is the server's, but it may carry a workspace half beside it: a
// workspace.json in its folder, a manifest of the same id with no server reach, read here as any workspace pack is, so
// one subsystem is one pack with both a server process and what it says on a map (task e_jpcsbt48).

import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { isRequired, isServerPack, readManifest, type Manifest } from './manifest.ts';

/** The server's own packs folder, beside its code: where its internal packs are read from, whatever else a registry reads. */
export const OWN_PACKS = join(import.meta.dirname, '..', '..', '..', 'packs');

/**
 * Each pack.json text this process has read, by its SHA-256: the text the log keeps for a pack fact naming that hash
 * (src/packstate.ts) is the one that was hashed, never the file as it is by the time the fact is written.
 */
const read = new Map<string, string>();

/** The pack.json this process read with that hash, if it has read one. */
export const manifestRead = (hash: string | undefined): string | undefined => (hash ? read.get(hash) : undefined);

export interface PackFolders<P> {
  /** Each workspace pack found, by id. */
  found: Map<string, P>;
  /** The SHA-256 of each pack's pack.json, as read. */
  hashes: Map<string, string>;
  /** The folder each pack was found in. */
  where: Map<string, string>;
}

/** The file a server pack's workspace half is kept in, beside its pack.json. */
export const WORKSPACE_HALF = 'workspace.json';

/**
 * A server pack's workspace half, as read from its folder: none when it has none. Its id is the server pack's, and it
 * asks for no server reach: what it declares is said on a map, and the server's half stays the server's.
 */
export function readWorkspaceHalf(folder: string, id: string): { text: string; manifest: Manifest } | undefined {
  const file = join(folder, WORKSPACE_HALF);
  if (!existsSync(file)) return undefined;
  const text = readFileSync(file, 'utf8');
  const manifest = readManifest(text, `packs/${id}/${WORKSPACE_HALF}`);
  if (manifest.id !== id) throw new Error(`The workspace half of server pack "${id}" is pack id "${manifest.id}": a half keeps its pack's id`);
  if (isServerPack(manifest)) throw new Error(`The workspace half of server pack "${id}" asks for server reach: that is its pack.json's alone`);
  return { text, manifest };
}

/** Every workspace pack in the folders, in their order. A folder named skip (the workspace's own types) is not read. */
export function readPackFolders<P extends Manifest>(dirs: string[], skip: string): PackFolders<P> {
  const found = new Map<string, P>(), hashes = new Map<string, string>(), where = new Map<string, string>();
  for (const dir of dirs) {
    for (const name of readdirSync(dir)) {
      const file = join(dir, name, 'pack.json');
      if (name === skip || !existsSync(file)) continue;
      let text = readFileSync(file, 'utf8');
      let pack = readManifest(text, `packs/${name}/pack.json`) as P;
      // A server pack kept beside the workspace packs is the server's (src/server-packs.ts); what a workspace reads of
      // it is its workspace half, if it has one.
      if (isServerPack(pack)) {
        const half = readWorkspaceHalf(join(dir, name), pack.id);
        if (!half) continue;
        ({ text } = half), (pack = half.manifest as P);
      }
      if (pack.id !== name) throw new Error(`Pack folder "${name}" contains pack id "${pack.id}"`);
      // The same id in two folders is refused, never one quietly taken over by the other.
      if (where.has(pack.id)) throw new Error(`Pack "${pack.id}" is in two pack folders: ${where.get(pack.id)} and ${dir}`);
      where.set(pack.id, dir);
      found.set(pack.id, pack);
      const hash = createHash('sha256').update(text).digest('hex');
      hashes.set(pack.id, hash);
      read.set(hash, text);
    }
  }
  if (!found.has('core')) throw new Error(`No core pack in ${dirs.join(', ')}`);
  // The server's internal packs (root and service, docs/kernel-packs.md) are its code: a registry read from other
  // folders (a test's, a copy of some packs) has the required ones too, from the server's own folder, as the server does.
  if (existsSync(OWN_PACKS)) for (const name of readdirSync(OWN_PACKS)) {
    const file = join(OWN_PACKS, name, 'pack.json');
    if (found.has(name) || !existsSync(file)) continue;
    const text = readFileSync(file, 'utf8');
    const pack = readManifest(text, `packs/${name}/pack.json`) as P;
    if (!isRequired(pack) || pack.id !== name) continue; // an optional one is found where its folder is read, as a plain pack is
    const hash = createHash('sha256').update(text).digest('hex');
    found.set(name, pack), where.set(name, OWN_PACKS), hashes.set(name, hash), read.set(hash, text);
  }
  return { found, hashes, where };
}
