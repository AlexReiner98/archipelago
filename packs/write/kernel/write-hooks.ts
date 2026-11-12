// The write path's hook points (docs/kernel-packs.md, "Write-path hooks"): where change() and its apply loop ask what
// other code has to say of a change, instead of calling it by name. Each point is filled first by what the write path
// still did inline (src/write-fillings.ts, each named for the pack it moves to), then by the internal packs that
// declare it under `kernel.hooks`, in pack order and each pack's own order. With none filled, the write path works
// as it does on a map with only core.
//
//   write.rewrite   ops in, ops out: same ops, same order, same op, id, type and ends; only the fields its pack fills;
//                   a stated visibility may narrow, never widen. Checked here, and the change refused naming the pack.
//   write.validate  ops in, refusals and warnings out: reads only. Run where a change is planned (src/change-plan.ts).
//   write.follow    ops in, more ops out: judged with the change, and run again before it applies.
//   write.follow.rides  what rides the change: ops no rule judges, applied in its change set with its verdict and its
//                   authority (held with it, applied when it is), asked op by op inside the apply's transaction.
//   log.project    facts in, rows of its own tables out (src/log-project.ts).
//   write.after     the change set in, nothing out: a failure is a warning, never an error.
//   write.retype    a type or link type renamed, ops out, made as the pack through change.
//
// What follows an op at the level of facts (the owner's link, src/owner-link.ts) stays in the write path.

import { BUILT_IN } from './write-fillings.ts';
import { islandRegistry } from '../../loader/kernel/island-pin.ts';
import type { Archipelago } from './pelago.ts';
import type { Authority, Op, SourceSpec } from './pelago-types.ts';
import type { Q } from '../../database/kernel/db.ts';
import type { Registry } from '../../loader/kernel/packs.ts';

/** The points the write path opens. */
export const POINTS = ['write.rewrite', 'write.validate', 'write.follow', 'write.follow.rides', 'log.project', 'write.after', 'write.retype'] as const;
export type Point = (typeof POINTS)[number];

/** Who a change is from, as a validator is told: a person, or an agent or a pack's action. */
export interface Who { human: boolean; pack?: string }

/** What the write path hands its own fillings: the map, the types the change is judged by, and what the change says. */
export interface WriteEnv { map: Archipelago; reg: Registry; island?: string; who?: Who }

/**
 * What a rewrite or a validator of a pack is handed beside the ops: the registry the change is judged by (an island's
 * version, where that differs from the map's), the island the change was given, and the registry an island runs.
 */
export interface Judged { registry: Registry; island?: string; islandRegistry(island: unknown): Promise<Registry> }
const judgedOf = (env: WriteEnv): Judged => ({ registry: env.reg, island: env.island, islandRegistry: (island) => islandRegistry(env.map, island, env.reg) });

/** What a validator answers. */
export interface Checked { refusals: string[]; warnings?: string[] }

/** What write.after is handed: the change set on the log. */
export interface AfterEntry { changeset: string; actor: string; reason: string; ops: Op[] }

/** A filling the write path still holds itself, named for the pack its code goes to. */
export interface BuiltIn { pack: string; fills?: string[]; run: (env: WriteEnv, ...args: never[]) => Promise<unknown> }

/** One filling of a point, whoever holds its code: called with what the point hands it. */
interface Filling { pack: string; fills: string[]; run: (...args: unknown[]) => Promise<unknown> }

const rejected = (lines: string[]) => new Error(`Change rejected:\n${lines.map((l) => `- ${l}`).join('\n')}`);

/**
 * The internal packs' fillings of a point, each bound to its pack's context, and a change made as a pack: the loader's
 * (src/kernel-context.ts), which the write path sits above. A map a workspace opened is answered by the host its open
 * made; a map no workspace opened (a test's, a registry read at a past version) by a loose one, as their code runs for it
 * anywhere else.
 */
interface WriteSlot {
  fillings(map: Archipelago, point: Point): Promise<{ pack: string; run: (...args: unknown[]) => Promise<unknown> }[]>;
  change(map: Archipelago, pack: string, input: { reason: string; basis: string; ops: Op[] }): Promise<unknown>;
}
const slotOf = async (_map: Archipelago): Promise<WriteSlot> => {
  // Dynamic: the loader's context reaches the map, whose write path is this module.
  const { hostAt, kernelContext } = await import('../../loader/kernel/kernel-context.ts');
  return { fillings: (map, point) => hostAt(map).fillings(map, point), change: (map, pack, input) => kernelContext(map, pack).change(input) };
};

/** The packs' fields a rewrite may set, by the manifest's `kernel.fills` (none, until a pack says). */
const fillsOf = (map: Archipelago, pack: string): string[] => {
  const k = map.registry.packs.find((p) => p.id === pack)?.kernel as { fills?: unknown } | undefined;
  return Array.isArray(k?.fills) ? k.fills.filter((f): f is string => typeof f === 'string') : [];
};

/** Every filling of a point, the write path's own first, then the packs', in order. */
async function fillings(env: WriteEnv, point: Point): Promise<Filling[]> {
  const own = (BUILT_IN[point] ?? []).map((b): Filling => ({ pack: b.pack, fills: b.fills ?? [], run: (...args) => (b.run as (e: WriteEnv, ...a: unknown[]) => Promise<unknown>)(env, ...args) }));
  const packs = (await (await slotOf(env.map)).fillings(env.map, point)).map((f): Filling => ({ pack: f.pack, fills: fillsOf(env.map, f.pack), run: f.run }));
  return [...own, ...packs];
}

const RANK: Record<string, number> = { private: 0, shared: 1, public: 2 };
/** What says which op an op is: never changed by a rewrite. */
const IDENTITY = ['op', 'id', 'ref', 'type', 'from', 'to', 'relation', 'keep', 'drop'];
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/**
 * Why a rewrite's answer breaks its bounds, or undefined when it keeps them: the same ops in the same order, each the
 * same op on the same item, type and ends; of its fields only those named in `fills` set or taken away; nothing else
 * of it changed but its visibility, which, where the op stated it, may only narrow.
 */
export function rewriteProblem(before: Op[], after: unknown, fills: string[]): string | undefined {
  if (!Array.isArray(after) || after.length !== before.length) return `answered ${Array.isArray(after) ? `${after.length} ops for ${before.length}` : 'no list of ops'}`;
  for (const [i, was] of before.entries()) {
    const now = after[i] as Record<string, unknown> | undefined;
    const old = was as unknown as Record<string, unknown>;
    const where = `op ${i + 1}`;
    if (!now || typeof now !== 'object') return `${where}: answered no op`;
    for (const k of IDENTITY) if (!same(old[k], now[k])) return `${where}: changed its ${k}`;
    for (const k of new Set([...Object.keys(old), ...Object.keys(now)])) {
      if (IDENTITY.includes(k) || k === 'props' || k === 'visibility') continue;
      if (!same(old[k], now[k])) return `${where}: changed its ${k}`;
    }
    const was_ = (old.props ?? {}) as Record<string, unknown>, is = (now.props ?? {}) as Record<string, unknown>;
    for (const k of new Set([...Object.keys(was_), ...Object.keys(is)])) if (!same(was_[k], is[k]) && !fills.includes(k)) return `${where}: set ${k}, a field it does not fill`;
    if (now.visibility !== old.visibility) {
      if (typeof now.visibility !== 'string' || !(now.visibility in RANK)) return `${where}: made its visibility ${String(now.visibility)}`;
      if (old.visibility !== undefined && RANK[now.visibility] > RANK[old.visibility as string]) return `${where}: widened its visibility from ${String(old.visibility)} to ${now.visibility}`;
    }
  }
  return undefined;
}

/** write.rewrite: each filling's answer checked against its bounds and put in the ops' place, in the list given. */
export async function rewrite(env: WriteEnv, ops: Op[]): Promise<void> {
  for (const f of await fillings(env, 'write.rewrite')) {
    const out = await f.run(structuredClone(ops), judgedOf(env));
    const problem = rewriteProblem(ops, out, f.fills);
    if (problem) throw rejected([`the ${f.pack} pack's rewrite ${problem}`]);
    // An op it left as it was stays the same object: the apply loop knows each op by it (change-apply.ts, `at`).
    ops.splice(0, ops.length, ...(out as Op[]).map((o, i) => (same(o, ops[i]) ? ops[i] : o)));
  }
}

/** write.validate: every filling's refusals and warnings, each refusal named as a reason the change is refused. */
export async function validate(env: WriteEnv, ops: Op[]): Promise<{ refusals: string[]; warnings: string[] }> {
  const refusals: string[] = [], warnings: string[] = [];
  for (const f of await fillings(env, 'write.validate')) {
    const out = (await f.run(structuredClone(ops), env.who, judgedOf(env))) as Checked | undefined;
    refusals.push(...(out?.refusals ?? []));
    warnings.push(...(out?.warnings ?? []));
  }
  return { refusals, warnings };
}

/** What follows a change, by the pack that said it. */
export type Followed = { pack: string; ops: Op[] }[];

/** write.follow: the ops each filling adds to a change, kept apart by pack; nothing when none adds any. */
export async function follow(env: WriteEnv, ops: Op[]): Promise<Followed> {
  const out: Followed = [];
  for (const f of await fillings(env, 'write.follow')) {
    const more = await f.run(structuredClone(ops));
    if (!Array.isArray(more) || more.some((o) => !o || typeof o !== 'object' || typeof (o as { op?: unknown }).op !== 'string')) throw rejected([`the ${f.pack} pack's follow answered something other than ops`]);
    if (more.length) out.push({ pack: f.pack, ops: more as Op[] });
  }
  return out;
}

/** The ops a change was judged with, what followed them taken off: what follow is run on again before it applies. */
export const judged = (ops: Op[], followed: Followed): Op[] => ops.slice(0, ops.length - followed.reduce((n, f) => n + f.ops.length, 0));

/** Before a judged change applies: what follows it now must be what followed it when it was judged, or the map moved. */
export async function followedStill(env: WriteEnv, ops: Op[], followed: Followed): Promise<void> {
  const again = await follow(env, judged(ops, followed));
  if (!same(again, followed)) throw rejected([`the map moved while this change was judged: what ${[...new Set([...again, ...followed].map((f) => f.pack))].join(', ')} follows it with is not what was judged. Send it again.`]);
}

/**
 * What a filling of write.follow.rides is handed beside the ops, for one op of a change, inside the apply's
 * transaction: what the ops before it left is what it reads. It is asked where the op names its source (`source`:
 * what it adds is said before the op's facts, and `is` names the item that source is), and after each op (`after`).
 * `at` is the op, from 0; -1 is the change's own source, asked before any op.
 */
export interface Ride {
  q: Q;
  at: number;
  place: 'source' | 'after';
  /** The source asked, where place is `source`. */
  source?: SourceSpec;
  authority: Authority | null;
  /** Whose word the change is: where its authority is a person's, the person the map is read as. */
  word: string | null;
  /** The types the change applies by, its own type items included. */
  registry: Registry;
}

/** What a filling of write.follow.rides answers: ops that ride the change (create with a ref, or unlink), the item a source is, and words for the change's answer. */
export interface Rode { ops?: Op[]; is?: string; answer?: Record<string, unknown[]> }

const RIDE_OPS = ['create', 'unlink'];

/** write.follow.rides: the fillings, each asked op by op as the change applies; every answer checked against its bounds. */
export async function riders(env: WriteEnv): Promise<(ops: Op[], ride: Ride) => Promise<Rode[]>> {
  const all = await fillings(env, 'write.follow.rides');
  return async (ops, ride) => {
    const out: Rode[] = [];
    for (const f of all) {
      const rode = (await f.run(structuredClone(ops), ride)) as Rode | undefined;
      if (rode === undefined) continue;
      const bad = !rode || typeof rode !== 'object' || (rode.ops !== undefined && (!Array.isArray(rode.ops) || rode.ops.some((o) => !o || !RIDE_OPS.includes((o as { op?: string }).op ?? '') || (o.op === 'create' && !o.ref))))
        || (rode.is !== undefined && typeof rode.is !== 'string') || (rode.answer !== undefined && Object.values(rode.answer ?? {}).some((v) => !Array.isArray(v)));
      if (bad) throw rejected([`the ${f.pack} pack's ride answered something other than ops that ride (create with a ref, unlink), the item a source is, and lists for the answer`]);
      out.push(rode);
    }
    return out;
  };
}

/** write.after: each filling run once the change set is on the log; a failure is said as a warning, never an error, as the change has applied. */
export async function after(env: WriteEnv, entry: AfterEntry, warnings: string[]): Promise<void> {
  for (const f of await fillings(env, 'write.after')) {
    await f.run(entry).catch((err) => {
      console.error(err);
      warnings.push(`Applied, but what follows it failed: ${(err as Error).message}`);
    });
  }
}

/** write.retype: what each pack does once a type or link type is renamed, made as that pack through change. */
export async function retyped(map: Archipelago, from: string, to: string, what: 'entity' | 'relation'): Promise<void> {
  const slot = await slotOf(map);
  for (const f of await slot.fillings(map, 'write.retype')) {
    const ops = (await f.run(from, to, what)) as Op[] | undefined;
    if (!Array.isArray(ops) || !ops.length) continue;
    await slot.change(map, f.pack, { reason: `Every ${from} is a ${to} now: what the ${f.pack} pack keeps of it follows.`, basis: 'its retype', ops });
  }
}
