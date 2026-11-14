// The shapes the map is written and read in: who acts, the ops of a change, an item, a held change. The write path
// (packs/write/kernel/pelago.ts) takes and answers them; every other module names them from there.

import type { Ruled } from '../../rules/kernel/rules.ts';
import type { Registry, TypeDef } from '../../loader/kernel/packs.ts';
import type { ForgetOp } from './forget.ts';

export interface Actor {
  kind: 'human' | 'agent';
  name: string;
  /** The person this identity is, or acts for. */
  person?: string;
  /** May manage the workspace's members, tokens and settings. */
  admin?: boolean;
  /** Id of the token in use, when there is one. */
  token?: string;
  /** The items this identity writes within, with all that is part of them (their ids). Absent: everything. */
  within?: string[];
  /** What it may write: only reports (measurements), proposals that always wait, or changes. Absent: change. */
  may?: May;
}

export type May = 'read' | 'report' | 'propose' | 'change';

type Props = Record<string, unknown>;

export interface CreateOp {
  op: 'create';
  ref?: string;
  type: string;
  title: string;
  body?: string;
  status?: string;
  owner?: string;
  visibility?: 'private' | 'shared' | 'public';
  confidence?: number;
  props?: Props;
  /** Where this fact came from, when it differs from the change's source. */
  source?: SourceSpec;
}
export interface UpdateOp {
  op: 'update';
  id: string;
  title?: string;
  body?: string;
  /** Added to the end of the note, after a blank line. */
  append?: string;
  /** One exact passage of the note, which must be there once, and what goes in its place. */
  replace?: { find: string; with: string };
  /** One exact passage of a code field (a module of it, by file, for modules by name) and what goes in its place: made into the whole field before the change is judged (packs/write/kernel/edit.ts). base: the text's sha256 as it was read. */
  edit?: { field: string; file?: string; find: string; with: string; base?: string };
  status?: string;
  owner?: string | null;
  visibility?: 'private' | 'shared' | 'public';
  confidence?: number;
  props?: Props;
}
export interface LinkOp {
  op: 'link';
  type: string;
  from: string;
  to: string;
  props?: Props;
  confidence?: number;
  source?: SourceSpec;
}
export interface UnlinkOp {
  op: 'unlink';
  relation: string;
}
export interface ArchiveOp {
  op: 'archive';
  id: string;
}
export interface RestoreOp {
  op: 'restore';
  id: string;
}
export interface MergeOp {
  op: 'merge';
  keep: string;
  drop: string;
}
export interface DefineTypeOp {
  op: 'define_type';
  type: TypeDef;
}
export type Op = CreateOp | UpdateOp | LinkOp | UnlinkOp | ArchiveOp | RestoreOp | MergeOp | DefineTypeOp | ForgetOp; export type { ForgetOp };

export interface SourceSpec {
  uri: string;
  title?: string;
  kind?: string;
  excerpt?: string;
}

/**
 * On whose authority a change is made: a human's, or the agent's own
 * judgment. An agent that says a human's must say where the human said so,
 * and the record keeps that it is the agent's report (`stated_by`).
 */
export interface Authority {
  of: 'human' | 'agent';
  /** Who: the human or agent itself, when the system knows. */
  who?: string;
  /** What it rests on: the human's words and where they were said, or what the agent saw. */
  basis?: string;
  /** The agent that reported a human's authority. Absent when the human acted themselves. */
  stated_by?: string;
}

/** A part of the page, by its id and the hash of the code that ran: which version of it asked. */
/** A part that sent a change: the part, the hash of its code, and the commit of the host the page loaded with (task e_qqp3cuk4). */
export interface PartRef { id: string; hash: string; host?: string }

export interface ChangeInput {
  ops: Op[];
  reason: string;
  source?: SourceSpec;
  /** From an agent: whether this is a human's word or its own judgment. A human's own change is theirs. */
  authority?: Pick<Authority, 'of' | 'basis'>;
  /** From an agent: have this change wait for a human even where agents' changes are applied as made. */
  hold?: boolean;
  /** The pack action that made it, named on every event it logs ("time.log made this"). */
  action?: string; /** The island a pack action was given (its `island` input): where what it makes goes when nothing it is tied to in the change says (packs/loader/kernel/island-items.ts). */ island?: string; /** The pack whose action or handler made it: what it writes is kept to the pack's reach (core's pack_reach). */ pack?: string; /** From the page: the layout whose code asked for it (packs/rules/kernel/layout-changes.ts). */ drawing?: string;
  /** From the page: the part of a pack that sent the action that made it, by its id and the hash of its code (packs/loader/kernel/part-calls.ts). */
  part?: PartRef;
  /** The change set this one reverses: undo's own. */
  undoes?: string; /** The session it was made in (a run's id), kept in the log's entry: where it came from, never on whose authority. */ run?: string;
}

export interface Entity {
  id: string; /** Its kind, kept in its row (packs/loader/kernel/head.ts). */ kind: string | null; /** The row's own, which may not be the server's name for it (Archipelago.workspace). */ workspace: string;
  type: string;
  title: string;
  body: string;
  status: string;
  is_open: boolean;
  owner: string | null;
  visibility: string;
  confidence: number;
  props: Props;
  source_id: string | null;
  created_at: Date;
  updated_at: Date;
  archived_at: Date | null;
  /** The person this is private to; null when everyone in the workspace can see it. */
  private_to: string | null;
}

export interface Proposal {
  id: string;
  ts: Date;
  actor: string;
  reason: string;
  source: SourceSpec | null;
  ops: Op[];
  warnings: string[];
  status: string;
  decided_by: string | null;
  decided_at: Date | null;
  note: string | null;
  /** Whom it was held for: the viewer of the map it was proposed on, or null. What it makes private is private to them. */
  private_to: string | null;
  /** The rule that held it (packs/rules/kernel/rules.ts): null for one held before rules named themselves. */
  held_by: Ruled | null;
}

// How an actor is named in the log: the identity root's (packs/identity/kernel/actor-checks.ts), who is asking.
export { actorId } from '../../identity/kernel/actor-checks.ts';

/** Active holds on resources, including ones whose holder the caller may not see. */
export const ACTIVE_HOLDS = `pelago_active_holds(current_user = 'pelago_member', current_setting('pelago.viewer', true))`;

/**
 * What can be made public: the types their packs mark so (a product, what it
 * has built, and how we know it is correct). Nothing else, so that a slip
 * cannot put a decision, a person or a note in front of everyone.
 */
export const publicTypes = (reg: Registry) => [...reg.types.values()].filter((t) => t.public && !t.dormant).map((t) => t.id);
