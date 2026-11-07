// An agent reuses a view rather than make it twice (task e_av382ad4): a new view with the name or the query of one
// already kept, about the same items (or, about nothing, the workspace's), is refused, naming the one there to open or
// change. Read across the whole change, since a view's about links come in it beside the view.

import type { Archipelago, Op } from './pelago.ts';
import type { CreateOp, LinkOp } from './pelago-types.ts';

type Props = Record<string, unknown>;

/** A value as text, its keys in order: the map keeps an object's keys in an order of its own. */
const canonical = (v: unknown): string =>
  Array.isArray(v) ? `[${v.map(canonical).join(',')}]` : v && typeof v === 'object' ? `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${canonical((v as Props)[k])}`).join(',')}}` : JSON.stringify(v ?? null);

/** What a view is the same by: its query, as flat reads it. */
const query = (p: Props) => canonical({ filter: p.filter, walk: p.walk, view: p.view, time: p.time });

/** Refuse each view an agent makes that is one there already: the same name or query, about the same items. */
export async function noTwins(l: Archipelago, ops: Op[]): Promise<void> {
  const types = l.registry.family('lens');
  const made = ops.filter((o): o is CreateOp => o.op === 'create' && types.includes(String(o.type)) && typeof o.title === 'string');
  if (!made.length) return;
  const refs = new Set(ops.flatMap((o) => (o.op === 'create' && o.ref ? [o.ref] : [])));
  const aboutOf = (key: string | undefined) => ops.filter((o): o is LinkOp => o.op === 'link' && o.type === 'about' && key !== undefined && o.from === key).map((o) => String(o.to));
  const { rows } = await l.db.query<{ id: string; title: string; props: Props }>(
    `select id, title, ${l.props} from entity where type = any($1::text[]) and is_open and archived_at is null and (lower(title) = any($2::text[]) or props ? 'filter' or props ? 'view') -- index entity_type`,
    [types, made.map((o) => o.title.trim().toLowerCase())],
  );
  if (!rows.length) return;
  const { rows: links } = await l.db.query<{ from_id: string; to_id: string }>(`select from_id, to_id from relation where type = 'about' and valid_to is null and from_id = any($1::text[])`, [rows.map((r) => r.id)]);
  const same = (a: string[], b: string[]) => a.length === b.length && a.every((x) => b.includes(x));
  const twins: string[] = [];
  for (const op of made) {
    const about = aboutOf(op.ref);
    // About an item this change makes, it can have no twin yet.
    if (about.some((to) => refs.has(to))) continue;
    const mine = query((op.props ?? {}) as Props);
    const twin = rows.find((r) => same(links.filter((x) => x.from_id === r.id).map((x) => x.to_id), about) && (r.title.trim().toLowerCase() === op.title.trim().toLowerCase() || query(r.props) === mine));
    if (twin) twins.push(`"${op.title}": "${twin.title}" (${twin.id}) is that view already, ${about.length ? 'about the same item' : 'of the workspace'}: open it with report show, or change it, rather than make it twice.`);
  }
  if (twins.length) throw new Error(`Change rejected:\n${twins.map((t) => `- ${t}`).join('\n')}`);
}
