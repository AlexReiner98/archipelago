// The activity log as it is read: newest first, each event with the title and type of what it is about, filtered by
// when, by whom, about what and from where.

import type { Q } from './db.ts';

export type EventQuery = { since?: string; before?: number; target?: string; actor?: string; origin?: string; limit?: number };

export async function readEvents(db: Q, input: EventQuery) {
  const where: string[] = [];
  const params: unknown[] = [];
  const add = (sql: string, value: unknown) => {
    params.push(value);
    where.push(sql.replace('?', `$${params.length}`));
  };
  if (input.since) add(`ev.ts >= ?::timestamptz`, input.since);
  if (input.before) add(`ev.seq < ?`, input.before);
  if (input.target) add(`ev.target_id = ?`, input.target);
  if (input.actor) add(`ev.actor = ?`, input.actor);
  if (input.origin) add(`ev.origin = ?`, input.origin);
  params.push(Math.min(input.limit ?? 50, 500));
  const { rows } = await db.query(
    `select ev.seq, ev.ts, ev.origin, ev.actor, ev.action, ev.target_id, e.title as target_title, e.type as target_type, ev.changeset, ev.reason, ev.detail
     from event ev left join entity e on e.id = ev.target_id
     ${where.length ? 'where ' + where.join(' and ') : ''} order by ev.seq desc limit $${params.length}`,
    params,
  );
  return rows;
}
