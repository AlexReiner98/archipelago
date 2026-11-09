// The folders workspace packs are read from: the server's own (packsDir), then those PELAGO_PACKS names, so a pack the
// hosted service keeps to itself is a folder on its machine, never a file of the open repository. One id is one pack.

import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { isServerPack, readManifest, type Manifest } from './manifest.ts';

export interface PackFolders<P> {
  /** Each workspace pack found, by id. */
  found: Map<string, P>;
  /** The SHA-256 of each pack's pack.json, as read. */
  hashes: Map<string, string>;
  /** The folder each pack was found in. */
  where: Map<string, string>;
}

/** Every workspace pack in the folders, in their order. A folder named skip (the workspace's own types) is not read. */
export function readPackFolders<P extends Manifest>(dirs: string[], skip: string): PackFolders<P> {
  const found = new Map<string, P>(), hashes = new Map<string, string>(), where = new Map<string, string>();
  for (const dir of dirs) {
    for (const name of readdirSync(dir)) {
      const file = join(dir, name, 'pack.json');
      if (name === skip || !existsSync(file)) continue;
      const text = readFileSync(file, 'utf8');
      const pack = readManifest(text, `packs/${name}/pack.json`) as P;
      // A server pack kept beside the workspace packs is the server's (src/server-packs.ts), never a workspace's.
      if (isServerPack(pack)) continue;
      if (pack.id !== name) throw new Error(`Pack folder "${name}" contains pack id "${pack.id}"`);
      // The same id in two folders is refused, never one quietly taken over by the other.
      if (where.has(pack.id)) throw new Error(`Pack "${pack.id}" is in two pack folders: ${where.get(pack.id)} and ${dir}`);
      where.set(pack.id, dir);
      found.set(pack.id, pack);
      hashes.set(pack.id, createHash('sha256').update(text).digest('hex'));
    }
  }
  if (!found.has('core')) throw new Error(`No core pack in ${dirs.join(', ')}`);
  return { found, hashes, where };
}
