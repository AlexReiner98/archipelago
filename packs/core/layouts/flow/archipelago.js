// A picture of items on islands, one or more, set out as an archipelago (task e_auw7hb3v; one wiring system, inside islands and
// out: design e_87x2us2b, the owner, 6 Nov 2026). Every level is the flow's own layout, ports and all, and nothing is
// routed outside it: each island alone, to its frame; the sea, each island a box of its frame and each link between two a
// link of its own, which says the side each wire leaves its island by; each island again with its ports free on those
// sides, its own wires and those to its ports laid out at once; and the sea again, each wire's ends held by the solve
// where its island put its ports. A link across is three wires joined at two ports: inside one island, across the sea,
// inside the other; a finding's reads that leave by one port share the wire in to it, and its readers on one island share
// one port there and one wire across the sea. What lives on no island (a person) is a
// group of its own, with no shore. Layer: metrics. Pure: the answer and a layout in, one model of the whole picture out.

import { touch } from './count.js';
import { bridged } from './finish.js';
import { frameOf, insideOf, SIDES } from './ports.js';
import { tidy } from './polyline.js';

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

/** Entries of the given widths set out down columns no taller than `room`, a row each: each one's place, and the size of all. */
function columns(widths, room, gap, row) {
  const at = [], per = Math.max(1, Math.floor(room / row));
  let x = 0, wide = 0;
  widths.forEach((w, k) => {
    if (k && k % per === 0) (x += wide + gap), (wide = 0);
    at.push([x, (k % per) * row]);
    wide = Math.max(wide, w);
  });
  return { at, w: widths.length ? x + wide : 0, h: Math.min(widths.length, per) * row };
}

/** The sea's name for a group: what lives on no island is a box too. */
const seaId = (id) => id ?? 'none~';

/** Which of the top and foot of `box` (its middle and size) the point `p` is nearer, and how far along it, as a share of it. */
function sideOf(box, p) {
  // An island's ports stand on its top and its foot, where its own order lays them out (./ports.js): the one nearer.
  const [cx, cy, w, h] = box, d = { top: Math.abs(p[1] - (cy - h / 2)), bottom: Math.abs(p[1] - (cy + h / 2)) };
  const side = Object.keys(d).reduce((s, k) => (d[k] < d[s] ? k : s), 'top'), along = 1 - SIDES[side][0];
  return { side, share: Math.min(1, Math.max(0, (p[along] - (along ? cy - h / 2 : cx - w / 2)) / (along ? h : w))) };
}

/** Three wires joined into one line: where two meet in line, within half a pixel, they run on as one stretch. */
function joined(points) {
  const out = points.map((p) => [...p]);
  for (let i = 1; i < out.length; i++) for (const axis of [0, 1]) if (Math.abs(out[i][axis] - out[i - 1][axis]) < 0.5) out[i][axis] = out[i - 1][axis];
  return tidy(out);
}

/**
 * The whole picture: each group's model moved to its place, merged into one model as the flow's layout answers, with the
 * links between islands as ties (each with its `gates`, its ports where it crosses a shore, `sea`: its line from the
 * reader's gate to the finding's, and `toPort`: the finding's port it ends on, where it shares the wire in), and `islands`:
 * each one's frame as its land, where its name and each entry of its legend go. `legends` gives each island's entries'
 * widths, and `names` how wide its name is.
 */
export function compose({ groups, cross, where, run }, { legends, names = new Map(), sizes }) {
  const z = (name) => sizes[`flow_island_${name}`];
  const [PAD, NAME, SEA, GAP, ROW, PORT] = ['pad', 'name_room', 'sea', 'legend_gap', 'legend_row', 'port'].map(z);
  const M = sizes.flow_margin;
  // The first pass: each island alone, to its frame. Its legend stands in a column under its name down the island's left
  // side, where no port is and so no wire crosses it (the owner, 6 Nov 2026): as tall as its steps, in no more than
  // `legend_columns` columns.
  const blocks = groups.map((g) => {
    const shore = g.id !== null, widths = shore ? legends.get(g.id) ?? [] : [], inside = insideOf(g.model.raw);
    const legend = columns(widths, Math.max(inside.b - inside.t, ROW * Math.ceil(widths.length / z('legend_columns'))), GAP, ROW);
    const raw = g.model.raw;
    const framed = frameOf(raw, { name: shore ? names.get(g.id) ?? 0 : 0, legend, pad: PAD, room: NAME, gap: GAP });
    return { ...g, shore, legend, raw, ...framed, first: framed };
  });
  const byId = new Map(blocks.map((b) => [b.id, b]));
  const islandOf = (id) => where.get(id) ?? null;
  const reads = cross.filter((l) => byId.get(islandOf(l.from))?.raw.x.has(l.from) && byId.get(islandOf(l.to))?.raw.x.has(l.to));
  // A finding read by several items of one island crosses the sea once (the owner, 6 Nov 2026): those reads are one
  // bundle, one wire at sea, and they share a port on the readers' island as a finding's reads share one on its own.
  // Only reads of one link type, held or not alike, go together; a read to or from what lives on no island goes alone.
  const grouped = new Map();
  reads.forEach((l, n) => {
    const gated = byId.get(islandOf(l.from)).shore && byId.get(islandOf(l.to)).shore;
    const key = gated ? [l.to, islandOf(l.from), l.type ?? l.kind, Boolean(l.pending)].join('\n') : n;
    (grouped.get(key) ?? grouped.set(key, []).get(key)).push(l);
  });
  const bundles = [...grouped.values()];
  // The sea is one more level, laid out by the flow's own layers: each island a box of its frame, a sea apart, and each
  // link between two islands a link of its own. Given `held` ports, each link is a wire between two of them.
  const first = (b) => b.items.map((i) => i.created_at).filter(Boolean).sort()[0];
  // At sea an island is its frame and what stands out of it, its ports and the names on them: no wire crosses either.
  const outline = (b) => b.box ?? b.frame, frameSize = (b) => [outline(b).r - outline(b).l, outline(b).b - outline(b).t];
  const middle = (b) => [(outline(b).l + outline(b).r) / 2, (outline(b).t + outline(b).b) / 2];
  const seaLevel = (held) => run({
    combed: true, apart: SEA,
    items: blocks.map((b) => ({ id: seaId(b.id), type: 'island', title: '', size: frameSize(b), ...(first(b) && { created_at: first(b) }) })),
    links: bundles.map(([l], k) => ({ type: `sea:${k}`, from: seaId(islandOf(l.from)), to: seaId(islandOf(l.to)) })),
    ...(held && { held, rewire: Object.fromEntries(wires.map((w) => [`sea:${w.k}`, w.ends.map((e) => `${e.id}#${w.k}`)])) }),
  });
  // First the sea alone: which side of its island each read leaves and comes in by.
  let sea = seaLevel();
  const boxOf = (b) => [sea.x.get(seaId(b.id)), sea.y.get(seaId(b.id)), ...frameSize(b)];
  const turn = blocks[0].raw.z.turn, slots = (n) => n + (n % 2);
  const wireOf = (ls, k, drawn) => {
    const l = ls[0], readers = [...new Set(ls.map((r) => r.from))];
    const t = sea.ties.find((w) => w.type === `sea:${k}`), ends = [l.from, l.to].map(islandOf).map((id) => byId.get(id));
    const sketch = drawn ?? t?.points ?? ends.map((b) => boxOf(b).slice(0, 2));
    // A finding read across leaves its island by one port on each side, for all its reads that leave by it; a bundle's
    // readers come in by one port, a bar along its side as wide as their wires a wire apart. Every port is small: the
    // finding itself is outlined in its island's colour (./islands.js).
    const gated = ends.every((b) => b.shore);
    return {
      l, k, gated, readers, sketch, ends: ends.map((b, e) => {
        const { side, share } = sideOf(boxOf(b), e ? sketch.at(-1) : sketch[0]), shared = Boolean(e && gated), bundled = !e && readers.length > 1;
        const size = [PORT, PORT];
        if (bundled) size[1 - SIDES[side][0]] += (slots(readers.length) - 1) * turn;
        return { block: b, side, to: e ? l.to : bundled ? readers : l.from, id: shared ? `\u0000find:${l.to}:${side}` : `\u0000port:${k}:${e}`, size, shared, bundled, share };
      }),
    };
  };
  const wires = bundles.map((ls, k) => wireOf(ls, k));
  // Each island's ports and its header, as it is laid out again: `known` says where along its side each port's wires
  // come at sea, where the islands laid out before it have said.
  const box = (r) => [r.r - r.l, r.b - r.t];
  const headerOf = (b) => {
    const [nw, nh] = b.first.named ? box(b.first.named) : [0, 0], [kw, kh] = b.first.keyed ? box(b.first.keyed) : [0, 0], under = nh && kh ? GAP : 0;
    return { nw, nh, kw, kh, under, extras: nh || kh ? [{ id: '\u0000header', size: [Math.max(nw, kw), nh + under + kh] }] : [] };
  };
  const portsFor = (b, known = new Map()) => [...new Map(wires.flatMap((w) => w.ends.filter((e) => e.block === b)).map((e) => [e.id, { id: e.id, side: e.side, to: e.to, size: e.size, small: true, share: known.has(e.id) ? known.get(e.id)[0] / known.get(e.id)[1] : e.share }])).values()];
  // A trial: each island with a bundle laid out once. A reader whose wire to the bundle's bar would come through another
  // step (one reader stood over another) reads apart, a wire of its own, and the island is tried again.
  for (const b of blocks) {
    // Each split leaves the bundle a reader's own read, so this ends.
    for (;;) {
      const mine = wires.filter((w) => w.ends[0].bundled && w.ends[0].block === b);
      if (!mine.length) break;
      const trial = run({ items: b.items, links: b.links, ports: portsFor(b), extras: headerOf(b).extras });
      const steps = [...trial.x.keys()].filter((id) => !trial.nodes.get(id).dummy).map((id) => { const n = trial.nodes.get(id); return { id, l: trial.x.get(id) - n.w / 2, r: trial.x.get(id) + n.w / 2, t: trial.y.get(id) - n.h / 2, b: trial.y.get(id) + n.h / 2 }; });
      const meets = (p, q, s) => Math.max(p[0], q[0]) > s.l && Math.min(p[0], q[0]) < s.r && Math.max(p[1], q[1]) > s.t && Math.min(p[1], q[1]) < s.b;
      // Or whose readers the solve could not part: one stands on another step.
      const box = (id) => steps.find((s) => s.id === id), crowded = (id) => steps.some((s) => s.id !== id && meets([box(id).l, box(id).t], [box(id).r, box(id).b], s));
      const found = mine.flatMap((w) => [...(trial.ported.get(w.ends[0].id)?.lines ?? [])].filter(([id, l]) => (box(id) && crowded(id)) || l.some((p, i) => i && steps.some((s) => s.id !== id && meets(l[i - 1], p, s)))).map(([id]) => [w, id]))[0];
      if (!found) break;
      // Only that reader goes apart; the rest still share their wire.
      const [w, id] = found;
      bundles.push(bundles[w.k].filter((l) => l.from === id));
      bundles[w.k] = bundles[w.k].filter((l) => l.from !== id);
      wires[w.k] = wireOf(bundles[w.k], w.k, w.sketch);
      wires.push(wireOf(bundles.at(-1), bundles.length - 1, w.sketch));
    }
  }
  // A port two or more bundles of a finding's reads leave by is shared: a bar along its side, each landing on it a wire
  // apart and none in line with the wire in, which leaves from its middle. A finding read once by a side has a port of its own.
  const landing = new Map();
  for (const e of wires.flatMap((w) => w.ends)) if (e.shared) landing.set(e.id, (landing.get(e.id) ?? 0) + 1);
  for (const w of wires) {
    const e = w.ends[1];
    if (!e.shared) continue;
    if (landing.get(e.id) < 2) Object.assign(e, { shared: false, id: `\u0000port:${w.k}:1` });
    else e.size = e.size.map((s, i) => (i === 1 - SIDES[e.side][0] ? s + (slots(landing.get(e.id)) - 1) * turn : s));
  }
  // A reader's wire that steps aside just before its bundle's bar comes straight on to the bar instead, where that is
  // a wire clear of the others on it and touches no other wire: the bar is as long as its wires need (`reach`).
  const RUN = sizes.flow_port_run;
  const straighten = (b) => {
    const all = [...b.ported.ported.values()].flatMap((p) => [...p.lines.values()]), drawn = [...b.ported.chains, ...b.ported.ties].map((w) => w.points);
    for (const e of new Set(wires.map((w) => w.ends[0]).filter((e) => e.bundled && e.block === b))) {
      const p = b.ported.ported.get(e.id), [axis] = SIDES[e.side], along = 1 - axis;
      if (!p) continue;
      for (const [id, l] of p.lines) {
        const [p0, p1, p2, p3, ...more] = tidy(l.map((q) => [...q]));
        const others0 = [...p.lines].filter(([o]) => o !== id).map(([, o]) => o), rest0 = [...drawn, ...all.filter((o) => o !== l)];
        // A wire that runs a little along the shore from its landing before it turns in: it lands where it turns, or
        // turns in at its landing.
        if (p2 && Math.abs(p1[axis] - p0[axis]) < 0.5 && Math.abs(p1[along] - p0[along]) > 0.5 && Math.abs(p1[along] - p0[along]) < RUN && Math.abs(p2[along] - p1[along]) < 0.5) {
          const turned = [...p0];
          turned[axis] = p2[axis];
          const tries = [
            !others0.some((o) => Math.abs(o[0][along] - p1[along]) < turn / 2 - 0.5) && [p1, p2, ...(p3 ? [p3, ...more] : [])],
            p3 && Math.abs(p3[axis] - p2[axis]) < 0.5 && !rest0.some((o) => touch([p0, turned, p3], o)) && [p0, turned, p3, ...more],
          ];
          const kept = tries.find(Boolean);
          if (kept) (p.lines.set(id, kept), (all[all.indexOf(l)] = kept));
          continue;
        }
        if (!p3 ||Math.abs(p1[along] - p0[along]) > 0.5 || Math.abs(p2[axis] - p1[axis]) > 0.5 || Math.abs(p3[along] - p2[along]) > 0.5) continue;
        const step = Math.abs(p2[along] - p1[along]);
        if (step < 0.5 || step >= RUN) continue;
        // Either the landing moves along the bar to where the wire comes down, or, where that is another's, the wire
        // comes down to the landing where it is: the bend after the step moves over.
        const others = [...p.lines].filter(([o]) => o !== id).map(([, o]) => o), rest = [...drawn, ...all.filter((o) => o !== l)];
        const at = [...p0];
        at[along] = p2[along];
        const bend = [...p3];
        bend[along] = p0[along];
        const tries = [
          !others.some((o) => Math.abs(o[0][along] - at[along]) < turn / 2 - 0.5) && !rest.some((o) => touch([at, p2], o)) && [at, p3, ...more],
          more[0] && Math.abs(more[0][axis] - p3[axis]) < 0.5 && !rest.some((o) => touch([p0, bend, more[0]], o)) && [p0, bend, ...more],
        ];
        const kept = tries.find(Boolean);
        if (!kept) continue;
        p.lines.set(id, kept);
        all[all.indexOf(l)] = kept;
      }
    }
  };
  // Then each island laid out again with its ports free on those sides, its name and its legend boxes of it, so its own
  // wires and those to its ports are laid out at once, by the same layers.
  // The island with the most ports first, by the sea's sketch; each after it orders its ports by where those they are wired
  // to already stand, so the two ends of a bundle agree.
  const portsOf = (b) => new Set(wires.flatMap((w) => w.ends.filter((e) => e.block === b).map((e) => e.id))).size;
  const sharesOf = (b) => {
    const sum = new Map();
    for (const w of wires) w.ends.forEach((e, k) => {
      const o = w.ends[1 - k], at = o.block.ported?.ported.get(o.id)?.at;
      if (e.block !== b || !at) return;
      const along = 1 - SIDES[e.side][0], [ox, oy] = boxOf(o.block), [bx, by, bw, bh] = boxOf(b), mid = middle(o.block);
      const abs = (along ? oy : ox) + at[along] - mid[along], share = (abs - ((along ? by : bx) - (along ? bh : bw) / 2)) / (along ? bh : bw);
      const s0 = sum.get(e.id) ?? [0, 0];
      sum.set(e.id, [s0[0] + share, s0[1] + 1]);
    });
    return sum;
  };
  for (const b of [...blocks].sort((p, q) => portsOf(q) - portsOf(p))) {
    const ports = portsFor(b, sharesOf(b));
    // Its header is one box, its name over its legend, so the two stand together wherever the solve puts it.
    const { nw, nh, kw, kh, under, extras } = headerOf(b);
    b.ported = ports.length ? run({ items: b.items, links: b.links, ports, extras }) : null;
    if (b.ported) ({ frame: b.frame, model: b.model } = { frame: b.ported.frame, model: b.ported });
    if (b.ported) {
      const sizeOf = new Map(ports.map((p) => [p.id, p.size])), r = [b.frame, ...[...b.ported.ported].map(([id, p]) => ({ l: p.at[0] - sizeOf.get(id)[0] / 2, t: p.at[1] - sizeOf.get(id)[1] / 2, r: p.at[0] + sizeOf.get(id)[0] / 2, b: p.at[1] + sizeOf.get(id)[1] / 2 }))];
      b.box = { l: Math.min(...r.map((q) => q.l)), t: Math.min(...r.map((q) => q.t)), r: Math.max(...r.map((q) => q.r)), b: Math.max(...r.map((q) => q.b)) };
    }
    if (b.ported) straighten(b);
    const head = b.ported?.placed.header;
    if (head) [b.named, b.keyed] = [nh ? { l: head.l, t: head.t, r: head.l + nw, b: head.t + nh } : null, kh ? { l: head.l, t: head.t + nh + under, r: head.l + kw, b: head.b } : null];
  }
  // Then the sea again, each port held where its island put it: the islands placed and every wire at sea laid out by the
  // same layers as inside, out of its port and between them.
  // Each wire's end is held at its own point: where its island put its port, and, where a finding's reads share its
  // port, spread across it a wire apart, off its middle.
  const held = [];
  for (const b of blocks) for (const [id, p] of b.ported?.ported ?? []) {
    const along = 1 - SIDES[wires.find((w) => w.ends.some((e) => e.id === id)).ends.find((e) => e.id === id).side][0];
    // On a bar, each read in the order its other end stands along the same way, so the reads leave it without crossing.
    const far = (w) => { const o = w.ends.find((e) => e.id !== id), at = o.block.ported?.ported.get(o.id)?.at; return at ? boxOf(o.block)[along] + at[along] - middle(o.block)[along] : boxOf(o.block)[along]; };
    const using = wires.filter((w) => w.ends.some((e) => e.id === id)).sort((p, q) => far(p) - far(q));
    using.forEach((w, j) => {
      const e = w.ends.find((v) => v.id === id), at = [p.at[0] - middle(b)[0], p.at[1] - middle(b)[1]];
      // A bundle's one wire leaves its bar nearest its middle where none of its readers' wires comes to it.
      if (e.bundled) {
        const lands = [...p.lines.values()].map((l) => l[0][along] - p.at[along]);
        e.leave = Array.from({ length: 2 * slots(lands.length) + 1 }, (_, i) => ((i % 2 ? -1 : 1) * Math.ceil(i / 2) * turn) / 2).find((d) => lands.every((v) => Math.abs(v - d) >= turn / 2 - 0.5)) ?? 0;
        const ends = [...lands, e.leave], half = e.size[along] / 2;
        e.reach = [Math.min(-half, Math.min(...ends) - PORT / 2), Math.max(half, Math.max(...ends) + PORT / 2)];
      }
      at[along] += e.bundled ? e.leave : (j - ((using.length > 1 ? slots(using.length) : 1) - 1) / 2) * turn;
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
  const inner = (e, id) => { const p = e.block.ported.ported.get(e.id); return (p.lines.get(id) ?? p.points).map(move(e.block)); };
  // A shared port is where its wires meet, on its outer edge: its bar is drawn there, and the wire on starts there.
  // That is on its island's side at sea, in line with the port: the port's outer edge, or past it where a step stands out.
  const shoreAt = (e) => {
    const [axis, out] = SIDES[e.side], p = portAt(e), box = outline(e.block);
    p[axis] = (out < 0 ? (axis ? box.t : box.l) : axis ? box.b : box.r) + (axis ? e.block.dy : e.block.dx);
    return p;
  };
  const routed = [], shared = new Set();
  for (const w of wires) {
    const t = sea.ties.find((v) => v.type === `sea:${w.k}`);
    if (!t) continue;
    const [a, c] = [w.l.from, w.l.to], [into, out] = w.ends, type = w.l.type ?? w.l.kind, held = w.l.pending && { pending: w.l.pending };
    // The wire at sea leaves each end straight out of its port's side, in line with where the wire inside comes to it:
    // a few px apart along the shore, the first stretch moves over to it, so the two meet at a right angle.
    const over = t.points.map((p) => [...p]);
    const meet = (line, e, to) => {
      const along = 1 - SIDES[e.side][0], [p, q] = line;
      if (!q || Math.abs(p[along] - to[along]) < 0.5 || Math.abs(p[along] - to[along]) > turn || Math.abs(p[along] - q[along]) > 0.5) return;
      p[along] = q[along] = to[along];
    };
    if (!into.bundled) meet(over, into, inner(into, a)[0]);
    if (!out.shared) meet([...over].reverse(), out, inner(out, c)[0]);
    // A bundle's readers each come to its bar by a wire of their own, carried on to the shore where the one wire at sea
    // leaves it; the head is that wire's, at the finding.
    if (into.bundled) for (const r of w.readers) {
      const [axis] = SIDES[into.side], line = inner(into, r).reverse(), end = [...line.at(-1)];
      end[axis] = shoreAt(into)[axis];
      ties.push({ a: r, b: c, toPort: into.id, type, headAt: 'end', points: joined([...line, end]), ...held });
    }
    // Reads of one finding that leave by one port share the wire in to it: drawn once, the rest each their own.
    const leaves = () => { const p = shoreAt(into); p[1 - SIDES[into.side][0]] += into.leave ?? 0; return p; };
    const points = joined([...(into.bundled ? [leaves()] : inner(into, a).reverse()), ...over, ...(out.shared ? [] : inner(out, c))]);
    if (out.shared && !shared.has(out.id)) (shared.add(out.id), ties.push({ a, b: c, fromPort: out.id, type, headAt: 'end', points: joined([shoreAt(out), ...inner(out, c)]), ...held }));
    const way = (e) => SIDES[e.side][0] ? [0, SIDES[e.side][1]] : [SIDES[e.side][1], 0];
    const gateOf = (e) => {
      const along = 1 - SIDES[e.side][0], at = e.shared || e.bundled ? shoreAt(e) : portAt(e);
      if (!e.reach) return { at, span: e.size[along] };
      at[along] += (e.reach[0] + e.reach[1]) / 2;
      return { at, span: e.reach[1] - e.reach[0] };
    };
    const gates = w.gated ? w.ends.map((e) => ({ island: e.block.id, ...gateOf(e), way: way(e) })) : [];
    const tie = { a, b: c, type, headAt: 'end', points, crossing: true, gates, ...(into.bundled && { fromPort: into.id }), ...(out.shared && { toPort: out.id }), ...(w.gated && { sea: over }), ...held };
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
