// The one layout (hub e_9uhaqhwe): the whole picture, islands and all, laid out at once in three steps. Step 1 makes it
// plane (./embedding.js: every wire's crossings and ports chosen, rings broken, trunks joined), step 2 gives it right
// angles with the fewest bends (./shape.js), step 3 relaxes the distances keeping that shape (./relax.js). This module
// only reads the kit's graph into step 1 and the relaxed places back out as the model the flow's scene draws.
// Layer: metrics. Pure: the layout's args in, the model out.

import { asInput } from './format.js';
import { embedding } from './embedding.js';
import { ORDER } from './graph.js';
import { finish } from './land.js';
import { model } from './model.js';
import { relax } from './relax.js';
import { shape } from './shape.js';
import { stage } from './stage.js';

export { stages } from './stage.js';

/** The key of a link as step 1 names it: its type and its two ends, in the way step 1 runs it. */
const keyOf = (type, a, b) => `${type} ${a} ${b}`;

/**
 * Every link of the kit's graph `m` by the key step 1 gives it, with whether that key turns it round: a headless tie is
 * keyed from what it ties to, as step 1 reads it.
 */
function linksOf(m, headless) {
  const out = new Map();
  for (const c of m.chains) out.set(keyOf(ORDER, c.a, c.b), { wire: c, kind: 'chain' });
  for (const t of m.ties) out.set(headless.includes(t.type) ? keyOf(t.type, t.b, t.a) : keyOf(t.type, t.a, t.b), { wire: t, kind: 'tie' });
  return out;
}

/**
 * What a loop at right angles holds, as rectangles: cut across at every height a corner stands at, each band's inside
 * read off the upright stretches it meets (in, out, in...), and a band joined to the one above where they hold the same.
 */
function landOf(lines) {
  const uprights = lines.flatMap((ps) => ps.slice(1).map((q, k) => [ps[k], q]).filter(([p, q]) => Math.abs(p[0] - q[0]) < 0.5 && Math.abs(p[1] - q[1]) > 0.5));
  const ys = [...new Set(lines.flat().map((p) => Math.round(p[1] * 2) / 2))].sort((p, q) => p - q), out = [];
  let open = [];
  for (let k = 0; k + 1 < ys.length; k++) {
    const mid = (ys[k] + ys[k + 1]) / 2, xs = uprights.filter(([p, q]) => Math.min(p[1], q[1]) < mid && Math.max(p[1], q[1]) > mid).map(([p]) => p[0]).sort((p, q) => p - q);
    const spans = [];
    for (let j = 0; j + 1 < xs.length; j += 2) spans.push([xs[j], xs[j + 1]]);
    const next = [];
    for (const [l, r] of spans) {
      const same = open.find((o) => Math.abs(o.l - l) < 0.5 && Math.abs(o.r - r) < 0.5);
      if (same) (same.b = ys[k + 1], next.push(same));
      else { const band = { l, t: ys[k], r, b: ys[k + 1] }; out.push(band); next.push(band); }
    }
    open = next;
  }
  return out;
}

/**
 * The whole picture of `args` (as the flow's layout is given them): `islandOf(id)` where a step lives, `heads(island)`
 * how tall its name and legend stand over what it holds. Answers the kit's graph, the relaxed places, the model's
 * `x`, `y`, `nodes`, `chains` and `ties`, and each island's frame and ports.
 */
export function laidOut(args, { islandOf = () => null, heads = new Map() } = {}) {
  const { sizes } = args, headless = args.headless ?? [], m = model(args);
  const e = embedding(m, { sizes, headless, islandOf: (id) => islandOf(id) ?? null });
  const input = asInput(e, m), sketch = shape(input);
  stage('shaped', { bends: sketch.bends, nodes: sketch.nodes.length, wires: sketch.wires.length });
  const r = relax(sketch, { size: (n) => (m.nodes.has(n.id) ? [m.nodes.get(n.id).w, m.nodes.get(n.id).h] : [0, 0]), sizes, heads });
  const M = sizes.flow_margin, to = ([px, py]) => [px + M, py + M];
  const at = new Map(r.nodes.map((n) => [n.id, { ...n, x: n.x + M, y: n.y + M }]));
  // A box is drawn as the shape made it: where many wires land on it, it stands as long as they need.
  const nodes = new Map([...m.nodes].map(([id, n]) => [id, at.has(id) ? { ...n, w: Math.max(n.w, at.get(id).w), h: Math.max(n.h, at.get(id).h) } : n]));
  const x = new Map([...at].filter(([id]) => m.nodes.has(id)).map(([id, n]) => [id, n.x])), y = new Map([...at].filter(([id]) => m.nodes.has(id)).map(([id, n]) => [id, n.y]));
  const ends = new Map(sketch.wires.map((w) => [w.id, [w.from, w.to]])), given = new Map(input.wires.map((w) => [w.id, w]));
  const kindOf = new Map(input.nodes.map((n) => [n.id, n.kind])), portAt = new Map(r.ports.map((p) => [p.id, p]));
  const links = linksOf(m, headless), chains = [], ties = [];
  // A trunk's stem carries no link of its own: it takes its kind and head from the links of its branches.
  const trunkLinks = new Map();
  for (const w of input.wires) if (w.trunk !== undefined && w.link && links.has(w.link)) (trunkLinks.get(w.trunk) ?? trunkLinks.set(w.trunk, []).get(w.trunk)).push(links.get(w.link));
  for (const w of r.wires) {
    if (w.type === 'unseen' || w.type === 'border') continue;
    const [from, to_] = ends.get(w.id) ?? [], g = given.get(w.id), points = w.points.map(to), known = g?.link ? links.get(g.link) : null;
    // The ports a wire passes on its way, each a gate on its island's shore.
    const passes = new Set((g?.edges ?? []).flatMap((k) => { const edge = input.edges.find((x) => x.id === k); return edge ? [edge.from, edge.to] : []; }).filter((v) => kindOf.get(v) === 'port'));
    const gates = [...passes].map((id) => portAt.get(id)).filter(Boolean).map((p) => ({ island: p.island, at: to([p.x, p.y]), span: sizes.flow_island_port, way: p.side === 'top' || p.side === 'bottom' ? [0, 1] : [1, 0] }));
    if (known) {
      const { wire, kind } = known, forward = from === wire.a || to_ === wire.b, line = forward ? points : [...points].reverse();
      // A branch of a trunk starts or ends at its junction, not its item: that end stays where the trunk meets it.
      const reaches = (forward ? to_ : from) === wire.b, leaves = (forward ? from : to_) === wire.a, out = { ...wire, points: line, ...(!reaches && { toPort: true }), ...(!leaves && { stop: true }), ...(w.reversed && kind === 'chain' && { dashed: true }), ...(gates.length && kind === 'tie' && { crossing: true, gates }) };
      (kind === 'chain' ? chains : ties).push(out);
      continue;
    }
    // A stem: from the shared end to a junction, or between junctions.
    const list = trunkLinks.get(g?.trunk) ?? [], kind = list[0]?.kind ?? (w.type === ORDER ? 'chain' : 'tie'), shared = [from, to_].find((v) => m.nodes.has(v));
    const headed = shared !== undefined && list.length > 0 && list.every((l) => l.wire.b === shared);
    const line = headed && to_ !== shared ? [...points].reverse() : points, [a, b] = headed && to_ !== shared ? [to_, from] : [from, to_];
    const type = list[0]?.wire.type ?? w.type;
    (kind === 'chain' ? chains : ties).push({ a, b, type, points: line, stop: !m.nodes.has(a), ...(!headed && { toPort: true }) });
  }
  // An island's border is a loop at right angles, not a box: its land is the loop cut into rectangles.
  const islands = r.islands.map((i) => {
    const loop = r.wires.filter((w) => w.type === 'border' && w.id.startsWith(`border ${i.id} `)).map((w) => w.points.map(to));
    const rect = [i.rect[0] + M, i.rect[1] + M, i.rect[2] + M, i.rect[3] + M];
    return { id: i.id, rect, land: loop.length ? landOf(loop) : [{ l: rect[0], t: rect[1], r: rect[2], b: rect[3] }] };
  });
  return { m, nodes, x, y, chains, ties, islands, ports: r.ports, told: r.told };
}

/** The model the flow's scene draws: the whole picture with no islands, or the kit's plain graph when only that is asked. */
export function layout(args) {
  if (args.extras?.plain) {
    const m = model(args);
    return { all: [...m.nodes.values()], chains: m.chains, ties: m.ties, breaks: [], args };
  }
  const a = laidOut(args);
  const done = finish({ nodes: a.nodes, x: a.x, y: a.y, chains: a.chains, ties: a.ties, potential: a.m.potential, margin: args.sizes.flow_margin });
  stage('finish', { chains: done.chains.map((w) => w.points), ties: done.ties.map((w) => w.points) });
  return Object.assign(done, { raw: { args } });
}
