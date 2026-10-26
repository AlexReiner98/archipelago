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
/** How far a path runs along what is drawn already, within `near` of it: a run that shares a step with it is a bus, and costs nothing. */
const overlap = (points, ends, taken) => {
  let n = 0;
  for (const r of runsOf(points, ends))
    for (const d of [-1, 0, 1])
      for (const o of taken.lines.get(lineOf(taken, r.h, r.at + d * taken.near)) ?? [])
        if (Math.abs(o.at - r.at) < taken.near && !o.ends.some((e) => ends.includes(e))) n += Math.max(0, Math.min(r.hi, o.hi) - Math.max(r.lo, o.lo));
  return n;
};
/** Keep a path as drawn, so the next one routed keeps off it. */
export const take = (taken, points, ends) => {
  if (!taken) return;
  for (const r of runsOf(points, ends)) {
    const key = lineOf(taken, r.h, r.at);
    const line = taken.lines.get(key) ?? taken.lines.set(key, []).get(key);
    // A run along one that shares a step with it is the same bus: the one grows, and carries both runs' steps.
    const bus = line.find((o) => o.h === r.h && Math.abs(o.at - r.at) < 0.01 && o.lo <= r.hi && r.lo <= o.hi && o.ends.some((e) => r.ends.includes(e)));
    if (bus) Object.assign(bus, { lo: Math.min(bus.lo, r.lo), hi: Math.max(bus.hi, r.hi), ends: [...new Set([...bus.ends, ...r.ends])] });
    else line.push(r);
  }
};

/**
 * A wire at right angles from the foot of a to the head of b (each { x, y, w, h }, x and y its middle), across the
 * track that passes through the fewest of the other steps (`others`), and then runs along the fewest of the paths
 * drawn already (`taken`, kept by take), the middle one when more than one ties.
 */
export function route(a, b, lead, others = [], taken) {
  const [ax, ay, bx, by] = [a.x, a.y + a.h / 2, b.x, b.y - b.h / 2];
  const ends = [a.id, b.id].filter((id) => id !== undefined);
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
    for (const my of spread(ay + lead, by - lead)) {
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
  return best([...columns, ...out], (cx) => [[ax, ay], [ax, ay + lead], [cx, ay + lead], [cx, by - lead], [bx, by - lead], [bx, by]]);
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
