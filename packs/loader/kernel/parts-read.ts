// The parts a page draws, as a read (task e_k295nr4j, decision e_fxayrhma): the loader root's service root.parts, which
// the query pack names as the view `parts`, so a person's page and an agent ask the same question. On an island it
// answers the parts of the registry that island runs (the version it pins, packs/loader/kernel/island-pin.ts), under
// the owner's versions of them (core's part items); asked for the shipped parts, the parts as every pack ships them,
// with none of either over them (packs/loader/kernel/way-back.ts). Each part comes with its modules only when the page
// does not hold them by hash (`have`). `refined` says what the island draws otherwise than it ships, so the host shows
// the way back only where it would change something. With the parts go the words of the registry they draw by
// (./part-words.ts), handed to each part as data; left out as their hash alone when the page holds them (`have`).

import type { RootCall } from './root-calls.ts';
import { islandRegistry } from './island-pin.ts';
import type { Registry } from './packs.ts';
import { partsFor, type Part } from './ui-parts.ts';
import { refinedOn, shippedParts, type Refined } from './way-back.ts';
import { wordsOf, type Words } from './part-words.ts';
import type { Archipelago } from '../../write/kernel/pelago.ts';

const HASH = /^[0-9a-f]{64}$/;
/** How many hashes a page may say it holds: more than any map draws parts. */
const HAVE_MOST = 500;

/** The owner's versions of parts here: core's part items, open or retired, as the person asking may read them. */
export async function keptParts(l: Archipelago, reg: Registry): Promise<{ is_open: boolean; props: Record<string, unknown> }[]> {
  const { rows } = await l.db.query<{ is_open: boolean; props: Record<string, unknown> }>(
    `select is_open, ${l.props} as props from entity where type = any($1::text[]) and archived_at is null limit 500 -- index entity_type`,
    [reg.family('part')],
  );
  return rows;
}

/** What root.parts answers: the parts to draw, each by hash, and what the island refines (left out when nothing). */
export interface PartsAnswer {
  parts: Part[];
  /** Drawn as they ship: the way back was pressed. */
  shipped?: true;
  refined?: Refined;
  /** The schema's words the parts are drawn by: only the hash, when the page said it holds them. */
  words: Words | { hash: string };
}

/** The words of a registry, whole, or by their hash alone when the page holds them. */
const wordsFor = (reg: Registry, have: string[]) => {
  // Made each time: a type defined on the map changes the registry in place, and the words are a few kilobytes at most.
  const words = wordsOf(reg);
  return have.includes(words.hash) ? { hash: words.hash } : words;
};

/** root.parts: the parts a page draws on an island (or the map), or as they ship. */
export async function parts(call: RootCall, input: { island?: string; have?: string[]; shipped?: boolean }): Promise<PartsAnswer> {
  const l = call.map;
  if (!l) throw new Error('Parts are read of a map: a server duty has none');
  const have = (Array.isArray(input?.have) ? input.have : []).filter((h) => typeof h === 'string' && HASH.test(h)).slice(0, HAVE_MOST);
  const island = typeof input?.island === 'string' ? input.island : undefined;
  if (input?.shipped) return { parts: shippedParts(l, have), shipped: true, words: wordsFor(l.registry, have) };
  const reg = await islandRegistry(l, island);
  const kept = await keptParts(l, reg);
  const refined = island ? await refinedOn(l, island, kept) : undefined;
  return { parts: partsFor(reg, kept, have), ...(refined && { refined }), words: wordsFor(reg, have) };
}
