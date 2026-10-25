// When a merge may not run: what it would absorb is already gone, or the change merges the same item twice. A merge
// run again appends the absorbed note to the kept one again (23 Oct 2026: one approval clicked three times wrote it
// three times), so it is refused on the write path, and a held merge the map has since overtaken is refused when approved.

import type { Q } from './db.ts';

interface Side {
  id: string;
  title: string;
  archived_at: unknown;
}

/** What is wrong with merging drop into keep, given what the same change has already merged away. */
export async function mergeRefusals(db: Q, where: string, keep: Side | undefined, drop: Side | undefined, dropped: Set<string>): Promise<string[]> {
  if (!keep || !drop) return [];
  if (keep.id === drop.id) return [`${where}: keep and drop are the same entity`];
  const problems: string[] = [];
  if (drop.archived_at) {
    const { rows } = await db.query<{ changeset: string | null }>(
      `select e.id as changeset from log_fact f join log_entry e on e.stream = f.stream and e.at = f.at and e.pos = f.pos
       where f.stream = 'facts' and f.id = $2 and f.field = 'merged_into' and f.value = to_jsonb($1::text) order by f.pos desc limit 1`,
      [keep.id, drop.id],
    );
    problems.push(rows.length ? `${where}: "${drop.title}" is already merged into "${keep.title}"${rows[0].changeset ? ` (${rows[0].changeset})` : ''}` : `${where}: "${drop.title}" is archived, so there is nothing left of it to merge`);
  }
  if (keep.archived_at) problems.push(`${where}: "${keep.title}" is archived: restore it before merging into it`);
  if (dropped.has(drop.id)) problems.push(`${where}: "${drop.title}" is merged twice in this change`);
  if (dropped.has(keep.id)) problems.push(`${where}: "${keep.title}" is merged away earlier in this change, so nothing can be merged into it`);
  dropped.add(drop.id);
  return problems;
}

/** A held change refused when approved names itself as overtaken, and what is left to do with it. */
export function overtaken(proposal: string, err: Error): Error {
  return new Error(`${proposal} is out of date: the map has changed since it was held, and nothing of it was applied. Leave out the ops named here, or decline it.\n${err.message}`);
}

const deciding = new Set<string>();

/** Decide a held change once at a time: a second approval while the first is applying is refused, not applied again. */
export async function once<T>(proposal: string, run: () => Promise<T>): Promise<T> {
  if (deciding.has(proposal)) throw new Error(`Proposal ${proposal} is being decided already`);
  deciding.add(proposal);
  try {
    return await run();
  } finally {
    deciding.delete(proposal);
  }
}
