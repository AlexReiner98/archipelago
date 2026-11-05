// What a reader relies on has moved: an item reads another by a link of a type that crosses (core's reads, of a
// finding), the item read is of a type that promises some of its fields (the `promised` capability), and one of
// those fields changed after the reader last changed or checked itself, and after the reading began. Read from the
// log and the links alone: nothing runs when a finding moves, and the reason goes once the reader is changed or said
// still true (an update of only its id). The values are the finding's own, before the reader's last word and now.

import type { Archipelago } from './pelago.ts';
import { openSaid } from './seal.ts';

/** One moved reading: the item read, each promised field that moved (from what to what), and when it last moved. */
export interface Moved {
  finding: string;
  title: string;
  moved: { field: string; from: unknown; to: unknown }[];
  on: string;
}

/** The link types that may cross between islands, and every type extending one: a reading. */
export function readingTypes(l: Archipelago): string[] {
  const reg = l.registry;
  return reg.relationFamily(...[...reg.relations.values()].filter((r) => r.crosses).map((r) => r.id));
}

/** The types whose readers are told when they move: those promising fields. */
export function promisedTypes(l: Archipelago): string[] {
  return l.registry.having('promised');
}

/** Of these items, the readings that have moved since each reader last changed or checked itself. */
export async function movedReadings(l: Archipelago, readers: string[]): Promise<Map<string, Moved[]>> {
  const out = new Map<string, Moved[]>();
  const kinds = readingTypes(l);
  const promised = promisedTypes(l);
  if (!readers.length || !kinds.length || !promised.length) return out;
  const { rows: links } = await l.db.query<{ id: string; from_id: string; to_id: string; type: string; title: string }>(
    `select r.id, r.from_id, r.to_id, e.type, e.title from relation r join entity e on e.id = r.to_id
     where r.from_id = any($1::text[]) and r.type = any($2::text[]) and r.valid_to is null and e.type = any($3::text[]) and e.archived_at is null`,
    [readers, kinds, promised],
  );
  if (!links.length) return out;
  // Where each reading began, and each reader's last word: positions in the log, so the order is the log's.
  const { rows: last } = await l.db.query<{ id: string; pos: number }>(
    `select id, max(pos)::int as pos from log_fact where stream = 'facts' and id = any($1::text[]) group by id -- index log_fact_history`,
    [[...new Set(links.map((k) => k.from_id)), ...links.map((k) => k.id)]],
  );
  const at = new Map(last.map((r) => [r.id, r.pos]));
  const read = [...new Set(links.map((k) => k.to_id))];
  const fieldsOf = (type: string) => l.registry.type(type)?.capabilities.promised?.fields ?? [];
  const fields = [...new Set(links.flatMap((k) => fieldsOf(k.type)))];
  const { rows: said } = await l.db.query<{ id: string; field: string; value: unknown; op: string; pos: number; at: Date }>(
    `select id, field, value, op, pos::int as pos, at from log_fact where stream = 'facts' and id = any($1::text[]) and field = any($2::text[]) order by pos, n -- index log_fact_history`,
    [read, fields],
  );
  const facts = await openSaid(l.db, said);
  for (const k of links) {
    const since = Math.max(at.get(k.from_id) ?? 0, at.get(k.id) ?? 0);
    const mine = facts.filter((f) => f.id === k.to_id);
    const moved: Moved['moved'] = [];
    let on: Date | undefined;
    for (const field of fieldsOf(k.type)) {
      const of = mine.filter((f) => f.field === field);
      const after = of.filter((f) => f.pos > since);
      if (!after.length) continue;
      const valueOf = (f: (typeof of)[number] | undefined) => (f && f.op === '+' ? f.value : null);
      const from = valueOf(of.filter((f) => f.pos <= since).at(-1));
      const to = valueOf(after.at(-1));
      if (JSON.stringify(from) === JSON.stringify(to)) continue;
      moved.push({ field, from, to });
      const when = new Date(after.at(-1)!.at);
      if (!on || when > on) on = when;
    }
    if (!moved.length) continue;
    out.set(k.from_id, [...(out.get(k.from_id) ?? []), { finding: k.to_id, title: k.title, moved, on: on!.toISOString() }]);
  }
  return out;
}

/** The open items that read a promised item: a person's (owned by them, or by nobody when they are the owner), or everyone's. */
export async function readersOf(l: Archipelago, me?: string, isOwner = false): Promise<string[]> {
  const kinds = readingTypes(l);
  const promised = promisedTypes(l);
  if (!kinds.length || !promised.length) return [];
  const { rows } = await l.db.query<{ id: string }>(
    `select distinct r.from_id as id from relation r join entity e on e.id = r.from_id join entity f on f.id = r.to_id
     where r.type = any($1::text[]) and r.valid_to is null and f.type = any($2::text[]) and e.is_open and e.archived_at is null
       and ($3::text is null or e.owner = $3 or ($4 and e.owner is null)) -- index relation_open_type`,
    [kinds, promised, me ?? null, isOwner],
  );
  return rows.map((r) => r.id);
}

/** The query term `moved`: every open item whose reading has moved, as the viewer may see them. */
export async function movedIds(l: Archipelago): Promise<string[]> {
  return [...(await movedReadings(l, await readersOf(l))).keys()];
}
