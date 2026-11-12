// What the sessions pack reads and writes, in its own words: an item as the reads answer it, who acts, and a change as
// the write path takes it. Kept here so the pack names nothing of the kernel's (docs/kernel-packs.md, "The in-process
// context"); the shapes are the map's own.

/** Who acts: a person or an agent, as the tools hand it. */
export interface Actor {
  kind: 'human' | 'agent';
  name: string;
  person?: string;
  admin?: boolean;
  within?: string[];
  may?: string;
}

/** The id an actor is logged by. */
export const actorId = (actor: Actor) => `${actor.kind}:${actor.name}`;

/** An item as a read answers it whole. */
export interface Item {
  id: string;
  type: string;
  title: string;
  body: string;
  status: string;
  is_open: boolean;
  owner: string | null;
  props: Record<string, unknown>;
  created_at: Date | string;
  updated_at: Date | string;
  archived_at: Date | string | null;
}

/** One op of a change. */
export type Op = { op: string; [field: string]: unknown };

/** A change as the write path takes it. */
export interface Change {
  ops: Op[];
  reason: string;
  authority?: { of: 'human' | 'agent'; basis?: string };
}

/** What a change answers: what it made, by ref, and the rest as it says it. */
export type Answer = { created: Record<string, string>; [more: string]: unknown };
