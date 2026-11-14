// Changes held for the owner, drawn where they would land (the owner, 25 Oct 2026): the write pack's say on what a held
// change would add to a picture. A proposed item that a link in the same change ties to something drawn is a faint
// node; a proposed link between what is drawn (or such a node) is a dashed wire; a proposed edit, archive or unlink is
// marked on what it changes. Each carries `pending`: which change it is and what of it, the flag a drawing draws a
// ghost by (docs/layouts.md). Pure: proposals and what is drawn in, ghosts out.

/**
 * What held changes add to a picture: `items` to draw faint, `links` to draw dashed, and `marks` (by the id of an item
 * or link drawn) the changes held on each. `holds(id)` says whether an item is drawn.
 * On a canvas of what is held (`loose`) a new item is drawn even where nothing it ties is drawn.
 */
export function ghostsOf(proposals, holds, loose = false) {
  const items = [], links = [], marks = new Map();
  const mark = (id, pending) => (marks.get(id) ?? marks.set(id, []).get(id)).push(pending);
  for (const p of proposals ?? []) {
    const ops = Array.isArray(p.ops) ? p.ops : [];
    const by = { proposal: p.id, ...(p.actor && { by: p.actor }), ...(p.reason && { reason: p.reason }) };
    // What this change makes, by its ref, and which of them a link of it ties to what is drawn.
    const made = new Map(ops.filter((o) => o.op === 'create' && o.ref).map((o) => [o.ref, `${p.id}:${o.ref}`]));
    const idOf = (o, n) => (o.ref ? made.get(o.ref) : `${p.id}:#${n}`);
    const end = (key) => (made.has(key) ? made.get(key) : holds(key) ? key : null);
    const ties = ops.filter((o) => o.op === 'link' && end(o.from) && end(o.to));
    // A new item lands where its links reach what is drawn, directly or through another new item that does.
    const landed = new Set(loose ? made.keys() : []);
    const reached = (k) => (made.has(k) ? landed.has(k) : true);
    for (let grew = true; grew; ) {
      grew = false;
      for (const t of ties) for (const [a, b] of [[t.from, t.to], [t.to, t.from]]) if (made.has(a) && !landed.has(a) && reached(b)) (landed.add(a), (grew = true));
    }
    ops.forEach((o, n) => {
      if (o.op === 'create' && (o.ref ? landed.has(o.ref) : loose)) {
        items.push({ id: idOf(o, n), type: o.type, title: String(o.title ?? ''), ...(o.body && { body: String(o.body) }), status: o.status ?? null, open: true, pending: { ...by, op: 'create' } });
      } else if (o.op === 'link' && ties.includes(o)) {
        const [from, to] = [end(o.from), end(o.to)];
        // A link to a node that is not drawn (made, but tied to nothing drawn) is not drawn either.
        if ([o.from, o.to].every(reached)) links.push({ id: `${p.id}:${n}`, type: o.type, from, to, pending: { ...by, op: 'link' } });
      } else if ((o.op === 'update' || o.op === 'archive') && holds(o.id)) mark(o.id, { ...by, op: o.op });
      else if (o.op === 'unlink' && o.relation) mark(o.relation, { ...by, op: 'unlink' });
    });
  }
  return { items, links, marks };
}
