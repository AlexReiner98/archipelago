// Who is asking, and who may do what, said once: an actor as the log names it, a workspace's admin, or a person and
// not an agent. A tool marked humanOnly is refused to an agent before it runs (packs/surface/kernel/tools.ts); a function reached some
// other way checks for itself, with these. The identity root's (who is asking), so every root above it names an actor
// the same way.

import type { Actor } from '../../write/kernel/pelago-types.ts';

/** An actor as the log names it: its kind and its name. */
export const actorId = (actor: Pick<Actor, 'kind' | 'name'>) => `${actor.kind}:${actor.name}`;

/** Refused unless a workspace admin asks: "Only a workspace admin can <what>." */
export function needAdmin(actor: { admin?: boolean }, what: string): void {
  if (!actor.admin) throw new Error(`Only a workspace admin can ${what}.`);
}

/**
 * Who started a run, when it was not the owner: another person, an automation, or a delivery from outside (a push).
 * Such a run only proposes, whatever agents may do here: what it changes waits for the owner.
 */
export interface StartedBy {
  kind: 'person' | 'automation' | 'webhook' | 'pack';
  id?: string;
  name: string;
  /** A pack's action that started it (packs/loader/kernel/pack-action-launch.ts): the pack, and what else the pack says of the run. */
  pack?: string;
  [field: string]: unknown;
}

/**
 * Who a session is started for, when it is not the workspace's owner: what `by` names, else the person asking if they
 * are not the owner. Undefined for the owner's own.
 */
export function startedFor(actor: { person?: string; name: string }, owner: string | undefined, by?: StartedBy): StartedBy | undefined {
  return by ?? (owner && actor.person && actor.person !== owner ? { kind: 'person', id: actor.person, name: actor.name } : undefined);
}

/** What a session's token may do: one started for anyone but the owner only proposes. */
export const launchedMay = (started: StartedBy | undefined) => (started ? { may: 'propose' as const } : {});

/** Refused unless a person asks, with what is said to anyone else. */
export function needHuman(actor: { kind: string }, refusal: string): void {
  if (actor.kind !== 'human') throw new Error(refusal);
}
