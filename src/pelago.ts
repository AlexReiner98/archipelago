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
import { KEPT_FIELDS } from './operational.ts'; import { operationalFacts, record, type OpFact, type OpStream } from './streams.ts';
import { search, type SearchInput } from './search.ts';
import { append, headOf, type Decision, type Fact } from './log.ts'; import { FORGET_ROWS, projectDecision, projectFacts, stamp } from './replay.ts'; import { changedFacts, itemFacts, linkFacts } from './facts.ts';
import { privateDependencies } from './private-deps.ts'; import { decideProposal, supersede } from './proposals.ts'; import { asOwner, forgetIn, type ForgetOp } from './forget.ts';

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

export interface ChangeInput {
  ops: Op[];
  reason: string;
  source?: SourceSpec;
  /** From an agent: whether this is a human's word or its own judgment. A human's own change is theirs. */
  authority?: Pick<Authority, 'of' | 'basis'>;
  /** From an agent: have this change wait for a human even where agents' changes are applied as made. */
  hold?: boolean;
  /** The pack action that made it, named on every event it logs ("time.log made this"). */
  action?: string; /** The pack whose action or handler made it: what it writes is kept to the pack's reach (core's pack_reach). */ pack?: string;
  /** The change set this one reverses: undo's own. */
  undoes?: string;
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

export { BLOCKING_RELATIONS } from './private-deps.ts';

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
    const who = { human: actor.kind === 'human', reading: measured, may: actor.may, asked: input.hold, said: Boolean(claimed), pack: input.pack };
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

    const by = { id: me, ...(actor.token && { token: actor.token }) };
    if (verdict.outcome === 'hold') {
      const id = newId('p');
      // What it would do on the map as it is now, with the ids it would make: approved with nothing moved, it appends these facts.
      const { facts = [], ids = {} } = await this.apply(me, input, { authority, dry: true });
      const base = (await headOf(this.db)).pos, rule = verdict.by && { rule: verdict.by.rule, pack: verdict.by.pack, say: verdict.by.say };
      // The queue is a projection of the pending stream: the record makes its row (src/replay.ts).
      await this.db.transaction(async (tx) =>
        projectDecision(tx, await append(tx, this.workspace, 'pending', { id, actor: by, authority, held_by: rule ?? null, reason: input.reason, source: input.source ?? null, action: input.action ?? null, undoes: input.undoes ?? null, base, ops: input.ops, warnings, ids, private_to: this.viewer || null }, facts)),
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
    const spared = [...new Map(verdict.spared.flat().map((r) => [`${r.pack}.${r.rule}`, { rule: r.rule, pack: r.pack }])).values()];
    const applied = await this.apply(me, input, { authority, token: actor.token, rule: { outcome: 'apply', spared } });
    return answered.length ? { ...applied, answered } : applied;
  }

  /** `ops`, when given, replaces the proposed ops: the reviewer's corrected version. One at a time: a second click while one applies is refused, not applied again. */
  decide(actor: Actor, input: Parameters<typeof decideProposal>[2]) { return once(input.proposal, () => decideProposal(this, actor, input)); }

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
        case 'archive': case 'forget':
          await existing(op.id, where);
          if (op.op === 'forget' && (ops.length > 1 || op.reasons?.some((c) => !/^[cp]_\w+$/.test(c)))) errors.push(`${where}: a forget is a change of its own, and its reasons name change sets (c_…) or held changes (p_…)`);
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
    if (!errors.length) errors.push(...(await privateDependencies(this, ops)));
    if (errors.length) throw new Error(`Change rejected:\n- ${errors.join('\n- ')}`);
    return { warnings };
  }

  /**
   * Apply a change without consulting policy. For human changes, approved proposals, and the system's own bookkeeping
   * (sessions). Each op is planned into facts and projected at once (src/replay.ts), so the next reads what it did; the
   * facts are appended to the fact stream as one change set in the same transaction. dry: the facts it would append and
   * the ids it would make, with nothing written; ids: those ids, to make the same ones again.
   */
  async apply(actor: string, input: ChangeInput, opts: { except?: string[]; approvedBy?: string; revised?: boolean; authority?: Authority; token?: string; rule?: Decision; dry?: boolean; ids?: Record<string, string> } = {}) {
    const ops = dropExcepted(input.ops, opts.except ?? []); await stillWritable(this.workspace);
    if (!ops.length) throw new Error('Nothing left to apply after exclusions.');
    // Validate again: the map may have changed since this was proposed.
    const { warnings } = await this.plan(ops);
    const changeset = newId('c');
    const created: Record<string, string> = {};
    const reg = this.registry;
    // Each id it makes is named by what makes it, so that a held change approved with nothing moved makes the same ones.
    const ids: Record<string, string> = {};
    const mint = (key: string, prefix: string) => (ids[key] = opts.ids?.[key] ?? newId(prefix));
    const at = new Map(input.ops.map((op, i) => [op, i + 1]));
    const facts: Fact[] = [];
    const DRY = Symbol('dry');

    await this.db.transaction(async (tx) => {
      // Facts first: each op is planned on the map as the ops before it left it, and its facts projected at once.
      const when = await stamp(tx);
      const said = async (some: Fact[]) => { facts.push(...some); await projectFacts(tx, reg, when, some); };
      const fallback = await this.defaultVisibility(tx);
      const source = (spec: SourceSpec) => this.ensureSource(tx, spec, said, mint);
      const defaultSource = input.source ? await source(input.source) : null;
      const sourceOf = async (op: { source?: SourceSpec }) => (op.source ? source(op.source) : defaultSource);
      const resolve = (key: string) => created[key] ?? key;
      // What this change makes has its id from the start, so a title or note in the same change can name it:
      // {ref} becomes the id of the item made under that ref. Braces around anything else are left alone.
      for (const [i, op] of ops.entries()) if (op.op === 'create') created[op.ref ?? `#${i + 1}`] = mint(`#${at.get(op)}`, 'e');
      const refs = new Set(ops.flatMap((op) => (op.op === 'create' && op.ref ? [op.ref] : [])));
      const named = <T extends string | undefined>(text: T): T => (text === undefined ? text : (text.replace(/\{([^{}\s]+)\}/g, (whole, ref: string) => (refs.has(ref) ? created[ref] : whole)) as T));

      for (const [i, op] of ops.entries()) {
        switch (op.op) {
          case 'create': {
            const type = reg.type(op.type)!;
            const id = created[op.ref ?? `#${i + 1}`];
            const visibility = op.visibility ?? fallback;
            await said(itemFacts({
              id, type: op.type, title: named(op.title.trim()), body: named(op.body) ?? '', status: op.status ?? type.statuses.open[0],
              visibility, private_to: this.privateTo(visibility), owner: op.owner ? resolve(op.owner) : null, confidence: op.confidence ?? 1,
              source_id: type.columns && !type.columns.source ? null : await sourceOf(op), props: { ...reg.defaults(op.type), ...op.props },
            }));
            await this.kept(tx, id, op.props);
            break;
          }
          case 'update': {
            const before = (await this.entity(op.id, tx))!;
            const props = { ...before.props };
            for (const [key, value] of Object.entries(op.props ?? {})) {
              if (value === null) delete props[key];
              else props[key] = value;
            }
            const visibility = op.visibility ?? before.visibility;
            await said(changedFacts(before, {
              ...before, props, visibility,
              title: named(op.title)?.trim() ?? before.title,
              body: bodyAfter(before.body, { ...op, body: named(op.body), append: named(op.append), replace: op.replace && { find: op.replace.find, with: named(op.replace.with) } }),
              status: op.status ?? before.status,
              owner: op.owner === undefined ? before.owner : op.owner,
              confidence: op.confidence ?? before.confidence,
              // Only an explicit change of visibility moves who it is private to.
              private_to: op.visibility !== undefined && op.visibility !== before.visibility ? this.privateTo(visibility) : before.private_to,
            }));
            await this.kept(tx, op.id, op.props);
            break;
          }
          case 'link': {
            const from = resolve(op.from);
            const to = resolve(op.to);
            const same = await tx.query(`select 1 from relation where type = $1 and from_id = $2 and to_id = $3 and valid_to is null`, [op.type, from, to]);
            if (same.rows.length) break; // already linked
            await said(linkFacts({ id: mint(`#${at.get(op)}`, 'r'), type: op.type, from_id: from, to_id: to, props: op.props ?? {}, confidence: op.confidence ?? 1, source_id: await sourceOf(op) }));
            break;
          }
          case 'unlink':
            await said([['-', op.relation, 'link']]);
            break;
          case 'archive':
            await said([['+', op.id, 'archived', true]]);
            break;
          case 'restore':
            await said([['-', op.id, 'archived']]);
            break;
          case 'merge': {
            const keep = (await this.entity(op.keep, tx))!;
            const drop = (await this.entity(op.drop, tx))!; // archived first, and only once: the log's lock puts a merge that races another after it, refused
            if (drop.archived_at) throw new Error(`Change rejected:\n- "${drop.title}" is already merged or archived`);
            await said([['+', drop.id, 'archived', true], ['+', drop.id, 'merged_into', keep.id]]);
            // Each live link of the dropped item moves to the kept one, unless it would join the item to itself or repeat
            // one the kept item has: where both said the same thing (each was part of the same project), the older stays,
            // and of two made together, the kept item's.
            const { rows: links } = await tx.query<{ id: string; type: string; from_id: string; to_id: string }>(
              `select id, type, from_id, to_id from relation where valid_to is null and (from_id = any($1::text[]) or to_id = any($1::text[])) order by valid_from, $2 in (from_id, to_id), id`,
              [[keep.id, drop.id], drop.id],
            );
            const seen = new Set<string>();
            const moves: Fact[] = [];
            for (const r of links) {
              const [from, to] = [r.from_id, r.to_id].map((end) => (end === drop.id ? keep.id : end));
              const what = `${r.type} ${from} ${to}`;
              if (from === to || seen.has(what)) moves.push(['-', r.id, 'link']);
              else if (seen.add(what) && (from !== r.from_id || to !== r.to_id)) moves.push(['+', r.id, 'link', [r.type, from, to]]);
            }
            const { rows: owned } = await tx.query<{ id: string }>(`select id from entity where owner = $1`, [op.drop]);
            await said([...moves, ...owned.map((o): Fact => ['+', o.id, 'owner', op.keep])]);
            const now = (await this.entity(op.keep, tx))!;
            await said(changedFacts(now, { ...now, props: { ...drop.props, ...keep.props }, body: [keep.body, drop.body].filter(Boolean).join('\n\n') }));
            break;
          }
          case 'forget': // for good: its key, its words in the log and beside it, then its rows, whoever could see them
            await forgetIn(tx, op); await said([['+', op.id, 'forgotten', true]]); await asOwner(tx, FORGET_ROWS, [op.id]);
            break;
          case 'define_type':
            await said([['+', op.type.id, 'type_def', op.type]]);
            break; // registered after the transaction
        }
      }
      if (opts.dry) throw DRY;
      const rule: Decision = opts.rule ?? { outcome: 'apply', spared: [] };
      const by = { id: actor, ...(opts.token && { token: opts.token }) };
      const done = await append(tx, this.workspace, 'facts', { id: changeset, actor: by, authority: opts.authority ?? null, rule, reason: input.reason, source: defaultSource, action: input.action ?? null, undoes: input.undoes ?? null, keys: [], ...(input.pack && { pack: { id: input.pack, manifest: this.registry.hashes.get(input.pack) ?? null, action: input.action ?? null } }) }, facts);
      if (done.at !== when) throw new Error(`The log's time moved under its lock (${when}, then ${done.at})`);
      await projectDecision(tx, done);
    }).catch((err) => { if (err !== DRY) throw err; });
    if (opts.dry) return { status: 'dry' as const, changeset, created, warnings, facts, ids };

    for (const op of ops) if (op.op === 'define_type') await this.registry.defineLocal(op.type);
    await supersede(this, changeset);
    return { status: 'applied' as const, changeset, created, warnings };
  }

  /** What an op sets of an item's operational state (src/operational.ts) is not a fact: it is written beside them, never logged. */
  private async kept(tx: Q, id: string, props: Props = {}) {
    const ours = Object.entries(props).filter(([k]) => KEPT_FIELDS.includes(k));
    if (!ours.length) return;
    const set = Object.fromEntries(ours.filter(([, v]) => v !== null && v !== undefined));
    await tx.query(`update entity set props = (props || $2::jsonb) - $3::text[] where id = $1`, [id, JSON.stringify(set), ours.filter(([k]) => !(k in set)).map(([k]) => k)]);
  }

  private async ensureSource(q: Q, spec: SourceSpec, said: (facts: Fact[]) => Promise<void>, mint: (key: string, prefix: string) => string): Promise<string | null> {
    const type = this.registry.type('sys.source');
    if (!type) return null;
    const found = await q.query<{ id: string }>(`select id from entity where type = 'sys.source' and props->>'uri' = $1 and archived_at is null -- index entity_source_uri`, [spec.uri]);
    if (found.rows.length) return found.rows[0].id;
    const id = mint(`source ${spec.uri}`, 'e');
    const props: Props = { uri: spec.uri };
    if (spec.kind) props.kind = spec.kind;
    const problems = this.registry.check('sys.source', undefined, props);
    if (problems.length) throw new Error(`Change rejected:\n- source: ${problems.join('\n- source: ')}`);
    const visibility = await this.defaultVisibility(q);
    // The source's own facts, before the facts that name it.
    await said(itemFacts({ id, type: type.id, title: spec.title ?? spec.uri, body: spec.excerpt ?? '', status: 'recorded', visibility, private_to: this.privateTo(visibility), props }));
    return id;
  }

  /** A change set the system appends in a migration (a pack moves a type or a kind, places move to their stream): what moved, and nothing else. */
  async moved(tx: Q, action: string, reason: string, facts: Fact[]) {
    await projectFacts(tx, this.registry, await stamp(tx), facts, true);
    await append(tx, this.workspace, 'facts', { id: newId('c'), actor: { id: 'system' }, authority: null, rule: { outcome: 'apply', spared: [] }, reason, source: null, action, undoes: null, keys: [] }, facts);
  }

  /** Each item's kind in its row, from the type table, where the row lacks it or has another (src/head.ts): when a workspace opens. */
  fillKinds = async () => (await this.db.query(`update entity e set kind = t.def->>'kind' from type_def t where t.id = e.type and e.kind is distinct from t.def->>'kind' returning e.id`)).rows.length;

  /**
   * Move every item of a type (or link of a relation) no pack defines any more to the one that took it over
   * (moved_from): a one-time migration as a pack takes it out of another, logged as one event. All else stays. The
   * lenses and screens that name the old one in their settings (kinds and on, or over) name the new one.
   */
  async retype(from: string, to: string, what: 'entity' | 'relation' = 'entity'): Promise<number> {
    return this.db.transaction(async (tx) => {
      const { rows } = await tx.query<{ id: string; from_id?: string; to_id?: string }>(
        what === 'entity' ? `select id from entity where type = $1 -- index entity_type` : `select id, from_id, to_id from relation where type = $1`,
        [from],
      );
      const keys = what === 'entity' ? ['kinds', 'on'] : ['over'];
      const names = `jsonb_typeof(e.props -> k) = 'array' and (e.props -> k ? $1 or e.props -> k ? ('-' || $1))`;
      const swap = `case when x = to_jsonb($1::text) then to_jsonb($2::text) when x = to_jsonb('-' || $1) then to_jsonb('-' || $2) else x end`;
      const { rows: named } = await tx.query<{ id: string; props: Props }>(
        `select e.id, (select jsonb_object_agg(k, (select jsonb_agg(${swap} order by i) from jsonb_array_elements(e.props -> k) with ordinality a(x, i))) from unnest($3::text[]) k where ${names}) as props
         from entity e where e.type = any($4::text[]) and exists (select 1 from unnest($3::text[]) k where ${names})`,
        [from, to, keys, [...this.registry.family('lens'), ...this.registry.family('screen')]],
      );
      const settings = named.length ? { settings: named.map((r) => r.id) } : {};
      const reason = `Every ${from} is a ${to} now: its pack took the ${what === 'entity' ? 'type' : 'relation'} over.`;
      const facts = rows.flatMap((r): Fact[] => (what === 'entity' ? [['+', r.id, 'type', to]] : [['+', r.id, 'link', [to, r.from_id, r.to_id]]]));
      for (const r of named) for (const k of keys) if (Array.isArray(r.props[k])) facts.push(['+', r.id, k, r.props[k]]);
      if (facts.length) await this.moved(tx, 'type.moved', reason, facts);
      if (rows.length || named.length) await this.log(tx, { actor: 'system', action: 'type.moved', reason, detail: { from, to, items: rows.map((r) => r.id), ...settings } });
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
    const { rows } = await this.db.query<{ props: Props; visibility: string; private_to: string | null }>(
      `update entity set props = ((props || $2::jsonb) - $3::text[]) || coalesce((select jsonb_object_agg(k, coalesce((props->>k)::numeric, 0) + v::numeric) from jsonb_each_text($4::jsonb) a(k, v)), '{}'),
         visibility = coalesce($5, visibility), private_to = case when $6 then $7 else private_to end where id = $1 returning props, visibility, private_to`,
      [id, JSON.stringify(set.props ?? {}), set.unset ?? [], JSON.stringify(set.add ?? {}), set.reach?.visibility ?? null, Boolean(set.reach), set.reach?.private_to ?? null],
    );
    for (const [stream, facts] of rows[0] ? operationalFacts(id, set, rows[0]) : []) await this.record(stream, event?.actor ?? 'system', facts, event?.reason);
    if (event) await this.log(this.db, { ...event, target: id });
  }

  /** Append to a compacted stream at once (src/streams.ts), kept by the retention rules the packs declare. */
  record(stream: OpStream, actor: string, facts: OpFact[], reason?: string, tx?: Q) {
    return tx ? record(tx, this.workspace, stream, actor, facts, { rules: this.registry.rules, reason }) : this.db.transaction((t) => record(t, this.workspace, stream, actor, facts, { rules: this.registry.rules, reason }));
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
      await tx.query(`insert into relation (id, type, from_id, to_id, props) values ($1, 'holds', $2, $3, $4::jsonb)`, [id, holder.id, resource.id, JSON.stringify(input.for ? { for: input.for } : {})]);
      await this.record('claims', actorId(actor), linkFacts({ id, type: 'holds', from_id: holder.id, to_id: resource.id, props: input.for ? { for: input.for } : {}, confidence: 1 }) as OpFact[], input.reason, tx);
      await this.log(tx, { actor: actorId(actor), action: 'resource.claim', target: resource.id, reason: input.reason, detail: { resource: resource.title, holder: holder.id, holder_title: holder.title, for: input.for } });
      return { status: 'claimed' as const, relation: id };
    });
  }

  async release(actor: Actor, input: { resource: string; holder?: string; reason: string }) {
    const { rows } = await this.db.query<{ id: string; from_id: string }>(
      `update relation set valid_to = now() where type = 'holds' and to_id = $1 and valid_to is null and ($2::text is null or from_id = $2) returning id, from_id`,
      [input.resource, input.holder ?? null],
    );
    await this.record('claims', actorId(actor), rows.map((r): OpFact => ['-', r.id, 'link']), input.reason);
    for (const row of rows) await this.log(this.db, { actor: actorId(actor), action: 'resource.release', target: input.resource, reason: input.reason, detail: { holder: row.from_id } });
    return { released: rows.length };
  }

  /** Ping every connection's URL and record whether it is reachable. */
  async checkConnections(actor: Actor) {
    const { rows } = await this.db.query<Entity>(`select * from entity where type = any($1::text[]) and archived_at is null and is_open`, [this.registry.family('sys.connection')]);
    const out = [];
    for (const conn of rows) {
      const url = conn.props.url as string | undefined;
      if (!url) continue;
      // Any HTTP answer, even an error status, means something is listening.
      const reachable = await fetch(url, { signal: AbortSignal.timeout(2000) }).then(() => true, () => false);
      const status = reachable ? 'available' : 'unavailable';
      await this.record('observations', actorId(actor), [['+', conn.id, 'status', status]]);
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
    await this.record('settings', 'system', [value ? ['+', 'secret', key, true] : ['-', 'secret', key]]); // the name only: the value is the vault's
  }

  /** Create (or find) the person this workspace belongs to and make them the default for views. */
  async init(actor: Actor, input: { name: string; email?: string }) {
    if (actor.kind !== 'human') throw new Error('Only a human can set the workspace owner.');
    const found = await this.db.query<{ id: string }>(`select id from entity where type = 'person' and lower(title) = lower($1) and archived_at is null -- index entity_type_title`, [input.name]);
    let id = found.rows[0]?.id;
    if (!id) id = (await this.apply(actorId(actor), { ops: [{ op: 'create', ref: 'me', type: 'person', title: input.name, props: input.email ? { email: input.email } : {} }], reason: 'Workspace owner' })).created.me;
    // Its first owner begins a workspace: what its agents change takes effect as they make it, until the owner says otherwise (owner, 21 Oct 2026).
    if ((await this.setting('me')) === undefined) await this.db.query(`insert into setting (key, value) values ($1, '"apply"'::jsonb) on conflict (key) do nothing`, [AGENT_CHANGES]);
    await this.db.query(`insert into setting (key, value) values ('me', $1::jsonb) on conflict (key) do update set value = excluded.value`, [JSON.stringify(id)]);
    await this.record('settings', actorId(actor), [['+', 'setting', 'me', id], ['+', 'setting', AGENT_CHANGES, await this.setting(AGENT_CHANGES)]]);
    return { me: id };
  }

  // ---- reads -----------------------------------------------------------

  async entity(id: string, q: Q = this.db): Promise<Entity | undefined> {
    const { rows } = await q.query<Entity>(`select * from entity where id = $1`, [id]);
    return rows[0];
  }

  async search(input: SearchInput) {
    if (input.type && !this.registry.type(input.type)) throw new Error(`Unknown type "${input.type}"`);
    return search(this.db, (type) => this.registry.family(type), input);
  }

  async get(id: string) {
    const entity = await this.entity(id);
    if (!entity) throw new Error(`No item "${id}"`);
    const rel = `r.id as relation, r.type, r.props, r.confidence, e.id, e.type as entity_type, e.title, e.status`;
    const [out, inc, events, source] = await Promise.all([
      this.db.query(`select ${rel} from relation r join entity e on e.id = r.to_id where r.from_id = $1 and r.valid_to is null`, [id]),
      this.db.query(`select ${rel} from relation r join entity e on e.id = r.from_id where r.to_id = $1 and r.valid_to is null`, [id]),
      readEvents(this.db, { target: id, limit: 8 }),
      entity.source_id ? this.entity(entity.source_id) : undefined,
    ]);
    return {
      entity,
      source: source && { id: source.id, title: source.title, uri: source.props.uri },
      trail: await this.trail(id),
      mentioned_in: await this.mentionedIn(id),
      outgoing: out.rows,
      incoming: inc.rows,
      recent_events: events.map(({ seq, ts, actor, action, changeset, reason, detail }) => ({ seq, ts, actor, action, changeset, reason, detail })),
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
      `select e.id, e.type, e.title, e.status from mention m join entity e on e.id = m.from_id
       where m.to_id = $1 and e.archived_at is null and e.type not like 'sys.%' order by e.type = any($2::text[]) desc, e.updated_at desc limit 30`,
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
      `select concat_ws('.', greatest((select coalesce(max(seq), 0) from event), (select coalesce(max(seq), 0) from log_fact)), (select count(*) from proposal where status = 'pending')) as stamp -- index log_fact_seq, proposal_status`,
    );
    return rows[0];
  }

  async proposals(input: { status?: string } = {}) {
    const { rows } = await this.db.query<Proposal>(`select * from proposal where status = $1 order by ts -- index proposal_status`, [input.status ?? 'pending']);
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
