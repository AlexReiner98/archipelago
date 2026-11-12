// root.bookkeep, for the sessions pack (docs/kernel-packs.md, "Root services", "System authority"): a session's own
// record of itself, written as it always was. A service pack's ctx.change is made as `system:<pack>`; a session's
// bookkeeping is made as the agent it is for (its hook's actor, the session's own), with no authority claimed. It is
// judged by the rules (decide) as the calling pack's bookkeeping, which that pack's own rule lets through
// (sessions.bookkeeping, `then: "spare"`), so nothing here skips them. Each ask is one write the sessions pack made
// through the map before it moved, on the map the caller's context is of, as the actor it names.

import type { RootCall } from '../../../src/root-calls.ts';
import type { Actor, ChangeInput } from './pelago-types.ts';
import type { Done } from '../../../src/activity.ts';
import { openOps } from '../../../src/opseal.ts';
import { isSealed } from '../../../src/seal.ts';
import { decide, type RuleDef } from '../../../src/rules.ts';
import { ownManifest } from '../../loader/kernel/root-calls.ts';
import type { Registry } from '../../../src/packs.ts';
import type { Light, OpFact, OpStream } from '../../../src/streams.ts';

type Props = Record<string, unknown>;

/** What the sessions pack asks the write path for. */
export type BookkeepAsk =
  /** A change applied as `actor`, with no rule consulted (Archipelago.apply): a session's record of itself. */
  | { apply: { actor: string; input: ChangeInput } }
  /** A change as `actor`, through the rules like any it sends itself: what a session vouches for as it ends. */
  | { change: { actor: Actor; input: ChangeInput } }
  /** The operational write (Archipelago.operational): a heartbeat, a count, a story kept on the run. */
  | { operational: { id: string; set: { props?: Props; unset?: string[]; add?: Record<string, number> }; event?: { actor: string; action: string; reason?: string; detail?: Props } } }
  /** A resource taken or given back for the session, as `actor`. */
  | { claim: { actor: Actor; input: { resource: string; holder: string; for?: string; reason: string } } }
  | { give_back: { actor: Actor; input: { resource: string; holder?: string; reason: string } } }
  /** Facts on a stream the sessions pack writes, as `actor`. */
  | { record: { stream: OpStream; actor: string; facts: OpFact[] } }
  /**
   * A run's events on the sessions stream, one batch of a run at a time: those the run has already (the same `same`
   * fields, or twice in the batch) are dropped, the rest appended in the order given. Answers how many were kept.
   */
  | { events: { run: string; since: string; actor: string; field: string; values: Props[]; same: string[] } }
  /** A connection's own log copied into the activity, and how far it was read, in one transaction (the import_audit act). */
  | { audit: { entries: Done[]; cursor: { key: string; value: string } } }
  /** How far a connection's log was read. */
  | { audit_cursor: string };

/** The streams the sessions pack writes: its events, and what an audit import observed and how far it read. */
const STREAMS = /^(?:sessions|observations|automations)$/;
const AUDIT = /^audit_cursor:e_\w+$/;

/**
 * The registry a pack's bookkeeping is judged by: the map's, with the pack's own rules as this server ships them where
 * the map has not loaded it (an optional pack the kernel still runs on every map: sessions), so its rule lets it through
 * wherever its code writes.
 */
function judgedBy(reg: Registry, pack: string): Registry {
  if (reg.rules.some((r) => r.pack === pack)) return reg;
  const own = ((ownManifest(pack) as { rules?: RuleDef[] } | undefined)?.rules ?? []).map((r) => ({ ...r, pack }));
  return new Proxy(reg, { get: (t, k) => (k === 'rules' ? [...t.rules, ...own] : Reflect.get(t, k, t)) });
}

/** Answer one ask, on the map the caller's context is of. */
export async function bookkeep(at: RootCall, ask: BookkeepAsk): Promise<unknown> {
  const map = at.map;
  if (!map) throw new Error('root.bookkeep is asked of a map');
  if ('apply' in ask) {
    // Judged by the rules like any change, as the pack's bookkeeping: its own rule (sessions.bookkeeping) lets it
    // through, and the log names what it spared. Its actor and its authority (none claimed) are as they always were.
    const { actor, input } = ask.apply;
    const verdict = await decide(map.db, judgedBy(map.registry, at.caller), { human: actor.startsWith('human:'), bookkeeping: at.caller }, input.ops, map.policy);
    if (verdict.outcome !== 'apply') throw new Error(`root.bookkeep: ${at.caller}'s bookkeeping is ${verdict.outcome === 'hold' ? 'held' : 'refused'}: ${[...verdict.refused, ...verdict.held.map((r) => r.say)].join('; ')}`);
    const spared = [...new Map(verdict.spared.flat().map((r) => [`${r.pack}.${r.rule}`, { rule: r.rule, pack: r.pack }])).values()];
    return map.apply(actor, input, { rule: { outcome: 'apply', spared } });
  }
  if ('change' in ask) return map.change(ask.change.actor, ask.change.input);
  if ('operational' in ask) return map.operational(ask.operational.id, ask.operational.set, ask.operational.event);
  if ('claim' in ask) return map.claim(ask.claim.actor, ask.claim.input);
  if ('give_back' in ask) return map.release(ask.give_back.actor, ask.give_back.input);
  if ('record' in ask) {
    if (!STREAMS.test(ask.record.stream)) throw new Error(`root.bookkeep records on the sessions, observations and automations streams, not ${ask.record.stream}`);
    return map.record(ask.record.stream, ask.record.actor, ask.record.facts);
  }
  if ('events' in ask) {
    const { run, since, actor, field, values, same } = ask.events;
    const sameness = (v: Props) => same.map((k) => String(v[k] ?? '')).join('\u0000');
    return map.db.transaction(async (tx) => {
      // One batch of a run at a time, so two sent together cannot both keep the same event.
      await tx.query(`select pg_advisory_xact_lock(hashtext('pelago.session_events'), hashtext($1))`, [run]);
      type Row = { stream: Light['stream']; pos: number; at: Date; head: Omit<Light, 'stream' | 'pos' | 'at' | 'facts'>; facts: OpFact[] };
      const { rows } = await tx.query<Row>(
        `select stream, pos::int as pos, at, head, facts from log_op where stream = 'sessions' and at >= $1 and facts @> $2::jsonb order by at, pos`,
        [new Date(since).toISOString(), JSON.stringify([['+', run, field]])],
      );
      const opened = await openOps(tx, rows.map((r): Light => ({ ...r.head, stream: r.stream, pos: r.pos, at: new Date(r.at).toISOString(), facts: r.facts })));
      // A value whose key is gone (its run forgotten) reads as a digest, and is none any more.
      const had = new Set(opened.flatMap((e) => e.facts.filter((f) => f[0] === '+' && f[1] === run && f[2] === field && !isSealed(f[3]) && f[3] && typeof f[3] === 'object').map((f) => sameness(f[3] as Props))));
      const fresh = values.filter((v) => !had.has(sameness(v)) && (had.add(sameness(v)), true));
      await map.record('sessions', actor, fresh.map((v): OpFact => ['+', run, field, v]), undefined, tx);
      return fresh.length;
    });
  }
  if ('audit' in ask) {
    const { entries, cursor } = ask.audit;
    if (!AUDIT.test(cursor.key)) throw new Error('root.bookkeep keeps only a connection\'s audit cursor');
    await map.db.transaction(async (tx) => {
      for (const entry of entries) await map.log(tx, entry);
      await tx.query(`insert into setting (key, value) values ($1, $2::jsonb) on conflict (key) do update set value = excluded.value`, [cursor.key, JSON.stringify(cursor.value)]);
    });
    return entries.length;
  }
  if ('audit_cursor' in ask) {
    if (!AUDIT.test(ask.audit_cursor)) throw new Error('root.bookkeep reads only a connection\'s audit cursor');
    return (await map.setting<string>(ask.audit_cursor)) ?? null;
  }
  throw new Error('root.bookkeep applies, changes, keeps operational state, claims, releases, records, keeps events or an audit');
}
