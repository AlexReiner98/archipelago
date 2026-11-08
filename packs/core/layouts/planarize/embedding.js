// The whole picture made planar at once (task e_snvzsxj4, step 1 of "One layout: planarize, shape, relax"): one graph of
// every step, every wire and every island's border, solved together under one set of rules. Wires go as one between a
// pair, each ring is broken by turning the fewest (./direct.js), and wires of one type and way share a trunk
// (./trunks.js). Then the mixed upward planarization the flow's parts use (./upward.js), run once over everything: all
// on one line, each island a run of it closed by its border (./line.js); what fits on the line's two sides kept, the
// rest threaded through the faces the way the numbers run (./thread.js), where crossing a border is dear, so a wire
// crosses one once and that crossing is its port. Of a few tries, the one with the fewest wires against their way is
// kept, then the fewest crossings: crossings are never traded for the rules. Layer: topology. Pure: the kit's graph in,
// an embedding out, and no place.

import { joined, directed } from './direct.js';
import { borderArcs, isBorder, lineOf } from './line.js';
import { STRONG } from './numbering.js';
import { pair } from './polyline.js';
import { stage } from './stage.js';
import { threader } from './thread.js';
import { withTrunks } from './trunks.js';
import { close, facesOf, keyed, pages } from './upward.js';

/** How firm a wire's way is to the numbering: the order's, which nothing passes under; another link's. A tie has none. */
const FIRM = { order: STRONG, link: 2 };
/** What it costs a wire to cross a border: so much that it never crosses one more than it must. */
const SHORE = 1e4;
/** What passing a wire costs, seen and unseen, as the threader counts. */
const SEEN = 1, UNSEEN = 0.1;

/** A wire as the threader takes it: [top, foot, firmness], the wire it stands for kept on it. */
const asLink = (w) => Object.assign(w.firm ? [w.top, w.foot, w.order ? FIRM.order : FIRM.link] : [w.u, w.v], { wire: w });
/** What passing a wire costs: a border dear, a seen wire one, an unseen one little. */
const cost = (w) => (w?.link?.border !== undefined ? SHORE : w?.visible ? SEEN : UNSEEN);

/** The rotation round each node, from faces that each keep their inside on one side: each node's neighbours in turn. */
export function rotations(faces) {
  const next = new Map();
  for (const f of faces) f.forEach((v, k) => {
    const a = f[(k - 1 + f.length) % f.length], b = f[(k + 1) % f.length];
    (next.get(v) ?? next.set(v, new Map()).get(v)).set(a, b);
  });
  const out = new Map();
  for (const [v, after] of next) {
    const ring = [], start = after.keys().next().value;
    for (let at = start; !ring.includes(at) && at !== undefined; at = after.get(at)) ring.push(at);
    out.set(v, ring);
  }
  return out;
}

/** One try, the `k`th: the line leaning its own way, the two sides filled, the rest threaded. */
function attempt({ ids, wires, placeOf, made, islands, tighten }, k, oneWay) {
  const index = new Map(), idx = (v) => index.get(v) ?? index.set(v, index.size).get(v);
  ids.forEach(idx);
  const noise = (v) => (k ? keyed(k, idx(v), -1) : 0);
  const { line, wires: ways } = lineOf(ids, wires, placeOf, made, noise);
  const links = ways.map(asLink), borders = islands.flatMap(borderArcs);
  const { sides, at, left } = pages(line, links, (l) => keyed(k, idx(l[0]), idx(l[1])), [borders.filter((b) => b.side === 0), borders.filter((b) => b.side !== 0)]);
  const number = new Map(at), { hidden, stHere } = close(line, sides), owner = new Map(), all = [];
  const add = (path, visible, link) => {
    const w = { path, visible, link };
    all.push(w);
    for (let i = 1; i < path.length; i++) owner.set(pair(path[i - 1], path[i]), w);
    return w;
  };
  for (const arcs of sides) for (const a of arcs) if (a.l) add([a.l[0], a.l[1]], true, a.l);
  for (const a of hidden) add([line[a.p], line[a.q]], false, null);
  const faces = facesOf(line, sides), [s, t] = [line[0], line.at(-1)], run = stHere ? [s, t] : [t, s];
  const isOuter = (f) => f.some((v, j) => (v === run[0] && f[(j + 1) % f.length] === run[1]) || (v === run[1] && f[(j + 1) % f.length] === run[0]));
  // The order's wires first, then the rest; each the way the numbers run, and only where none can, the shortest way.
  const strict = threader(faces, owner, add, { number, keep: pair(s, t), onward: (l) => oneWay && (l[2] ?? 0) > 0, oneWay, cost, tag: 'w' });
  strict.through([...left].sort((p, q) => Number(q[2] ?? 0) - Number(p[2] ?? 0)));
  const done = () => new Set(all.map((w) => w.link)), failed = left.filter((l) => !done().has(l));
  if (failed.length) threader(faces, owner, add, { number, keep: pair(s, t), cost, tag: 's' }).through(failed);
  // Then tightened as the flow's are, but only the wires of links: a border is never threaded again.
  if (!failed.length) (strict.prune(all), strict.again(all.filter((w) => w.link?.wire), tighten));
  const live = [...new Set(owner.values())];
  return { g: { wires: live, owner, faces }, number, s, t, outerAt: faces.findIndex(isOuter), loose: failed.length, lost: left.filter((l) => !done().has(l)).length, line, ways };
}

/** What a tried embedding comes to: wires against their way, crossings, ports, and wires that cross a border twice. */
function measured({ g, number }) {
  const near = new Map();
  for (const key of g.owner.keys()) { const [a, b] = key.split('|'); (near.get(a) ?? near.set(a, []).get(a)).push(b); (near.get(b) ?? near.set(b, []).get(b)).push(a); }
  const real = g.wires.filter((w) => w.link?.wire);
  const up = real.filter((w) => w.link.wire.firm && w.path.some((v, i) => i && number.get(w.path[i - 1]) > number.get(v)));
  const crossings = [], ports = [];
  for (const [v, list] of near) {
    if (!v.startsWith('ghost')) continue;
    // A point where two wires cross: two of them, each passing through it, not ending there.
    const through = [...new Set(list.map((n) => g.owner.get(pair(v, n))))], wire = through.find((w) => w.link?.wire), shore = through.find((w) => w.link?.border !== undefined);
    if (through.length !== 2 || list.length !== 2 * through.length || !wire) continue;
    if (through.every((w) => w.link?.wire)) crossings.push(v);
    else if (shore) ports.push({ at: v, island: shore.link.border, wire: wire.link.wire.id });
  }
  const shores = new Map();
  for (const p of ports) shores.set(`${p.wire} ${p.island}`, (shores.get(`${p.wire} ${p.island}`) ?? 0) + 1);
  return { up, crossings, ports, twice: [...shores.values()].filter((n) => n > 1).length };
}

/**
 * The embedding of the kit's graph `m` (./model.js): `headless` the link types with no head, `islandOf(id)` where a
 * step lives (null at sea). Answers `wires` (each with its way, `turned`, `trunk` and its `path` through the points
 * where it crosses), `junctions`, `faces`, `rotation` (each node's neighbours in turn), `number` (the numbering, top
 * first, with `s` and `t`), `outer` (the outer face's place in `faces`), `crossings` (points where two wires cross),
 * `ports` (each island's, in turn round its border), `borders` (each island's border, every point in turn) and
 * `counts`. Without `trunks` no wires share one; without `oneWay` what is left out is threaded the shortest way.
 * `down` says which wires must run down: 'all' that have a way (the default), or only the 'order'. `sizes` are the
 * style's, which say how many tries the work allows.
 */
export function embedding(m, { headless = [], islandOf = () => null, trunks: joinTrunks = true, oneWay = true, tries, down = 'all', sizes } = {}) {
  for (const name of ['planarize_tries_least', 'planarize_tries_most', 'planarize_work', 'planarize_tighten']) if (typeof sizes?.[name] !== 'number') throw new Error(`The style names no size "${name}": the house style (packs/core/pack.json) names every one planarize uses`);
  const made = (id) => m.nodes.get(id)?.made ?? Infinity, steps = [...m.nodes.keys()];
  const { wires: ways } = directed(joined(m, headless), steps, made);
  const joinedUp = joinTrunks ? withTrunks(ways, made, islandOf) : { wires: ways, junctions: [], trunks: 0 }, { junctions, trunks } = joinedUp;
  // Which wires must run down: every one with a way, or only the order's.
  const wires = joinedUp.wires.map((w) => ({ ...w, firm: w.directed && (down === 'all' || w.order) }));
  const where = new Map([...steps.map((id) => [id, islandOf(id) ?? null]), ...junctions.map((j) => [j.id, j.island])]);
  const placeOf = (id) => where.get(id) ?? null, madeOf = new Map([...steps.map((id) => [id, made(id)]), ...junctions.map((j) => [j.id, made(j.end)])]);
  const islands = [...new Set([...where.values()].filter((i) => i !== null))], ids = [...where.keys()];
  // As many lines are tried as the work allows, in wires squared, within the least and the most.
  const count = tries ?? Math.max(sizes.planarize_tries_least, Math.min(sizes.planarize_tries_most, Math.ceil(sizes.planarize_work / Math.max(1, wires.length ** 2))));
  let best = null;
  const less = (a, b) => { for (let k = 0; k < a.length; k++) if (a[k] !== b[k]) return a[k] < b[k]; return false; };
  for (let k = 0; k < count; k++) {
    const tried = attempt({ ids, wires, placeOf, made: (id) => madeOf.get(id), islands, tighten: sizes.planarize_tighten }, k, oneWay), seen = measured(tried);
    const score = [seen.twice, tried.lost, seen.up.length, seen.crossings.length];
    if (!best || less(score, best.score)) best = { ...tried, ...seen, score, k };
  }
  const { g } = best, pathOf = new Map(g.wires.filter((w) => w.link?.wire).map((w) => [w.link.wire.id, w.path]));
  // Each island's border, every point in turn round it from its top, and its ports among them.
  const borders = new Map(islands.map((island) => [island, [0, 1, 2].flatMap((side) => {
    const w = g.wires.find((x) => x.link?.border === island && x.link.side === side), first = w.link[0];
    return (w.path[0] === first ? w.path : [...w.path].reverse()).slice(0, -1);
  })]));
  const portAt = new Map(best.ports.map((p) => [p.at, p]));
  const ports = new Map([...borders].map(([island, ring]) => [island, ring.filter((v) => portAt.has(v))]));
  const out = {
    wires: best.ways.map((w) => ({ ...w, path: pathOf.get(w.id) ?? [] })), junctions, faces: g.faces, rotation: rotations(g.faces), owner: g.owner,
    number: best.number, s: best.s, t: best.t, outer: best.outerAt, line: best.line, crossings: best.crossings, ports, portAt, borders, place: where,
    counts: {
      steps: steps.length, wires: wires.length, turned: best.ways.filter((w) => w.turned).length, byIslands: best.ways.filter((w) => w.byIslands).length,
      ties: ways.filter((w) => !w.directed).length, trunks, crossings: best.crossings.length, up: best.up.length, twice: best.twice, loose: best.loose,
      lost: best.lost, ports: Object.fromEntries([...ports].map(([island, list]) => [island, list.length])), tried: best.k,
    },
  };
  stage('planarized', { line: out.line, faces: out.faces, crossings: out.crossings, ports: out.ports, counts: out.counts });
  return out;
}

export { isBorder };
