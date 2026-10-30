// Rows from the order, and the order inside each row chosen for few crossings. The order is a constraint here, never a
// score: each step sits below all it follows, so no wire of the order can run up. Everything else is free to be moved
// for the rest: a step takes the row its links want, inside what the order leaves it; ties pass through rows like any
// wire, each its own; and the left-to-right order in each row is searched from several starts, one of them the
// embedding's. Pure: ids and links in, rows out, in the shape ./layers.js places.

import { grouped } from './graph.js';

/** Passes over the steps for their rows, and over the rows for their order. */
const ROW_PASSES = 8, SWEEPS = 16;
/** How much worse a crossing of two wires that matter is than one of a quiet tie; a tie along a row's cost in rows. */
const QUIET_WEIGHT = 1, WIRE_WEIGHT = 2, FLAT_COST = 2;
/** Past this much work in a row's crossing table a row keeps the order the sweeps gave it. */
const SIFT_MOST = 4e5;

/**
 * Each step's row: `edges` are { a, b }, a leads to b, `ties` { a, b, type }; `wide(id)` is its width, `across` how wide a
 * row should grow. A step of the order sits below all it follows and above all that follows it, always.
 */
export function rowsOf(ids, edges, ties, { wide, across, quiet }) {
  const ins = grouped(edges, (e) => e.b, (e) => e.a), outs = grouped(edges, (e) => e.a, (e) => e.b);
  const row = new Map(), degree = new Map(ids.filter((id) => ins.has(id) || outs.has(id)).map((id) => [id, (ins.get(id) ?? []).length]));
  const queue = [...degree.keys()].filter((id) => !degree.get(id));
  queue.forEach((id) => row.set(id, 0));
  for (let k = 0; k < queue.length; k++) for (const v of outs.get(queue[k]) ?? []) {
    row.set(v, Math.max(row.get(v) ?? 0, row.get(queue[k]) + 1));
    degree.set(v, degree.get(v) - 1);
    if (!degree.get(v)) queue.push(v);
  }
  const near = new Map(ids.map((id) => [id, []]));
  for (const t of ties) if (near.has(t.a) && near.has(t.b)) (near.get(t.a).push({ id: t.b, weight: quiet(t) ? QUIET_WEIGHT : WIRE_WEIGHT }), near.get(t.b).push({ id: t.a, weight: quiet(t) ? QUIET_WEIGHT : WIRE_WEIGHT }));
  // What no order reaches starts from what it is tied to, the most tied first.
  const spread = (from) => { for (let k = 0; k < from.length; k++) for (const { id } of near.get(from[k])) if (!row.has(id)) (row.set(id, row.get(from[k]) + 1), from.push(id)); };
  spread([...row.keys()]);
  for (const id of [...ids].sort((p, q) => near.get(q).length - near.get(p).length)) if (!row.has(id)) (row.set(id, 0), spread([id]));
  const bottom = Math.max(...row.values());
  const taken = new Map();
  for (const id of ids) taken.set(row.get(id), (taken.get(row.get(id)) ?? 0) + wide(id));
  const order = [...queue, ...ids.filter((id) => !degree.has(id))];
  for (let pass = 0; pass < ROW_PASSES; pass++) for (const id of pass % 2 ? order : [...order].reverse()) {
    const before = (ins.get(id) ?? []).map((a) => row.get(a) + 1), after = (outs.get(id) ?? []).map((b) => row.get(b) - 1);
    const lo = Math.max(0, ...before), hi = Math.min(bottom, ...after), was = row.get(id);
    if (lo >= hi) continue;
    const cost = (r) => {
      let c = (taken.get(r) ?? 0) - (r === was ? wide(id) : 0) + wide(id) > across ? ((taken.get(r) ?? 0) + wide(id)) / across : 0;
      for (const w of [...(ins.get(id) ?? []), ...(outs.get(id) ?? [])]) c += WIRE_WEIGHT * Math.abs(r - row.get(w));
      for (const { id: w, weight } of near.get(id)) c += weight * (Math.abs(r - row.get(w)) + (r === row.get(w) ? FLAT_COST : 0));
      return c;
    };
    let best = was, least = cost(was);
    for (let r = lo; r <= hi; r++) if (cost(r) < least) ((best = r), (least = cost(r)));
    if (best !== was) (taken.set(was, taken.get(was) - wide(id)), taken.set(best, (taken.get(best) ?? 0) + wide(id)), row.set(id, best));
  }
  return row;
}

/**
 * Every line through its rows, each with a waypoint of its own in each row it passes. `lines` are { order, link, from,
 * to, weight }, the order's from what leads to what follows. Answers with `layers` unordered and who joins whom.
 */
export function thread(ids, lines, row) {
  const waypoints = new Map();
  for (const line of lines) {
    if (!line.order && row.get(line.to) < row.get(line.from)) [line.from, line.to] = [line.to, line.from];
    line.bundle = `${line.from}>${line.to}`;
    line.flat = row.get(line.from) === row.get(line.to);
    line.path = [line.from];
    for (let k = row.get(line.from) + 1; k < row.get(line.to); k++) {
      const id = `${line.bundle}@${k}`;
      waypoints.set(id, { id, dummy: true, layer: k, w: 6, h: 0, order: line.order });
      line.path.push(id);
    }
    line.path.push(line.to);
  }
  const every = [...ids, ...waypoints.keys()], rowAt = (id) => waypoints.get(id)?.layer ?? row.get(id);
  const maps = () => new Map(every.map((id) => [id, []]));
  const [up, down, upOrder, downOrder, upBy, downBy] = [maps(), maps(), maps(), maps(), maps(), maps()];
  for (const line of lines) for (let k = 1; k < line.path.length && !line.flat; k++) {
    const [u, v] = [line.path[k - 1], line.path[k]];
    (down.get(u).push(v), up.get(v).push(u), downBy.get(u).push(line.weight), upBy.get(v).push(line.weight));
    if (line.order) (downOrder.get(u).push(v), upOrder.get(v).push(u));
  }
  const layers = [];
  for (const id of every) (layers[rowAt(id)] ??= []).push(id);
  for (let k = 0; k < layers.length; k++) layers[k] ??= [];
  return { layerOf: row, waypoints, up, down, upOrder, downOrder, upBy, downBy, layers, paths: lines.map((l) => [l.from, l.to, l.path, l.bundle, l.flat]) };
}

/** How many crossings, weighed, between each two rows: the wires as `pos` has them. */
export function weighed(t, pos) {
  let total = 0;
  for (let k = 1; k < t.layers.length; k++) {
    const pairs = t.layers[k].flatMap((b) => t.up.get(b).map((a, i) => [pos.get(a), pos.get(b), t.upBy.get(b)[i]]));
    for (let i = 0; i < pairs.length; i++) for (let j = i + 1; j < pairs.length; j++) {
      const [p, q] = [pairs[i], pairs[j]];
      if ((p[0] - q[0]) * (p[1] - q[1]) < 0) total += p[2] * q[2];
    }
  }
  return total;
}

/** What it costs to have each of `list` left of each other, by the rows either side, as `pos` has them. */
function table(list, t, pos) {
  const n = list.length, sides = list.map((id) => [[t.up.get(id).map((v) => pos.get(v)), t.upBy.get(id)], [t.down.get(id).map((v) => pos.get(v)), t.downBy.get(id)]]);
  const cost = Array.from({ length: n }, () => new Float64Array(n));
  for (let u = 0; u < n; u++) for (let v = u + 1; v < n; v++) for (const s of [0, 1]) {
    const [pu, wu] = sides[u][s], [pv, wv] = sides[v][s];
    for (let i = 0; i < pu.length; i++) for (let j = 0; j < pv.length; j++) {
      if (pu[i] > pv[j]) cost[u][v] += wu[i] * wv[j];
      else if (pu[i] < pv[j]) cost[v][u] += wu[i] * wv[j];
    }
  }
  return cost;
}

/** Each of a row tried at every place in it, and left where the fewest wires cross. Answers with whether it moved one. */
function sift(k, t, pos) {
  const list = t.layers[k], work = list.reduce((s, id) => s + t.up.get(id).length + t.down.get(id).length, 0) ** 2;
  if (list.length < 2 || work > SIFT_MOST) return false;
  const cost = table(list, t, pos), index = new Map(list.map((id, i) => [id, i]));
  let moved = false;
  for (const id of [...list]) {
    const u = index.get(id), from = list.indexOf(id);
    let at = from, run = 0, least = 0;
    // Leftward, then rightward, from where it stands: passing one swaps which of the two is on the left.
    for (let i = from - 1; i >= 0; i--) {
      const v = index.get(list[i]);
      run += cost[u][v] - cost[v][u];
      if (run < least) ((least = run), (at = i));
    }
    run = 0;
    for (let i = from + 1; i < list.length; i++) {
      const v = index.get(list[i]);
      run += cost[v][u] - cost[u][v];
      if (run < least) ((least = run), (at = i));
    }
    if (at !== from) ((moved = true), list.splice(from, 1), list.splice(at, 0, id));
  }
  list.forEach((id, i) => pos.set(id, i));
  return moved;
}

/** Sweeps by the mean of each one's neighbours, then sifting, from the order `t.layers` stands in. Answers with the score. */
function search(t) {
  const pos = new Map(), index = () => t.layers.forEach((list) => list.forEach((id, i) => pos.set(id, i)));
  index();
  let best = t.layers.map((l) => [...l]), fewest = weighed(t, pos);
  const bary = (k, toward) => {
    const list = t.layers[k], at = new Map(list.map((id) => [id, toward.get(id).length ? toward.get(id).reduce((s, v) => s + pos.get(v), 0) / toward.get(id).length : pos.get(id)]));
    list.sort((p, q) => at.get(p) - at.get(q));
    list.forEach((id, i) => pos.set(id, i));
  };
  const keep = () => {
    const c = weighed(t, pos);
    if (c < fewest) ((fewest = c), (best = t.layers.map((l) => [...l])));
  };
  for (let round = 0; round < SWEEPS; round++) {
    if (round % 2 === 0) for (let k = 1; k < t.layers.length; k++) bary(k, t.up);
    else for (let k = t.layers.length - 2; k >= 0; k--) bary(k, t.down);
    keep();
  }
  t.layers.splice(0, t.layers.length, ...best.map((l) => [...l]));
  index();
  for (let round = 0, moved = true; moved && round < SWEEPS; round++) {
    moved = false;
    for (let k = 0; k < t.layers.length; k++) if (sift(k, t, pos)) moved = true;
    keep();
  }
  t.layers.splice(0, t.layers.length, ...best);
  return fewest;
}

/**
 * The order in each row of `t`, the best of the search from each start: `starts` are functions of an id, giving where it
 * stands across. Sets `t.layers`; answers with the score of each start, for a bench.
 */
export function orderRows(t, starts) {
  let best = null, least = Infinity;
  const scores = [];
  for (const place of starts) {
    for (const list of t.layers) list.sort((p, q) => place(p) - place(q));
    const c = search(t);
    scores.push(c);
    if (c < least) ((least = c), (best = t.layers.map((l) => [...l])));
  }
  t.layers.splice(0, t.layers.length, ...best);
  return scores;
}
