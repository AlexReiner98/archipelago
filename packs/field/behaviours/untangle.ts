/**
 * Untangle: a search for a local minimum of crossings. A force can't do it
 * well: a push to undo one crossing is pulled back by the springs first.
 *
 * Once the forces have roughly settled (warmth under `untangle_from`), a
 * pass ranks the particles by how many crossings their links are in (the
 * `untangle_tries` worst), and each step tries the next of them: moving it
 * to the middle of its neighbours, or to its mirror across each link it
 * crosses (at most `untangle_mirrors`). A move is kept only if its links
 * then cross fewer others, so crossings never rise by its hand.
 *
 * Sliced: each step does at most `untangle_work` tests of one link against
 * another, so no frame waits on it. Once the forces sleep it goes on alone,
 * keeping the run awake (and then landing on no other particle), until a
 * whole pass moves nothing or `untangle_passes` is reached. Counted, not
 * timed, so every machine reaches the same picture.
 */
import { weight, type Behaviour } from "../behaviour.ts";
import type { G, Settings } from "../graph.ts";
import { segments, type Segments } from "../segments.ts";

interface Search {
  list: number[];
  at: number;
  moved: number;
  passes: number;
  done: boolean;
  segs: Segments | null;
  spots: Spots | null;
}

const untangle: Behaviour = {
  name: "untangle",
  doc: "Particles step to where their links cross fewer others.",
  on: true,
  dials: () => [
    weight("untangle", 1, 1),
    { key: "untangle_from", label: "starts at warmth", min: 0, max: 1, step: 0.01, value: 0.3, doc: "The search starts once the run has cooled to this warmth." },
    { key: "untangle_tries", label: "worst per pass", min: 10, max: 5000, step: 10, value: 1000, doc: "How many of the particles in most crossings each pass tries." },
    { key: "untangle_hub", label: "hubs stay", min: 1, max: 100, step: 1, value: 16, doc: "A particle with more links than this is never moved by the search." },
    { key: "untangle_work", label: "tests per step", min: 1000, max: 500000, step: 1000, value: 60000, doc: "How many link-against-link tests each step may do: the slice that keeps frames smooth." },
    { key: "untangle_mirrors", label: "mirrors", min: 0, max: 64, step: 1, value: 16, doc: "How many of the links it crosses a particle tries mirroring across." },
    { key: "untangle_passes", label: "passes", min: 1, max: 50, step: 1, value: 12, doc: "At most this many passes once the forces sleep." },
  ],
  apply() {},
  busy: (sim) => !(sim.un as Search | undefined)?.done,
  move(g, S, sim) {
    // While the forces run hot, crossings are only counted now and then.
    if (sim.alpha > S.untangle_from!) {
      if (sim.steps % 25 === 0) sim.crossings = segments(g).count();
      return;
    }
    const un = (sim.un ??= { list: [], at: 0, moved: 0, passes: 0, done: false, segs: null, spots: null } satisfies Search) as Search;
    if (un.done) return;
    // While the forces still move things the index is rebuilt each step; asleep, only this moves anything and it keeps the index itself.
    const cold = sim.alpha < S.alpha_min!;
    if (!un.segs || !cold) (un.segs = segments(g)), (un.spots = null);
    if (cold) un.spots ??= spots(g, S);
    const segs = un.segs;
    if (un.at >= un.list.length) {
      if (cold && un.passes && (!un.moved || un.passes >= S.untangle_passes!)) {
        un.done = true;
        un.segs = null;
        return;
      }
      const hits = new Int32Array(g.n);
      let found = 0;
      for (const [k1, k2] of segs.pairs()) {
        hits[g.a[k1]!]!++;
        hits[g.b[k1]!]!++;
        hits[g.a[k2]!]!++;
        hits[g.b[k2]!]!++;
        found++;
      }
      sim.crossings = found;
      const worst: number[] = [];
      for (let i = 0; i < g.n; i++) if (hits[i] && !g.fixed[i] && g.degree[i]! <= S.untangle_hub!) worst.push(i);
      worst.sort((p, q) => hits[q]! - hits[p]! || p - q);
      un.list = worst.slice(0, S.untangle_tries!);
      un.at = 0;
      un.moved = 0;
      un.passes++;
      if (!un.list.length) {
        un.done = cold;
        un.segs = null;
        return;
      }
    }
    let moved = 0;
    const w0 = segs.work;
    while (un.at < un.list.length && segs.work - w0 < S.untangle_work!) {
      const i = un.list[un.at++]!, ix = g.x[i]!, iy = g.y[i]!;
      const now = segs.crossingsAt(i, ix, iy);
      if (!now) continue;
      const tries: [number, number][] = [];
      const near = g.incident[i]!.map((e) => (g.a[e] === i ? g.b[e]! : g.a[e]!));
      if (near.length) tries.push([near.reduce((t, q) => t + g.x[q]!, 0) / near.length, near.reduce((t, q) => t + g.y[q]!, 0) / near.length]);
      let m = 0;
      for (const k of segs.crossedBy(i)) {
        if (m++ >= S.untangle_mirrors!) break;
        const c = g.a[k]!, d = g.b[k]!, ux = g.x[d]! - g.x[c]!, uy = g.y[d]! - g.y[c]!, uu = ux * ux + uy * uy || 1e-9;
        const t = ((ix - g.x[c]!) * ux + (iy - g.y[c]!) * uy) / uu, fx = g.x[c]! + t * ux, fy = g.y[c]! + t * uy;
        tries.push([2 * fx - ix, 2 * fy - iy]);
      }
      let best: [number, number] | null = null, bestN = now;
      for (const [tx, ty] of tries) {
        const spot = un.spots ? un.spots.near(i, tx, ty) : ([tx, ty] as [number, number]);
        if (!spot) continue;
        const n = segs.crossingsAt(i, spot[0], spot[1]);
        if (n < bestN) (bestN = n), (best = spot);
      }
      if (best) {
        g.x[i] = best[0];
        g.y[i] = best[1];
        g.vx[i] = 0;
        g.vy[i] = 0;
        segs.moved(i);
        un.spots?.moved(i);
        moved++;
        sim.crossings -= now - bestN;
      }
    }
    un.moved += moved;
    sim.untangled = (sim.untangled ?? 0) + moved;
  },
};

interface Spots {
  near(i: number, x: number, y: number): [number, number] | null;
  moved(i: number): void;
}
/** The particles in a grid, to ask whether a spot is free: no particle nearer than both radii and the collide gap. */
function spots(g: G, S: Settings): Spots {
  let rmax = 0;
  for (let i = 0; i < g.n; i++) rmax = Math.max(rmax, g.r[i]!);
  const gap = S.collide_gap ?? 0;
  const cell = 2 * rmax + gap, cells = new Map<number, number[]>(), at = new Array<number>(g.n);
  const key = (cx: number, cy: number) => (cx * 73856093) ^ (cy * 19349663);
  const put = (i: number) => {
    const k = (at[i] = key(Math.floor(g.x[i]! / cell), Math.floor(g.y[i]! / cell)));
    let list = cells.get(k);
    if (!list) cells.set(k, (list = []));
    list.push(i);
  };
  for (let i = 0; i < g.n; i++) put(i);
  const free = (i: number, x: number, y: number) => {
    const cx = Math.floor(x / cell), cy = Math.floor(y / cell), r = g.r[i]!;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) for (const j of cells.get(key(cx + dx, cy + dy)) ?? []) {
      if (j !== i && Math.hypot(g.x[j]! - x, g.y[j]! - y) < r + g.r[j]! + gap) return false;
    }
    return true;
  };
  return {
    // The spot itself if free, else the first free one of six round it, its width away; or null.
    near(i, x, y) {
      if (free(i, x, y)) return [x, y];
      const d = 2 * g.r[i]! + gap;
      for (let k = 0; k < 6; k++) {
        const sx = x + d * Math.cos((k * Math.PI) / 3), sy = y + d * Math.sin((k * Math.PI) / 3);
        if (free(i, sx, sy)) return [sx, sy];
      }
      return null;
    },
    moved(i) {
      const list = cells.get(at[i]!);
      if (list) list.splice(list.indexOf(i), 1);
      put(i);
    },
  };
}

export default untangle;
