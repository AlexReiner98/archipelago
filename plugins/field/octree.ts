/**
 * An octree over some particles in x, y and z, as flat arrays, each weighed
 * by its charge q: each cell's mass, middle of mass, size, eight kids, or
 * its one leaf. Barnes-Hut reads a far cell as one particle at its middle.
 */
import type { G } from "./graph.ts";

export interface Octree {
  mass: Float32Array;
  cx: Float32Array;
  cy: Float32Array;
  cz: Float32Array;
  size: Float32Array;
  kid: Int32Array;
  leaf: Int32Array;
}

export function octree(g: G, q: Float32Array, ids: number[]): Octree {
  let x0 = Infinity, y0 = Infinity, z0 = Infinity, x1 = -Infinity, y1 = -Infinity, z1 = -Infinity;
  for (const i of ids) {
    const x = g.x[i]!, y = g.y[i]!, z = g.z[i]!;
    if (x < x0) x0 = x;
    if (x > x1) x1 = x;
    if (y < y0) y0 = y;
    if (y > y1) y1 = y;
    if (z < z0) z0 = z;
    if (z > z1) z1 = z;
  }
  if (!ids.length) (x0 = y0 = z0 = 0), (x1 = y1 = z1 = 1);
  const most = ids.length * 4 + 8;
  const t: Octree & { ox: Float32Array; oy: Float32Array; oz: Float32Array; used: Uint8Array } = {
    mass: new Float32Array(most),
    cx: new Float32Array(most),
    cy: new Float32Array(most),
    cz: new Float32Array(most),
    size: new Float32Array(most),
    ox: new Float32Array(most),
    oy: new Float32Array(most),
    oz: new Float32Array(most),
    kid: new Int32Array(most * 8).fill(-1),
    leaf: new Int32Array(most).fill(-1),
    used: new Uint8Array(most),
  };
  let count = 1;
  t.size[0] = Math.max(x1 - x0, y1 - y0, z1 - z0) + 1;
  t.ox[0] = x0;
  t.oy[0] = y0;
  t.oz[0] = z0;
  const oct = (c: number, i: number) => {
    const h = t.size[c]! / 2;
    return (g.x[i]! >= t.ox[c]! + h ? 1 : 0) + (g.y[i]! >= t.oy[c]! + h ? 2 : 0) + (g.z[i]! >= t.oz[c]! + h ? 4 : 0);
  };
  const kidOf = (c: number, k: number) => {
    const had = t.kid[c * 8 + k]!;
    if (had >= 0) return had;
    const h = t.size[c]! / 2, n = count++;
    if (n >= most) return -1;
    t.size[n] = h;
    t.ox[n] = t.ox[c]! + (k & 1 ? h : 0);
    t.oy[n] = t.oy[c]! + (k & 2 ? h : 0);
    t.oz[n] = t.oz[c]! + (k & 4 ? h : 0);
    t.kid[c * 8 + k] = n;
    return n;
  };
  for (const i of ids) {
    let c = 0, depth = 0;
    for (;;) {
      if (!t.used[c]) {
        t.used[c] = 1;
        t.leaf[c] = i;
        break;
      }
      if (t.leaf[c]! >= 0) {
        // A leaf splits: its particle goes down a level (or, too deep, two share it).
        if (depth > 24) break;
        const j = t.leaf[c]!, nj = kidOf(c, oct(c, j));
        t.leaf[c] = -1;
        if (nj >= 0) (t.used[nj] = 1), (t.leaf[nj] = j);
      }
      const next = kidOf(c, oct(c, i));
      if (next < 0) break;
      c = next;
      depth++;
    }
  }
  // Masses and middles, from the leaves up (a cell's kids are always made after it).
  for (let c = count - 1; c >= 0; c--) {
    let m = 0, sx = 0, sy = 0, sz = 0;
    const lf = t.leaf[c]!;
    if (lf >= 0) {
      m = q[lf]!;
      sx = g.x[lf]! * m;
      sy = g.y[lf]! * m;
      sz = g.z[lf]! * m;
    }
    for (let k = 0; k < 8; k++) {
      const kid = t.kid[c * 8 + k]!;
      if (kid < 0) continue;
      const km = t.mass[kid]!;
      if (!km) continue;
      m += km;
      sx += t.cx[kid]! * km;
      sy += t.cy[kid]! * km;
      sz += t.cz[kid]! * km;
    }
    if (m) {
      t.mass[c] = m;
      t.cx[c] = sx / m;
      t.cy[c] = sy / m;
      t.cz[c] = sz / m;
    }
  }
  return t;
}
