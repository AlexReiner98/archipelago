// The map and its single write path. Every change to entities and relations
// goes through change(): it is validated, checked against policy, then either
// applied or stored as a proposal for a human, and always logged.

import { existsSync, readFileSync } from 'node:fs';
import { checkAutomation } from './automation-rules.ts';
import { newId, scoped, type Db, type Q } from './db.ts';
import type { Registry, TypeDef } from './packs.ts';
import { isSealed, seal, unseal } from './secrets.ts';

export interface Actor {
  kind: 'human' | 'agent';
  name: string;
  /** The person this identity is, or acts for. */
  person?: string;
  /** May manage the workspace's members, tokens and settings. */
  admin?: boolean;
  /** Id of the token in use, when there is one. */
  token?: string;
}

export type Level = 'auto' | 'propose' | 'forbidden';
export type OpKind = 'create' | 'update' | 'link' | 'unlink' | 'archive' | 'restore' | 'merge' | 'define_type';
export type Policy = Record<OpKind, Level>;

/** Agents propose everything until trust is built; loosen per op in lattice.config.json. */
export const DEFAULT_AGENT_POLICY: Policy = {
  create: 'propose',
  update: 'propose',
  link: 'propose',
  unlink: 'propose',
  archive: 'propose',
  restore: 'propose',
  merge: 'propose',
  define_type: 'propose',
};

/** The setting that holds a workspace's own choice between applying agents' changes and holding them. */
const AGENT_CHANGES = 'agent_changes';

type Props = Record<string, unknown>;

export interface CreateOp {
  op: 'create';
  ref?: string;
  type: string;
  title: string;
  body?: string;
  status?: string;
  owner?: string;
  visibility?: 'private' | 'shared';
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
  visibility?: 'private' | 'shared';
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
}

export interface Entity {
  id: string;
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
}

export const actorId = (actor: Actor) => `${actor.kind}:${actor.name}`;

/** Relations that make one thing wait on another. */
export const BLOCKING_RELATIONS = ['depends_on', 'needs'];

/** Active holds on resources, including ones whose holder the caller may not see. */
export const ACTIVE_HOLDS = `lattice_active_holds(current_user = 'lattice_member', current_setting('lattice.viewer', true))`;

export class Lattice {
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

  constructor(db: Db, registry: Registry, policy: Partial<Policy> = {}, workspace = 'default', viewer?: string) {
    this.db = db;
    this.registry = registry;
    this.policy = { ...DEFAULT_AGENT_POLICY, ...policy };
    this.workspace = workspace;
    this.viewer = viewer;
  }

  /** This map as one person sees it. An empty viewer sees only what is shared. */
  as(viewer: string): Lattice {
    return new Lattice(scoped(this.db, viewer), this.registry, this.policy, this.workspace, viewer);
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
    const chosen = await this.setting<string>(AGENT_CHANGES);
    if (chosen === 'apply' || chosen === 'hold') return chosen;
    return Object.values(this.policy).every((level) => level === 'auto') ? 'apply' : 'hold';
  }

  /** Who a new private thing is private to: the viewer, when there is one. */
  private privateTo(visibility: 'private' | 'shared'): string | null {
    return visibility === 'private' && this.viewer ? this.viewer : null;
  }

  // ---- writes ----------------------------------------------------------

  async change(actor: Actor, input: ChangeInput) {
    if (!input.reason?.trim()) throw new Error('Every change needs a reason.');
    const { warnings } = await this.plan(input.ops);
    const me = actorId(actor);
    const claimed = input.authority;
    if (actor.kind !== 'human' && claimed?.of === 'human' && !claimed.basis?.trim())
      throw new Error('Change rejected:\n- authority: to act on a human\u2019s word, say what they said and where (authority.basis).');
    const authority: Authority =
      actor.kind === 'human' ? { of: 'human', who: me } : claimed?.of === 'human' ? { of: 'human', basis: claimed.basis, stated_by: me } : { of: 'agent', who: me, ...(claimed?.basis && { basis: claimed.basis }) };
    // The workspace's own choice, when it has made one, stands in for the
    // server's policy on everything the policy does not forbid outright.
    const chosen = actor.kind === 'human' ? undefined : await this.setting<string>(AGENT_CHANGES);
    const levels = input.ops.map((op): Level => {
      if (actor.kind === 'human') return 'auto';
      const level = this.policy[op.op];
      if (level === 'forbidden') return level;
      // An agent may always ask for a look before its change takes effect.
      if (input.hold) return 'propose';
      return chosen === 'apply' ? 'auto' : chosen === 'hold' ? 'propose' : level;
    });
    const forbidden = input.ops.filter((_, i) => levels[i] === 'forbidden').map((op) => op.op);
    if (forbidden.length) throw new Error(`Policy forbids agents from: ${[...new Set(forbidden)].join(', ')}`);
    // Settling a question is the human's, whatever the server's policy lets
    // agents do unreviewed: an agent that sees one settled proposes the answer,
    // and the human confirms it. Only a workspace that has itself chosen to
    // have agents' changes applied lets an agent settle one, and then the
    // record has to stand on its own: a decision says what was chosen and why,
    // and the human is told (see `answered`).
    const answered: { id: string; title: string; status: string; outcome?: string; authority: Authority }[] = [];
    if (actor.kind !== 'human') {
      const decisions = new Set(this.registry.family('decision'));
      const questions = new Set([...decisions, ...this.registry.family('hypothesis')]);
      for (const [i, op] of input.ops.entries()) {
        if (op.op !== 'update' || !op.status || levels[i] !== 'auto') continue;
        const e = await this.entity(op.id);
        if (!e || !questions.has(e.type) || !e.is_open || !this.registry.type(e.type)?.statuses.closed.includes(op.status)) continue;
        if (chosen !== 'apply') {
          levels[i] = 'propose';
          continue;
        }
        const props = { ...e.props, ...op.props };
        if (decisions.has(e.type) && !(props.outcome && props.rationale))
          throw new Error(`Change rejected:\n- "${e.title}": to settle a decision, say what was chosen (props.outcome) and why (props.rationale).`);
        if (!claimed) throw new Error(`Change rejected:\n- "${e.title}": to settle a question, say on whose authority (authority.of: "human" with where they said so, or "agent" for your own judgment).`);
        answered.push({ id: e.id, title: e.title, status: op.status, outcome: props.outcome as string | undefined, authority });
      }
    }

    if (levels.includes('propose')) {
      const id = newId('p');
      await this.db.query(
        `insert into proposal (id, actor, reason, source, ops, warnings, private_to) values ($1, $2, $3, $4::jsonb, $5::jsonb, $6::jsonb, $7)`,
        [id, actorId(actor), input.reason, JSON.stringify(input.source ?? null), JSON.stringify(input.ops), JSON.stringify(warnings), this.viewer || null],
      );
      await this.log(this.db, { actor: actorId(actor), action: 'proposal.create', reason: input.reason, detail: { proposal: id, ops: input.ops.length } });
      return {
        status: 'proposed' as const,
        proposal: id,
        warnings,
        note: 'Nothing has changed yet. A human must approve this proposal before it appears in the map.',
      };
    }
    const applied = await this.apply(me, input, { authority });
    return answered.length ? { ...applied, answered } : applied;
  }

  /** `ops`, when given, replaces the proposed ops: the reviewer's corrected version. */
  async decide(actor: Actor, input: { proposal: string; approve: boolean; except?: string[]; note?: string; ops?: Op[] }) {
    if (actor.kind !== 'human') throw new Error('Only a human can approve or reject proposals.');
    const { rows } = await this.db.query<Proposal>(`select * from proposal where id = $1`, [input.proposal]);
    const proposal = rows[0];
    if (!proposal) throw new Error(`No proposal "${input.proposal}"`);
    if (proposal.status !== 'pending') throw new Error(`Proposal ${proposal.id} is already ${proposal.status}`);

    let result: Awaited<ReturnType<Lattice['apply']>> | undefined;
    if (input.approve) {
      result = await this.apply(
        proposal.actor,
        { ops: input.ops ?? proposal.ops, reason: proposal.reason, source: proposal.source ?? undefined },
        // Held and then applied by a human: it rests on that human, whatever the agent thought it rested on.
        { except: input.except, approvedBy: actorId(actor), revised: Boolean(input.ops), authority: { of: 'human', who: actorId(actor) } },
      );
      if (input.ops) await this.db.query(`update proposal set ops = $2::jsonb where id = $1`, [proposal.id, JSON.stringify(input.ops)]);
    }
    const status = input.approve ? 'approved' : 'rejected';
    await this.db.query(`update proposal set status = $2, decided_by = $3, decided_at = now(), note = $4 where id = $1`, [
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
    const errors: string[] = [];
    const warnings: string[] = [];
    const refs = new Map<string, string>(); // ref -> type
    const seen = new Set<string>();
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
          if (reg.isA(op.type, 'sys.automation')) errors.push(...checkAutomation(op.props ?? {}).map((p) => `${where}: ${p}`));
          if (op.ref) {
            if (refs.has(op.ref)) errors.push(`${where}: ref "${op.ref}" is used twice`);
            refs.set(op.ref, op.type);
          }
          const root = type.lineage.at(-1)!;
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
          errors.push(...reg.check(target.type, op.status, op.props ?? {}).map((p) => `${where}: ${p}`));
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
          if (op.keep === op.drop) errors.push(`${where}: keep and drop are the same entity`);
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
      if (op.op === 'link' && BLOCKING_RELATIONS.includes(op.type)) {
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
          [op.id, BLOCKING_RELATIONS],
        );
        const { rows: all } = await this.db.query<{ n: number }>(`select lattice_external_dependents($1, $2) as n`, [op.id, this.viewer]);
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
          [op.id, BLOCKING_RELATIONS],
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
    const ops = dropExcepted(input.ops, opts.except ?? []);
    if (!ops.length) throw new Error('Nothing left to apply after exclusions.');
    // Validate again: the map may have changed since this was proposed.
    const { warnings } = await this.plan(ops);
    const changeset = newId('c');
    const created: Record<string, string> = {};
    const extra = { ...(opts.approvedBy && { approved_by: opts.approvedBy, ...(opts.revised && { revised_by: opts.approvedBy }) }), ...(opts.authority && { authority: opts.authority }) };
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
              `insert into entity (id, type, title, body, status, is_open, owner, visibility, confidence, props, source_id, private_to)
               values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb, $11, $12)`,
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
                await sourceOf(op),
                this.privateTo(op.visibility ?? fallback),
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
                this.privateTo(next.visibility as 'private' | 'shared'),
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
            const drop = (await this.entity(op.drop, tx))!;
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
            await tx.query(`update entity set archived_at = now(), updated_at = now() where id = $1`, [op.drop]);
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
      this.registry.defineLocal(op.type);
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
      const done = await this.db.query(`update proposal set status = 'superseded', decided_by = 'agent:lattice', decided_at = now(), note = $2 where id = $1 and status = 'pending' returning id`, [p.id, `Already so since ${changeset}`]);
      if (done.rows.length) await this.log(this.db, { actor: 'agent:lattice', action: 'proposal.supersede', reason: p.reason, detail: { proposal: p.id, proposed_by: p.actor, by: changeset } });
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

  async log(
    q: Q,
    e: { actor: string; action: string; target?: string; changeset?: string; reason?: string; detail?: Props; origin?: string; ts?: string },
  ): Promise<void> {
    await q.query(
      `insert into event (actor, action, target_id, changeset, reason, detail, origin, ts, private_to)
       values ($1, $2, $3, $4, $5, $6::jsonb, $7, coalesce($8::timestamptz, now()), $9)`,
      // An event about an entity is as visible as that entity. One with no
      // target (a proposal, an undo) is private to whoever caused it.
      [e.actor, e.action, e.target ?? null, e.changeset ?? null, e.reason ?? '', JSON.stringify(e.detail ?? {}), e.origin ?? 'lattice', e.ts ?? null, e.target ? null : this.viewer || null],
    );
  }

  // ---- resources and connections ----------------------------------------
  // These take effect at once for agents too: coordination that waits for
  // approval is no coordination.

  async claim(actor: Actor, input: { resource: string; holder: string; for?: string; reason: string }) {
    return this.db.transaction(async (tx) => {
      const resource = await this.entity(input.resource, tx);
      if (!resource || !this.registry.isA(resource.type, 'resource')) throw new Error(`"${input.resource}" is not a resource`);
      const holder = await this.entity(input.holder, tx);
      if (!holder) throw new Error(`No entity "${input.holder}" to hold it`);
      if (input.for && !(await this.entity(input.for, tx))) throw new Error(`No entity "${input.for}"`);
      if (resource.status !== 'available') throw new Error(`"${resource.title}" is ${resource.status}`);

      const { rows: held } = await tx.query<{ id: string; from_id: string; valid_from: Date; title: string }>(
        `select h.id, h.from_id, h.valid_from, h.holder_title as title from ${ACTIVE_HOLDS} h where h.to_id = $1`,
        [resource.id],
      );
      const mine = held.find((h) => h.from_id === holder.id);
      if (mine) return { status: 'already_held' as const, relation: mine.id };
      if (resource.props.exclusive !== false && held.length) {
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
    for (const row of rows) {
      await this.log(this.db, { actor: actorId(actor), action: 'resource.release', target: input.resource, reason: input.reason, detail: { holder: row.from_id } });
    }
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

  /**
   * Copy new entries from a connection's JSON-lines tool-call log into the
   * event log. Expects lines shaped {ts, tool, params, durationMs, ok, error}.
   */
  async importAudit(actor: Actor, input: { connection: string }) {
    const conn = await this.entity(input.connection);
    if (!conn || !this.registry.isA(conn.type, 'sys.connection')) throw new Error(`"${input.connection}" is not a connection`);
    const path = conn.props.audit_log as string | undefined;
    if (!path) throw new Error(`"${conn.title}" has no audit_log path`);
    if (!existsSync(path)) return { imported: 0, path, note: 'Log file does not exist yet.' };

    const cursorKey = `audit_cursor:${conn.id}`;
    const cursor = (await this.setting<string>(cursorKey)) ?? '';
    let latest = cursor;
    let imported = 0;
    let skipped = 0;
    await this.db.transaction(async (tx) => {
      for (const line of readFileSync(path, 'utf8').split('\n')) {
        if (!line.trim()) continue;
        let entry: { ts?: string; tool?: string; params?: unknown; durationMs?: number; ok?: boolean; error?: unknown };
        try {
          entry = JSON.parse(line);
        } catch {
          skipped++;
          continue;
        }
        if (!entry.ts || !entry.tool || Number.isNaN(Date.parse(entry.ts))) {
          skipped++;
          continue;
        }
        if (entry.ts <= cursor) continue;
        await this.log(tx, {
          actor: `external:${conn.title}`,
          action: entry.tool,
          target: conn.id,
          origin: 'external',
          ts: entry.ts,
          detail: { params: entry.params, durationMs: entry.durationMs, ok: entry.ok, error: entry.error },
        });
        if (entry.ts > latest) latest = entry.ts;
        imported++;
      }
      await tx.query(`insert into setting (key, value) values ($1, $2::jsonb) on conflict (key) do update set value = excluded.value`, [
        cursorKey,
        JSON.stringify(latest),
      ]);
    });
    if (imported) await this.log(this.db, { actor: actorId(actor), action: 'audit.import', target: conn.id, detail: { imported, path } });
    return { imported, skipped, path };
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
    if (!id) {
      const result = await this.apply(actorId(actor), {
        ops: [{ op: 'create', ref: 'me', type: 'person', title: input.name, props: input.email ? { email: input.email } : {} }],
        reason: 'Workspace owner',
      });
      id = result.created.me;
    }
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
    if (!entity) throw new Error(`No entity "${id}"`);
    const rel = `r.id as relation, r.type, r.props, r.confidence, e.id, e.type as entity_type, e.title, e.status`;
    const [out, inc, events, source] = await Promise.all([
      this.db.query(`select ${rel} from relation r join entity e on e.id = r.to_id where r.from_id = $1 and r.valid_to is null`, [id]),
      this.db.query(`select ${rel} from relation r join entity e on e.id = r.from_id where r.to_id = $1 and r.valid_to is null`, [id]),
      this.db.query(`select seq, ts, actor, action, reason, detail from event where target_id = $1 order by seq desc limit 15`, [id]),
      entity.source_id ? this.entity(entity.source_id) : undefined,
    ]);
    return {
      entity,
      source: source && { id: source.id, title: source.title, uri: source.props.uri },
      outgoing: out.rows,
      incoming: inc.rows,
      recent_events: events.rows,
    };
  }

  async events(input: { since?: string; target?: string; actor?: string; origin?: string; limit?: number }) {
    const where: string[] = [];
    const params: unknown[] = [];
    const add = (sql: string, value: unknown) => {
      params.push(value);
      where.push(sql.replace('?', `$${params.length}`));
    };
    if (input.since) add(`ev.ts >= ?::timestamptz`, input.since);
    if (input.target) add(`ev.target_id = ?`, input.target);
    if (input.actor) add(`ev.actor = ?`, input.actor);
    if (input.origin) add(`ev.origin = ?`, input.origin);
    params.push(Math.min(input.limit ?? 50, 500));
    const { rows } = await this.db.query(
      `select ev.seq, ev.ts, ev.origin, ev.actor, ev.action, ev.target_id, e.title as target_title, e.type as target_type, ev.changeset, ev.reason, ev.detail
       from event ev left join entity e on e.id = ev.target_id
       ${where.length ? 'where ' + where.join(' and ') : ''} order by ev.seq desc limit $${params.length}`,
      params,
    );
    return rows;
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
 * The note an update leaves: a whole new one (`body`), or the one that is
 * there with one passage replaced and a paragraph added, so a long note is
 * changed without being sent again. Throws saying what is wrong with the op.
 */
function bodyAfter(before: string, op: UpdateOp): string {
  if (op.body !== undefined && (op.append !== undefined || op.replace)) throw new Error('send body (the whole note) or append and replace (parts of it), not both');
  let body = op.body ?? before;
  if (op.replace) {
    const { find } = op.replace;
    if (!find) throw new Error('replace.find cannot be empty');
    const found = body.split(find).length - 1;
    if (found !== 1) throw new Error(`replace.find must be in the note exactly once, and is there ${found === 0 ? 'not at all' : `${found} times`}: ${JSON.stringify(find.length > 80 ? `${find.slice(0, 80)}…` : find)}. Copy it from the note as it is now (get), with more around it if it repeats.`);
    body = body.replace(find, () => op.replace!.with);
  }
  if (op.append?.trim()) body = [body.trimEnd(), op.append.trim()].filter(Boolean).join('\n\n');
  return body;
}

/**
 * Remove the ops a reviewer excluded. An exclusion is a create's ref or "#n"
 * for the nth op. Ops that depend on an excluded create go with it.
 */
function dropExcepted(ops: Op[], except: string[]): Op[] {
  if (!except.length) return ops;
  const skip = new Set(except);
  const gone = new Set<string>();
  const dropped = new Set<number>();
  for (let changed = true; changed; ) {
    changed = false;
    for (const [i, op] of ops.entries()) {
      if (dropped.has(i)) continue;
      const excluded =
        skip.has(`#${i + 1}`) ||
        (op.op === 'create' && ((op.ref !== undefined && skip.has(op.ref)) || (op.owner !== undefined && gone.has(op.owner)))) ||
        (op.op === 'link' && (gone.has(op.from) || gone.has(op.to)));
      if (!excluded) continue;
      dropped.add(i);
      if (op.op === 'create' && op.ref) gone.add(op.ref);
      changed = true;
    }
  }
  return ops.filter((_, i) => !dropped.has(i));
}
