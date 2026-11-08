// Layer: topology. Each link of an island as a plan of its wire, before anything has a place: which side of each item
// it leaves by, which street (the room between two rows) it runs in, and which rows it crosses on waypoints. A block
// alone leaves by its top or foot; an item among parts leaves by its right side into the gutter beside its column and
// down to the street below its row; a block's head takes what comes from above on its top. Two items in one column are
// joined in their gutter (a bracket). The order's wires into one item merge, and so do those out of one. A link to
// another island leaves by a port on the island's foot. Pure.

/** Where each item stands in its block: its block, row, column (-1 for the head) and whether it is alone. */
export function whereOf(blocks, row) {
  const where = new Map();
  for (const b of blocks) {
    const single = b.members.length === 1, r = row.get(b.id), last = b.columns.length - 1;
    where.set(b.head, { block: b.id, row: r, column: -1, gutter: last, head: true, single, y: 0 });
    b.columns.forEach((c, k) => c.lines.forEach((l) => where.set(l.id, { block: b.id, row: r, column: k, gutter: k, head: false, single: false, y: l.y })));
  }
  return where;
}

/** The end of a wire at an item, leaving up (to the street above its row) or down. */
function endAt(item, dir, where) {
  const w = where.get(item);
  if (w.single) return { item, side: dir === 'up' ? 'top' : 'bottom', street: dir === 'up' ? w.row : w.row + 1 };
  if (w.head && dir === 'up') return { item, side: 'top', street: w.row };
  return { item, side: 'right', gutter: `${w.block}:${w.gutter}`, street: w.row + 1 };
}

const range = (from, to) => Array.from({ length: Math.max(0, to - from) }, (_, k) => from + k);

/**
 * The plans of an island's wires. `rows` is how many rows the island has; a port on its foot stands in row `rows`.
 * A plan is { id, link, type, kind, head ('a', 'b' or none), a, b, rows (crossed on waypoints), merge { a, b } } or,
 * for a bracket, { ..., bracket: gutter }. `kind` is order, back, tie or out.
 */
export function plansOf({ links, where, back, rows, islandOf = () => '' }) {
  const plans = [];
  for (const l of links) {
    if (l.type === 'part_of') continue;
    const [from, to] = [where.get(l.from), where.get(l.to)];
    if (!from && !to) continue;
    const kind = l.order ? (back.has(l.id) ? 'back' : 'order') : 'tie';
    // A link to another island: its end here leaves down, crosses every row below on waypoints, to a port on the foot.
    // The links of a type into one item share a port on each island they come from, and one on the item's own.
    if (!from || !to) {
      const here = from ? l.from : l.to, other = from ? l.to : l.from, a = endAt(here, 'down', where);
      const target = l.order ? l.from : l.to, headHere = target === here;
      const key = headHere ? `port:${l.type}>${here}@${islandOf(other)}` : `port:${l.type}>${target}`;
      plans.push({ id: l.id, link: l, type: l.type, kind: 'out', head: headHere ? 'a' : '', a, b: { port: true, street: rows, other, key }, rows: [...range(a.street, rows), rows], way: key, merge: { ways: key, ...(headHere && { a: key }) } });
      continue;
    }
    // Upper end first: for the order, what is depended on (`to`); else the end in the higher row.
    let [A, B] = [l.to, l.from];
    if (kind !== 'order' && where.get(A).row > where.get(B).row) [A, B] = [B, A];
    const head = (l.order ? l.from : l.to) === A ? 'a' : 'b';
    const [wa, wb] = [where.get(A), where.get(B)];
    if (wa.block === wb.block && !wa.single && wa.gutter === wb.gutter) {
      plans.push({ id: l.id, link: l, type: l.type, kind, head, a: { item: A }, b: { item: B }, bracket: `${wa.block}:${wa.gutter}`, rows: [], merge: {} });
      continue;
    }
    const a = endAt(A, 'down', where), b = wa.row === wb.row ? endAt(B, 'down', where) : endAt(B, 'up', where);
    // The order's wires out of one item merge, and every wire of a type into one item.
    const into = head === 'a' ? { a: `in:${l.type}:${A}` } : { b: `in:${l.type}:${B}` };
    const merge = kind === 'order' ? { a: `out:${A}`, b: `in:${l.type}:${B}` } : into;
    // Wires that merge into one item share their waypoints too: one line down the rows, not one each.
    const shared = merge[head], ways = range(a.street, b.street);
    plans.push({ id: l.id, link: l, type: l.type, kind, head, a, b, rows: ways, merge: shared && ways.length ? { ...merge, ways: shared } : merge, ...(shared && ways.length && { way: shared }) });
  }
  return plans;
}

/** What each gutter must hold: the vertical runs of the wires that use it, from an item's middle down, or a bracket. */
export function gutterRuns(plans, where, blocks, itemsById) {
  const bottom = new Map(blocks.map((b) => [b.id, b.h])), runs = new Map();
  const add = (gutter, key, lo, hi, ends) => (runs.get(gutter) ?? runs.set(gutter, []).get(gutter)).push({ key, lo, hi, ends });
  const mid = (id) => where.get(id).y + itemsById.get(id).h / 2;
  for (const p of plans) {
    if (p.bracket) {
      add(p.bracket, p.id, mid(p.a.item), mid(p.b.item), [{ at: mid(p.a.item), near: true }, { at: mid(p.b.item), near: true }]);
      continue;
    }
    for (const end of ['a', 'b']) {
      const e = p[end];
      if (e.side !== 'right') continue;
      add(e.gutter, p.merge[end] ?? `${p.id}:${end}`, mid(e.item), bottom.get(where.get(e.item).block), [{ at: mid(e.item), near: true }]);
    }
  }
  return runs;
}
