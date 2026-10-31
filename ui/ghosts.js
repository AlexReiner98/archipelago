// Changes held for the owner, drawn where they would land (the owner, 25 Oct 2026): read from the pending proposals,
// kept beside a store's answer (ui/replica.js). A proposed item that a link in the same change ties to something
// drawn is a faint node; a proposed link between what is drawn (or such a node) is a dashed wire; a proposed edit,
// archive or unlink is marked on what it changes. Each carries `pending`: which change it is and what of it, the flag
// a drawing draws a ghost by (docs/layouts.md). A link the person has just drawn and the server has not yet answered
// for is pending too (`mine`). Pure: proposals and what is held in, ghosts out.

/** A held change's id, as a drawing names it in the key of the mark that decides it: `held:<id>` (ui/layout.js). */
export const HELD = /^held:(p_[a-z0-9]+)/;

/**
 * What held changes add to a picture: `items` to draw faint, `links` to draw dashed, and `marks` (by the id of an item
 * or link drawn) the changes held on each. `holds(id)` says whether an item is drawn; `kindOf(type)` an item's kind.
 */
export function ghostsOf(proposals, holds, kindOf = () => null) {
  const items = [], links = [], marks = new Map();
  const mark = (id, pending) => (marks.get(id) ?? marks.set(id, []).get(id)).push(pending);
  for (const p of proposals ?? []) {
    const ops = Array.isArray(p.ops) ? p.ops : [];
    const by = { proposal: p.id, ...(p.actor && { by: p.actor }), ...(p.reason && { reason: p.reason }) };
    // What this change makes, by its ref, and which of them a link of it ties to what is drawn.
    const made = new Map(ops.filter((o) => o.op === 'create' && o.ref).map((o) => [o.ref, `${p.id}:${o.ref}`]));
    const end = (key) => (made.has(key) ? made.get(key) : holds(key) ? key : null);
    const ties = ops.filter((o) => o.op === 'link' && end(o.from) && end(o.to));
    // A new item lands where its links reach what is drawn, directly or through another new item that does.
    const landed = new Set();
    const reached = (k) => (made.has(k) ? landed.has(k) : true);
    for (let grew = true; grew; ) {
      grew = false;
      for (const t of ties) for (const [a, b] of [[t.from, t.to], [t.to, t.from]]) if (made.has(a) && !landed.has(a) && reached(b)) (landed.add(a), (grew = true));
    }
    ops.forEach((o, n) => {
      if (o.op === 'create' && o.ref && landed.has(o.ref)) {
        items.push({ id: made.get(o.ref), kind: kindOf(o.type), type: o.type, title: String(o.title ?? ''), ...(o.body && { body: String(o.body) }), status: o.status ?? null, open: true, pending: { ...by, op: 'create' } });
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

/**
 * A lens answer with what is held drawn into it: the ghosts added, each item or link a held change edits flagged with
 * the first such change, and the links the person drew and the server has not answered for (`mine`, each
 * { id, type, from, to }) flagged as theirs.
 */
export function withGhosts(answer, ghosts, mine = []) {
  const flag = (x) => (ghosts.marks.has(x.id) ? { ...x, pending: ghosts.marks.get(x.id)[0] } : x);
  const ids = new Set(answer.items.map((i) => i.id));
  const drawn = (l) => ids.has(l.from) && ids.has(l.to);
  return {
    ...answer,
    items: [...answer.items.map(flag), ...ghosts.items],
    links: [...answer.links.map(flag), ...ghosts.links, ...mine.filter(drawn).map((l) => ({ ...l, pending: { mine: true, op: 'link' } }))],
  };
}
