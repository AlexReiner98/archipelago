// The map and its single write path. Every change to items and links goes through change(): it is validated, judged
// by the rules (src/rules.ts), then either applied or stored as a proposal for a human, and always logged.

import { checkWritten } from './automation-rules.ts'; import { undeclaredColumns } from './head.ts';
import { AGENT_CHANGES, agentChanges, decide, DEFAULT_AGENT_POLICY, type Policy, type Ruled } from './rules.ts';
import { mayWrite } from './within.ts'; import { stillWritable } from './ended.ts'; import { authorityOf } from './authority.ts';
import { anyone, newId, scoped, type Db, type Q } from './db.ts';
import { bodyAfter, dropExcepted } from './ops.ts'; import { mergeRefusals, once, overtaken } from './merge.ts';
import { readEvents, type EventQuery } from './eventlog.ts';
import type { Registry, TypeDef } from './packs.ts';
import { isSealed, seal, unseal } from './secrets.ts';
import { KEPT_FIELDS } from './operational.ts';

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

export type May = 'report' | 'propose' | 'change';

export type { Level, OpKind, Policy } from './rules.ts';
export { DEFAULT_AGENT_POLICY } from './rules.ts';

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
export type Op = CreateOp | UpdateOp | LinkOp | UnlinkOp | ArchiveOp | RestoreOp | MergeOp | DefineTypeOp;

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

export interface ChangeInput {
  ops: Op[];
  reason: string;
  source?: SourceSpec;
  /** From an agent: whether this is a human's word or its own judgment. A human's own change is theirs. */
  authority?: Pick<Authority, 'of' | 'basis'>;
  /** From an agent: have this change wait for a human even where agents' changes are applied as made. */
  hold?: boolean;
  /** The pack action that made it, named on every event it logs ("time.log made this"). */
  action?: string;
}

export interface Entity {
  id: string; /** Its kind, kept in its row (src/head.ts). */ kind: string | null;
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
  /** The rule that held it (src/rules.ts): null for one held before rules named themselves. */
  held_by: Ruled | null;
}

export const actorId = (actor: Actor) => `${actor.kind}:${actor.name}`;

/** Relations that make one thing wait on another. */
export const BLOCKING_RELATIONS = ['depends_on', 'needs'];

/** Active holds on resources, including ones whose holder the caller may not see. */
export const ACTIVE_HOLDS = `pelago_active_holds(current_user = 'pelago_member', current_setting('pelago.viewer', true))`;

/**
 * What can be made public: the types their packs mark so (a product, what it
 * has built, and how we know it is correct). Nothing else, so that a slip
 * cannot put a decision, a person or a note in front of everyone.
 */
export const publicTypes = (reg: Registry) => [...reg.types.values()].filter((t) => t.public && !t.dormant).map((t) => t.id);

export class Archipelago {
  readonly db: Db;
  readonly registry: Registry;
  readonly policy: Policy;
  /** The workspace this map belongs to. Each has its own database. */
  readonly workspace: string;
  /**
   * The person whose view this is. Undefined means unscoped: the whole map,
   * as one person on one machine or the system itself sees it.
   */
  readonly viewer: string | undefined;

  /**
   * An item's fields as this view may select them from entity. Anyone with
   * no login may not read the column: the database gives them the few fields
   * the public page shows.
   */
  readonly props: string;

  constructor(db: Db, registry: Registry, policy: Partial<Policy> = {}, workspace = 'default', viewer?: string, props = 'props') {
    this.db = db;
    this.registry = registry;
    this.policy = { ...DEFAULT_AGENT_POLICY, ...policy };
    this.workspace = workspace;
    this.viewer = viewer;
    this.props = props;
  }

  /** This map as anyone sees it with no login: only what is public. Ask it of the whole map, not of one person's view. */
  forAnyone(): Archipelago {
    return new Archipelago(anyone(this.db), this.registry, this.policy, this.workspace, '', 'pelago_public_props(id) as props');
  }

  /** This map as one person sees it. An empty viewer sees only what is shared; an admin also sees every token and setting. */
  as(viewer: string, admin = false): Archipelago {
    return new Archipelago(scoped(this.db, viewer, admin), this.registry, this.policy, this.workspace, viewer);
  }

  /** Whether new things are private to their author unless they say otherwise. */
  async defaultVisibility(q: Q = this.db): Promise<'private' | 'shared'> {
    const { rows } = await q.query<{ value: string }>(`select value from setting where key = 'default_visibility'`);
    return rows[0]?.value === 'shared' ? 'shared' : 'private';
  }

  /**
   * What becomes of an agent's change in this workspace: applied as it is
   * made, with the log and undo as the record ("apply"), or held until a
   * human has looked ("hold"). The workspace's setting; without one, what the
   * server's policy comes to. Only the workspace's own "apply" lets an agent
   * settle a decision or a hypothesis.
   */
  async agentChanges(): Promise<'apply' | 'hold'> {
    return agentChanges(this.db, this.policy);
  }

  /** Who a new private thing is private to: the viewer, when there is one. */
  private privateTo(visibility: string): string | null {
    return visibility === 'private' && this.viewer ? this.viewer : null;
  }

  // ---- writes ----------------------------------------------------------

  /** measured: a report's reading (a part up or down), applied at once as a measurement, not anyone's judgment. */
  async change(actor: Actor, input: ChangeInput, measured = false) {
    if (!input.reason?.trim()) throw new Error('Every change needs a reason.');
    await stillWritable(this.workspace); await mayWrite(this, actor, input.ops, measured);
    const { warnings } = await this.plan(input.ops);
    const me = actorId(actor);
    const claimed = input.authority;
    const authority = authorityOf(actor.kind === 'human', me, claimed);
    // Whether it applies, waits or is refused is the rules' to say (src/rules.ts), and the answer names the rule.
    const who = { human: actor.kind === 'human', reading: measured, may: actor.may, asked: input.hold, said: Boolean(claimed) };
    const verdict = await decide(this.db, this.registry, who, input.ops, this.policy);
    if (verdict.outcome === 'refuse') throw new Error(`Change rejected:\n${verdict.refused.map((r) => `- ${r}`).join('\n')}`);
    // A question an agent settled, where the owner lets it, is put to them by the next session they talk to.
    const answered: { id: string; title: string; status: string; outcome?: string; authority: Authority }[] = [];
    if (actor.kind !== 'human' && verdict.outcome === 'apply') {
      const questions = new Set(this.registry.having('settles'));
      for (const op of input.ops) {
        if (op.op !== 'update' || !op.status) continue;
        const e = await this.entity(op.id);
        if (!e || !questions.has(e.type) || !e.is_open || !this.registry.type(e.type)?.statuses.closed.includes(op.status)) continue;
        answered.push({ id: e.id, title: e.title, status: op.status, outcome: { ...e.props, ...op.props }.outcome as string | undefined, authority });
      }
    }

    if (verdict.outcome === 'hold') {
      const id = newId('p');
      await this.db.query(
        `insert into proposal (id, actor, reason, source, ops, warnings, private_to, held_by) values ($1, $2, $3, $4::jsonb, $5::jsonb, $6::jsonb, $7, $8::jsonb)`,
        [id, actorId(actor), input.reason, JSON.stringify(input.source ?? null), JSON.stringify(input.ops), JSON.stringify(warnings), this.viewer || null, JSON.stringify(verdict.by ?? null)],
      );
      await this.log(this.db, { actor: actorId(actor), action: 'proposal.create', reason: input.reason, detail: { proposal: id, ops: input.ops.length, held_by: verdict.by?.rule } });
      return {
        status: 'proposed' as const,
        proposal: id,
        held_by: verdict.by,
        warnings,
        note: 'Nothing has changed yet. A human must approve this proposal before it appears in the map.',
      };
    }
    const applied = await this.apply(me, input, { authority });
    return answered.length ? { ...applied, answered } : applied;
  }

  /** `ops`, when given, replaces the proposed ops: the reviewer's corrected version. One at a time: a second click while one applies is refused, not applied again. */
  decide(actor: Actor, input: Parameters<Archipelago['decideNow']>[1]) { return once(input.proposal, () => this.decideNow(actor, input)); }
  private async decideNow(actor: Actor, input: { proposal: string; approve: boolean; except?: string[]; note?: string; ops?: Op[] }) {
    if (actor.kind !== 'human') throw new Error('Only a human can approve or reject proposals.');
    const { rows } = await this.db.query<Proposal>(`select * from proposal where id = $1`, [input.proposal]);
    const proposal = rows[0];
    if (!proposal) throw new Error(`No proposal "${input.proposal}"`);
    if (proposal.status !== 'pending') throw new Error(`Proposal ${proposal.id} is already ${proposal.status}`);

    let result: Awaited<ReturnType<Archipelago['apply']>> | undefined;
    if (input.approve) {
      result = await this.apply(
        proposal.actor,
        { ops: input.ops ?? proposal.ops, reason: proposal.reason, source: proposal.source ?? undefined },
        // Held and then applied by a human: it rests on that human, whatever the agent thought it rested on.
        { except: input.except, approvedBy: actorId(actor), revised: Boolean(input.ops), authority: { of: 'human', who: actorId(actor) } },
      ).catch((err: Error) => { throw err.message.startsWith('Change rejected') ? overtaken(proposal.id, err) : err; });
      if (input.ops) await this.db.query(`update proposal set ops = $2::jsonb where id = $1`, [proposal.id, JSON.stringify(input.ops)]);
    }
    const status = input.approve ? 'approved' : 'rejected';
    await this.db.query(`update proposal set status = $2, decided_by = $3, decided_at = now(), note = $4 where id = $1 and status = 'pending'`, [
      proposal.id,
      status,
      actorId(actor),
      input.note ?? null,
    ]);
    await this.log(this.db, {
      actor: actorId(actor),
      action: `proposal.${input.approve ? 'approve' : 'reject'}`,
      changeset: result?.changeset,
      reason: input.note ?? '',
      detail: { proposal: proposal.id, proposed_by: proposal.actor, except: input.except ?? [], revised: Boolean(input.ops) },
    });
    return { ...result, proposal: proposal.id, status };
  }

  /** Validate ops against the schema and the current map. Throws listing every problem. */
  async plan(ops: Op[]): Promise<{ warnings: string[] }> {
    if (!ops.length) throw new Error('A change needs at least one op.');
    const errors: string[] = [], warnings: string[] = [];
    const refs = new Map<string, string>(); // ref -> type
    const seen = new Set<string>(), dropped = new Set<string>(); // dropped: what this change has merged away so far
    const reg = this.registry;

    const typeOf = async (key: string, where: string): Promise<string | undefined> => {
      const local = refs.get(key);
      if (local) return local;
      const found = await this.entity(key);
      if (!found) errors.push(`${where}: no entity or ref "${key}"`);
      else if (found.archived_at) warnings.push(`${where}: "${found.title}" (${key}) is archived`);
      return found?.type;
    };
    const existing = async (id: string, where: string) => {
      const found = await this.entity(id);
      if (!found) errors.push(`${where}: no entity "${id}"`);
      return found;
    };
    const checkOwner = async (owner: string, where: string) => {
      const type = await typeOf(owner, where);
      if (type && !reg.isA(type, 'person') && !reg.isA(type, 'agent')) errors.push(`${where}: owner must be a person or agent, not ${type}`);
    };

    for (const [i, op] of ops.entries()) {
      const where = `op ${i + 1} (${op.op})`;
      switch (op.op) {
        case 'create': {
          if (!op.title?.trim()) errors.push(`${where}: title is required`);
          errors.push(...reg.check(op.type, op.status, op.props ?? {}).map((p) => `${where}: ${p}`));
          if (op.owner) await checkOwner(op.owner, where);
          const type = reg.type(op.type);
          if (!type) break;
          if (op.visibility === 'public' && !type.public) errors.push(`${where}: a ${op.type} cannot be public. Only these can: ${publicTypes(reg).join(', ')}.`);
          errors.push(...[...checkWritten(reg, op.type, op.props ?? {}), ...undeclaredColumns(type, op)].map((p) => `${where}: ${p}`));
          if (op.ref) {
            if (refs.has(op.ref)) errors.push(`${where}: ref "${op.ref}" is used twice`);
            refs.set(op.ref, op.type);
          }
          const root = type.base;
          const key = `${root}\n${op.title.trim().toLowerCase()}`;
          if (seen.has(key)) warnings.push(`${where}: "${op.title}" appears more than once in this change`);
          seen.add(key);
          const { rows } = await this.db.query<Entity>(
            `select id, type, title from entity where lower(title) = lower($1) and type = any($2::text[]) and archived_at is null`,
            [op.title.trim(), reg.family(root)],
          );
          for (const dup of rows) warnings.push(`${where}: possible duplicate of existing ${dup.type} "${dup.title}" (${dup.id})`);
          break;
        }
        case 'update': {
          const target = await existing(op.id, where);
          if (!target) break;
          errors.push(...[...reg.check(target.type, op.status, op.props ?? {}), ...undeclaredColumns(reg.type(target.type), op)].map((p) => `${where}: ${p}`));
          if (op.visibility === 'public' && !reg.type(target.type)?.public) errors.push(`${where}: "${target.title}" is a ${target.type}, which cannot be public. Only these can: ${publicTypes(reg).join(', ')}.`);
          if (op.title !== undefined && !op.title.trim()) errors.push(`${where}: title cannot be empty`);
          try {
            bodyAfter(target.body, op);
          } catch (e) {
            errors.push(`${where}: "${target.title}": ${(e as Error).message}`);
          }
          if (op.owner) await checkOwner(op.owner, where);
          break;
        }
        case 'link': {
          const from = await typeOf(op.from, where);
          const to = await typeOf(op.to, where);
          if (op.from === op.to) errors.push(`${where}: cannot link an entity to itself`);
          if (from && to) {
            const problem = reg.checkRelation(op.type, from, to);
            if (problem) errors.push(`${where}: ${problem}`);
          }
          break;
        }
        case 'unlink': {
          const { rows } = await this.db.query(`select 1 from relation where id = $1 and valid_to is null`, [op.relation]);
          if (!rows.length) errors.push(`${where}: no active relation "${op.relation}"`);
          break;
        }
        case 'archive':
          await existing(op.id, where);
          break;
        case 'restore': {
          const target = await existing(op.id, where);
          if (target && !target.archived_at) errors.push(`${where}: "${target.title}" is not archived`);
          break;
        }
        case 'merge': {
          const keep = await existing(op.keep, where);
          const drop = await existing(op.drop, where);
          errors.push(...(await mergeRefusals(this.db, where, keep, drop, dropped)));
          if (keep && drop && keep.type !== drop.type) warnings.push(`${where}: merging a ${drop.type} into a ${keep.type}`);
          break;
        }
        case 'define_type':
          errors.push(...reg.checkNewType(op.type).map((p) => `${where}: ${p}`));
          break;
      }
    }
    if (!errors.length) errors.push(...(await this.checkPrivateDependencies(ops)));
    if (errors.length) throw new Error(`Change rejected:\n- ${errors.join('\n- ')}`);
    return { warnings };
  }

  /**
   * The rule that keeps blockers honest between people: nothing may depend on
   * an item that is private unless it is private to the same person. Otherwise
   * a colleague would see work as ready that is waiting on something hidden
   * from them. Checked for new dependencies and for changes of visibility.
   */
  private async checkPrivateDependencies(ops: Op[]): Promise<string[]> {
    if (!this.viewer) return []; // nothing is private without a person to be private to
    const problems: string[] = [];
    const fallback = await this.defaultVisibility();
    const after = new Map<string, boolean>(); // ref or id -> private once this change applies
    const names = new Map<string, string>();
    for (const op of ops) {
      if (op.op === 'create' && op.ref) {
        after.set(op.ref, (op.visibility ?? fallback) === 'private');
        names.set(op.ref, op.title);
      }
      if (op.op === 'update' && op.visibility) after.set(op.id, op.visibility === 'private');
    }
    const lookup = async (key: string) => {
      const found = after.has(key) && names.has(key) ? undefined : await this.entity(key);
      if (found) names.set(key, found.title);
      return { private: after.get(key) ?? Boolean(found?.private_to), was: Boolean(found?.private_to) };
    };
    const name = (key: string) => `"${names.get(key) ?? key}"`;

    for (const [i, op] of ops.entries()) {
      const where = `op ${i + 1} (${op.op})`;
      if (op.op === 'link' && BLOCKING_RELATIONS.includes(this.registry.relations.get(op.type)?.root ?? op.type)) {
        const [from, to] = [await lookup(op.from), await lookup(op.to)];
        if (to.private && !from.private) problems.push(`${where}: ${name(op.from)} is shared, so it cannot depend on ${name(op.to)}, which is private. Share ${name(op.to)}, or make ${name(op.from)} private too.`);
      }
      if (op.op === 'merge') {
        // A merge moves relations from one to the other, so the two must be equally visible.
        const [keep, drop] = [await lookup(op.keep), await lookup(op.drop)];
        if (keep.private !== drop.private) problems.push(`${where}: ${name(op.keep)} and ${name(op.drop)} must have the same visibility to be merged. Share or un-share one of them first.`);
      }
      if (op.op !== 'update' || !op.visibility) continue;
      const self = await lookup(op.id);
      if (self.private && !self.was) {
        // Going private: nothing outside my own private items may be waiting on it.
        const { rows: seen } = await this.db.query<{ id: string; title: string }>(
          `select s.id, s.title from relation r join entity s on s.id = r.from_id
           where r.to_id = $1 and r.valid_to is null and r.type = any($2::text[]) and s.archived_at is null and s.private_to is null`,
          [op.id, this.registry.relationFamily(...BLOCKING_RELATIONS)],
        );
        const { rows: all } = await this.db.query<{ n: number }>(`select pelago_external_dependents($1, $2) as n`, [op.id, this.viewer]);
        const staying = seen.filter((s) => after.get(s.id) !== true);
        const hidden = all[0].n - seen.length;
        if (staying.length || hidden > 0) {
          const what = [...staying.map((s) => `"${s.title}"`), ...(hidden > 0 ? [`${hidden} item${hidden === 1 ? '' : 's'} private to someone else`] : [])].join(', ');
          problems.push(`${where}: ${name(op.id)} cannot be made private while other work depends on it: ${what}.`);
        }
      }
      if (!self.private && self.was) {
        // Going shared: what it waits on must be visible too.
        const { rows: targets } = await this.db.query<{ id: string; title: string }>(
          `select t.id, t.title from relation r join entity t on t.id = r.to_id
           where r.from_id = $1 and r.valid_to is null and r.type = any($2::text[]) and t.archived_at is null and t.private_to is not null`,
          [op.id, this.registry.relationFamily(...BLOCKING_RELATIONS)],
        );
        const stillPrivate = targets.filter((t) => after.get(t.id) !== false);
        if (stillPrivate.length) problems.push(`${where}: ${name(op.id)} cannot be shared while it depends on private items: ${stillPrivate.map((t) => `"${t.title}"`).join(', ')}. Share those in the same change.`);
      }
    }
    return problems;
  }

  /**
   * Apply a change without consulting policy. For human changes, approved
   * proposals, and the system's own bookkeeping (sessions).
   */
  async apply(actor: string, input: ChangeInput, opts: { except?: string[]; approvedBy?: string; revised?: boolean; authority?: Authority } = {}) {
    const ops = dropExcepted(input.ops, opts.except ?? []); await stillWritable(this.workspace);
    if (!ops.length) throw new Error('Nothing left to apply after exclusions.');
    // Validate again: the map may have changed since this was proposed.
    const { warnings } = await this.plan(ops);
    const changeset = newId('c');
    const created: Record<string, string> = {};
    const extra = { ...(opts.approvedBy && { approved_by: opts.approvedBy, ...(opts.revised && { revised_by: opts.approvedBy }) }), ...(opts.authority && { authority: opts.authority }), ...(input.action && { action: input.action }) };
    const reg = this.registry;

    await this.db.transaction(async (tx) => {
      const fallback = await this.defaultVisibility(tx);
      const defaultSource = input.source ? await this.ensureSource(tx, actor, input.source, changeset) : null;
      const sourceOf = async (op: { source?: SourceSpec }) => (op.source ? this.ensureSource(tx, actor, op.source, changeset) : defaultSource);
      const resolve = (key: string) => created[key] ?? key;
      // What this change makes has its id from the start, so a title or note in the same change can name it:
      // {ref} becomes the id of the item made under that ref. Braces around anything else are left alone.
      for (const [i, op] of ops.entries()) if (op.op === 'create') created[op.ref ?? `#${i + 1}`] = newId('e');
      const refs = new Set(ops.flatMap((op) => (op.op === 'create' && op.ref ? [op.ref] : [])));
      const named = <T extends string | undefined>(text: T): T => (text === undefined ? text : (text.replace(/\{([^{}\s]+)\}/g, (whole, ref: string) => (refs.has(ref) ? created[ref] : whole)) as T));
      const log = (action: string, target: string, detail: Props) =>
        this.log(tx, { actor, action, target, changeset, reason: input.reason, detail: { ...detail, ...extra } });

      for (const [i, op] of ops.entries()) {
        switch (op.op) {
          case 'create': {
            const type = reg.type(op.type)!;
            const id = created[op.ref ?? `#${i + 1}`];
            const status = op.status ?? type.statuses.open[0];
            await tx.query(
              `insert into entity (id, type, title, body, status, is_open, owner, visibility, confidence, props, source_id, private_to, kind)
               values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb, $11, $12, $13)`,
              [
                id,
                op.type,
                named(op.title.trim()),
                named(op.body) ?? '',
                status,
                reg.isOpen(op.type, status),
                op.owner ? resolve(op.owner) : null,
                op.visibility ?? fallback,
                op.confidence ?? 1,
                JSON.stringify({ ...reg.defaults(op.type), ...op.props }),
                type.columns && !type.columns.source ? null : await sourceOf(op),
                this.privateTo(op.visibility ?? fallback), type.kind ?? null,
              ],
            );
            await log('entity.create', id, { type: op.type, title: named(op.title.trim()), status });
            break;
          }
          case 'update': {
            const before = (await this.entity(op.id, tx))!;
            const props = { ...before.props };
            const changes: Record<string, { from: unknown; to: unknown }> = {};
            for (const [key, value] of Object.entries(op.props ?? {})) {
              changes[`props.${key}`] = { from: props[key] ?? null, to: value };
              if (value === null) delete props[key];
              else props[key] = value;
            }
            const next = {
              title: named(op.title)?.trim() ?? before.title,
              body: bodyAfter(before.body, { ...op, body: named(op.body), append: named(op.append), replace: op.replace && { find: op.replace.find, with: named(op.replace.with) } }),
              status: op.status ?? before.status,
              owner: op.owner === undefined ? before.owner : op.owner,
              visibility: op.visibility ?? before.visibility,
              confidence: op.confidence ?? before.confidence,
            };
            for (const key of Object.keys(next) as (keyof typeof next)[]) {
              if (next[key] !== before[key]) changes[key] = { from: before[key], to: next[key] };
            }
            await tx.query(
              `update entity set title = $2, body = $3, status = $4, is_open = $5, owner = $6, visibility = $7,
                 confidence = $8, props = $9::jsonb, updated_at = now(),
                 private_to = case when $10::boolean then $11 else private_to end where id = $1`,
              [
                op.id, next.title, next.body, next.status, reg.isOpen(before.type, next.status), next.owner, next.visibility, next.confidence, JSON.stringify(props),
                // Only an explicit change of visibility moves who it is private to.
                op.visibility !== undefined && op.visibility !== before.visibility,
                this.privateTo(next.visibility),
              ],
            );
            await log('entity.update', op.id, { title: next.title, changes });
            break;
          }
          case 'link': {
            const from = resolve(op.from);
            const to = resolve(op.to);
            const same = await tx.query<{ id: string }>(
              `select id from relation where type = $1 and from_id = $2 and to_id = $3 and valid_to is null`,
              [op.type, from, to],
            );
            if (same.rows.length) break; // already linked
            const id = newId('r');
            await tx.query(
              `insert into relation (id, type, from_id, to_id, props, confidence, source_id) values ($1, $2, $3, $4, $5::jsonb, $6, $7)`,
              [id, op.type, from, to, JSON.stringify(op.props ?? {}), op.confidence ?? 1, await sourceOf(op)],
            );
            await log('relation.link', from, { relation: id, type: op.type, to });
            break;
          }
          case 'unlink': {
            const { rows } = await tx.query<{ type: string; from_id: string; to_id: string }>(
              `update relation set valid_to = now() where id = $1 returning type, from_id, to_id`,
              [op.relation],
            );
            await log('relation.unlink', rows[0].from_id, { relation: op.relation, type: rows[0].type, to: rows[0].to_id });
            break;
          }
          case 'archive': {
            const { rows } = await tx.query<{ title: string }>(`update entity set archived_at = now(), updated_at = now() where id = $1 returning title`, [op.id]);
            await log('entity.archive', op.id, { title: rows[0].title });
            break;
          }
          case 'restore': {
            const { rows } = await tx.query<{ title: string }>(`update entity set archived_at = null, updated_at = now() where id = $1 returning title`, [op.id]);
            await log('entity.restore', op.id, { title: rows[0].title });
            break;
          }
          case 'merge': {
            const keep = (await this.entity(op.keep, tx))!;
            const drop = (await this.entity(op.drop, tx))!; // archived first, and only once: a merge that races another is refused
            if (!(await tx.query(`update entity set archived_at = now(), updated_at = now() where id = $1 and archived_at is null returning id`, [op.drop])).rows.length) throw new Error(`Change rejected:\n- "${drop.title}" is already merged or archived`);
            await tx.query(`update relation set from_id = $1 where from_id = $2`, [op.keep, op.drop]);
            await tx.query(`update relation set to_id = $1 where to_id = $2`, [op.keep, op.drop]);
            await tx.query(`update relation set valid_to = now() where from_id = to_id and valid_to is null`);
            // Where both said the same thing (each was part of the same project), the kept one now says it twice: the older stays.
            await tx.query(
              `update relation set valid_to = now() where valid_to is null and (from_id = $1 or to_id = $1) and id not in (
                 select distinct on (type, from_id, to_id) id from relation where valid_to is null and (from_id = $1 or to_id = $1)
                 order by type, from_id, to_id, valid_from, id)`,
              [op.keep],
            );
            await tx.query(`update entity set owner = $1 where owner = $2`, [op.keep, op.drop]);
            const body = [keep.body, drop.body].filter(Boolean).join('\n\n');
            await tx.query(`update entity set props = $2::jsonb, body = $3, updated_at = now() where id = $1`, [
              op.keep,
              JSON.stringify({ ...drop.props, ...keep.props }),
              body,
            ]);
            await log('entity.merge', op.keep, { title: keep.title, absorbed: { id: drop.id, title: drop.title, props: drop.props } });
            break;
          }
          case 'define_type':
            break; // handled after the transaction
        }
      }
    });

    for (const op of ops) {
      if (op.op !== 'define_type') continue;
      await this.registry.defineLocal(op.type);
      await this.log(this.db, { actor, action: 'type.define', changeset, reason: input.reason, detail: { type: op.type, ...extra } });
    }
    await this.supersede(changeset);
    return { status: 'applied' as const, changeset, created, warnings };
  }

  /**
   * A held change that asks only for what is now so (each thing it would
   * settle already has that status) has been overtaken: it leaves the queue
   * as superseded, and the log says by which change. Nobody decided it, so
   * it is neither applied nor declined.
   */
  private async supersede(changeset: string): Promise<void> {
    const { rows } = await this.db.query<Proposal>(`select * from proposal where status = 'pending'`);
    for (const p of rows) {
      let moot = p.ops.length > 0;
      for (const op of p.ops) {
        if (op.op !== 'update' || !op.status || Object.keys(op).some((key) => !['op', 'id', 'status', 'props'].includes(key))) moot = false;
        else moot = (await this.entity(op.id))?.status === op.status;
        if (!moot) break;
      }
      if (!moot) continue;
      const done = await this.db.query(`update proposal set status = 'superseded', decided_by = 'agent:pelago', decided_at = now(), note = $2 where id = $1 and status = 'pending' returning id`, [p.id, `Already so since ${changeset}`]);
      if (done.rows.length) await this.log(this.db, { actor: 'agent:pelago', action: 'proposal.supersede', reason: p.reason, detail: { proposal: p.id, proposed_by: p.actor, by: changeset } });
    }
  }

  private async ensureSource(q: Q, actor: string, spec: SourceSpec, changeset: string): Promise<string | null> {
    if (!this.registry.type('sys.source')) return null;
    const found = await q.query<{ id: string }>(`select id from entity where type = 'sys.source' and props->>'uri' = $1 and archived_at is null`, [spec.uri]);
    if (found.rows.length) return found.rows[0].id;
    const id = newId('e');
    const props: Props = { uri: spec.uri };
    if (spec.kind) props.kind = spec.kind;
    const problems = this.registry.check('sys.source', undefined, props);
    if (problems.length) throw new Error(`Change rejected:\n- source: ${problems.join('\n- source: ')}`);
    await q.query(
      `insert into entity (id, type, title, body, status, is_open, props, visibility, private_to) values ($1, 'sys.source', $2, $3, 'recorded', true, $4::jsonb, $5, $6)`,
      [id, spec.title ?? spec.uri, spec.excerpt ?? '', JSON.stringify(props), await this.defaultVisibility(q), this.privateTo(await this.defaultVisibility(q))],
    );
    await this.log(q, { actor, action: 'entity.create', target: id, changeset, reason: 'Source of this change', detail: { type: 'sys.source', title: spec.title ?? spec.uri } });
    return id;
  }

  /**
   * Move every item of a type (or link of a relation) no pack defines any more to the one that took it over
   * (moved_from): a one-time migration as a pack takes it out of another, logged as one event. All else stays. The
   * lenses and screens that name the old one in their settings (kinds and on, or over) name the new one.
   */
  /** Each item's kind in its row, from the type table, where the row lacks it or has another (src/head.ts): when a workspace opens. */
  fillKinds = async () => (await this.db.query(`update entity e set kind = t.def->>'kind' from type_def t where t.id = e.type and e.kind is distinct from t.def->>'kind' returning e.id`)).rows.length;
  async retype(from: string, to: string, what: 'entity' | 'relation' = 'entity'): Promise<number> {
    return this.db.transaction(async (tx) => {
      const { rows } = await tx.query<{ id: string }>(`update ${what === 'entity' ? 'entity' : 'relation'} set type = $2 where type = $1 returning id`, [from, to]);
      const names = `jsonb_typeof(e.props -> k) = 'array' and (e.props -> k ? $1 or e.props -> k ? ('-' || $1))`;
      const swap = `case when x = to_jsonb($1::text) then to_jsonb($2::text) when x = to_jsonb('-' || $1) then to_jsonb('-' || $2) else x end`;
      const { rows: named } = await tx.query<{ id: string }>(
        `update entity e set props = e.props || (select jsonb_object_agg(k, (select jsonb_agg(${swap} order by i) from jsonb_array_elements(e.props -> k) with ordinality a(x, i))) from unnest($3::text[]) k where ${names})
         where e.type = any($4::text[]) and exists (select 1 from unnest($3::text[]) k where ${names}) returning e.id`,
        [from, to, what === 'entity' ? ['kinds', 'on'] : ['over'], [...this.registry.family('lens'), ...this.registry.family('screen')]],
      );
      const settings = named.length ? { settings: named.map((r) => r.id) } : {};
      if (rows.length || named.length) await this.log(tx, { actor: 'system', action: 'type.moved', reason: `Every ${from} is a ${to} now: its pack took the ${what === 'entity' ? 'type' : 'relation'} over.`, detail: { from, to, items: rows.map((r) => r.id), ...settings } });
      return rows.length;
    });
  }

  async log(
    q: Q,
    e: { actor: string; action: string; target?: string; changeset?: string; reason?: string; detail?: Props; origin?: string; ts?: string },
  ): Promise<void> {
    await q.query(
      `insert into event (actor, action, target_id, changeset, reason, detail, origin, ts, private_to)
       values ($1, $2, $3, $4, $5, $6::jsonb, $7, coalesce($8::timestamptz, now()), $9)`,
      // An event about an entity is as visible as that entity. One with no
      // target (a proposal, an undo) is private to whoever caused it.
      [e.actor, e.action, e.target ?? null, e.changeset ?? null, e.reason ?? '', JSON.stringify(e.detail ?? {}), e.origin ?? 'pelago', e.ts ?? null, e.target ? null : this.viewer || null],
    );
  }

  // ---- operational state (src/operational.ts) ------------------------------
  // These take effect at once for agents too and are never held: coordination that waits for approval is no coordination.

  /**
   * The one write to an item that skips change: bookkeeping no one states as a fact (a session's heartbeat, an
   * automation's last firing), and who may read a notification. Only the fields src/operational.ts names; out of the
   * item's history, so it does not look newly confirmed. The event, when given, is logged with it.
   */
  async operational(id: string, set: { props?: Props; unset?: string[]; add?: Record<string, number>; reach?: { private_to: string | null; visibility?: 'shared' } }, event?: { actor: string; action: string; reason?: string; detail?: Props }) {
    const named = [...Object.keys(set.props ?? {}), ...(set.unset ?? []), ...Object.keys(set.add ?? {})].filter((k) => !KEPT_FIELDS.includes(k));
    if (named.length) throw new Error(`${named.join(', ')} is a fact about the item: change it through change`);
    await this.db.query(
      `update entity set props = ((props || $2::jsonb) - $3::text[]) || coalesce((select jsonb_object_agg(k, coalesce((props->>k)::numeric, 0) + v::numeric) from jsonb_each_text($4::jsonb) a(k, v)), '{}'),
         visibility = coalesce($5, visibility), private_to = case when $6 then $7 else private_to end where id = $1`,
      [id, JSON.stringify(set.props ?? {}), set.unset ?? [], JSON.stringify(set.add ?? {}), set.reach?.visibility ?? null, Boolean(set.reach), set.reach?.private_to ?? null],
    );
    if (event) await this.log(this.db, { ...event, target: id });
  }

  async claim(actor: Actor, input: { resource: string; holder: string; for?: string; reason: string }) {
    return this.db.transaction(async (tx) => {
      await tx.query(`select pelago_hold_lock($1)`, [input.resource]); // one claim of it at a time (src/db.ts): what is held is read after
      const resource = await this.entity(input.resource, tx);
      if (!resource || !this.registry.capacity(resource)) throw new Error(`"${input.resource}" is not a resource: nothing of its type can be held`);
      const holder = await this.entity(input.holder, tx);
      if (!holder) throw new Error(`No item "${input.holder}" to hold it`);
      if (input.for && !(await this.entity(input.for, tx))) throw new Error(`No item "${input.for}"`);
      if (resource.status !== 'available') throw new Error(`"${resource.title}" is ${resource.status}`);

      const { rows: held } = await tx.query<{ id: string; from_id: string; valid_from: Date; title: string }>(
        `select h.id, h.from_id, h.valid_from, h.holder_title as title from ${ACTIVE_HOLDS} h where h.to_id = $1`,
        [resource.id],
      );
      const mine = held.find((h) => h.from_id === holder.id);
      if (mine) return { status: 'already_held' as const, relation: mine.id };
      if (held.length >= this.registry.capacity(resource)!) {
        const h = held[0];
        throw new Error(`"${resource.title}" is held by "${h.title}" (${h.from_id}) since ${h.valid_from.toISOString()}. It must be released first.`);
      }
      const id = newId('r');
      await tx.query(`insert into relation (id, type, from_id, to_id, props) values ($1, 'holds', $2, $3, $4::jsonb)`, [
        id,
        holder.id,
        resource.id,
        JSON.stringify(input.for ? { for: input.for } : {}),
      ]);
      await this.log(tx, { actor: actorId(actor), action: 'resource.claim', target: resource.id, reason: input.reason, detail: { resource: resource.title, holder: holder.id, holder_title: holder.title, for: input.for } });
      return { status: 'claimed' as const, relation: id };
    });
  }

  async release(actor: Actor, input: { resource: string; holder?: string; reason: string }) {
    const { rows } = await this.db.query<{ from_id: string }>(
      `update relation set valid_to = now() where type = 'holds' and to_id = $1 and valid_to is null
         and ($2::text is null or from_id = $2) returning from_id`,
      [input.resource, input.holder ?? null],
    );
    for (const row of rows) await this.log(this.db, { actor: actorId(actor), action: 'resource.release', target: input.resource, reason: input.reason, detail: { holder: row.from_id } });
    return { released: rows.length };
  }

  /** Ping every connection's URL and record whether it is reachable. */
  async checkConnections(actor: Actor) {
    const { rows } = await this.db.query<Entity>(`select * from entity where type = any($1::text[]) and archived_at is null and is_open`, [
      this.registry.family('sys.connection'),
    ]);
    const out = [];
    for (const conn of rows) {
      const url = conn.props.url as string | undefined;
      if (!url) continue;
      // Any HTTP answer, even an error status, means something is listening.
      const reachable = await fetch(url, { signal: AbortSignal.timeout(2000) }).then(
        () => true,
        () => false,
      );
      const status = reachable ? 'available' : 'unavailable';
      if (status !== conn.status) {
        await this.db.query(`update entity set status = $2, updated_at = now() where id = $1`, [conn.id, status]);
        await this.log(this.db, { actor: actorId(actor), action: 'connection.check', target: conn.id, reason: 'Reachability changed', detail: { title: conn.title, from: conn.status, to: status } });
      }
      out.push({ id: conn.id, title: conn.title, url, status });
    }
    return out;
  }

  // ---- settings --------------------------------------------------------

  async setting<T>(key: string): Promise<T | undefined> {
    const { rows } = await this.db.query<{ value: T }>(`select value from setting where key = $1`, [key]);
    return rows[0]?.value;
  }

  /**
   * A setting that is a secret the server has to use (a key, a signing
   * secret): stored sealed, so the database and its backups do not hold it.
   * One stored before secrets were sealed is sealed the first time it is
   * read. One that cannot be opened here reads as not set.
   */
  async secret(key: string): Promise<string | undefined> {
    const stored = await this.setting<string>(key);
    if (typeof stored !== 'string' || !stored) return undefined;
    if (!isSealed(stored)) await this.setSecret(key, stored);
    return unseal(stored);
  }

  async setSecret(key: string, value: string | undefined): Promise<void> {
    if (!value) await this.db.query(`delete from setting where key = $1`, [key]);
    else await this.db.query(`insert into setting (key, value) values ($1, $2::jsonb) on conflict (key) do update set value = excluded.value`, [key, JSON.stringify(seal(value))]);
  }

  /** Create (or find) the person this workspace belongs to and make them the default for views. */
  async init(actor: Actor, input: { name: string; email?: string }) {
    if (actor.kind !== 'human') throw new Error('Only a human can set the workspace owner.');
    const found = await this.db.query<{ id: string }>(`select id from entity where type = 'person' and lower(title) = lower($1) and archived_at is null`, [input.name]);
    let id = found.rows[0]?.id;
    if (!id) id = (await this.apply(actorId(actor), { ops: [{ op: 'create', ref: 'me', type: 'person', title: input.name, props: input.email ? { email: input.email } : {} }], reason: 'Workspace owner' })).created.me;
    // Its first owner begins a workspace: what its agents change takes effect as they make it, until the owner says otherwise (owner, 21 Oct 2026).
    if ((await this.setting('me')) === undefined) await this.db.query(`insert into setting (key, value) values ($1, '"apply"'::jsonb) on conflict (key) do nothing`, [AGENT_CHANGES]);
    await this.db.query(`insert into setting (key, value) values ('me', $1::jsonb) on conflict (key) do update set value = excluded.value`, [JSON.stringify(id)]);
    return { me: id };
  }

  // ---- reads -----------------------------------------------------------

  async entity(id: string, q: Q = this.db): Promise<Entity | undefined> {
    const { rows } = await q.query<Entity>(`select * from entity where id = $1`, [id]);
    return rows[0];
  }

  async search(input: { q?: string; type?: string; status?: string; owner?: string; open?: boolean; include_archived?: boolean; limit?: number }) {
    if (input.type && !this.registry.type(input.type)) throw new Error(`Unknown type "${input.type}"`);
    // Text is matched as typed anywhere in the title, or as the same words in
    // any form in the title or notes. Only when that finds nothing are titles
    // with a word close to what was typed taken instead: a slip of the keys
    // should find something, but "hosting" should not also bring up "posting".
    const run = async (near: boolean) => {
      const where: string[] = [];
      const params: unknown[] = [];
      const add = (sql: string, value: unknown) => {
        params.push(value);
        where.push(sql.replaceAll('?', `$${params.length}`));
      };
      let rank = '';
      if (input.q) {
        const TEXT = `to_tsvector('english', title || ' ' || body)`;
        add(near ? `word_similarity(?, title) > 0.5` : `(title ilike '%' || ? || '%' or ${TEXT} @@ websearch_to_tsquery('english', ?))`, input.q);
        const q = `$${params.length}`;
        // Best first: the words in the title count for more than in the notes,
        // and a title that is mostly the words asked for beats a long one that mentions them.
        const WEIGHTED = `setweight(to_tsvector('english', title), 'A') || setweight(to_tsvector('english', body), 'D')`;
        rank = `(case when title ilike '%' || ${q} || '%' then 1 else 0 end) + similarity(${q}, title) + ts_rank(${WEIGHTED}, websearch_to_tsquery('english', ${q}), 1) desc, `;
      }
      if (input.type) add(`type = any(?::text[])`, this.registry.family(input.type));
      if (input.status) add(`status = ?`, input.status);
      if (input.owner) add(`owner = ?`, input.owner);
      if (input.open !== undefined) add(`is_open = ?`, input.open);
      if (!input.include_archived) where.push(`archived_at is null`);
      params.push(Math.min(input.limit ?? 25, 200));
      const { rows } = await this.db.query<Entity>(
        `select id, type, title, status, is_open, owner, confidence, props, updated_at from entity
         ${where.length ? 'where ' + where.join(' and ') : ''} order by ${rank}updated_at desc limit $${params.length}`,
        params,
      );
      return rows;
    };
    const rows = await run(false);
    return rows.length || !input.q ? rows : run(true);
  }

  async get(id: string) {
    const entity = await this.entity(id);
    if (!entity) throw new Error(`No item "${id}"`);
    const rel = `r.id as relation, r.type, r.props, r.confidence, e.id, e.type as entity_type, e.title, e.status`;
    const [out, inc, events, source] = await Promise.all([
      this.db.query(`select ${rel} from relation r join entity e on e.id = r.to_id where r.from_id = $1 and r.valid_to is null`, [id]),
      this.db.query(`select ${rel} from relation r join entity e on e.id = r.from_id where r.to_id = $1 and r.valid_to is null`, [id]),
      this.db.query(`select seq, ts, actor, action, changeset, reason, detail from event where target_id = $1 order by seq desc limit 8`, [id]),
      entity.source_id ? this.entity(entity.source_id) : undefined,
    ]);
    return {
      entity,
      source: source && { id: source.id, title: source.title, uri: source.props.uri },
      trail: await this.trail(id),
      mentioned_in: await this.mentionedIn(id),
      outgoing: out.rows,
      incoming: inc.rows,
      recent_events: events.rows,
    };
  }

  /**
   * Where an item sits: what it is part of, what that is part of, and so on, outermost first, each with the views
   * kept about it (lenses, not shortcuts), so a page can lead back up to a picture it was reached from. Led to two
   * things, it goes up the nearer: the one that is itself part of something. Only what the asker may see.
   */
  async trail(id: string) {
    const trail: { id: string; type: string; title: string; views: { id: string; title: string }[] }[] = [];
    const seen = new Set([id]);
    for (let at = id; trail.length < 8; ) {
      const { rows } = await this.db.query<{ id: string; type: string; title: string }>(
        `select e.id, e.type, e.title from relation r join entity e on e.id = r.to_id
         where r.from_id = $1 and r.type = 'part_of' and r.valid_to is null and e.archived_at is null
         order by exists (select 1 from relation u where u.from_id = e.id and u.type = 'part_of' and u.valid_to is null) desc, e.title`,
        [at],
      );
      const next = rows.find((r) => !seen.has(r.id));
      if (!next) break;
      seen.add(next.id);
      trail.unshift({ ...next, views: [] });
      at = next.id;
    }
    if (!trail.length) return trail;
    const { rows } = await this.db.query<{ id: string; title: string; about: string }>(
      `select v.id, v.title, a.to_id as about from entity v join relation a on a.from_id = v.id and a.type = 'about' and a.valid_to is null
       where v.type = any($1::text[]) and v.archived_at is null and v.is_open and a.to_id = any($2::text[]) and v.props ->> 'from' is null
       order by (v.props ->> 'place')::numeric nulls last, v.title`,
      [this.registry.family('lens'), trail.map((t) => t.id)],
    );
    for (const v of rows) trail.find((t) => t.id === v.about)?.views.push({ id: v.id, title: v.title });
    return trail;
  }

  /**
   * What names an item in its text or its fields (a note that points at it, a document that brings it in, a
   * decision whose reasons cite it): the way back for a link written as an id, which no relation records.
   * Documents first, then the newest. The system's own records are left out. Only what the asker may see.
   */
  async mentionedIn(id: string) {
    const { rows } = await this.db.query<{ id: string; type: string; title: string; status: string }>(
      `select id, type, title, status from entity
       where id <> $1 and archived_at is null and type not like 'sys.%' and position($1 in body || ' ' || props::text) > 0
       order by type = any($2::text[]) desc, updated_at desc limit 30`,
      [id, this.registry.drawnWith('document')],
    );
    return rows;
  }

  async events(input: EventQuery) {
    return readEvents(this.db, input);
  }

  /** A stamp that moves whenever the map or the review queue does, as this viewer sees them. */
  async pulse() {
    const { rows } = await this.db.query<{ stamp: string }>(
      `select concat_ws('.', (select coalesce(max(seq), 0) from event), (select count(*) from proposal), (select count(*) from proposal where status = 'pending')) as stamp`,
    );
    return rows[0];
  }

  async proposals(input: { status?: string } = {}) {
    const { rows } = await this.db.query<Proposal>(`select * from proposal where status = $1 order by ts`, [input.status ?? 'pending']);
    return rows;
  }
}

/**
 * The restore path (src/operational.ts): a backup's items and links merged into the map as they were, never applied
 * again as changes, since their events come with them. An item on both sides keeps whichever was edited later; a link
 * ended on either side is ended. Answers, for each link written, whether it was new.
 */
export async function restoreRows(tx: Q, entities: string, relations: string): Promise<{ added: boolean }[]> {
  const { rows: cols } = await tx.query<{ set: string }>(`select string_agg(format('%I = excluded.%I', column_name, column_name), ', ') as set from information_schema.columns where table_schema = 'public' and table_name = 'entity' and column_name <> 'id'`);
  // One statement: rows that point at each other (an entity's owner) are checked together.
  await tx.query(`insert into entity select * from jsonb_populate_recordset(null::entity, $1::jsonb) on conflict (id) do update set ${cols[0].set} where excluded.updated_at > entity.updated_at`, [entities]);
  const { rows } = await tx.query<{ added: boolean }>(
    `insert into relation select i.* from jsonb_populate_recordset(null::relation, $1::jsonb) i
     where exists (select 1 from entity where id = i.from_id) and exists (select 1 from entity where id = i.to_id)
     on conflict (id) do update set valid_to = excluded.valid_to where relation.valid_to is null and excluded.valid_to is not null
     returning (xmax = 0) as added`,
    [relations],
  );
  return rows;
}
