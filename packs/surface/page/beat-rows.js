// What a beat of the log did to the rows the page holds, as data for the parts on `traces` (task e_p3tygg6p): the
// runtime keeps the store and the projector (packs/log/kernel/project.ts), so it projects the facts and hands each row
// they touched as it was before them and is after, with its latest maker; the part (catch_up.changes) compares the two.
// Pure: rows and entries in, rows out; it changes nothing it is handed.

import { project } from './project.js';

/**
 * The rows the entries after `after` touched, over rows held as `held` ({ items, links }: Maps by id, as a Replica keeps
 * them): `{ from, to, rows: [{ id, was, now, by?, at?, pos }] }`, `was` or `now` null where the row was not held or is
 * gone. `kinds`: what the projector asks of the types; `gone`: what the reader held and may no longer see, which left.
 */
export function beatRows(held, kinds, entries = [], { after = -Infinity, gone = [] } = {}) {
  const now = { items: new Map(held.items), links: new Map(held.links) };
  const first = new Map();
  const last = new Map();
  let to = after;
  const keyOf = (id) => (id.startsWith('r_') ? 'links' : 'items');
  const note = (id) => first.has(id) || first.set(id, now[keyOf(id)].get(id) ?? null);
  for (const e of entries) {
    if (!(e.pos > after)) continue;
    to = Math.max(to, e.pos);
    for (const f of e.facts) {
      note(f[1]);
      if (f[2] === 'forgotten') for (const [rid, r] of now.links) if (r.from_id === f[1] || r.to_id === f[1]) note(rid);
    }
    const moved = project(now, kinds, e.at, e.facts, Boolean(e.moved));
    for (const id of [...moved.items, ...moved.links, ...moved.gone]) last.set(id, { ...(e.by && { by: e.by }), at: e.at, pos: e.pos });
  }
  for (const id of gone) if (now[keyOf(id)].has(id)) (note(id), now[keyOf(id)].delete(id));
  const rows = [...first].map(([id, was]) => ({ id, was, now: now[keyOf(id)].get(id) ?? null, ...(last.get(id) ?? { pos: to }) }));
  return { from: Number.isFinite(after) ? after : null, to: Number.isFinite(to) ? to : null, rows };
}

/**
 * What was missed, entry by entry, from rows as they were (`then`): each entry with the rows it touched as they were
 * before it and after, so a part can play them a step at a time. The store is never touched.
 */
export function missedRows(then, kinds, entries = []) {
  let held = { items: new Map(then.items), links: new Map(then.links) };
  return entries.map((e) => {
    const { rows } = beatRows(held, kinds, [e], { after: e.pos - 1 });
    // The next entry starts where this one left the rows.
    held = { items: new Map(held.items), links: new Map(held.links) };
    for (const r of rows) {
      const key = r.id.startsWith('r_') ? 'links' : 'items';
      if (r.now) held[key].set(r.id, r.now);
      else held[key].delete(r.id);
    }
    return { pos: e.pos, at: e.at, ...(e.by && { by: e.by }), ...(e.moved && { moved: true }), facts: e.facts, rows: rows.map(({ id, was, now }) => ({ id, was, now })) };
  });
}
