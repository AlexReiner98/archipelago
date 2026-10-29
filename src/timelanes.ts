// What a lens on a time axis is filed by (src/timeaxis.ts places it): a lane for whose it is, and a colour for what it
// counts toward. A person's lane holds what they hold (what no one holds is the workspace owner's: it is their
// calendar), and each session a lane of its own. What a block counts toward is the group its work sits in (a
// session's stretch, the work it was on then; anything else, itself): the item just under the outermost one, a
// sub-project or feature, so the work in one part of a project shares a colour apart from the rest. Work loose in
// the outermost item, holding nothing, counts toward that item; work in nothing, toward itself (a session's) or nothing.

import { SYSTEM } from './head.ts';
import type { Archipelago } from './pelago.ts';
import type { Span } from './timeaxis.ts';

interface Placed {
  id: string;
  type: string;
  title: string;
  owner: string | null;
}

/** A span as the answer sends it: what it was on, by name, and what it counts toward. */
export type FiledSpan = Span & { on_title?: string; stream?: string | null };

const KEPT = (e: string) => `${e}.archived_at is null and (${e}.kind is null or ${e}.kind <> '${SYSTEM}')`;

/**
 * The group each of these counts toward: what it sits in just under the outermost item (by how many items each holder
 * sits in itself: none is outermost, one is just under it), the first by title where there are more; one just under
 * the outermost itself, if it holds something, else the outermost. Not the app's own configuration.
 */
async function groups(l: Archipelago, ids: string[]): Promise<Map<string, string>> {
  const { rows } = await l.db.query<{ id: string; at: string; depth: number }>(
    `select c.descendant as id, c.ancestor as at,
       (select count(*) from part_closure p join entity a on a.id = p.ancestor where p.descendant = c.ancestor and ${KEPT('a')})::int as depth
     from part_closure c join entity e on e.id = c.ancestor
     where c.descendant = any($1::text[]) and ${KEPT('e')}
     order by e.title, c.ancestor`,
    [ids],
  );
  const { rows: holding } = await l.db.query<{ id: string }>(
    `select distinct c.ancestor as id from part_closure c join entity e on e.id = c.descendant where c.ancestor = any($1::text[]) and ${KEPT('e')}`,
    [ids],
  );
  const holds = new Set(holding.map((r) => r.id));
  const out = new Map<string, string>();
  for (const id of ids) {
    const mine = rows.filter((r) => r.id === id);
    if (!mine.length) continue;
    const root = mine.find((r) => r.depth === 0)?.at ?? mine[0].at;
    const under = mine.find((r) => r.depth === 1)?.at;
    out.set(id, under ?? (mine.length === 1 && holds.has(id) ? id : root));
  }
  return out;
}

/** The lanes and streams of what is placed, each item's lane and stream, and each span named and coloured. */
export async function fileOnAxis(l: Archipelago, items: Placed[], spans: Map<string, Span[]>, me: string | null) {
  const placed = items.filter((e) => spans.get(e.id)?.length);
  const isRun = (e: Placed) => l.registry.isA(e.type, 'run');
  const works = new Set<string>();
  for (const e of placed) for (const s of isRun(e) ? spans.get(e.id)! : [{ on: e.id }]) if (s.on) works.add(s.on);
  const roots = await groups(l, [...works]);
  const owners = [...new Set(placed.filter((e) => !isRun(e)).map((e) => e.owner ?? me).filter((k): k is string => k !== null))];
  const named = [...new Set([...works, ...roots.values(), ...owners])];
  const { rows } = await l.db.query<{ id: string; title: string }>('select id, title from entity where id = any($1::text[])', [named]);
  const titles = new Map(rows.map((r) => [r.id, r.title]));

  const lane = new Map<string, string | null>();
  const stream = new Map<string, string | null>();
  const filed = new Map<string, FiledSpan[]>();
  for (const e of placed) {
    if (isRun(e)) {
      lane.set(e.id, e.id);
      filed.set(e.id, spans.get(e.id)!.map((s) => ({ ...s, ...(s.on && { on_title: titles.get(s.on) }), stream: s.on ? (roots.get(s.on) ?? s.on) : null })));
    } else {
      lane.set(e.id, e.owner ?? me);
      stream.set(e.id, roots.get(e.id) ?? null);
    }
  }
  // Sessions in the order they began that week, after the people (by name) and what no one holds.
  const firstOf = (id: string) => Math.min(...spans.get(id)!.map((s) => Date.parse(s.start)));
  const runs = placed.filter(isRun).sort((a, b) => firstOf(a.id) - firstOf(b.id) || a.id.localeCompare(b.id));
  const people = owners.map((key) => ({ key, title: titles.get(key) ?? 'Someone' })).sort((a, b) => a.title.localeCompare(b.title));
  const lanes = [
    ...people,
    ...(placed.some((e) => !isRun(e) && lane.get(e.id) === null) ? [{ key: null, title: 'No one' }] : []),
    ...runs.map((r) => ({ key: r.id, title: r.title })),
  ];
  const used = new Set([...stream.values(), ...[...filed.values()].flat().map((s) => s.stream)].filter((k): k is string => Boolean(k)));
  const streams = [...used].map((key) => ({ key, title: titles.get(key) ?? 'Something' })).sort((a, b) => a.title.localeCompare(b.title) || a.key.localeCompare(b.key));
  return { lane, stream, filed, lanes, streams };
}
