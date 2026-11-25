/**
 * The names on the wires (a bough's name, along its branch) give way: one
 * that overlaps anything shown (another name, a node's dot) fades out, and
 * comes back when zoom or a move clears it. They are drawn in the tree's
 * own units, so they grow and shrink with the zoom. A bough nearer the
 * root keeps its name over a deeper one. Each name is tested by its own
 * turned outline, not the box round it, with a little room round it,
 * against the nodes' names and dots, the boughs' dots and the root.
 */

export type Quad = [number, number][];

/** Whether two convex quads overlap (separating axes). */
export function quadsOverlap(a: Quad, b: Quad): boolean {
  for (const q of [a, b]) {
    for (let i = 0; i < q.length; i++) {
      const [x1, y1] = q[i]!, [x2, y2] = q[(i + 1) % q.length]!;
      const nx = y2 - y1, ny = x1 - x2;
      let aMin = Infinity, aMax = -Infinity, bMin = Infinity, bMax = -Infinity;
      for (const [x, y] of a) {
        const d = x * nx + y * ny;
        aMin = Math.min(aMin, d), (aMax = Math.max(aMax, d));
      }
      for (const [x, y] of b) {
        const d = x * nx + y * ny;
        bMin = Math.min(bMin, d), (bMax = Math.max(bMax, d));
      }
      if (aMax <= bMin || bMax <= aMin) return false;
    }
  }
  return true;
}

/** The grid's cell, in screen pixels: a quad is tested only against those in the cells its box touches. */
const CELL = 64;

/** A grid of quads by the cells their boxes touch. */
class Grid {
  private cells = new Map<string, Quad[]>();
  private keys(q: Quad): string[] {
    if (!q.length) return [];
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const [x, y] of q) (x0 = Math.min(x0, x)), (y0 = Math.min(y0, y)), (x1 = Math.max(x1, x)), (y1 = Math.max(y1, y));
    const out: string[] = [];
    for (let i = Math.floor(x0 / CELL); i <= Math.floor(x1 / CELL); i++) for (let j = Math.floor(y0 / CELL); j <= Math.floor(y1 / CELL); j++) out.push(`${i},${j}`);
    return out;
  }
  add(q: Quad) {
    for (const k of this.keys(q)) (this.cells.get(k) ?? (this.cells.set(k, []), this.cells.get(k)!)).push(q);
  }
  hits(q: Quad): boolean {
    const seen = new Set<Quad>();
    for (const k of this.keys(q))
      for (const s of this.cells.get(k) ?? []) {
        if (seen.has(s)) continue;
        seen.add(s);
        if (quadsOverlap(q, s)) return true;
      }
    return false;
  }
}

/** Which of the wire names to hide: in order (nearest the root first), each that overlaps a shown thing or a name kept before it. */
export function crowded(names: Quad[], shown: Quad[]): boolean[] {
  const grid = new Grid();
  for (const s of shown) grid.add(s);
  return names.map((q) => {
    const hit = grid.hits(q);
    if (!hit) grid.add(q);
    return hit;
  });
}

/** A quad pulled in toward its middle by `pad` (a negative pad grows it), so names that only touch both stay. */
export function pullIn(q: Quad, pad: number): Quad {
  if (!pad) return q;
  const cx = q.reduce((s, p) => s + p[0], 0) / q.length, cy = q.reduce((s, p) => s + p[1], 0) / q.length;
  return q.map(([x, y]) => {
    const d = Math.hypot(x - cx, y - cy) || 1;
    return [x - ((x - cx) / d) * pad, y - ((y - cy) / d) * pad] as [number, number];
  });
}

/**
 * A name's outline at zoom k, in screen pixels from the picture's origin: its
 * line from `from` to `to` along its turn, `h` tall round `dy`, at (x, y).
 */
export function nameQuad(n: { x: number; y: number; turn: number; from: number; to: number; dy: number; h: number }, k: number): Quad {
  const a = (n.turn * Math.PI) / 180, cos = Math.cos(a), sin = Math.sin(a);
  const y0 = n.dy - n.h / 2, y1 = n.dy + n.h / 2;
  return ([[n.from, y0], [n.to, y0], [n.to, y1], [n.from, y1]] as [number, number][]).map(([u, w]) => [(n.x + u * cos - w * sin) * k, (n.y + u * sin + w * cos) * k]);
}

/** A box's outline at zoom k, in screen pixels. */
export const boxQuad = (x0: number, y0: number, x1: number, y1: number, k: number): Quad => [[x0 * k, y0 * k], [x1 * k, y0 * k], [x1 * k, y1 * k], [x0 * k, y1 * k]];

/**
 * Which wire names to hide at zoom k: each that overlaps a node's name or
 * dot, a bough's dot, the root, or a wire name kept before it (nearer the
 * root first). `names` are the boughs' names, `others` what is shown and
 * may not be covered; names keep 2 px of room round them.
 */
export function crowdedNames(names: { id: string; depth: number; quad: Quad }[], others: Quad[]): Set<string> {
  const order = names.map((n, i) => ({ n, i })).sort((a, b) => a.n.depth - b.n.depth || a.i - b.i).map((x) => x.n);
  const hide = crowded(order.map((n) => pullIn(n.quad, -2)), others);
  return new Set(order.filter((_, i) => hide[i]).map((n) => n.id));
}
