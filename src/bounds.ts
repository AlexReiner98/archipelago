// Bounds: a field against a limit, declared by a type as its bound capability. A date due by a day, a quantity
// under its reorder level. What crosses one is at risk, whatever the field is called.

import type { Archipelago } from './pelago.ts';

interface Crossed {
  id: string;
  type: string;
  title: string;
  status: string;
  owner: string | null;
}

/** Open items whose bound is crossed or near: a date due within some days, or a quantity under its limit. */
export async function pastBounds(l: Archipelago, days: number) {
  const bounds = l.registry.having('bound').map((type) => ({ type, ...l.registry.type(type)!.capabilities.bound! }));
  const { rows: due } = await l.db.query<Crossed & { due: string; overdue: boolean }>(
    `select e.id, e.type, e.title, e.status, e.owner, e.props->>b.field as due, (e.props->>b.field)::date < current_date as overdue
     from entity e join jsonb_to_recordset($2::jsonb) as b(type text, field text) on b.type = e.type
     where e.is_open and e.archived_at is null and e.props ? b.field and (e.props->>b.field)::date <= current_date + $1::int
     order by due`,
    [days, JSON.stringify(bounds.filter((b) => b.limit))],
  );
  const { rows: under } = await l.db.query<Crossed & { value: number; limit: number }>(
    `select e.id, e.type, e.title, e.status, e.owner, (e.props->>b.field)::numeric as value, (e.props->>b.below)::numeric as limit
     from entity e join jsonb_to_recordset($1::jsonb) as b(type text, field text, below text) on b.type = e.type
     where e.is_open and e.archived_at is null and (e.props->>b.field)::numeric < (e.props->>b.below)::numeric`,
    [JSON.stringify(bounds.filter((b) => b.below))],
  );
  return { due, under };
}

