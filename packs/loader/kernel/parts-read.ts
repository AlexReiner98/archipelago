// The parts a page draws, as a read (task e_k295nr4j, decision e_fxayrhma): the loader root's service root.parts, which
// the query pack names as the view `parts`, so a person's page and an agent ask the same question. On an island it
// answers the parts of the registry that island runs (the version it pins, packs/loader/kernel/island-pin.ts), under
// the owner's versions of them (core's part items); asked for the shipped parts, the parts as every pack ships them,
// with none of either over them (packs/loader/kernel/way-back.ts). Each part comes with its modules only when the page
// does not hold them by hash (`have`). `refined` says what the island draws otherwise than it ships, so the host shows
// the way back only where it would change something. With the parts go the words of the registry they draw by
// (./part-words.ts), handed to each part as data; left out as their hash alone when the page holds them (`have`).
// The page says which marks its host draws (`marks`, from packs/walls/page/part-check.js): a part naming another
// waits, sent without its code (task e_jqj87va8).

import { createHash } from 'node:crypto';
import type { RootCall } from './root-calls.ts';
import { startedFrom } from '../../database/kernel/config.ts';
import { headPos } from '../../log/kernel/tail.ts';
import { islandRegistry } from './island-pin.ts';
import { drewWith, type Drew } from './pack-versions.ts';
import { registryAt } from './registry-at.ts';
import type { Registry } from './packs.ts';
import { MARK, partsFor, type Part } from './ui-parts.ts';
import { refinedOn, shippedParts, type Refined } from './way-back.ts';
import { schemaOf, wordsOf, type SchemaWords, type Words } from './part-words.ts';
import type { Archipelago } from '../../write/kernel/pelago.ts';

const HASH = /^[0-9a-f]{64}$/;
/** How many hashes a page may say it holds: more than any map draws parts. */
const HAVE_MOST = 500;
/** How many marks a host may say it draws: more than any host has. */
const MARKS_MOST = 100;

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
  /** The fields and capabilities of each type, only where a root pack's part reads items whole: its hash alone when the page holds it. */
  schema?: SchemaWords | { hash: string };
  /** What the page draws with, as recorded (packs/loader/kernel/pack-versions.ts): the look keeps it beside its picture. */
  drew?: Drew;
  /**
   * Asked at a past position: the packs' code as it stood then, the owner's versions of parts as they are now. Where the
   * log's packs of then cannot be read by this server (a manifest of a shape it no longer takes), today's stand in, and
   * `stand_in` says why.
   */
  at?: { pos: number; owners_parts: 'now'; stand_in?: string };
}

/** The last set each person's page recorded on each island, by this process: the same set is not recorded again. */
const recorded = new Map<string, string>();
const RECORDED_MOST = 5000;

/**
 * Record what a page drew with, in the observations stream (packs/log/kernel/operational.ts, RECORDS.drew), as the person
 * asking, about the island or the map, unless it is the set they last recorded there. A map that may not record (a
 * look's pass, a token that only reads) draws all the same: the record is what is skipped.
 */
async function record(l: Archipelago, drew: Drew): Promise<void> {
  const about = drew.island ?? 'map';
  const key = `${l.workspace}:${l.viewer ?? ''}:${about}`;
  const set = createHash('sha256').update(JSON.stringify([drew.host, drew.server, drew.packs, drew.parts])).digest('hex');
  if (recorded.get(key) === set) return;
  try {
    await l.record('observations', l.viewer || 'system', [['+', about, 'drew', drew]]);
    if (recorded.size >= RECORDED_MOST) recorded.delete(recorded.keys().next().value!);
    recorded.set(key, set);
  } catch (err) {
    console.warn(`${l.workspace}: what a page drew with was not recorded: ${String((err as Error)?.message ?? err).slice(0, 200)}`);
  }
}

/** The words of a registry, whole, or by their hash alone when the page holds them. */
const wordsFor = (reg: Registry, have: string[]) => {
  // Made each time: a type defined on the map changes the registry in place, and the words are a few kilobytes at most.
  const words = wordsOf(reg);
  return have.includes(words.hash) ? { hash: words.hash } : words;
};

/** The schema's fields, for a root pack's part that reads items whole, when one is among the parts: by hash when the page holds them. */
const schemaFor = (reg: Registry, have: string[], list: Part[]) => {
  if (!list.some((p) => p.reads === '*')) return {};
  const schema = schemaOf(reg);
  return { schema: have.includes(schema.hash) ? { hash: schema.hash } : schema };
};

/** root.parts: the parts a page draws on an island (or the map), or as they ship. */
export async function parts(call: RootCall, input: { island?: string; have?: string[]; shipped?: boolean; host?: string; at?: number; marks?: string[] }): Promise<PartsAnswer> {
  const l = call.map;
  if (!l) throw new Error('Parts are read of a map: a server duty has none');
  const have = (Array.isArray(input?.have) ? input.have : []).filter((h) => typeof h === 'string' && HASH.test(h)).slice(0, HAVE_MOST);
  const drawable = Array.isArray(input?.marks) ? input.marks.filter((m) => typeof m === 'string' && MARK.test(m)).slice(0, MARKS_MOST) : undefined;
  const island = typeof input?.island === 'string' ? input.island : undefined;
  const head = await headPos(l.db);
  const at = Number.isInteger(input?.at) && input.at! >= 0 && input.at! < head ? input.at! : undefined;
  if (input?.shipped) {
    const list = shippedParts(l, have, drawable);
    return drawn(l, { parts: list, shipped: true, words: wordsFor(l.registry, have), ...schemaFor(l.registry, have, list) });
  }
  // At a past position (a look redrawn as it was): the packs' code as the log kept it then (registryAt).
  let past: Awaited<ReturnType<typeof registryAt>>, stand_in: string | undefined;
  if (at !== undefined) past = await registryAt(l.db, l.registry, at).catch((err) => void (stand_in = String(err?.message ?? err).slice(0, 300)));
  const then = past ? l.readIn(past.registry) : l;
  const reg = await islandRegistry(then, island, then.registry);
  const kept = await keptParts(l, reg);
  const refined = island && !past ? await refinedOn(l, island, kept) : undefined;
  const list = partsFor(reg, kept, have, drawable);
  const answer = { parts: list, ...schemaFor(reg, have, list), ...(refined && { refined }), ...(at !== undefined && { at: { pos: at, owners_parts: 'now' as const, ...(stand_in && { stand_in }) } }), words: wordsFor(reg, have) };
  return drawn(then, answer, past ? at : undefined);

  /** The answer with what it draws with: the packs of the registry it was read in, at the position whose code it is. Recorded only for today's. */
  async function drawn(map: Archipelago, answer: PartsAnswer, pos?: number): Promise<PartsAnswer> {
    const drew = await drewWith(map, { island, host: input?.host, server: startedFrom() ?? null, at: pos ?? head, parts: answer.parts });
    if (at === undefined) await record(l!, drew);
    return { ...answer, drew: { ...drew, ...(answer.at?.stand_in && { stand_in: answer.at.stand_in }) } };
  }
}
