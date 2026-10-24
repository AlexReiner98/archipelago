// Undo: reverse one change set by applying its opposite as a new change, which the log keeps as the change set that
// undoes it (docs/log.md, section 2). Nothing is erased. What each field held before is read from the log whole; a
// field that has been changed again since is left alone and reported, not overwritten.

import type { Actor, Archipelago, Op, UpdateOp } from './pelago.ts';
import { entry, factAt, type Fact } from './log.ts';

const same = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
/** The head fields an update op sets by name; any other field of an item is a declared one, in props. */
const HEAD: Record<string, unknown> = { title: undefined, body: '', status: undefined, owner: null, visibility: undefined, confidence: 1 };
/** Fields that move with another (private_to with visibility) or that no op sets. */
const FOLLOWS = ['private_to', 'kind', 'type', 'source', 'checked'];

export async function undo(l: Archipelago, actor: Actor, input: { changeset: string }) {
  const done = await entry(l.db, input.changeset);
  if (!done || done.stream !== 'facts' || !done.facts.length) throw new Error(`No change set "${input.changeset}"`);
  const { rows: already } = await l.db.query(`select 1 from log_entry where undoes = $1 and stream = 'facts'`, [input.changeset]);
  if (already.length) throw new Error(`Change set ${input.changeset} has already been undone`);
  if (done.facts.some((f) => f[2] === 'forgotten')) throw new Error(`Change set ${input.changeset} forgot something: its key is gone, and it cannot be undone`);

  const ops: Op[] = [];
  const skipped: string[] = [];
  const title = async (id: string) => (await l.entity(id))?.title ?? id;
  const before = async (id: string, field: string) => factAt(l.db, id, field, done.pos - 1);
  const value = (f: { op: string; value: unknown } | undefined) => (f?.op === '+' ? f.value : undefined);

  // What it made is archived, not taken apart; what it merged is left whole.
  const made = new Set(done.facts.filter((f) => f[2] === 'type').map((f) => f[1]));
  for (const id of [...made]) if (await before(id, 'type')) made.delete(id); // a type moved, not an item made
  const merged = done.facts.filter((f): f is Extract<Fact, ['+', ...unknown[]]> => f[2] === 'merged_into' && f[0] === '+');
  const inMerge = new Set(merged.flatMap((f) => [f[1], f[3] as string]));
  for (const f of merged) skipped.push(`merging "${await title(f[1])}" into "${await title(f[3] as string)}" cannot be undone automatically: its links were moved`);

  const updates = new Map<string, UpdateOp>();
  // Newest first, so a create is undone after the links that hang off it.
  for (const fact of [...done.facts].reverse()) {
    const [op, id, field] = fact;
    if (field === 'type_def') {
      skipped.push(`defining type ${id} cannot be undone here: remove it from the local pack file`);
      continue;
    }
    if (field === 'link') {
      const was = await before(id, 'link');
      if (op === '+' && !was) {
        const { rows } = await l.db.query(`select 1 from relation where id = $1 and valid_to is null`, [id]);
        if (rows.length) ops.push({ op: 'unlink', relation: id });
      } else if (op === '-' && value(was) && !inMerge.size) {
        const [type, from, to] = value(was) as [string, string, string];
        const { rows } = await l.db.query<{ props: Record<string, unknown> }>(`select props from relation where id = $1`, [id]);
        ops.push({ op: 'link', type, from, to, props: rows[0]?.props ?? {} });
      }
      continue;
    }
    if (made.has(id)) {
      if (field === 'type' && !(await l.entity(id))?.archived_at) ops.push({ op: 'archive', id });
      continue;
    }
    if (inMerge.has(id) || FOLLOWS.includes(field) || field === 'merged_into') continue;
    const entity = await l.entity(id);
    if (!entity) continue; // a link's own field, or something not an item
    if (field === 'archived') {
      if (op === '+' && entity.archived_at && !value(await before(id, field))) ops.push({ op: 'restore', id });
      if (op === '-' && !entity.archived_at) ops.push({ op: 'archive', id });
      continue;
    }
    const now = await factAt(l.db, id, field);
    if (now && now.pos > done.pos && !same(value(now), op === '+' ? fact[3] : undefined)) {
      skipped.push(`"${entity.title}": ${field} has changed again since, so it was left as it is`);
      continue;
    }
    const was = value(await before(id, field));
    const update = updates.get(id) ?? { op: 'update', id };
    updates.set(id, update);
    if (field in HEAD) (update as unknown as Record<string, unknown>)[field] = was ?? HEAD[field];
    else update.props = { ...update.props, [field]: was ?? null };
  }
  ops.push(...[...updates.values()].filter((u) => Object.keys(u).length > 2));
  if (!ops.length) throw new Error(`Nothing to undo.${skipped.length ? `\n- ${skipped.join('\n- ')}` : ' Everything in it has already been reversed or replaced.'}`);

  // What it had done outside the map was done there: an act is never undone, and the undo says so.
  const { rows: acts } = await l.db.query<{ act: string; pack: string }>(`select act, pack from act where changeset = $1 and status = 'done'`, [input.changeset]);
  for (const a of acts) skipped.push(`the ${a.pack} pack's act "${a.act}" was made outside the map and cannot be undone`);
  const result = await l.change(actor, { ops, reason: `Undo: ${done.reason || input.changeset}`, undoes: input.changeset });
  // An agent's undo is only a proposal; it is the undo once it has really happened.
  if (result.status === 'applied') {
    await l.log(l.db, { actor: `${actor.kind}:${actor.name}`, action: 'changeset.undo', changeset: result.changeset, reason: `Undo: ${done.reason}`, detail: { undoes: input.changeset, skipped } });
  }
  return { ...result, undoes: input.changeset, reversed: ops.length, skipped };
}
