/**
 * The links as segments in a grid of cells, to ask which cross: every
 * crossing (pairs, count), how many a particle's links would cross were it
 * at (x, y) (crossingsAt), which they cross now (crossedBy). After a
 * particle moves, its links go into their new cells (moved). Two links that
 * share an end never cross. Work done is counted (work), so a caller can
 * share a search out across steps.
 */
import { bounds, type G } from "./graph.ts";

export interface Segments {
  work: number;
  pairs(): Generator<[number, number]>;
  count(): number;
  crossingsAt(p: number, x: number, y: number): number;
  crossedBy(p: number): Set<number>;
  moved(p: number): void;
}

/** Where segment a-b crosses segment c-d (strictly inside both), or null. */
export function cross(ax: number, ay: number, bx: number, by: number, cx: number, cy: number, dx: number, dy: number): [number, number] | null {
  const rx = bx - ax, ry = by - ay, sx = dx - cx, sy = dy - cy, den = rx * sy - ry * sx;
  if (Math.abs(den) < 1e-12) return null;
  const t = ((cx - ax) * sy - (cy - ay) * sx) / den, u = ((cx - ax) * ry - (cy - ay) * rx) / den;
  return t > 0 && t < 1 && u > 0 && u < 1 ? [ax + t * rx, ay + t * ry] : null;
}

export function segments(g: G): Segments {
  const [x0, y0, x1, y1] = bounds(g);
  const cell = Math.max(1, Math.sqrt(((x1 - x0) * (y1 - y0)) / Math.max(1, g.m))) * 1.5;
  const key = (cx: number, cy: number) => (cx * 73856093) ^ (cy * 19349663);
  const cells = new Map<number, Set<number>>();
  const where = new Map<number, [number, number]>();
  const at: number[][] = new Array(g.m);
  const inCell = (pt: [number, number], cx: number, cy: number) => Math.floor((pt[0] - x0) / cell) === cx && Math.floor((pt[1] - y0) / cell) === cy;
  const cover = (ax: number, ay: number, bx: number, by: number, fn: (c: number, cx: number, cy: number) => void) => {
    const cx0 = Math.floor((Math.min(ax, bx) - x0) / cell), cx1 = Math.floor((Math.max(ax, bx) - x0) / cell);
    const cy0 = Math.floor((Math.min(ay, by) - y0) / cell), cy1 = Math.floor((Math.max(ay, by) - y0) / cell);
    if ((cx1 - cx0 + 1) * (cy1 - cy0 + 1) > 400) return; // a very long link is left to the springs
    for (let cx = cx0; cx <= cx1; cx++) for (let cy = cy0; cy <= cy1; cy++) fn(key(cx, cy), cx, cy);
  };
  const put = (e: number) => {
    const list: number[] = (at[e] = []);
    const a = g.a[e]!, b = g.b[e]!;
    cover(g.x[a]!, g.y[a]!, g.x[b]!, g.y[b]!, (c, cx, cy) => {
      let s = cells.get(c);
      if (!s) cells.set(c, (s = new Set())), where.set(c, [cx, cy]);
      s.add(e);
      list.push(c);
    });
  };
  for (let e = 0; e < g.m; e++) put(e);

  // How many links the segment p-q (p at px, py) crosses, leaving out link `self`.
  const crossCount = (p: number, px: number, py: number, q: number, self: number, out: Set<number> | null) => {
    let n = 0;
    const qx = g.x[q]!, qy = g.y[q]!;
    cover(px, py, qx, qy, (c, cx, cy) => {
      const list = cells.get(c);
      if (!list) return;
      api.work += list.size;
      for (const k of list) {
        const a = g.a[k]!, b = g.b[k]!;
        if (k === self || a === p || b === p || a === q || b === q) continue;
        const pt = cross(px, py, qx, qy, g.x[a]!, g.y[a]!, g.x[b]!, g.y[b]!);
        if (pt && inCell(pt, cx, cy)) {
          n++;
          out?.add(k);
        }
      }
    });
    return n;
  };
  const api: Segments = {
    work: 0,
    *pairs() {
      for (const [c, list] of cells) {
        const arr = [...list], [cx, cy] = where.get(c)!;
        api.work += (arr.length * (arr.length - 1)) / 2;
        for (let i = 0; i < arr.length; i++) for (let j = i + 1; j < arr.length; j++) {
          const k1 = arr[i]!, k2 = arr[j]!, a = g.a[k1]!, b = g.b[k1]!, c2 = g.a[k2]!, d = g.b[k2]!;
          if (a === c2 || a === d || b === c2 || b === d) continue;
          const pt = cross(g.x[a]!, g.y[a]!, g.x[b]!, g.y[b]!, g.x[c2]!, g.y[c2]!, g.x[d]!, g.y[d]!);
          // A crossing is counted once, in the cell its point lies in.
          if (pt && inCell(pt, cx, cy)) yield [k1, k2];
        }
      }
    },
    count() {
      let n = 0;
      for (const _ of api.pairs()) n++;
      return n;
    },
    crossingsAt(p, x, y) {
      let n = 0;
      for (const e of g.incident[p]!) n += crossCount(p, x, y, g.a[e] === p ? g.b[e]! : g.a[e]!, e, null);
      return n;
    },
    crossedBy(p) {
      const out = new Set<number>();
      for (const e of g.incident[p]!) crossCount(p, g.x[p]!, g.y[p]!, g.a[e] === p ? g.b[e]! : g.a[e]!, e, out);
      return out;
    },
    moved(p) {
      for (const e of g.incident[p]!) {
        for (const c of at[e] ?? []) cells.get(c)?.delete(e);
        put(e);
      }
    },
  };
  return api;
}
