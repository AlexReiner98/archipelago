// Nothing shared may wait on what is private to someone: checked by plan (src/pelago.ts) for every change.

import type { Archipelago, Op } from './pelago.ts';

/** Relations that make one thing wait on another. */
export const BLOCKING_RELATIONS = ['depends_on', 'needs'];

/**
 * The rule that keeps blockers honest between people: nothing may depend on
 * an item that is private unless it is private to the same person. Otherwise
 * a colleague would see work as ready that is waiting on something hidden
 * from them. Checked for new dependencies and for changes of visibility.
 */
export async function privateDependencies(l: Archipelago, ops: Op[]): Promise<string[]> {
  if (!l.viewer) return []; // nothing is private without a person to be private to
  const problems: string[] = [];
  const fallback = await l.defaultVisibility();
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
    const found = after.has(key) && names.has(key) ? undefined : await l.entity(key);
    if (found) names.set(key, found.title);
    return { private: after.get(key) ?? Boolean(found?.private_to), was: Boolean(found?.private_to) };
  };
  const name = (key: string) => `"${names.get(key) ?? key}"`;

  for (const [i, op] of ops.entries()) {
    const where = `op ${i + 1} (${op.op})`;
    if (op.op === 'link' && BLOCKING_RELATIONS.includes(l.registry.relations.get(op.type)?.root ?? op.type)) {
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
      const { rows: seen } = await l.db.query<{ id: string; title: string }>(
        `select s.id, s.title from relation r join entity s on s.id = r.from_id
         where r.to_id = $1 and r.valid_to is null and r.type = any($2::text[]) and s.archived_at is null and s.private_to is null`,
        [op.id, l.registry.relationFamily(...BLOCKING_RELATIONS)],
      );
      const { rows: all } = await l.db.query<{ n: number }>(`select pelago_external_dependents($1, $2) as n`, [op.id, l.viewer]);
      const staying = seen.filter((s) => after.get(s.id) !== true);
      const hidden = all[0].n - seen.length;
      if (staying.length || hidden > 0) {
        const what = [...staying.map((s) => `"${s.title}"`), ...(hidden > 0 ? [`${hidden} item${hidden === 1 ? '' : 's'} private to someone else`] : [])].join(', ');
        problems.push(`${where}: ${name(op.id)} cannot be made private while other work depends on it: ${what}.`);
      }
    }
    if (!self.private && self.was) {
      // Going shared: what it waits on must be visible too.
      const { rows: targets } = await l.db.query<{ id: string; title: string }>(
        `select t.id, t.title from relation r join entity t on t.id = r.to_id
         where r.from_id = $1 and r.valid_to is null and r.type = any($2::text[]) and t.archived_at is null and t.private_to is not null`,
        [op.id, l.registry.relationFamily(...BLOCKING_RELATIONS)],
      );
      const stillPrivate = targets.filter((t) => after.get(t.id) !== false);
      if (stillPrivate.length) problems.push(`${where}: ${name(op.id)} cannot be shared while it depends on private items: ${stillPrivate.map((t) => `"${t.title}"`).join(', ')}. Share those in the same change.`);
    }
  }
  return problems;
}
