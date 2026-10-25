// What a lens sends beside its items and links when a page asks for it: which of the items it sends name another of
// them in their text or fields (the mention projection, src/mentions.ts), as links of the kind `mentions`; and the
// first line of each one's note, for a tip that says the point of a thing. Both read only the items sent, by id,
// joined to entity so row-level security keeps out what may not be seen.

import type { Archipelago } from './pelago.ts';

/** How much of a note's first line a tip is sent. */
const NOTE_MOST = 180;

/** The mentions among these items, each as a link from what names to what is named. */
export async function mentionsAmong(l: Archipelago, ids: string[]): Promise<{ kind: 'mentions'; from: string; to: string; n: number }[]> {
  if (ids.length < 2) return [];
  const { rows } = await l.db.query<{ from_id: string; to_id: string }>(
    `select m.from_id, m.to_id from mention m join unnest($1::text[]) a(id) on a.id = m.from_id join unnest($1::text[]) b(id) on b.id = m.to_id
     join entity f on f.id = m.from_id join entity t on t.id = m.to_id order by m.from_id, m.to_id`,
    [ids],
  );
  return rows.map((r) => ({ kind: 'mentions', from: r.from_id, to: r.to_id, n: 1 }));
}

/** The first line of each item's note that is not a heading, cut to a tip's length. */
export async function notesOf(l: Archipelago, ids: string[]): Promise<Map<string, string>> {
  if (!ids.length) return new Map();
  const { rows } = await l.db.query<{ id: string; head: string | null }>(`select id, left(body, 800) as head from entity where id = any($1::text[]) and body is not null`, [ids]);
  const first = (text: string) => text.split(/\r?\n/).map((s) => s.trim()).find((s) => s && !s.startsWith('#') && !/^[-*_]{3,}$/.test(s)) ?? '';
  const cut = (s: string) => (s.length > NOTE_MOST ? `${s.slice(0, NOTE_MOST - 1).replace(/\s+\S*$/, '')}…` : s);
  return new Map(rows.map((r) => [r.id, cut(first(r.head ?? '').replace(/[*_`]/g, ''))] as const).filter(([, s]) => s));
}
