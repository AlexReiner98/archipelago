// Layer: metrics. One island laid out by rows, each step its own module and each told to `stage` for the explainer:
// blocks (./blocks.js), rows (./ranks.js), plans (./plan.js), each block's shape (./shape.js), places across with the
// straightening passes (./place.js), streets (./streets.js), and points (./route.js). Pure: the island's items, every
// link touching them and the style's lengths in; places, wires, part lines and ports on the island's foot out, from
// the island's top left.

import { blocksOf } from './blocks.js';
import { gutterRuns, plansOf, whereOf } from './plan.js';
import { placed } from './place.js';
import { linesOf, ranksOf } from './ranks.js';
import { bracket, routed } from './route.js';
import { shapeOf } from './shape.js';
import { streetsOf } from './streets.js';

const byMade = (p, q) => (p.made < q.made ? -1 : p.made > q.made ? 1 : p.id < q.id ? -1 : p.id > q.id ? 1 : 0);

export function islandOf(items, links, z, stage = () => {}, homeOf = () => '') {
  const itemsById = new Map(items.map((i) => [i.id, i]));
  const blocks = blocksOf(items, links, z), blockOf = new Map(blocks.flatMap((b) => b.members.map((m) => [m, b.id])));
  stage('blocks', { blocks: blocks.map((b) => ({ id: b.id, members: b.members, columns: b.columns.length })) });
  const ranked = ranksOf(blocks, links, blockOf), { row, back } = ranked;
  // What the order does not place wraps in lines under it, as wide as the widest row or the picture's shape asks.
  const bare = new Map(blocks.map((b) => [b.id, shapeOf(b, itemsById, new Map(), z)]));
  const across = new Map();
  for (const b of blocks) if (ranked.ordered.has(b.id)) across.set(row.get(b.id), (across.get(row.get(b.id)) ?? -z.gap) + z.gap + bare.get(b.id).w);
  const area = blocks.reduce((t, b) => t + bare.get(b.id).w * bare.get(b.id).h, 0);
  const rows = linesOf(blocks, ranked, (b) => bare.get(b.id).w, Math.max(0, ...across.values(), Math.sqrt(area * z.aspect)), z.gap);
  stage('rows', { row: Object.fromEntries(row), back: [...back] });
  const where = whereOf(blocks, row), plans = plansOf({ links, where, back, rows, islandOf: homeOf });
  const way = (p, r) => `${p.way ?? p.id}@${r}`;
  const ports = plans.some((p) => p.kind === 'out'), lines = rows + (ports ? 1 : 0);
  stage('plans', { plans: plans.map((p) => ({ id: p.id, kind: p.kind, rows: p.rows, bracket: p.bracket ?? null })) });
  const runs = gutterRuns(plans, where, blocks, itemsById), shapes = new Map(blocks.map((b) => [b.id, shapeOf(b, itemsById, runs, z)]));
  stage('shapes', { blocks: Object.fromEntries([...shapes].map(([id, s]) => [id, { w: s.w, h: s.h }])) });
  // Each row: its blocks made first, then the waypoints of the wires crossing it, those that end soonest first.
  const table = Array.from({ length: lines }, () => []);
  for (const b of [...blocks].sort(byMade)) table[row.get(b.id)].push({ id: b.id, w: shapes.get(b.id).w });
  const crossing = plans.filter((p) => p.rows.length).sort((p, q) => p.rows.at(-1) - q.rows.at(-1) || p.rows[0] - q.rows[0]);
  const listed = new Set();
  for (const p of crossing) for (const r of p.rows) if (!listed.has(way(p, r))) (listed.add(way(p, r)), table[r].push({ id: way(p, r), w: 0, way: true }));
  // Where along its entry each end stands: its share of the side it leaves an item's top or foot by, else its lane.
  let share = new Map();
  const relX = (e, p, end) => {
    const s = shapes.get(where.get(e.item).block), at = s.at.get(e.item);
    return e.side === 'right' ? s.lane.get(p.merge[end] ?? `${p.id}:${end}`) : at.x + itemsById.get(e.item).w * (share.get(`${p.id}:${end}`) ?? 1 / 2);
  };
  const entryOf = (e) => where.get(e.item).block;
  // Placed twice: once with every end at its side's middle, to see the order the ends of one side go in, then again
  // with each at its share of the side, so what is straightened is where the wires leave.
  const lay = () => {
  const ties = [];
  for (const p of plans) {
    if (p.bracket) continue;
    const chain = [{ id: entryOf(p.a), dx: relX(p.a, p, 'a') }, ...p.rows.map((r) => ({ id: way(p, r), dx: 0 })), ...(p.b.port ? [] : [{ id: entryOf(p.b), dx: relX(p.b, p, 'b') }])];
    for (let k = 0; k + 1 < chain.length; k++) {
      const [u, d] = [chain[k], chain[k + 1]], ends = k === 0 || k + 2 === chain.length;
      if (p.kind !== 'order' && ends) continue;
      ties.push({ up: u.id, upDx: u.dx, down: d.id, downDx: d.dx });
    }
  }
  const x = placed(table, ties, z, stage);
  // A port stands under where its wires come down from, the rightmost of them, and never on another.
  if (ports) {
    const from = new Map();
    for (const p of plans.filter((q) => q.kind === 'out')) {
      const above = p.rows.length > 1 ? x.get(way(p, p.rows.at(-2))) : x.get(entryOf(p.a)) + relX(p.a, p, 'a');
      from.set(way(p, rows), Math.max(from.get(way(p, rows)) ?? -Infinity, above));
    }
    let least = -Infinity;
    for (const [id, at] of [...from].sort((p, q) => p[1] - q[1])) (x.set(id, Math.max(at, least)), (least = x.get(id) + z.lane));
  }
  // Every end's geometry; ends that leave one side of one item share it, spread in the order of where they go.
  const boxOf = (id) => {
    const b = where.get(id).block, at = shapes.get(b).at.get(id), i = itemsById.get(id);
    return { x: x.get(b) + at.x, y: at.y, w: i.w, h: i.h };
  };
  const wires = plans.filter((p) => !p.bracket).map((p) => {
    const geo = (e, end) => (e.port ? { side: 'port', row: rows, x: x.get(way(p, rows)) } : { side: e.side, item: e.item, row: where.get(e.item).row, box: boxOf(e.item), x: x.get(entryOf(e)) + relX(e, p, end) });
    const [a, b] = [geo(p.a, 'a'), geo(p.b, 'b')];
    return { id: p.id, plan: p, a, b, street: p.a.street, merge: p.merge, stops: [a.x, ...p.rows.map((r) => x.get(way(p, r))), b.x] };
  });
  return { x, wires };
  };
  share = spread(lay().wires);
  const { x, wires } = lay();
  dodged(wires, z.track);
  const heights = table.map((list, r) => Math.max(0, ...list.filter((e) => !e.way).map((e) => shapes.get(e.id).h)));
  if (ports) heights[rows] = 0;
  const streets = streetsOf(heights, wires, z);
  stage('streets', { rowY: streets.rowY, streetH: streets.streetH });
  const places = new Map();
  for (const b of blocks) for (const [id, at] of shapes.get(b.id).at) places.set(id, { x: x.get(b.id) + at.x, y: streets.rowY[row.get(b.id)] + at.y, w: itemsById.get(id).w, h: itemsById.get(id).h });
  const drawn = wires.map((w) => ({ ...w, points: routed({ ...w, track: streets.track.get(w.id) }, streets.rowY) }));
  for (const p of plans.filter((q) => q.bracket)) {
    const s = shapes.get(where.get(p.a.item).block), lx = x.get(where.get(p.a.item).block) + s.lane.get(p.id);
    drawn.push({ id: p.id, plan: p, points: bracket(places.get(p.a.item), places.get(p.b.item), lx) });
  }
  const parts = blocks.flatMap((b) => shapes.get(b.id).spines.map((s) => ({ ...s, points: s.points.map(([px, py]) => [x.get(b.id) + px, streets.rowY[row.get(b.id)] + py]) })));
  const width = Math.max(0, ...table.flat().map((e) => x.get(e.id) + e.w));
  stage('wires', { wires: drawn.map((w) => ({ id: w.id, points: w.points })) });
  return {
    w: width, h: streets.bottom, places, parts,
    wires: drawn.map((w) => ({ id: w.id, link: w.plan.link, type: w.plan.type, kind: w.plan.kind, head: w.plan.head, start: w.plan.a.item, points: w.points })),
    ports: drawn.filter((w) => w.plan.kind === 'out').map((w) => ({ id: w.id, key: w.plan.b.key, x: w.points.at(-1)[0], other: w.plan.b.other })),
  };
}

/**
 * A wire that drops into an item's top moves along it, off any other wire's line in that street: a line that comes
 * down to its track there would otherwise run on, or beside, the one that goes on down. All of one merge move as one.
 */
function dodged(wires, apart) {
  const up = new Map(), tops = new Map();
  const add = (street, x, item) => (up.get(street) ?? up.set(street, []).get(street)).push({ x, item });
  for (const w of wires) {
    const last = w.stops.length - 1;
    if (w.a.side !== 'top') add(w.street, w.stops[0], w.a.item);
    for (let k = 1; k < last; k++) add(w.street + k, w.stops[k], null);
    const group = `${w.b.item} ${w.merge.b ?? w.id}`;
    if (w.b.side === 'top') (tops.get(group) ?? tops.set(group, []).get(group)).push(w);
    else if (w.b.side !== 'port') add(w.street + last - 1, w.stops[last], w.b.item);
  }
  for (const [group, list] of tops) {
    const g = list[0].b, item = g.item, street = list[0].street + list[0].stops.length - 2;
    // Every other line in the street, and the other groups' drops into this item.
    const others = [...tops].filter(([k, l]) => k !== group && l[0].b.item === item).map(([, l]) => ({ x: l[0].b.x, item: null }));
    const near = [...(up.get(street) ?? []).filter((u) => u.item !== item), ...others];
    const room = (x) => Math.min(Infinity, ...near.map((u) => Math.abs(u.x - x)));
    if (room(g.x) >= apart) continue;
    // The point along its middle half that stands furthest from every other line, in steps of half the spacing.
    const [lo, hi] = [g.box.x + g.box.w / 4, g.box.x + (g.box.w * 3) / 4];
    let best = g.x;
    for (let at = lo; at <= hi; at += apart / 2) if (room(at) > room(best)) best = at;
    for (const w of list) (w.b.x = best), (w.stops[w.stops.length - 1] = best);
  }
}

/** Ends that leave by one item's top or foot share that side, each its own point (merged ones one), spread in order: each end's share of the side, by wire and end. */
function spread(wires) {
  const share = new Map();
  const sides = new Map();
  for (const w of wires) for (const [end, near] of [['a', 1], ['b', -2]]) {
    const g = w[end];
    if (g.side !== 'top' && g.side !== 'bottom') continue;
    const key = `${g.item} ${g.side}`, group = w.merge[end] ?? `${w.id}:${end}`;
    (sides.get(key) ?? sides.set(key, []).get(key)).push({ w, end, group, toward: w.stops.at(near) });
  }
  for (const list of sides.values()) {
    const groups = [...new Set(list.sort((p, q) => p.toward - q.toward).map((e) => e.group))];
    for (const e of list) {
      share.set(`${e.w.id}:${e.end}`, (groups.indexOf(e.group) + 1) / (groups.length + 1));
    }
  }
  return share;
}
