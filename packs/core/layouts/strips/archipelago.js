// Strips on islands (task e_3svu8hbh): each island its own strip in a band (./bands.js), its name and legend over it,
// the bands side by side in the order their links run (a finding's island before its readers'), ties by when each was
// first made. A link between two islands leaves its step out of the side that faces the other and runs through the
// sea between (./sea.js); a finding's reads that leave by one side share its port there and one trunk in the sea
// (./bundle.js), each reader's own wire leaving it at a stop. In the flow's drawing this module stands where the flow's
// own archipelago does. Layer: metrics. Pure: the groups and their layout in, one model out.

import { band } from './bands.js';
import { bundle } from './bundle.js';
import { finish } from './land.js';
import { arrange, moved } from './layout.js';
import { sorted } from './model.js';
import { sea } from './sea.js';
import { stage } from './stage.js';

/** The islands an answer's items live on, in the order they come. */
export const islandsOf = (items) => [...new Set(items.map((i) => i.island).filter(Boolean))];

/** Each island's items laid out alone by `run` (this layout), for its legend, and the links that join two of them. */
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

/** The bands in the order their links run, a finding's island before its readers', ties by what was made first. */
function ordered(blocks, reads, islandOf) {
  const firstMade = (b) => b.items.map((i) => i.created_at).filter(Boolean).sort()[0] ?? '~';
  const made = new Map([...blocks].sort((p, q) => (firstMade(p) < firstMade(q) ? -1 : firstMade(p) > firstMade(q) ? 1 : 0)).map((b, k) => [b.id, k]));
  // An island is named here by its id, or `~` for what lives on no island.
  const named = (id) => id ?? '~';
  const ways = new Map(reads.map((l) => [`${named(islandOf(l.to))} ${named(islandOf(l.from))}`, 1]));
  const place = new Map(sorted(blocks.map((b) => named(b.id)), ways, (id) => made.get(id === '~' ? null : id)).map((id, k) => [id, k]));
  return [...blocks].sort((p, q) => place.get(named(p.id)) - place.get(named(q.id)));
}

/** The whole picture: the bands set out, every link across a lane of the sea, one model as the flow's scene reads it. */
export function compose({ groups, cross, where }, { legends, names = new Map(), sizes }) {
  const SEA = sizes.flow_island_sea, M = sizes.flow_margin, PORT = sizes.flow_island_port;
  const islandOf = (id) => where.get(id) ?? null;
  const all = groups.map((g) => ({ ...g, shore: g.id !== null, args: g.model.raw.args }));
  const reads = cross.filter((l) => all.some((b) => b.id === islandOf(l.from) && b.model.nodes.has(l.from)) && all.some((b) => b.id === islandOf(l.to) && b.model.nodes.has(l.to)));
  const blocks = ordered(all, reads, islandOf);
  stage('bands', { order: blocks.map((b) => b.id) });
  // Each read's two ends: the one on the band further left leaves by its right side, the other comes in by its left.
  // A finding's reads that leave by one side share its port there (`share`).
  const blockOf = new Map(blocks.map((b, k) => [b.id, k]));
  const routes = reads.map((l, k) => {
    const [p, q] = [l.from, l.to].map((id) => blockOf.get(islandOf(id))), [left, right] = p < q ? [l.from, l.to] : [l.to, l.from];
    const at = left === l.to ? 'l' : 'r', share = `f:${l.to}:${at}`;
    return { l, key: `r${k}`, left, right, i: Math.min(p, q), j: Math.max(p, q), share, at, keyL: at === 'l' ? share : `r${k}:l`, keyR: at === 'r' ? share : `r${k}:r` };
  });
  const yOf = (id) => blocks[blockOf.get(islandOf(id))].model.y.get(id);
  for (const b of blocks) {
    const outside = new Map();
    for (const r of routes) {
      if (blocks[r.i] === b) outside.set(r.keyL, { key: r.keyL, id: r.left, side: 'right', up: yOf(r.right) < yOf(r.left) });
      if (blocks[r.j] === b) outside.set(r.keyR, { key: r.keyR, id: r.right, side: 'left', up: yOf(r.left) < yOf(r.right) });
    }
    // Side by side, each band is cut toward its share of the picture's shape.
    b.laid = arrange({ ...b.args, outside: [...outside.values()], aspect: (b.args.aspect ?? 1.6) / blocks.length });
    const { l, t, r, b: foot } = b.laid.extent;
    b.band = band({ w: r - l, h: foot - t }, { name: b.shore ? names.get(b.id) ?? 0 : 0, legend: b.shore ? legends.get(b.id) ?? [] : [], shore: b.shore, sizes });
  }
  // The sea: each read's ends where its lines leave its band's steps, every band's top at 0.
  const bandY = (b, p) => p[1] - b.laid.extent.t + b.band.content[1];
  const leaves = (k, key) => bandY(blocks[k], blocks[k].laid.ports.get(key).at(-1));
  const s = sea({ widths: blocks.map((b) => b.band.w), routes: routes.map((r) => ({ key: r.key, i: r.i, j: r.j, yl: leaves(r.i, r.keyL), yr: leaves(r.j, r.keyR), share: r.share, at: r.at })), sizes, least: SEA });
  stage('sea', { left: s.left, over: s.over });
  const top = M + s.over;
  // Every place and wire moved into its band, the bands set down under the tracks.
  const nodes = new Map(), x = new Map(), y = new Map(), chains = [], ties = [], potential = new Set(), shores = [];
  blocks.forEach((b, k) => {
    const left = M + s.left[k], dx = left + b.band.content[0] - b.laid.extent.l, dy = top + b.band.content[1] - b.laid.extent.t;
    b.at = moved(b.laid, dx, dy);
    for (const [id, n] of b.laid.m.nodes) if (b.at.x.has(id)) (nodes.set(id, n), x.set(id, b.at.x.get(id)), y.set(id, b.at.y.get(id)));
    for (const id of b.laid.m.potential) potential.add(id);
    chains.push(...b.at.chains);
    ties.push(...b.at.ties);
    b.land = { l: left, t: top, r: left + b.band.w, b: top + b.band.h };
    if (!b.shore) return;
    const to = (p) => [p[0] + left, p[1] + top];
    shores.push({ id: b.id, land: [b.land], name: b.band.name ? to(b.band.name) : [b.land.l, b.land.t], entries: b.band.entries.map(to), steps: new Set(b.items.map((i) => i.id)) });
  });
  // Each read: out of its step, through the sea, into the other; its points from reader to finding, and a gate on each
  // shore it crosses.
  const drawn = routes.map((r) => {
    const into = blocks[r.i].at.ports.get(r.keyL), out = blocks[r.j].at.ports.get(r.keyR), over = s.points.get(r.key).map((p) => [p[0] + M, p[1] + M]);
    const gated = blocks[r.i].shore && blocks[r.j].shore;
    let points = [...into, ...over, ...[...out].reverse()];
    let gates = gated ? [{ island: blocks[r.i].id, at: [blocks[r.i].land.r, into.at(-1)[1]], span: PORT, way: [1, 0] }, { island: blocks[r.j].id, at: [blocks[r.j].land.l, out.at(-1)[1]], span: PORT, way: [1, 0] }] : [];
    let line = gated ? [gates[0].at, ...over, gates[1].at] : null;
    if (r.left !== r.l.from) (points = points.reverse(), (gates = gates.reverse()), (line = line && line.reverse()));
    return { share: r.share, a: r.l.from, b: r.l.to, type: r.l.type ?? r.l.kind, points, crossing: true, gates, ...(line && { sea: line }), ...(r.l.pending && { pending: r.l.pending }) };
  });
  // A finding's reads by one side are one bundle: a trunk to its port, each reader's wire leaving it at a stop.
  const byShare = new Map();
  for (const w of drawn) (byShare.get(w.share) ?? byShare.set(w.share, []).get(w.share)).push(w);
  for (const list of byShare.values()) {
    const cut = list.length > 1 ? bundle(list.map((w) => ({ ...w, hub: 'b' }))) : list;
    for (const w of cut) { const { share, hub, ...tie } = w; ties.push(tie); }
  }
  const done = finish({ nodes, x, y, chains, ties, potential, margin: M, islands: shores });
  stage('finish', { chains: done.chains.map((w) => w.points), ties: done.ties.map((w) => w.points) });
  return done;
}
