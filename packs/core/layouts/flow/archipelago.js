// A picture of more than one island, set out as an archipelago (task e_auw7hb3v; one wiring system, inside islands and
// out: design e_87x2us2b, the owner, 6 Nov 2026). Every level is the flow's own layout, ports and all, and nothing is
// routed outside it: each island alone, to its frame; the sea, each island a box of its frame and each link between two a
// link of its own, which says the side each wire leaves its island by; each island again with its ports free on those
// sides, its own wires and those to its ports laid out at once; and the sea again, each wire's ends held by the solve
// where its island put its ports. A link across is three wires joined at two ports: inside one island, across the sea,
// inside the other. A finding is named on its port where it leaves its island. What lives on no island (a person) is a
// group of its own, with no shore. Layer: metrics. Pure: the answer and a layout in, one model of the whole picture out.

import { bridged } from './finish.js';
import { frameOf, insideOf, SIDES } from './ports.js';

/** The islands an answer's items live on, in the order they come. */
export const islandsOf = (items) => [...new Set(items.map((i) => i.island).filter(Boolean))];

/** Each island's items laid out alone by `run` (the flow's layout), and the links that join two of them. */
export function islandModels({ items, links, run }) {
  const where = new Map(items.map((i) => [i.id, i.island ?? null]));
  const ids = [...islandsOf(items), ...(items.some((i) => !i.island) ? [null] : [])];
  const groups = ids.map((id) => {
    const own = items.filter((i) => where.get(i.id) === id), set = new Set(own.map((i) => i.id)), inner = links.filter((l) => set.has(l.from) && set.has(l.to));
    return { id, items: own, links: inner, model: run({ items: own, links: inner }) };
  });
  const cross = links.filter((l) => where.has(l.from) && where.has(l.to) && where.get(l.from) !== where.get(l.to));
  return { groups, cross, where, run };
}

/** Entries of the given widths set out in lines no wider than `room`: each one's place, and the band's size. */
function band(widths, room, gap, row) {
  const at = [];
  let x = 0, y = 0, wide = 0;
  for (const w of widths) {
    if (x > 0 && x + w > room) (x = 0), (y += row);
    at.push([x, y]);
    x += w + gap;
    wide = Math.max(wide, x - gap);
  }
  return { at, w: wide, h: widths.length ? y + row : 0 };
}

/** The sea's name for a group: what lives on no island is a box too. */
const seaId = (id) => id ?? 'none~';

/** Which side of `box` (its middle and size) the point `p` stands on, and how far along that side, as a share of it. */
function sideOf(box, p) {
  const [cx, cy, w, h] = box, d = { top: Math.abs(p[1] - (cy - h / 2)), bottom: Math.abs(p[1] - (cy + h / 2)), left: Math.abs(p[0] - (cx - w / 2)), right: Math.abs(p[0] - (cx + w / 2)) };
  const side = Object.keys(d).reduce((s, k) => (d[k] < d[s] ? k : s), 'top'), along = 1 - SIDES[side][0];
  return { side, share: Math.min(1, Math.max(0, (p[along] - (along ? cy - h / 2 : cx - w / 2)) / (along ? h : w))) };
}

/**
 * The whole picture: each group's model moved to its place, merged into one model as the flow's layout answers, with the
 * links between islands as ties (each with its `gates`, its ports where it crosses a shore, `sea`: its line from the
 * reader's gate to the finding's, and `label`: the box that names what crosses), and `islands`: each one's frame as its
 * land, where its name and each entry of its legend go. `legends` gives each island's entries' widths, `names` how wide its
 * name is, and `labels` how wide the box naming what a link crosses with is.
 */
export function compose({ groups, cross, where, run }, { legends, names = new Map(), labels = () => 0, sizes }) {
  const z = (name) => sizes[`flow_island_${name}`];
  const [PAD, NAME, SEA, GAP, ROW, PORT, GATE] = ['pad', 'name_room', 'sea', 'legend_gap', 'legend_row', 'port', 'gate_height'].map(z);
  const M = sizes.flow_margin;
  // The first pass: each island alone, to its frame.
  const blocks = groups.map((g) => {
    const shore = g.id !== null, widths = shore ? legends.get(g.id) ?? [] : [], legend = band(widths, Math.max(insideOf(g.model.raw).r - insideOf(g.model.raw).l, z('legend_wide'), ...widths), GAP, ROW);
    const raw = g.model.raw;
    const framed = frameOf(raw, { name: shore ? names.get(g.id) ?? 0 : 0, legend, pad: PAD, room: NAME, gap: GAP });
    return { ...g, shore, legend, raw, ...framed, first: framed };
  });
  const byId = new Map(blocks.map((b) => [b.id, b]));
  const islandOf = (id) => where.get(id) ?? null;
  const reads = cross.filter((l) => byId.get(islandOf(l.from))?.raw.x.has(l.from) && byId.get(islandOf(l.to))?.raw.x.has(l.to));
  // The sea is one more level, laid out by the flow's own layers: each island a box of its frame, a sea apart, and each
  // link between two islands a link of its own. Given `held` ports, each link is a wire between two of them.
  const first = (b) => b.items.map((i) => i.created_at).filter(Boolean).sort()[0];
  // At sea an island is its frame and what stands out of it, its ports and the names on them: no wire crosses either.
  const outline = (b) => b.box ?? b.frame, frameSize = (b) => [outline(b).r - outline(b).l, outline(b).b - outline(b).t];
  const middle = (b) => [(outline(b).l + outline(b).r) / 2, (outline(b).t + outline(b).b) / 2];
  const seaLevel = (held) => run({
    combed: true, apart: SEA,
    items: blocks.map((b) => ({ id: seaId(b.id), type: 'island', title: '', size: frameSize(b), ...(first(b) && { created_at: first(b) }) })),
    links: reads.map((l, k) => ({ type: `sea:${k}`, from: seaId(islandOf(l.from)), to: seaId(islandOf(l.to)) })),
    ...(held && { held, rewire: Object.fromEntries(wires.map((w) => [`sea:${w.k}`, w.ends.map((e) => `${e.id}#${w.k}`)])) }),
  });
  // First the sea alone: which side of its island each read leaves and comes in by.
  let sea = seaLevel();
  const boxOf = (b) => [sea.x.get(seaId(b.id)), sea.y.get(seaId(b.id)), ...frameSize(b)];
  const wires = reads.map((l, k) => {
    const t = sea.ties.find((w) => w.type === `sea:${k}`), ends = [l.from, l.to].map(islandOf).map((id) => byId.get(id));
    const sketch = t?.points ?? ends.map((b) => boxOf(b).slice(0, 2));
    // A finding read across is named where it leaves its island: its port there is its name, one for all its reads
    // that leave by that side, and takes room on the frame as any box does. A reader's port is small, one to a read.
    const gated = ends.every((b) => b.shore), wide = gated ? labels(l) : 0;
    return {
      l, k, gated, ends: ends.map((b, e) => {
        const { side } = sideOf(boxOf(b), e ? sketch.at(-1) : sketch[0]), named = e && wide;
        return { block: b, side, to: e ? l.to : l.from, id: named ? `\u0000find:${l.to}:${side}` : `\u0000port:${k}:${e}`, size: named ? [wide, GATE] : [PORT, PORT], small: !named };
      }),
    };
  });
  // Then each island laid out again with its ports free on those sides, its name and its legend boxes of it, so its own
  // wires and those to its ports are laid out at once, by the same layers.
  for (const b of blocks) {
    const ports = [...new Map(wires.flatMap((w) => w.ends.filter((e) => e.block === b)).map((e) => [e.id, { id: e.id, side: e.side, to: e.to, size: e.size, small: e.small }])).values()];
    const box = (r) => [r.r - r.l, r.b - r.t];
    // Its header is one box, its name over its legend, so the two stand together wherever the solve puts it.
    const [nw, nh] = b.first.named ? box(b.first.named) : [0, 0], [kw, kh] = b.first.keyed ? box(b.first.keyed) : [0, 0], under = nh && kh ? GAP : 0;
    const extras = nh || kh ? [{ id: '\u0000header', size: [Math.max(nw, kw), nh + under + kh] }] : [];
    b.ported = ports.length ? run({ items: b.items, links: b.links, ports, extras }) : null;
    if (b.ported) ({ frame: b.frame, model: b.model } = { frame: b.ported.frame, model: b.ported });
    if (b.ported) {
      const sizeOf = new Map(ports.map((p) => [p.id, p.size])), r = [b.frame, ...[...b.ported.ported].map(([id, p]) => ({ l: p.at[0] - sizeOf.get(id)[0] / 2, t: p.at[1] - sizeOf.get(id)[1] / 2, r: p.at[0] + sizeOf.get(id)[0] / 2, b: p.at[1] + sizeOf.get(id)[1] / 2 }))];
      b.box = { l: Math.min(...r.map((q) => q.l)), t: Math.min(...r.map((q) => q.t)), r: Math.max(...r.map((q) => q.r)), b: Math.max(...r.map((q) => q.b)) };
    }
    const head = b.ported?.placed.header;
    if (head) [b.named, b.keyed] = [nh ? { l: head.l, t: head.t, r: head.l + nw, b: head.t + nh } : null, kh ? { l: head.l, t: head.t + nh + under, r: head.l + kw, b: head.b } : null];
  }
  // Then the sea again, each port held where its island put it: the islands placed and every wire at sea laid out by the
  // same layers as inside, out of its port and between them.
  // Each wire's end is held at its own point: where its island put its port, and, where a finding's reads share its
  // name, spread across it a wire apart.
  const held = [], turn = blocks[0].raw.z.turn;
  for (const b of blocks) for (const [id, p] of b.ported?.ported ?? []) {
    const using = wires.filter((w) => w.ends.some((e) => e.id === id)), along = 1 - SIDES[using[0].ends.find((e) => e.id === id).side][0];
    using.forEach((w, j) => {
      const e = w.ends.find((v) => v.id === id), at = [p.at[0] - middle(b)[0], p.at[1] - middle(b)[1]];
      at[along] += (j - (using.length - 1) / 2) * turn;
      // On the side of the island's box at sea, in line with its port: what stands out of the frame is part of that box.
      const [axis, out] = SIDES[e.side], box = outline(b);
      at[axis] = (out < 0 ? (axis ? box.t : box.l) : axis ? box.b : box.r) - middle(b)[axis];
      held.push({ id: `${id}#${w.k}`, on: seaId(b.id), at, side: e.side });
    });
  }
  sea = seaLevel(held);
  // Where each island stands: its frame's middle on its box's.
  for (const b of blocks) {
    const [cx, cy] = boxOf(b);
    b.dx = cx - middle(b)[0];
    b.dy = cy - middle(b)[1];
  }
  // One model: every place moved by its island's.
  const nodes = new Map(), x = new Map(), y = new Map(), chains = [], ties = [], all = [], potential = new Set();
  const move = (b) => (p) => [p[0] + b.dx, p[1] + b.dy];
  for (const b of blocks) {
    const m = b.model, to = move(b);
    for (const [id, n] of m.nodes) if (m.x.has(id)) (nodes.set(id, n), x.set(id, m.x.get(id) + b.dx), y.set(id, m.y.get(id) + b.dy));
    all.push(...m.all);
    for (const id of m.potential) potential.add(id);
    const moved = (w) => ({ ...w, points: w.points.map(to), ...(w.gaps && { gaps: w.gaps.map(to) }) });
    chains.push(...m.chains.map(moved));
    ties.push(...m.ties.map(moved));
  }
  // Each link across: in from its reader to the reader's port, over the sea, and in from the finding's port to the finding.
  const portAt = (e) => move(e.block)(e.block.ported.ported.get(e.id).at);
  const inner = (e) => e.block.ported.ported.get(e.id).points.map(move(e.block));
  const routed = [], shared = new Set();
  for (const w of wires) {
    const t = sea.ties.find((v) => v.type === `sea:${w.k}`);
    if (!t) continue;
    const [a, c] = [w.l.from, w.l.to], over = t.points, named = w.ends[1];
    // Reads of one finding that leave by one name share the wire in to it: drawn once, the rest each their own.
    const points = [...inner(w.ends[0]).reverse(), ...over, ...(named.small ? inner(named) : [])];
    if (!named.small && !shared.has(named.id)) (shared.add(named.id), ties.push({ a, b: c, type: w.l.type ?? w.l.kind, headAt: 'end', points: inner(named), ...(w.l.pending && { pending: w.l.pending }) }));
    const way = (e) => SIDES[e.side][0] ? [0, SIDES[e.side][1]] : [SIDES[e.side][1], 0];
    const gates = w.gated ? w.ends.map((e) => ({ island: e.block.id, at: portAt(e), way: way(e), ...(!e.small && { port: e.id }) })) : [];
    const label = !named.small && { id: named.id, at: portAt(named), w: named.size[0] };
    const tie = { a, b: c, type: w.l.type ?? w.l.kind, headAt: 'end', points, crossing: true, gates, ...(label && { label }), ...(w.gated && { sea: over }), ...(w.l.pending && { pending: w.l.pending }) };
    routed.push(tie);
    ties.push(tie);
  }
  const shores = blocks.filter((b) => b.shore).map((b) => {
    const f = b.frame, land = { l: f.l + b.dx, t: f.t + b.dy, r: f.r + b.dx, b: f.b + b.dy };
    const name = b.named ? [b.named.l + b.dx, (b.named.t + b.named.b) / 2 + b.dy] : [land.l + PAD, land.t + PAD + NAME / 2];
    const lx = (b.keyed?.l ?? 0) + b.dx, ly = (b.keyed?.t ?? 0) + b.dy;
    return { id: b.id, land: [land], name, entries: b.legend.at.map(([ex, ey]) => [lx + ex, ly + ey]), steps: new Set(b.items.map((i) => i.id)) };
  });
  const extent = [...shores.map((s) => [s.land[0].r, s.land[0].b]), ...[...x.keys()].map((id) => [x.get(id) + nodes.get(id).w / 2, y.get(id) + nodes.get(id).h / 2]), ...routed.flatMap((t) => t.points)];
  // Where any two wires cross, inside an island or at sea, one passes under, as in any picture.
  const drawn = bridged({ chains, ties });
  return {
    nodes, all, chains: drawn.chains, ties: drawn.ties, breaks: drawn.breaks, potential, x, y,
    width: Math.max(...extent.map((p) => p[0])) + M, height: Math.max(...extent.map((p) => p[1])) + M,
    islands: shores,
  };
}
