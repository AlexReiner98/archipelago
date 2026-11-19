// Wires run square (study e_unru8ftt, round 5, theme e_zhcpy8bf): every link leaves and enters a box at right angles,
// from the middle of a side, and runs in the gutters between the boxes, never across one. One route a wire at a time,
// the shortest first, each by a search over the lines the boxes' edges make: what it costs is its length, a bend, a
// place where it crosses a wire already run, and a stretch it shares with one. Layer: metrics. Pure: boxes in, lines out.


const STEP = [[1, 0], [-1, 0], [0, 1], [0, -1]], [E, W, S, N] = STEP.keys(), WAYS = STEP.length, OPPOSITE = [W, E, N, S];

/** A line with repeated points and points along a straight run taken out. */
const tidy = (points) => points.reduce((out, p) => {
  if (out.length && out.at(-1)[0] === p[0] && out.at(-1)[1] === p[1]) return out;
  const [a, b] = out.slice(-2);
  if (out.length > 1 && ((a[0] === b[0] && b[0] === p[0]) || (a[1] === b[1] && b[1] === p[1]))) out.pop();
  return out.concat([[...p]]);
}, []);

/** The sorted, distinct values of a list (within a hair of one another counted as one). */
const lines = (list) => {
  const out = [];
  for (const v of [...list].sort((p, q) => p - q)) if (!out.length || v - out.at(-1) > 0.01) out.push(v);
  return out;
};

/** A binary heap of [cost, ...payload] by cost. */
class Heap {
  constructor() { this.a = []; }
  get size() { return this.a.length; }
  push(item) {
    const a = this.a;
    a.push(item);
    for (let i = a.length - 1; i > 0;) {
      const p = (i - 1) >> 1;
      if (a[p][0] <= a[i][0]) break;
      [a[p], a[i]] = [a[i], a[p]];
      i = p;
    }
  }
  pop() {
    const a = this.a, top = a[0], last = a.pop();
    if (a.length) {
      a[0] = last;
      for (let i = 0; ;) {
        const [l, r] = [2 * i + 1, 2 * i + 2];
        let m = i;
        if (l < a.length && a[l][0] < a[m][0]) m = l;
        if (r < a.length && a[r][0] < a[m][0]) m = r;
        if (m === i) break;
        [a[m], a[i]] = [a[i], a[m]];
        i = m;
      }
    }
    return top;
  }
}

/**
 * The lines of `wires` ({ a, b }, ids of `nodes` standing at `x`, `y`, each with its `w` and `h`) run square, answered
 * as a list of lines of points (from a's outline to b's), or null where a wire found no way (the caller draws it
 * straight). `sizes` are the style's: flow_square_clear (how far a line keeps from a box), flow_square_port (how far
 * apart the ports on a side are), flow_square_bend, flow_square_cross and flow_square_share (what each costs, in the
 * length of a line; a shared stretch costs its length times flow_square_share again), flow_square_port_used.
 */
export function squareLines({ wires, nodes, x, y, sizes }) {
  const clear = sizes.flow_square_clear, step = sizes.flow_square_port, BEND = sizes.flow_square_bend, CROSS = sizes.flow_square_cross, SHARE = sizes.flow_square_share, USED = sizes.flow_square_port_used;
  const boxes = new Map();
  for (const [id, n] of nodes) if (x.has(id)) boxes.set(id, { l: x.get(id) - n.w / 2, r: x.get(id) + n.w / 2, t: y.get(id) - n.h / 2, b: y.get(id) + n.h / 2, cx: x.get(id), cy: y.get(id), w: n.w, h: n.h });
  const all = [...boxes.values()];
  const xs = lines(all.flatMap((q) => [q.l - clear, q.r + clear, q.cx - step, q.cx, q.cx + step])), ys = lines(all.flatMap((q) => [q.t - clear, q.b + clear, q.cy - step, q.cy, q.cy + step]));
  const NX = xs.length, NY = ys.length, xi = new Map(xs.map((v, i) => [v, i])), yi = new Map(ys.map((v, j) => [v, j]));
  const near = (list, index, v) => { let lo = 0, hi = list.length - 1; while (lo < hi) { const mid = (lo + hi) >> 1; if (list[mid] < v - 0.01) lo = mid + 1; else hi = mid; } return index.get(list[lo]); };
  // A stretch between two neighbouring lines is blocked where it runs through the inside of a box and its clear room.
  const hBlock = new Uint8Array(NX * NY), vBlock = new Uint8Array(NX * NY);
  for (const q of all) {
    const [l, r, t, b] = [q.l - clear, q.r + clear, q.t - clear, q.b + clear];
    for (let j = 0; j < NY; j++) {
      if (!(ys[j] > t + 0.01 && ys[j] < b - 0.01)) continue;
      for (let i = 0; i < NX - 1; i++) if (xs[i] < r - 0.01 && xs[i + 1] > l + 0.01) hBlock[j * NX + i] = 1;
    }
    for (let i = 0; i < NX; i++) {
      if (!(xs[i] > l + 0.01 && xs[i] < r - 0.01)) continue;
      for (let j = 0; j < NY - 1; j++) if (ys[j] < b - 0.01 && ys[j + 1] > t + 0.01) vBlock[j * NX + i] = 1;
    }
  }
  const at = (i, j) => j * NX + i;
  const used = new Uint8Array(NX * NY * 2), straightV = new Uint8Array(NX * NY), straightH = new Uint8Array(NX * NY), ports = new Map();
  // The ports of a box: three on each side, from the middle outward. Each has the point on the box's outline, the point
  // a clear room off it, and the way in.
  const portsOf = (q) => {
    const out = [];
    for (const k of [0, -1, 1]) {
      out.push({ edge: [q.cx + k * step, q.t], out: N, p: [near(xs, xi, q.cx + k * step), near(ys, yi, q.t - clear)], key: `${q.cx}|${q.cy}|N${k}` });
      out.push({ edge: [q.cx + k * step, q.b], out: S, p: [near(xs, xi, q.cx + k * step), near(ys, yi, q.b + clear)], key: `${q.cx}|${q.cy}|S${k}` });
      out.push({ edge: [q.l, q.cy + k * step], out: W, p: [near(xs, xi, q.l - clear), near(ys, yi, q.cy + k * step)], key: `${q.cx}|${q.cy}|W${k}` });
      out.push({ edge: [q.r, q.cy + k * step], out: E, p: [near(xs, xi, q.r + clear), near(ys, yi, q.cy + k * step)], key: `${q.cx}|${q.cy}|E${k}` });
    }
    return out;
  };
  const edgeId = (i, j, d) => (d === E ? at(i, j) * 2 : d === W ? at(i - 1, j) * 2 : d === S ? at(i, j) * 2 + 1 : at(i, j - 1) * 2 + 1);
  const blocked = (i, j, d) => (d === E ? i >= NX - 1 || hBlock[at(i, j)] : d === W ? i < 1 || hBlock[at(i - 1, j)] : d === S ? j >= NY - 1 || vBlock[at(i, j)] : j < 1 || vBlock[at(i, j - 1)]);

  const route = (w) => {
    const [qa, qb] = [boxes.get(w.a), boxes.get(w.b)];
    if (!qa || !qb) return null;
    const goals = new Map();
    for (const g of portsOf(qb)) (goals.get(at(...g.p)) ?? goals.set(at(...g.p), []).get(at(...g.p))).push(g);
    const heap = new Heap(), best = new Map(), from = new Map();
    const key = (i, j, d) => at(i, j) * WAYS + d;
    const reach = (px, py) => Math.max(0, Math.abs(px - qb.cx) - qb.w / 2 - clear) + Math.max(0, Math.abs(py - qb.cy) - qb.h / 2 - clear);
    for (const s of portsOf(qa)) {
      const k = key(s.p[0], s.p[1], s.out), g = clear + (ports.get(s.key) ?? 0) * USED;
      if (best.has(k) && best.get(k) <= g) continue;
      best.set(k, g);
      from.set(k, { start: s });
      heap.push([g + reach(xs[s.p[0]], ys[s.p[1]]), k, g]);
    }
    while (heap.size) {
      const [, k, g] = heap.pop();
      if (k === -1) {
        const end = from.get('end'), line = [];
        for (let c = end.at; c !== undefined;) {
          const f = from.get(c);
          line.push([xs[Math.floor(c / WAYS) % NX], ys[Math.floor(Math.floor(c / WAYS) / NX)]]);
          if (f.start) return { points: tidy([f.start.edge, ...line.reverse(), end.port.edge]), start: f.start, end: end.port };
          c = f.prev;
        }
        return null;
      }
      if (g > best.get(k)) continue;
      const [d, cell] = [k % WAYS, Math.floor(k / WAYS)], [i, j] = [cell % NX, Math.floor(cell / NX)];
      for (const port of goals.get(cell) ?? []) {
        if (d === port.out) continue;
        const total = g + (d === OPPOSITE[port.out] ? 0 : BEND) + clear + (ports.get(port.key) ?? 0) * USED;
        if (!from.has('end') || total < from.get('end').cost) {
          from.set('end', { at: k, port, cost: total });
          heap.push([total, -1, total]);
        }
      }
      for (let n = 0; n < WAYS; n++) {
        if (n === OPPOSITE[d] || blocked(i, j, n)) continue;
        const [ni, nj] = [i + STEP[n][0], j + STEP[n][1]], run = Math.abs(xs[ni] - xs[i]) + Math.abs(ys[nj] - ys[j]);
        let cost = g + run * (used[edgeId(i, j, n)] ? 1 + SHARE : 1);
        if (n !== d) cost += BEND;
        else if ((n < 2 ? straightV : straightH)[cell]) cost += CROSS;
        const nk = key(ni, nj, n);
        if (best.has(nk) && best.get(nk) <= cost) continue;
        best.set(nk, cost);
        from.set(nk, { prev: k });
        heap.push([cost + reach(xs[ni], ys[nj]), nk, cost]);
      }
    }
    return null;
  };

  // What a run leaves behind for the next: its edges used, the places it passes straight through, the ports it takes.
  const record = ({ points, start, end }) => {
    ports.set(start.key, (ports.get(start.key) ?? 0) + 1);
    ports.set(end.key, (ports.get(end.key) ?? 0) + 1);
    const cells = [[...start.p], ...points.slice(1, -1).map((p) => [xi.get(p[0]), yi.get(p[1])]), [...end.p]];
    for (let n = 1; n < cells.length; n++) {
      const [[i0, j0], [i1, j1]] = [cells[n - 1], cells[n]];
      if (i0 === i1) for (let j = Math.min(j0, j1); j < Math.max(j0, j1); j++) { used[at(i0, j) * 2 + 1] = 1; if (j > Math.min(j0, j1)) straightV[at(i0, j)] = 1; }
      else if (j0 === j1) for (let i = Math.min(i0, i1); i < Math.max(i0, i1); i++) { used[at(i, j0) * 2] = 1; if (i > Math.min(i0, i1)) straightH[at(i, j0)] = 1; }
    }
  };

  const long = (w) => Math.abs((x.get(w.a) ?? 0) - (x.get(w.b) ?? 0)) + Math.abs((y.get(w.a) ?? 0) - (y.get(w.b) ?? 0));
  const results = new Array(wires.length).fill(null);
  [...wires.keys()].sort((p, q) => long(wires[p]) - long(wires[q]) || p - q).forEach((k) => {
    const done = route(wires[k]);
    if (done) (record(done), (results[k] = done.points));
  });
  return apart(results, sizes.flow_square_track);
}

/**
 * Wires that run along one another in a gutter are set apart: each stretch of a line (not the ones that leave or enter a
 * box, which stand at their ports) that another shares is moved `track` from the next, so no two lie on one line. Of
 * the wires on one line, the ones that turn up (or left) at their ends stand on the up (or left) side, so they cross fewest.
 */
export function apart(lines, track) {
  const runs = [];
  lines.forEach((line, w) => {
    if (!line) return;
    for (let s = 1; s + 2 < line.length; s++) {
      const [p, q] = [line[s], line[s + 1]], across = p[1] === q[1] ? 1 : 0, along = 1 - across;
      if (p[across] !== q[across]) continue;
      const turn = (point, beyond) => Math.sign(beyond[across] - point[across]);
      runs.push({ w, s, across, at: p[across], from: Math.min(p[along], q[along]), to: Math.max(p[along], q[along]), turns: turn(p, line[s - 1]) + turn(q, line[s + 2]) });
    }
  });
  const moves = [];
  for (const axis of [0, 1]) {
    const by = new Map();
    for (const r of runs) if (r.across === axis) (by.get(r.at) ?? by.set(r.at, []).get(r.at)).push(r);
    for (const list of by.values()) {
      list.sort((a, b) => a.from - b.from);
      for (let i = 0; i < list.length;) {
        let j = i + 1, reach = list[i].to;
        while (j < list.length && list[j].from < reach - 0.01) reach = Math.max(reach, list[j++].to);
        const group = list.slice(i, j);
        if (new Set(group.map((r) => r.w)).size > 1) group.sort((a, b) => a.turns - b.turns || a.w - b.w).forEach((r, k) => moves.push([r, (k - (group.length - 1) / 2) * track]));
        i = j;
      }
    }
  }
  const out = lines.map((line) => line && line.map((p) => [...p]));
  for (const [r, by] of moves) for (const point of [out[r.w][r.s], out[r.w][r.s + 1]]) point[r.across] += by;
  return out;
}
