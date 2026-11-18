// A change cut by a restart says so. A call in flight when the server restarts is answered with a 502, and the agent
// cannot tell whether its change applied. So each agent's last change is kept (its key, by whom), and the first answer
// an agent gets from a server started since it last heard from one says when that server started, on what commit,
// and what became of that change: applied, held, or not applied, to send again with its key.
//
// Both are operational state in the transient store (packs/log/kernel/operational.ts), kept a week: `heard:` is the
// start of the last server that answered a sender, `last:` its last change. A sender is a token in a workspace, as a
// refused change is kept for its retry (./tool-change.ts).

import type { Actor, Archipelago } from '../../write/kernel/pelago.ts';
import { actorId } from '../../write/kernel/pelago.ts';
import { firstAnswer, keyedIds } from '../../write/kernel/keyed.ts';
import { startedFrom } from '../../database/kernel/config.ts';
import { transientOf } from './root-transient.ts';

/** When this server started: the module is loaded once, as it starts. */
const STARTED = new Date().toISOString();
const WEEK = 7 * 24 * 3600_000;

type Last = { key: string; seed: string; at: string; reason: string; given: boolean };

const store = (l: Archipelago, ask: Parameters<typeof transientOf>[1]) => transientOf({ caller: 'surface', map: l }, ask);
const sender = (l: Archipelago, actor: Actor) => `${l.workspace}:${actor.token ?? ''}`;

/** The seed a keyed change's ids are drawn from: as the write path draws them (packs/write/kernel/pelago.ts). */
export const seedOf = (actor: Actor) => `${actorId(actor)}:${actor.token ?? ''}`;

/** A change is about to be judged: kept as this sender's last, under its key, before anything is applied. */
export async function changeBegun(l: Archipelago, actor: Actor, key: string, reason: string, given: boolean): Promise<void> {
  await store(l, { keep: { key: `last:${sender(l, actor)}`, value: { key, seed: seedOf(actor), at: new Date().toISOString(), reason, given } satisfies Last, ms: WEEK } });
}

/**
 * What an agent is told once of a restart: when this server started and on what commit, and what became of its last
 * change if it was sent to the server before. said is undefined when this sender has heard from this server already,
 * or from none before; heard marks it told, and is called once an answer carried it (a list cannot: the next will).
 */
export async function restartSaid(l: Archipelago, actor: Actor): Promise<{ said?: Record<string, unknown>; heard: () => Promise<void> } | undefined> {
  if (actor.kind !== 'agent') return undefined;
  const who = sender(l, actor);
  const was = (await store(l, { kept: `heard:${who}` })) as { started: string } | undefined;
  if (was?.started === STARTED) return undefined;
  const heard = async () => { await store(l, { keep: { key: `heard:${who}`, value: { started: STARTED }, ms: WEEK } }); };
  if (!was) return { heard }; // the first this sender heard from any server: nothing was cut
  return { said: await cutOff(l, who), heard };
}

/** When this server started, and what became of the sender's last change if it was sent before. */
async function cutOff(l: Archipelago, who: string): Promise<Record<string, unknown>> {
  const commit = startedFrom();
  const said: Record<string, unknown> = { at: STARTED, ...(commit && { commit: commit.slice(0, 12) }) };
  const last = (await store(l, { kept: `last:${who}` })) as Last | undefined;
  if (!last || last.at >= STARTED) return { ...said, note: `The server restarted at ${STARTED}.` };
  const first = await firstAnswer(l.db, keyedIds(last.seed, last.key));
  const change = first
    ? first.status === 'applied'
      ? { status: 'applied', changeset: first.changeset, reason: last.reason }
      : { status: 'held', proposal: first.proposal, reason: last.reason }
    : { status: 'not applied', reason: last.reason, key: last.key };
  const what = first ? (first.status === 'applied' ? `applied, as ${first.changeset}` : `held, as ${first.proposal}`) : `not applied: send it again with key "${last.key}", and it applies once`;
  return { ...said, last_change: change, note: `The server restarted at ${STARTED}. Your last change before it ("${last.reason.slice(0, 60)}") was ${what}.` };
}
