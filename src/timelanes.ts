// What a lens on a time axis is filed by (src/timeaxis.ts places it): a lane for whose it is, and a colour for what it
// counts toward. A person's lane holds what they hold (what no one holds is the workspace owner's: it is their
// calendar), and each session a lane of its own. What a block counts toward is the outermost item its work sits in
// (a session's stretch, the work it was on then; anything else, itself), or that work where it sits in nothing.

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

/** The outermost item each of these sits in (not the app's own configuration), the first by title where it sits in more than one. */
async function outermost(l: Archipelago, ids: string[]): Promise<Map<string, string>> {
  const { rows } = await l.db.query<{ id: string; root: string; title: string }>(
    `select c.descendant as id, c.ancestor as root, e.title from part_closure c join entity e on e.id = c.ancestor
     where c.descendant = any($1::text[]) and e.archived_at is null and (e.kind is null or e.kind <> '${SYSTEM}')
       and not exists (select 1 from part_closure p join entity a on a.id = p.ancestor where p.descendant = c.ancestor and a.archived_at is null and (a.kind is null or a.kind <> '${SYSTEM}'))
     order by e.title, c.ancestor`,
    [ids],
  );
  const out = new Map<string, string>();
  for (const r of rows) if (!out.has(r.id)) out.set(r.id, r.root);
  return out;
}

/** The lanes and streams of what is placed, each item's lane and stream, and each span named and coloured. */
export async function fileOnAxis(l: Archipelago, items: Placed[], spans: Map<string, Span[]>, me: string | null) {
  const placed = items.filter((e) => spans.get(e.id)?.length);
  const isRun = (e: Placed) => l.registry.isA(e.type, 'run');
  const works = new Set<string>();
  for (const e of placed) for (const s of isRun(e) ? spans.get(e.id)! : [{ on: e.id }]) if (s.on) works.add(s.on);
  const roots = await outermost(l, [...works]);
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
