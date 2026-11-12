// The clock's other half (decision e_esqevwkf: "from items' when or a watched query"; the shape e_52e35bft): an
// automation whose `on` names a query comes due when that query starts to match, by its edge, not at a time. Each pass
// of the clock asks each enabled automation's query again, once the log has moved since it last asked, and writes the
// same item.due fact a time writes, its detail saying which edge and which items: the packs that hear item.due act on
// it as on a time. The kernel decides nothing beyond "this came due" and names no pack.
//
// What an edge has met is remembered, so a restart or a second pass does not fire it again: per automation, in the
// workspace's settings (src/operational.ts, setting), beside the clock's cursor, with the `on` it was met under. What
// an edge meets is the automation_triggers pack's (packs/automation_triggers/kernel/edges.ts, meet); this is the
// clock's half that reads the map, until the reads it needs are a pack's (head position, a flat answer, its memory).

import { checkOn, edgeOf, meet, type Memory, type Met, type On } from './automation-rules.ts';
import { flatRead } from './query-flat.ts';
import type { Archipelago, Entity } from './pelago.ts';
import { headPos } from './tail.ts';

/** Where the clock keeps what each automation's edge has met, by the automation's id. */
const MEMORY = 'due_on:';

/** One pass over the automations that watch a query: each edge met recorded as item.due, and told to the packs. */
export async function onPass(l: Archipelago, now: number, tell: (event: { action: string; target: string; reason: string; detail: Record<string, unknown> }) => Promise<void>): Promise<Met[]> {
  const types = l.registry.family('automation');
  if (!types.length) return [];
  const { rows: autos } = await l.db.query<Entity>(`select * from entity where type = any($1::text[]) and status = 'enabled' and archived_at is null and props ? 'on' order by id limit 200 -- index entity_type`, [types]);
  if (!autos.length) return [];
  const pos = await headPos(l.db);
  const out: Met[] = [];
  for (const auto of autos) {
    const on = auto.props.on as On;
    if (checkOn(on).length) continue;
    const said = JSON.stringify(on);
    const memo = await l.setting<Memory>(MEMORY + auto.id);
    const was = memo?.on === said ? memo : undefined;
    if (was && was.pos === pos) continue;
    let ids: string[];
    try {
      ids = ((await flatRead(l, on.query as Record<string, unknown>)) as { items: { id: string }[] }).items.map((i) => i.id);
    } catch {
      continue; // a query that no longer reads (a type gone, an item named that is gone) meets nothing
    }
    const { rows: items } = ids.length ? await l.db.query<Entity>(`select * from entity where id = any($1::text[])`, [ids]) : { rows: [] as Entity[] };
    const order = new Map(ids.map((id, i) => [id, i]));
    items.sort((a, b) => order.get(a.id)! - order.get(b.id)!);
    const { met, keep } = meet(edgeOf(on), items, was, said, pos);
    await l.db.query(`insert into setting (key, value) values ($1, $2::jsonb) on conflict (key) do update set value = excluded.value`, [MEMORY + auto.id, JSON.stringify(keep)]);
    for (const m of met) {
      const firing: Met = { item: auto.id, type: auto.type, title: auto.title, at: new Date(now).toISOString(), ...m };
      await tell({ action: 'item.due', target: auto.id, reason: `"${auto.title}" is due: its query ${m.edge === 'first' ? 'matched' : `met ${m.edge}`}`, detail: { type: auto.type, at: firing.at, on: { edge: m.edge, matched: m.matched, ...(m.value !== undefined && { value: m.value }) } } });
      out.push(firing);
    }
  }
  return out;
}
