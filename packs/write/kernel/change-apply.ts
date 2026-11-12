// Applying a change: each op planned into facts and projected at once, then appended to the log as one change set.
// The apply loop of the one write path (src/pelago.ts), which calls it once the rules have let the change through.

import { newId, type Q } from '../../database/kernel/db.ts';
import { bodyAfter, dropExcepted } from './ops.ts'; import { ownerFollows } from './owner-link.ts';
import { roomToStore, stillWritable } from '../../identity/kernel/standing.ts';
import { after, followedStill, rewrite, riders, type Followed } from './write-hooks.ts';
import { typesAfter } from '../../loader/kernel/type-items.ts';
import { KEPT_FIELDS } from '../../log/kernel/operational.ts';
import { append, type Decision, type Fact } from '../../log/kernel/log.ts'; import { FORGET_ROWS, projectDecision, projectFacts, stamp } from '../../log/kernel/replay.ts'; import { changedFacts, itemFacts, linkFacts } from '../../log/kernel/facts.ts';
import { asOwner, forgetIn, ownerRows } from './forget.ts';
import type { Authority, ChangeInput, Op, SourceSpec } from './pelago-types.ts';
import type { Archipelago } from './pelago.ts';
import type { Verdict } from '../../rules/kernel/rules.ts';

type Props = Record<string, unknown>;

/** Who a new private thing is private to: the viewer, when there is one; for an approved change, whom it was held for (`to`). */
const privateTo = (map: Archipelago, visibility: string, to?: string | null): string | null => (visibility !== 'private' ? null : to !== undefined ? to : map.viewer || null);

/**
 * Apply a change without consulting policy. For human changes, approved proposals, and the system's own bookkeeping
 * (sessions). Each op is planned into facts and projected at once (src/replay.ts), so the next reads what it did; the
 * facts are appended to the fact stream as one change set in the same transaction. dry: the facts it would append and
 * the ids it would make, with nothing written; ids: those ids, to make the same ones again.
 */
export async function applyChange(map: Archipelago, actor: string, input: ChangeInput, opts: { except?: string[]; approvedBy?: string; revised?: boolean; authority?: Authority; token?: string; rule?: Decision; dry?: boolean; ids?: Record<string, string>; privateTo?: string | null; followed?: Followed } = {}) {
  const ops = dropExcepted(input.ops, opts.except ?? []); await stillWritable(map.workspace); if (!opts.dry) await roomToStore(map.workspace);
  if (!ops.length) throw new Error('Nothing left to apply after exclusions.');
  // Validate again: the map may have changed since this was proposed. A new item naming no island is placed again (src/island-items.ts).
  await rewrite({ map, reg: map.registry }, ops);
  const { warnings } = await map.plan(ops);
  // A change judged with what followed it (write.follow): what follows it now must be the same, or the map moved.
  if (opts.followed?.length) await followedStill({ map, reg: map.registry }, ops, opts.followed);
  const changeset = newId('c');
  const created: Record<string, string> = {};
  const reg = await typesAfter(map, ops);
  // Each id it makes is named by what makes it, so that a held change approved with nothing moved makes the same ones.
  const ids: Record<string, string> = {};
  const mint = (key: string, prefix: string) => (ids[key] = opts.ids?.[key] ?? newId(prefix));
  const at = new Map(input.ops.map((op, i) => [op, i + 1]));
  const facts: Fact[] = [];
  const DRY = Symbol('dry');
  // What rides the change (write.follow.rides: the waits pack's unwait, the placement pack's sources) is asked op by
  // op in the transaction below, and takes this change's verdict and authority: no rule judges it on its own.
  const ride = await riders({ map, reg: map.registry });
  const answers: Record<string, unknown[]> = {};
  // Whose word the change is: where its authority is a person's, the person the map is read as.
  const word = opts.authority?.of === 'human' ? (map.viewer || (await map.setting<string>('me')) || null) : null;

  await map.db.transaction(async (tx) => {
    // Facts first: each op is planned on the map as the ops before it left it, and its facts projected at once.
    const when = await stamp(tx);
    const said = async (some: Fact[]) => { facts.push(...some); await projectFacts(tx, reg, when, some); };
    const fallback = await map.defaultVisibility(tx);
    // What rides at an op: its ops said where they are asked (a create minted by its ref), the item a source is, and
    // what the change answers.
    const rodeIds: Record<string, string> = {};
    const riding = async (op: Op): Promise<Fact[]> => {
      if (op.op === 'unlink') return [['-', op.relation, 'link']];
      if (op.op !== 'create' || !op.ref) return [];
      const type = map.registry.type(op.type);
      if (!type) throw new Error(`Change rejected:\n- ${op.type}: no such type`);
      const problems = map.registry.check(op.type, undefined, op.props ?? {});
      if (problems.length) throw new Error(`Change rejected:\n- ${op.type}: ${problems.join(`\n- ${op.type}: `)}`);
      const id = (rodeIds[op.ref] = mint(op.ref, 'e'));
      const visibility = op.visibility ?? fallback;
      return itemFacts({ id, type: type.id, title: op.title, body: op.body ?? '', status: op.status ?? type.statuses.open[0], visibility, private_to: privateTo(map, visibility, opts.privateTo), props: op.props ?? {} });
    };
    const rides = async (at: number, place: 'source' | 'after', spec?: SourceSpec): Promise<string | null> => {
      let is: string | null = null;
      for (const rode of await ride(ops, { q: tx, at, place, ...(spec && { source: spec }), authority: opts.authority ?? null, word, registry: reg })) {
        for (const op of rode.ops ?? []) await said(await riding(op));
        if (rode.is) is = rodeIds[rode.is] ?? rode.is;
        for (const [k, v] of Object.entries(rode.answer ?? {})) (answers[k] ??= []).push(...v);
      }
      return is;
    };
    const defaultSource = input.source ? await rides(-1, 'source', input.source) : null;
    const sourceOf = async (op: { source?: SourceSpec }, i: number) => (op.source ? rides(i, 'source', op.source) : defaultSource);
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
            visibility, private_to: privateTo(map, visibility, opts.privateTo), owner: op.owner ? resolve(op.owner) : null, confidence: op.confidence ?? 1,
            source_id: type.columns && !type.columns.source ? null : await sourceOf(op, i), props: { ...reg.defaults(op.type), ...refsIn(op.props, named) },
          }));
          await kept(tx, id, op.props);
          break;
        }
        case 'update': {
          const before = (await map.entity(op.id, tx))!;
          const props = { ...before.props };
          for (const [key, value] of Object.entries(refsIn(op.props, named) ?? {})) {
            if (value === null) delete props[key];
            else props[key] = value;
          }
          const visibility = op.visibility ?? before.visibility;
          await said(changedFacts(before, {
            ...before, props, visibility,
            title: named(op.title)?.trim() ?? before.title,
            body: bodyAfter(before.body, { ...op, body: named(op.body), append: named(op.append), replace: op.replace && { find: op.replace.find, with: named(op.replace.with) } }),
            status: op.status ?? before.status,
            owner: op.owner === undefined ? before.owner : op.owner && resolve(op.owner),
            confidence: op.confidence ?? before.confidence,
            // Only an explicit change of visibility moves who it is private to.
            private_to: op.visibility !== undefined && op.visibility !== before.visibility ? privateTo(map, visibility, opts.privateTo) : before.private_to,
          }));
          await kept(tx, op.id, op.props);
          break;
        }
        case 'link': {
          const from = resolve(op.from);
          const to = resolve(op.to);
          const same = await tx.query(`select 1 from relation where type = $1 and from_id = $2 and to_id = $3 and valid_to is null`, [op.type, from, to]);
          if (same.rows.length) break; // already linked
          await said(linkFacts({ id: mint(`#${at.get(op)}`, 'r'), type: op.type, from_id: from, to_id: to, props: op.props ?? {}, confidence: op.confidence ?? 1, source_id: await sourceOf(op, i) }));
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
          const keep = (await map.entity(op.keep, tx))!;
          const drop = (await map.entity(op.drop, tx))!; // archived first, and only once: the log's lock puts a merge that races another after it, refused
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
          // Two people made one: what was private to the dropped one is the kept one's, or nobody could read it again.
          const mine = await ownerRows<{ id: string }>(tx, `select id from entity where private_to = $1 -- index entity_private_to`, [op.drop]);
          await said([...moves, ...owned.map((o): Fact => ['+', o.id, 'owner', op.keep]), ...mine.map((o): Fact => ['+', o.id, 'private_to', op.keep])]);
          // Projected as the tables' owner, as a forget's rows are: the person merging cannot see those rows to move them.
          if (mine.length) await asOwner(tx, [`update entity set private_to = $1, updated_at = $3 where id = any($2::text[])`], [op.keep, mine.map((o) => o.id), when]);
          const now = (await map.entity(op.keep, tx))!;
          const body = drop.body && keep.body.includes(drop.body) ? keep.body : [keep.body, drop.body].filter(Boolean).join('\n\n'); // a merge finished again adds nothing twice
          await said(changedFacts(now, { ...now, props: { ...drop.props, ...keep.props }, body }));
          break;
        }
        case 'forget': // for good: its key, its words in the log and beside it, then its rows, whoever could see them
          await forgetIn(tx, op); await said([['+', op.id, 'forgotten', true]]); await asOwner(tx, FORGET_ROWS, [op.id]);
          break;
        case 'define_type':
          await said([['+', op.type.id, 'type_def', op.type]]);
          break; // registered after the transaction
      }
      await said(await ownerFollows(tx, op, resolve, resolve(op.op === 'create' ? (op.ref ?? `#${i + 1}`) : ''), () => mint(`owner#${at.get(op)}`, 'r')));
      await rides(i, 'after');
    }
    if (opts.dry) throw DRY;
    const rule: Decision = opts.rule ?? { outcome: 'apply', spared: [] };
    const by = { id: actor, ...(opts.token && { token: opts.token }) };
    const done = await append(tx, map.workspace, 'facts', { id: changeset, actor: by, authority: opts.authority ?? null, rule, reason: input.reason, source: defaultSource, action: input.action ?? null, undoes: input.undoes ?? null, keys: [], ...(input.run && { run: input.run }), ...(input.pack && { pack: { id: input.pack, manifest: map.registry.hashes.get(input.pack) ?? null, action: input.action ?? null } }), ...(opts.followed?.length && { follows: opts.followed.map((f) => ({ pack: f.pack, ops: f.ops.length })) }) }, facts);
    if (done.at !== when) throw new Error(`The log's time moved under its lock (${when}, then ${done.at})`);
    await projectDecision(tx, done);
  }).catch((err) => { if (err !== DRY) throw err; });
  if (opts.dry) return { status: 'dry' as const, changeset, created, warnings, facts, ids };

  await after({ map, reg }, { changeset, actor, reason: input.reason, ops }, warnings); // write.after: the types it made, what it supersedes, and what packs do
  return { status: 'applied' as const, changeset, created, warnings, ...answers };
}

/** A prop's value with {ref} replaced by the id it makes, in every string inside it (a lens's filter, a style named in it). */
function refsIn<T>(value: T, named: (text: string) => string): T {
  if (typeof value === 'string') return named(value) as T;
  if (Array.isArray(value)) return value.map((v) => refsIn(v, named)) as T;
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, refsIn(v, named)])) as T;
  return value;
}

/** Of an applied change, what let it through: each rule that would have held it, and the setting, policy or holds off that did not let it. */
export function letThrough(spared: Verdict['spared']): { let_through?: { rule: string; pack: string; by: string }[] } {
  const each = new Map(spared.flat().map((r) => [`${r.pack}.${r.rule}`, { rule: r.rule, pack: r.pack, by: r.lifted_by ?? 'setting' }]));
  return each.size ? { let_through: [...each.values()] } : {};
}

/** What an op sets of an item's operational state (src/operational.ts) is not a fact: it is written beside them, never logged. */
async function kept(tx: Q, id: string, props: Props = {}) {
  const ours = Object.entries(props).filter(([k]) => KEPT_FIELDS.includes(k));
  if (!ours.length) return;
  const set = Object.fromEntries(ours.filter(([, v]) => v !== null && v !== undefined));
  await tx.query(`update entity set props = (props || $2::jsonb) - $3::text[] where id = $1`, [id, JSON.stringify(set), ours.filter(([k]) => !(k in set)).map(([k]) => k)]);
}
