// The strips layout (task e_3svu8hbh): the kit's graph (./model.js), one strip of rows and lanes (./strip.js), cut into
// columns where it runs far taller than the page (./columns.js), the links between columns run through the sea between
// them as links between islands are (./sea.js), then finished for the scene (./land.js). In the flow's drawing this
// module stands where the flow's own layout does, so the scene (./index.js) is the flow's. Layer: metrics. Pure: the
// layout's args in, the model the scene draws out.

import { bundle } from './bundle.js';
import { columns } from './columns.js';
import { finish } from './land.js';
import { model } from './model.js';
import { sea } from './sea.js';
import { stage } from './stage.js';
import { strip } from './strip.js';

export { stages } from './stage.js';

/** Everything in `a` moved by dx, dy: its places, its wires and its ports' lines. */
export function moved(a, dx, dy) {
  const to = (p) => [p[0] + dx, p[1] + dy], w = (l) => ({ ...l, points: l.points.map(to) });
  return {
    ...a,
    x: new Map([...a.x].map(([id, v]) => [id, v + dx])), y: new Map([...a.y].map(([id, v]) => [id, v + dy])),
    chains: a.chains.map(w), ties: a.ties.map(w), ports: new Map([...a.ports].map(([k, line]) => [k, line.map(to)])),
    extent: { l: a.extent.l + dx, t: a.extent.t + dy, r: a.extent.r + dx, b: a.extent.b + dy },
  };
}

/** The extent of steps and lines. */
function extentOf(ids, nodes, x, y, lines) {
  if (!ids.length) return { l: 0, t: 0, r: 0, b: 0 };
  const xs = [...ids.flatMap((id) => [x.get(id) - nodes.get(id).w / 2, x.get(id) + nodes.get(id).w / 2]), ...lines.flatMap((l) => l.map((p) => p[0]))];
  const ys = [...ids.flatMap((id) => [y.get(id) - nodes.get(id).h / 2, y.get(id) + nodes.get(id).h / 2]), ...lines.flatMap((l) => l.map((p) => p[1]))];
  return { l: Math.min(...xs), t: Math.min(...ys), r: Math.max(...xs), b: Math.max(...ys) };
}

/**
 * The strip of `args` (as the flow's layout is given them), its places and wires before they are landed: `outside`
 * names the ends that leave it for the sea ({ key, id, side, up }). Answers the graph `m`, `x`, `y`, `chains`,
 * `ties`, `ports` (each outside end's line, from its step out to where it leaves) and `extent`.
 */
export function arrange(args) {
  const { sizes } = args, outside = args.outside ?? [];
  for (const name of ['strips_row_gap', 'strips_hub', 'strips_wrap_from']) if (typeof sizes?.[name] !== 'number') throw new Error(`The style names no size "${name}": the house style (packs/core/pack.json) names every one strips uses`);
  const m = model(args);
  stage('order', { order: m.order });
  const whole = strip(m, { sizes });
  const wires = [...m.chains.map((w) => ({ ...w, kind: 'chain' })), ...m.ties.map((w) => ({ ...w, kind: 'tie' }))].filter((w) => m.rank.has(w.a) && m.rank.has(w.b));
  const cols = columns({
    order: m.order, heights: m.order.map((id) => m.nodes.get(id).h + sizes.strips_row_gap), spans: wires.map((w) => [m.rank.get(w.a), m.rank.get(w.b)].sort((p, q) => p - q)),
    width: whole.extent.r - whole.extent.l, aspect: args.aspect ?? 1.6, from: sizes.strips_wrap_from,
  });
  stage('columns', { columns: cols });
  const colOf = new Map(cols.flatMap((c, k) => c.map((id) => [id, k]))), last = cols.length - 1;
  const local = new Map(cols.flatMap((c) => c.map((id, k) => [id, k])));
  // A link between two columns leaves the left one's step by its right side and comes into the right one's by its left.
  const across = wires.filter((w) => colOf.get(w.a) !== colOf.get(w.b)).map((w, k) => {
    const [p, q] = [colOf.get(w.a), colOf.get(w.b)], [l, r] = p < q ? [w.a, w.b] : [w.b, w.a];
    return { w, key: `c${k}`, l, r, i: Math.min(p, q), j: Math.max(p, q), keyL: `c${k}:l`, keyR: `c${k}:r` };
  });
  // A step with many links across on one side is a hub there: they share its port and a trunk, as a hub's lane does.
  const many = new Map();
  for (const c of across) for (const id of [`${c.l}:right`, `${c.r}:left`]) many.set(id, (many.get(id) ?? 0) + 1);
  for (const c of across) {
    const [nl, nr] = [many.get(`${c.l}:right`), many.get(`${c.r}:left`)], at = nl >= nr ? 'l' : 'r';
    if (Math.max(nl, nr) < sizes.strips_hub) continue;
    c.share = at === 'l' ? `s:${c.l}:right` : `s:${c.r}:left`;
    c.at = at;
    c[at === 'l' ? 'keyL' : 'keyR'] = c.share;
  }
  const ends = cols.map(() => new Map()), routes = [];
  for (const c of across) {
    ends[c.i].set(c.keyL, { key: c.keyL, id: c.l, side: 'right', up: local.get(c.r) < local.get(c.l) });
    ends[c.j].set(c.keyR, { key: c.keyR, id: c.r, side: 'left', up: local.get(c.l) < local.get(c.r) });
  }
  // An end that leaves for another island from a column not on that edge runs over the columns to the edge.
  const edges = [];
  for (const e of outside) {
    const c = colOf.get(e.id);
    if (c === undefined) continue;
    ends[c].set(e.key, e);
    if ((e.side === 'right' && c < last) || (e.side === 'left' && c > 0)) edges.push({ e, c });
  }
  const strips = cols.map((ids, k) => {
    const inside = new Set(ids), keep = (w) => inside.has(w.a) && inside.has(w.b);
    return strip({ ...m, order: ids, chains: m.chains.filter(keep), ties: m.ties.filter(keep) }, { sizes, outside: [...ends[k].values()] });
  });
  const portOf = (k, key) => strips[k].ports.get(key);
  for (const c of across) routes.push({ key: c.key, i: c.i, j: c.j, yl: portOf(c.i, c.keyL)[1], yr: portOf(c.j, c.keyR)[1], ...(c.share && { share: c.share, at: c.at }) });
  for (const { e, c } of edges) routes.push(e.side === 'right' ? { key: e.key, i: c, j: cols.length, yl: portOf(c, e.key)[1] } : { key: e.key, i: -1, j: c, yr: portOf(c, e.key)[1] });
  const s = sea({ widths: strips.map((t) => t.extent.r - t.extent.l), routes, sizes, least: 2 * sizes.flow_wire_room });
  stage('sea', { left: s.left, over: s.over });
  const x = new Map(), y = new Map(), chains = [], ties = [], ports = new Map();
  const at = strips.map((t, k) => moved({ ...t, ports: new Map([...t.ports].map(([key, p]) => [key, [p]])) }, s.left[k] - t.extent.l, s.over - t.extent.t));
  for (const t of at) {
    t.x.forEach((v, id) => x.set(id, v));
    t.y.forEach((v, id) => y.set(id, v));
    chains.push(...t.chains);
    ties.push(...t.ties);
  }
  const shared = new Map();
  for (const c of across) {
    let points = [at[c.i].ports.get(c.keyL)[0], ...s.points.get(c.key), at[c.j].ports.get(c.keyR)[0]];
    if (c.l !== c.w.a) points = points.reverse();
    const { kind, ...w } = c.w, wire = { ...w, points, ...(m.against(w) && { dashed: true }) };
    if (!c.share) (kind === 'chain' ? chains : ties).push(wire);
    else (shared.get(c.share) ?? shared.set(c.share, []).get(c.share)).push({ kind, wire, hub: (c.at === 'l' ? c.l : c.r) === w.a ? 'a' : 'b' });
  }
  // A hub's links across share its port: one trunk, each wire leaving it at a stop (./bundle.js).
  for (const list of shared.values()) bundle(list.map((e) => ({ ...e.wire, hub: e.hub }))).forEach((w, k) => {
    const { hub, ...wire } = w;
    (list[k].kind === 'chain' ? chains : ties).push(wire);
  });
  const edged = new Map(edges.map(({ e }) => [e.key, e]));
  for (const e of outside) {
    const c = colOf.get(e.id);
    if (c === undefined) continue;
    const p = at[c].ports.get(e.key)[0], line = s.points.get(e.key);
    ports.set(e.key, edged.has(e.key) ? [p, ...(e.side === 'right' ? line : [...line].reverse())] : [p]);
  }
  const ids = [...x.keys()];
  return { m, x, y, chains, ties, ports, extent: extentOf(ids, m.nodes, x, y, [...chains, ...ties].map((w) => w.points).concat([...ports.values()])) };
}

/** The model the flow's scene draws, of one strip: what `arrange` gives, a margin in, every end landed. */
export function layout(args) {
  const a = arrange(args), M = args.sizes.flow_margin, at = moved(a, M - a.extent.l, M - a.extent.t);
  const done = finish({ nodes: a.m.nodes, x: at.x, y: at.y, chains: at.chains, ties: at.ties, potential: a.m.potential, margin: M });
  stage('finish', { chains: done.chains.map((w) => w.points), ties: done.ties.map((w) => w.points) });
  return Object.assign(done, { raw: { args } });
}
