// The registry as of a past position (docs/log.md section 8, "Any moment is replayable"): the packs the log says were
// active at fact position P, each read from the manifest text the log keeps by its hash, so a read or a replay of the
// map as it was runs under the types and rules as they were declared then. A pack's code (its handler, its layouts) is
// not on the log, only its pack.json's hash: nothing here runs old code.
//
// What it cannot read from the log it takes from today, and says so: a manifest whose text the log never kept (the
// pack was said before texts were kept) is today's when its hash is the same, else today's file stands in for it
// (`stand_in`); a type the packs at P do not define but today's registry knows (a pack added later, a type of the
// workspace's own defined later) is kept dormant, as a pack taken out is. Before any pack fact, there is no past
// registry: today's stands. The islands setting and the workspace's own types are as the logs said them by P
// (src/registry-then.ts).

import type { Q } from './db.ts';
import { readManifest } from './manifest.ts';
import { LOCAL_PACK, Registry, type PackFile } from './packs.ts';
import { islandsAt, localAt } from './registry-then.ts';
import { typeItemsIn } from './type-items.ts';

/** The last fact said of each pack up to fact position `pos`. */
export async function packsAt(q: Q, pos: number): Promise<Map<string, { op: '+' | '-'; version?: string; manifest?: string }>> {
  const { rows } = await q.query<{ id: string; op: '+' | '-'; value: { version?: string; manifest?: string } | null }>(`select distinct on (id) id, op, value - 'text' as value from log_fact where stream = 'facts' and field = 'pack' and id like 'pack:%' and pos <= $1 order by id, pos desc, n desc -- index log_fact_kept`, [pos]);
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
  const found = new Map<string, PackFile>(), hashes = new Map<string, string>(), packs: PastPack[] = [], missing: string[] = [];
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
    packs.push({ id, version: s.version, manifest: s.manifest, from });
  }
  if (!found.has('core')) return undefined;
  const local = await localAt(q, [...today.types.values()].filter((t) => t.pack === LOCAL_PACK).map((t) => t.id), pos);
  const registry = new Registry({ found, hashes }, undefined, local);
  registry.turnOff([], await islandsAt(q, today.onIslands, pos));
  // What the packs then did not define and today's registry knows is dormant, as a pack taken out leaves its types.
  registry.keep({ types: [...today.types.values()].filter((t) => !registry.types.has(t.id)), relations: [...today.relations.values()].filter((r) => !registry.relations.has(r.id)) });
  return { registry, pos, packs, missing };
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
