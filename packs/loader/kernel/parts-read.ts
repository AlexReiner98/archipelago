// The parts a page draws, as a read (task e_k295nr4j, decision e_fxayrhma): the loader root's service root.parts, which
// the query pack names as the view `parts`, so a person's page and an agent ask the same question. On an island it
// answers the parts of the registry that island runs (the version it pins, packs/loader/kernel/island-pin.ts), under
// the owner's versions of them (core's part items); asked for the shipped parts, the parts as every pack ships them,
// with none of either over them (packs/loader/kernel/way-back.ts). Each part comes with its modules only when the page
// does not hold them by hash (`have`). `refined` says what the island draws otherwise than it ships, so the host shows
// the way back only where it would change something.

import { createHash } from 'node:crypto';
import type { RootCall } from './root-calls.ts';
import { startedFrom } from '../../database/kernel/config.ts';
import { headPos } from '../../log/kernel/tail.ts';
import { islandRegistry } from './island-pin.ts';
import { drewWith, type Drew } from './pack-versions.ts';
import { registryAt } from './registry-at.ts';
import type { Registry } from './packs.ts';
import { partsFor, type Part } from './ui-parts.ts';
import { refinedOn, shippedParts, type Refined } from './way-back.ts';
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
  /** What the page draws with, as recorded (packs/loader/kernel/pack-versions.ts): the look keeps it beside its picture. */
  drew?: Drew;
  /** Asked at a past position: the packs' code as it stood then, the owner's versions of parts as they are now. */
  at?: { pos: number; owners_parts: 'now' };
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

/** root.parts: the parts a page draws on an island (or the map), or as they ship. */
export async function parts(call: RootCall, input: { island?: string; have?: string[]; shipped?: boolean; host?: string; at?: number }): Promise<PartsAnswer> {
  const l = call.map;
  if (!l) throw new Error('Parts are read of a map: a server duty has none');
  const have = (Array.isArray(input?.have) ? input.have : []).filter((h) => typeof h === 'string' && HASH.test(h)).slice(0, HAVE_MOST);
  const island = typeof input?.island === 'string' ? input.island : undefined;
  const head = await headPos(l.db);
  const at = Number.isInteger(input?.at) && input.at! >= 0 && input.at! < head ? input.at! : undefined;
  const drawn = async (answer: PartsAnswer): Promise<PartsAnswer> => {
    const drew = await drewWith(l, { island, host: input?.host, server: startedFrom() ?? null, at: at ?? head, parts: answer.parts });
    if (at === undefined) await record(l, drew);
    return { ...answer, drew };
  };
  if (input?.shipped) return drawn({ parts: shippedParts(l, have), shipped: true });
  // At a past position (a look redrawn as it was): the packs' code as the log kept it then (registryAt).
  const past = at === undefined ? undefined : await registryAt(l.db, l.registry, at);
  const reg = await islandRegistry(l, island, past?.registry ?? l.registry);
  const kept = await keptParts(l, reg);
  const refined = island && !past ? await refinedOn(l, island, kept) : undefined;
  return drawn({ parts: partsFor(reg, kept, have), ...(refined && { refined }), ...(past && { at: { pos: at!, owners_parts: 'now' as const } }) });
}
