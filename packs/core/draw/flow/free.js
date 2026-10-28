// Steps put where a person put them (the owner, 25 Oct 2026: the canvas is flexible), and the wires to them solved
// live, still at right angles. Where things were put on this canvas is the style's `placed`, by item: the page reads it
// from the places stream beside the lens and keeps what was moved here in it, with `moved` over it when given. A wire
// to a step that was put by hand leaves the foot of the step it comes from and comes down into the head of the one it
// goes to, round both when the second is not below the first. A tie is routed the same way, from the higher of its
// ends down into the lower, with no head (tieRoute); tieLine is the straight line between two edges. Pure:
// positions in, points out.

/** Where each step of this picture was put by hand: the middle of each, by item. */
export function placesOf(answer, style) {
  return { ...(style.placed ?? {}), ...(style.moved ?? {}) };
}

/**
 * Boxes kept by where they are, so a path asks only those near it: each box { id, x, y, w, h } in every band `cell`
 * tall it covers, each band in order along x. `each` visits, once, each box in the bands a run from (x1, y1) to
 * (x2, y2) crosses that lies across its span of x.
 */
export function field(boxes, cell) {
  const bands = new Map();
  for (const b of boxes)
    for (let j = Math.floor((b.y - b.h / 2) / cell); j <= Math.floor((b.y + b.h / 2) / cell); j++) (bands.get(j) ?? bands.set(j, { list: [], widest: 0 }).get(j)).list.push(b);
  for (const band of bands.values()) {
    band.list.sort((p, q) => p.x - p.w / 2 - (q.x - q.w / 2));
    band.widest = Math.max(...band.list.map((b) => b.w));
  }
  // Each box is visited once a run, marked with the run's number: no set is made for each.
  let run = 0;
  const seen = new Map();
  return {
    each(x1, y1, x2, y2, visit) {
      run++;
      const [lo, hi] = [Math.min(x1, x2), Math.max(x1, x2)];
      for (let j = Math.floor(Math.min(y1, y2) / cell); j <= Math.floor(Math.max(y1, y2) / cell); j++) {
        const band = bands.get(j);
        if (!band) continue;
        // The first box whose left edge could reach lo, then each until one starts past hi.
        let [a, z] = [0, band.list.length];
        while (a < z) {
          const mid = (a + z) >> 1;
          if (band.list[mid].x - band.list[mid].w / 2 < lo - band.widest) a = mid + 1;
          else z = mid;
        }
        for (let k = a; k < band.list.length && band.list[k].x - band.list[k].w / 2 < hi; k++) {
          const b = band.list[k];
          if (seen.get(b) !== run) (seen.set(b, run), visit(b));
        }
      }
    },
  };
}

/** How many of these boxes a path of right angles passes through (each box { x, y, w, h }, its middle and size; or a field of them), its own ends left out. */
const crossings = (points, boxes, ends = []) => {
  let n = 0;
  for (let k = 1; k < points.length; k++) {
    const [[x1, y1], [x2, y2]] = [points[k - 1], points[k]];
    const hit = (b) => !ends.includes(b.id) && Math.max(x1, x2) > b.x - b.w / 2 && Math.min(x1, x2) < b.x + b.w / 2 && Math.max(y1, y2) > b.y - b.h / 2 && Math.min(y1, y2) < b.y + b.h / 2 && n++;
    if (Array.isArray(boxes)) boxes.forEach(hit);
    else boxes.each(x1, y1, x2, y2, hit);
  }
  return n;
};

/** The runs of a path of right angles, each across (h) or down, where it is and from where to where, with the steps it joins. */
const runsOf = (points, ends) => points.slice(1).map(([x2, y2], k) => {
  const [x1, y1] = points[k];
  return Math.abs(y1 - y2) < 0.01 ? { h: true, at: y1, lo: Math.min(x1, x2), hi: Math.max(x1, x2), ends } : { h: false, at: x1, lo: Math.min(y1, y2), hi: Math.max(y1, y2), ends };
});
/** The paths drawn so far, their runs kept by line (across or down) and where it lies, `near` apart: what route keeps off. */
export const drawnPaths = (near) => ({ near, lines: new Map() });
const lineOf = (taken, h, at) => `${h ? 'h' : 'v'} ${Math.round(at / taken.near)}`;
/**
 * How far a path runs along what is drawn already, within `near` of it: two lines closer than that read as one. A run
 * exactly on a run that shares a step with it is a bus, and costs nothing; beside it, it costs as any other.
 */
const overlap = (points, ends, taken) => {
  let n = 0;
  for (const r of runsOf(points, ends))
    for (const d of [-1, 0, 1])
      for (const o of taken.lines.get(lineOf(taken, r.h, r.at + d * taken.near)) ?? [])
        if (Math.abs(o.at - r.at) < taken.near && !(Math.abs(o.at - r.at) < 0.01 && o.ends.some((e) => ends.includes(e)))) n += Math.max(0, Math.min(r.hi, o.hi) - Math.max(r.lo, o.lo));
  return n;
};
/** Keep a path as drawn, so the next one routed keeps off it. */
export const take = (taken, points, ends) => {
  if (!taken) return;
  for (const r of runsOf(points, ends)) {
    const key = lineOf(taken, r.h, r.at);
    const line = taken.lines.get(key) ?? taken.lines.set(key, []).get(key);
    // A run along one that shares a step with it is the same bus: the one grows, and keeps only the steps every run on it
    // shares. A run that shares a step with one run of a bus and not with another is not free to join it.
    const bus = line.find((o) => o.h === r.h && Math.abs(o.at - r.at) < 0.01 && o.lo <= r.hi && r.lo <= o.hi && o.ends.some((e) => r.ends.includes(e)));
    if (bus) Object.assign(bus, { lo: Math.min(bus.lo, r.lo), hi: Math.max(bus.hi, r.hi), ends: bus.ends.filter((e) => r.ends.includes(e)) });
    else line.push(r);
  }
};

/** Each of these boxes (an array, or a field of them) that may lie in the room from (x1, y1) to (x2, y2). */
const near = (boxes, x1, y1, x2, y2, visit) => (Array.isArray(boxes) ? boxes.forEach(visit) : boxes.each(x1, y1, x2, y2, visit));
/** What a path costs, in its own length: a turn as much as this, a length run along what is drawn this many times over, a step passed through more than any path. */
const [TURN, ALONG, THROUGH] = [48, 8, 1e6];
/** What a path costs: each step it passes through above all, then how far it runs along what is drawn, its turns, its length. */
const costOf = (points, others, ends, taken) => {
  let long = 0;
  for (let k = 1; k < points.length; k++) long += Math.abs(points[k][0] - points[k - 1][0]) + Math.abs(points[k][1] - points[k - 1][1]);
  return crossings(points, others, ends) * THROUGH + (taken ? overlap(points, ends, taken) * ALONG : 0) + (points.length - 2) * TURN + long;
};
/** A path with no run of no length and no turn that goes straight on. */
const tidy = (points) => {
  const out = [];
  for (const p of points) {
    if (out.length && Math.abs(p[0] - out.at(-1)[0]) < 0.01 && Math.abs(p[1] - out.at(-1)[1]) < 0.01) continue;
    const [q, r] = [out.at(-2), out.at(-1)];
    if (q && ((Math.abs(q[0] - r[0]) < 0.01 && Math.abs(r[0] - p[0]) < 0.01) || (Math.abs(q[1] - r[1]) < 0.01 && Math.abs(r[1] - p[1]) < 0.01))) out.pop();
    out.push(p);
  }
  return out;
};

/**
 * A path at right angles from (sx, sy) down to (tx, ty), coming into the second from above, round the steps (`others`,
 * its ends left out) a row at a time: down its line until a step is in the way, across over that step's row to a lane
 * through that row, and on down; then across over the second and down into it. Every run is first found clear, and of
 * the lanes (down the middle of the gaps between the steps of that row, the nearest few each side) and the heights
 * across (a lead over the row, higher a little at a time, or halfway up) each takes the one that runs along the least
 * drawn (`taken`), on the side toward the second unless that runs along more (or the side away from it first, `away`).
 * Undefined where it finds no way.
 */
function stairs(sx, sy, tx, ty, lead, others, ends, taken, away) {
  if (ty < sy) return undefined;
  const inside = (o, x1, y1, x2, y2) => o.x + o.w / 2 > Math.min(x1, x2) && o.x - o.w / 2 < Math.max(x1, x2) && o.y + o.h / 2 > Math.min(y1, y2) && o.y - o.h / 2 < Math.max(y1, y2);
  const hits = (x1, y1, x2, y2) => {
    const found = [];
    near(others, Math.min(x1, x2), Math.min(y1, y2), Math.max(x1, x2), Math.max(y1, y2), (o) => !ends.includes(o.id) && inside(o, x1, y1, x2, y2) && found.push(o));
    return found;
  };
  // A run is clear when no step's inside meets it (a line has no width: a step it only touches does not count).
  const clear = (x1, y1, x2, y2) => !hits(x1 === x2 ? x1 - 1e-3 : x1, y1 === y2 ? y1 - 1e-3 : y1, x1 === x2 ? x2 + 1e-3 : x2, y1 === y2 ? y2 + 1e-3 : y2).length;
  const along = (points) => (taken ? overlap(points, ends, taken) : 0);
  // Where a run across from x1 to x2 may go, between y and `until`: a lead over `until`, lifted over each step it would
  // meet there, and higher two thirds of a lead at a time (the order's tracks are as far apart), or halfway up to y.
  const heights = (x1, x2, y, until) => {
    let h = until - lead;
    for (let met = hits(x1, h - 1e-3, x2, h + 1e-3); met.length && h >= y; met = hits(x1, h - 1e-3, x2, h + 1e-3)) h = Math.min(...met.map((o) => o.y - o.h / 2)) - lead;
    return [...Array.from({ length: 5 }, (_, k) => h - (k * 2 * lead) / 3), (y + h) / 2].filter((v) => v >= y);
  };
  const points = [[sx, sy]];
  let [x, y] = [sx, sy];
  for (let rows = 0; rows < 200; rows++) {
    // Over the second: down, across and down into it, where it runs along the least drawn.
    let best, least = Infinity;
    for (const h of heights(x, tx, y, ty + lead)) {
      const p = [[x, y], [x, h], [tx, h], [tx, ty]];
      if (h > ty || !clear(x, y, x, h) || !clear(x, h, tx, h) || !clear(tx, h, tx, ty)) continue;
      const cost = along(p);
      if (cost < least) ((least = cost), (best = p));
      if (!least) break;
    }
    if (best) return [...points, ...best.slice(1)];
    // Else past the first step in the way down this line, to a lane beside it that goes on down past its row.
    const below = hits(x - 1e-3, y, x + 1e-3, ty);
    if (!below.length) return undefined;
    const block = below.reduce((p, q) => (q.y - q.h / 2 < p.y - p.h / 2 ? q : p));
    const toRight = tx === x ? block.x < x : tx > x;
    const top = block.y - block.h / 2, foot = block.y + block.h / 2;
    // The lanes through its row: down the middle of each gap between the steps there (a lead in from each side of a
    // wide one), the nearest few on each side of it.
    const row = hits(block.x - 40 * lead, top + 1e-3, block.x + 40 * lead, foot - 1e-3).map((o) => [o.x - o.w / 2, o.x + o.w / 2]).sort((p, q) => p[0] - q[0]);
    const gaps = [];
    let edge = -Infinity;
    for (const [l, r] of row) ((l > edge && gaps.push([edge, l])), (edge = Math.max(edge, r)));
    gaps.push([edge, Infinity]);
    const lanesIn = ([l, r]) => (r - l < 3 * lead ? [(l + r) / 2] : [l + lead, r - lead].filter(Number.isFinite));
    const [l0, r0] = [block.x - block.w / 2, block.x + block.w / 2];
    const sides = { false: gaps.filter(([, r]) => r <= l0 + 1e-6).reverse().flatMap(lanesIn).slice(0, 8), true: gaps.filter(([l]) => l >= r0 - 1e-6).flatMap(lanesIn).slice(0, 8) };
    // The first that runs along nothing drawn, on the side it goes first, is taken at once.
    search: for (const right of [toRight !== away, toRight === away])
      for (const to of sides[right]) {
        for (const h of heights(x, to, y, top)) {
          if (!clear(x, y, x, h) || !clear(x, h, to, h) || !clear(to, h, to, foot)) continue;
          // The other side only where this one runs along more: by more than a lead's worth.
          const runs = along([[x, y], [x, h], [to, h], [to, foot]]), first = right === (toRight !== away);
          const cost = runs * ALONG + (first ? 0 : lead * ALONG) + Math.abs(to - x) / 10;
          if (cost < least) ((least = cost), (best = [to, h]));
          if (!runs && first) break search;
        }
      }
    if (!best) return undefined;
    points.push([x, best[1]], best);
    [x, y] = best;
  }
  return undefined;
}

/**
 * A wire at right angles from the foot of a to the head of b (each { x, y, w, h }, x and y its middle), across the
 * track that passes through the fewest of the other steps (`others`), and then runs along the fewest of the paths
 * drawn already (`taken`, kept by take), the middle one when more than one ties. Where every such track passes through
 * a step or along a path drawn, it may go down round the steps a row at a time instead (stairs), whichever costs least:
 * through no step above all, then along the least drawn, then with the fewest turns, then the shortest.
 */
export function route(a, b, lead, others = [], taken) {
  const [ax, ay, bx, by] = [a.x, a.y + a.h / 2, b.x, b.y - b.h / 2];
  const ends = [a.id, b.id].filter((id) => id !== undefined);
  const plain = straight(a, b, lead, others, taken, ends);
  if (crossings(plain, others, ends) === 0 && (!taken || overlap(plain, ends, taken) === 0)) return plain;
  let chosen = plain, least = costOf(plain, others, ends, taken);
  for (const away of [false, true]) {
    const found = stairs(ax, ay + lead, bx, by - lead, lead, others, ends, taken, away);
    const p = found && tidy([[ax, ay], ...found, [bx, by]]);
    const cost = p ? costOf(p, others, ends, taken) : Infinity;
    if (cost < least) ((least = cost), (chosen = p));
    // Round the steps along nothing drawn: the other way round is not tried.
    if (p && cost < THROUGH && (!taken || !overlap(p, ends, taken))) break;
  }
  return chosen;
}

/** The wire of route by a track across (or a column beside, when b is not below a), with no lane of its own. */
function straight(a, b, lead, others, taken, ends) {
  const [ax, ay, bx, by] = [a.x, a.y + a.h / 2, b.x, b.y - b.h / 2];
  // A track that passes through more steps than the best so far is not measured for what it runs along.
  const best = (candidates, path) => {
    let chosen, least = Infinity;
    for (const c of candidates) {
      const p = path(c), through = crossings(p, others, ends) * 1e6;
      if (through >= least) continue;
      const cost = through + (taken ? overlap(p, ends, taken) : 0);
      if (cost < least) ((least = cost), (chosen = p));
      if (!least) break;
    }
    return chosen;
  };
  // Tracks across, the middle first, out to the very ends of the room (just under the one, just over the other).
  const spread = (from, to, n = taken ? 9 : 5) => [...Array.from({ length: n }, (_, k) => from + ((to - from) * (k + 0.5)) / n), from, to].sort((p, q) => Math.abs(p - (from + to) / 2) - Math.abs(q - (from + to) / 2));
  if (by - ay >= 2 * lead) {
    // The two drops are the same for every track but for where they turn: the steps along each are found once, and a
    // track counts those its drops reach and those its run across passes.
    const along = (x) => {
      const found = [];
      const keep = (o) => !ends.includes(o.id) && x > o.x - o.w / 2 && x < o.x + o.w / 2 && o.y + o.h / 2 > ay && o.y - o.h / 2 < by && found.push(o);
      if (Array.isArray(others)) others.forEach(keep);
      else others.each(x, ay, x, by, keep);
      return found;
    };
    const [downA, downB] = [along(ax), along(bx)];
    const reach = (list, y1, y2) => list.reduce((n, o) => n + (o.y + o.h / 2 > y1 && o.y - o.h / 2 < y2 ? 1 : 0), 0);
    let chosen, least = Infinity;
    // A tie's tracks are a lead apart from just under a (or just over b), so the ties out of one step lie on one another
    // as a bus: the nearest eight to each.
    const grid = [...new Set([1, 2, 3, 4, 5, 6, 7, 8].flatMap((k) => [ay + k * lead, by - k * lead]))].filter((v) => v >= ay + lead && v <= by - lead);
    for (const my of taken ? [...grid, ...spread(ay + lead, by - lead)] : spread(ay + lead, by - lead)) {
      const p = [[ax, ay], [ax, my], [bx, my], [bx, by]];
      const through = (reach(downA, ay, my) + reach(downB, my, by) + crossings([[ax, my], [bx, my]], others, ends)) * 1e6;
      if (through >= least) continue;
      const cost = through + (taken ? overlap(p, ends, taken) : 0);
      if (cost < least) ((least = cost), (chosen = p));
      if (!least) break;
    }
    return chosen;
  }
  // Not below: down out of the first, across beside them both (or between, where there is room), and down into the second.
  const between = Math.abs(bx - ax) >= (a.w + b.w) / 2 + 2 * lead;
  const side = Math.max(ax + a.w / 2, bx + b.w / 2) + lead, other = Math.min(ax - a.w / 2, bx - b.w / 2) - lead;
  const columns = between ? [ax < bx ? (ax + a.w / 2 + bx - b.w / 2) / 2 : (ax - a.w / 2 + bx + b.w / 2) / 2, side, other] : [side, other];
  // Beside them, further out a track at a time, when the nearest is taken.
  const out = taken ? [1, 2, 3].flatMap((k) => [side + k * lead, other - k * lead]) : [];
  // Out and in a lead from each, or further when that runs along what is drawn: the heights across are a half lead apart.
  const [outs, ins] = taken ? [[1, 2, 3].map((k) => ay + k * lead), [1, 2, 3].map((k) => by - k * lead)] : [[ay + lead], [by - lead]];
  const tracks = [...columns, ...out].flatMap((cx) => outs.flatMap((y1) => ins.map((y2) => [cx, y1, y2])));
  return best(tracks, ([cx, y1, y2]) => [[ax, ay], [ax, y1], [cx, y1], [cx, y2], [bx, y2], [bx, by]]);
}

/** A tie routed as a wire is, at right angles round the other steps: from the higher of its two ends down into the lower. */
export function tieRoute(a, b, lead, others = [], taken) {
  const points = a.y <= b.y ? route(a, b, lead, others, taken) : route(b, a, lead, others, taken);
  take(taken, points, [a.id, b.id].filter((id) => id !== undefined));
  return points;
}

/** A tie (part_of, or any link that is not the order): straight, from the edge of a to the edge of b, toward each other's middle. */
export function tieLine(a, b) {
  const [dx, dy] = [b.x - a.x, b.y - a.y];
  if (!dx && !dy) return [[a.x, a.y], [b.x, b.y]];
  const edge = (box, sx, sy) => {
    const t = Math.min(sx ? box.w / 2 / Math.abs(sx) : Infinity, sy ? box.h / 2 / Math.abs(sy) : Infinity);
    return [box.x + sx * t, box.y + sy * t];
  };
  return [edge(a, dx, dy), edge(b, -dx, -dy)];
}

/**
 * A tie of an outline (./graph.js): down from the foot of what the leaf is part of (`a`) to halfway to the outline's
 * top (`top`, the highest of its first row), across to the bus of the leaf's column (`bus` across from its left), down
 * it, and into the leaf's (`b`) side. Every tie of a column runs along the same bus. Across at `lane` when given, a
 * height between the foot and the top that no other outline's run across takes (layout.js).
 */
export function outlineRoute(a, b, top, bus, lane = (a.y + a.h / 2 + top) / 2) {
  const [foot, line] = [a.y + a.h / 2, b.x - b.w / 2 - bus];
  const points = [[a.x, foot], [a.x, lane], [line, lane], [line, b.y], [b.x - b.w / 2, b.y]];
  return points.filter((p, k) => !k || p[0] !== points[k - 1][0] || p[1] !== points[k - 1][1]);
}

/**
 * Route every tie (each { a, b }, given its points) round the steps (`steps`, each { id, x, y, w, h }) and off what is
 * drawn: the order's wires (`chains`), then the outlines, then the rest, each keeping off those before it. A tie into an
 * outline's leaf (`outlines`, its leaf and parent to the top of its outline) runs across at a lane of its parent's own:
 * of the heights between the parent's foot and that top, `track` apart, the one that runs along the least drawn.
 */
export function routeTies(ties, steps, chains, outlines, { lead, cell, track }) {
  const around = field(steps, cell), at = new Map(steps.map((s) => [s.id, s]));
  // Two lines closer than the order's tracks are apart read as one: each keeps that far off what is drawn, or lies on it
  // as one bus.
  const taken = drawnPaths(track);
  for (const c of chains) take(taken, c.points, [c.a, c.b]);
  const lanes = new Map();
  for (const t of ties) {
    const top = outlines.get(`${t.a} ${t.b}`);
    if (top === undefined) continue;
    const [leaf, parent] = [at.get(t.a), at.get(t.b)];
    if (!lanes.has(t.b)) {
      const foot = parent.y + parent.h / 2, n = Math.max(1, Math.floor((top - foot) / track) - 1);
      const heights = Array.from({ length: n }, (_, k) => foot + ((top - foot) * (k + 1)) / (n + 1)).sort((p, q) => Math.abs(p - (foot + top) / 2) - Math.abs(q - (foot + top) / 2));
      const along = (h) => overlap(outlineRoute(parent, leaf, top, lead, h), [t.a, t.b], taken);
      lanes.set(t.b, heights.reduce((best, h) => (along(h) < along(best) ? h : best), heights[0]));
    }
    take(taken, (t.points = outlineRoute(parent, leaf, top, lead, lanes.get(t.b))), [t.a, t.b]);
  }
  for (const t of ties) if (!outlines.has(`${t.a} ${t.b}`)) t.points = tieRoute(at.get(t.a), at.get(t.b), lead, around, taken);
}
