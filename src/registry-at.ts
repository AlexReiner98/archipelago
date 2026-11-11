// The registry as of a past position (docs/log.md section 8, "Any moment is replayable"): the packs the log says were
// active at fact position P, each read from the manifest text the log keeps by its hash, so a read or a replay of the
// map as it was runs under the types and rules as they were declared then. A pack's code (its handler, its layouts, its
// pages) is read back the same way, by the hashes of its files (src/pack-code.ts): the registry runs the code it had.
//
// What it cannot read from the log it takes from today, and says so: a manifest whose text the log never kept (the
// pack was said before texts were kept) is today's when its hash is the same, else today's file stands in for it
// (`stand_in`), and so with code a fact did not name or whose files the log lacks; a type the packs at P do not define but today's registry knows (a pack added later, a type of the
// workspace's own) is kept dormant, as a pack taken out is. Before any pack fact, there is no past registry: today's
// stands. The islands setting is today's.

import type { Q } from './db.ts';
import { dirname } from 'node:path';
import { readManifest } from './manifest.ts';
import { codeFromLog, folderCode } from './pack-code.ts';
import { Registry, type PackFile } from './packs.ts';
import { typeItemsIn } from './type-items.ts';

/** The last fact said of each pack up to fact position `pos`. */
export async function packsAt(q: Q, pos: number): Promise<Map<string, { op: '+' | '-'; version?: string; manifest?: string; code?: string; files?: Record<string, string> }>> {
  const { rows } = await q.query<{ id: string; op: '+' | '-'; value: { version?: string; manifest?: string; code?: string; files?: Record<string, string> } | null }>(`select distinct on (id) id, op, value - 'text' - 'texts' as value from log_fact where stream = 'facts' and field = 'pack' and id like 'pack:%' and pos <= $1 order by id, pos desc, n desc -- index log_fact_kept`, [pos]);
  return new Map(rows.map((r) => [r.id.slice('pack:'.length), { op: r.op, ...r.value }]));
}

/** The manifest texts the log keeps, by hash: a text is kept once, the first time the log meets its hash. */
export async function manifestTexts(q: Q, hashes: string[]): Promise<Map<string, string>> {
  if (!hashes.length) return new Map();
  const { rows } = await q.query<{ manifest: string; text: string }>(`select distinct on (value->>'manifest') value->>'manifest' as manifest, value->>'text' as text from log_fact where stream = 'facts' and field = 'pack' and id like 'pack:%' and value->>'manifest' = any($1::text[]) and value->>'text' is not null order by value->>'manifest', pos -- index log_fact_kept`, [hashes]);
  return new Map(rows.map((r) => [r.manifest, r.text]));
}

export interface PastPack {
  id: string;
  version?: string;
  manifest?: string;
  /** Where its manifest was read: the log's text, today's file with the same hash, or today's file standing in for one the log did not keep. */
  from: 'log' | 'today' | 'stand_in';
  /** Where its code was read: the log's files, today's folder with the same code, or today's folder standing in. */
  code: 'log' | 'today' | 'stand_in';
  /** Why the log's code could not be read, where today's stands in for it. */
  code_why?: string;
}

export interface RegistryAt {
  registry: Registry;
  pos: number;
  packs: PastPack[];
  /** Packs active at P that neither the log nor this server has a manifest for: left out, their types dormant. */
  missing: string[];
}

/**
 * The registry of the packs active at fact position `pos`, from the manifests the log names then. Undefined before any
 * pack fact: the map's packs were not on its log yet, and today's registry is all there is.
 */
export async function registryAt(q: Q, today: Registry, pos: number): Promise<RegistryAt | undefined> {
  const said = [...(await packsAt(q, pos))].filter(([, s]) => s.op === '+');
  if (!said.length) return undefined;
  const texts = await manifestTexts(q, said.flatMap(([, s]) => (s.manifest ? [s.manifest] : [])));
  const now = new Map(today.found.map((p) => [p.id, p]));
  const found = new Map<string, PackFile>(), hashes = new Map<string, string>(), where = new Map<string, string>(), packs: PastPack[] = [], missing: string[] = [];
  for (const [id, s] of said) {
    const text = s.manifest && texts.get(s.manifest);
    let manifest: PackFile | undefined;
    try {
      manifest = text ? (readManifest(text, `pack:${id} as of ${pos}`) as PackFile) : undefined;
    } catch {
      manifest = undefined; // a manifest of a shape this server no longer reads: today's stands in
    }
    const from: PastPack['from'] = manifest ? 'log' : now.has(id) && today.hashes.get(id) === s.manifest ? 'today' : 'stand_in';
    manifest ??= now.get(id);
    if (!manifest) { missing.push(id); continue; }
    found.set(id, manifest);
    hashes.set(id, s.manifest ?? today.hashes.get(id) ?? '');
    const code = await codeAt(q, today, id, s);
    if (code.where) where.set(id, code.where);
    packs.push({ id, version: s.version, manifest: s.manifest, from, code: code.from, ...(code.why && { code_why: code.why }) });
  }
  if (!found.has('core')) return undefined;
  const registry = new Registry({ found, hashes, where });
  registry.turnOff([], today.onIslands);
  // What the packs then did not define and today's registry knows is dormant, as a pack taken out leaves its types.
  registry.keep({ types: [...today.types.values()].filter((t) => !registry.types.has(t.id)), relations: [...today.relations.values()].filter((r) => !registry.relations.has(r.id)) });
  return { registry, pos, packs, missing };
}

/** The folder a pack's code at P runs from (what folderOf joins its id to): today's where it is the same, else laid out from the log. */
async function codeAt(q: Q, today: Registry, id: string, s: { code?: string; files?: Record<string, string> }): Promise<{ where?: string; from: PastPack['code']; why?: string }> {
  const now = today.found.some((p) => p.id === id) ? dirname(today.folderOf(id)) : undefined;
  if (s.code && now && folderCode(today.folderOf(id))?.code === s.code) return { where: now, from: 'today' };
  const laid = s.files ? await codeFromLog(q, id, s.files).catch((err: Error) => err) : new Error('the log names no code for it then');
  if (typeof laid === 'string') return { where: laid, from: 'log' };
  return { where: now, from: 'stand_in', why: laid.message };
}

/**
 * Take in the type items as they stood at P (the owner's versions of types, link types, and the versions of packs an
 * island pins), from the rows the map had then. One that does not load leaves the registry as the pack facts made it,
 * and says why.
 */
export function takeItemsAt(at: RegistryAt, rows: Record<string, unknown>[]): string | undefined {
  try {
    at.registry.takeItems(typeItemsIn(rows));
    return undefined;
  } catch (err) {
    return (err as Error).message;
  }
}
