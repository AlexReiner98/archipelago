/**
 * Links' arrows and names. Pure: screen or world numbers in, where to draw
 * out; nothing is drawn here.
 *
 * - An arrow sits at the end a link points to (its `to`), its tip on that
 *   particle's edge, so "A depends_on B" points at B.
 * - A link's name sits at its middle, along it and kept upright. Names go
 *   in order (the lit first, then the longest on screen), and one that
 *   would overlap a title, the view's clear boxes or another name is left
 *   out, as titles are.
 * - A name grows and shrinks with the zoom (`wireSize`): too small to read,
 *   it isn't drawn; it stops growing at a most. One left out fades away and
 *   one placed fades in (`easeWires`), so names never pop.
 */

/** The arrowhead: its tip, then its two back corners. */
export function arrow(x1: number, y1: number, x2: number, y2: number, back: number, len: number, wide: number): [number, number, number, number, number, number] {
  const d = Math.hypot(x2 - x1, y2 - y1) || 1e-6, ux = (x2 - x1) / d, uy = (y2 - y1) / d;
  const tx = x2 - ux * back, ty = y2 - uy * back;
  const bx = tx - ux * len, by = ty - uy * len, px = -uy * wide / 2, py = ux * wide / 2;
  return [tx, ty, bx + px, by + py, bx - px, by - py];
}

export interface WireWant {
  /** The link's index. */
  e: number;
  /** Its ends on screen, from and to. */
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  /** The name's size on screen. */
  w: number;
  h: number;
  /** Lit: placed before the rest. */
  lit: boolean;
}
export interface WirePlaced {
  e: number;
  x: number;
  y: number;
  /** The name's angle, upright (-π/2..π/2). */
  angle: number;
}
type Box = [number, number, number, number];

const hits = (a: Box, b: Box) => a[0] < b[2] && b[0] < a[2] && a[1] < b[3] && b[1] < a[3];

/**
 * Which links are named, and where: each whose length on screen is at least
 * `from` (and room for its name besides its ends' `ends` px), at most `most`,
 * none over `taken` (titles, the legend) or another name, none off the view.
 */
export function placeWires(wants: WireWant[], at: { width: number; height: number; from: number; most: number; ends: number; taken: Box[] }): WirePlaced[] {
  const len = (w: WireWant) => Math.hypot(w.x2 - w.x1, w.y2 - w.y1);
  const order = wants.filter((w) => len(w) >= Math.max(at.from, w.w + 2 * at.ends)).sort((p, q) => Number(q.lit) - Number(p.lit) || len(q) - len(p) || p.e - q.e);
  const boxes: Box[] = [...at.taken], out: WirePlaced[] = [];
  for (const w of order) {
    if (out.length >= at.most) break;
    const x = (w.x1 + w.x2) / 2, y = (w.y1 + w.y2) / 2;
    let angle = Math.atan2(w.y2 - w.y1, w.x2 - w.x1);
    if (angle > Math.PI / 2) angle -= Math.PI;
    if (angle < -Math.PI / 2) angle += Math.PI;
    // The box round the turned name, as the screen sees it.
    const c = Math.abs(Math.cos(angle)), s = Math.abs(Math.sin(angle));
    const bw = (w.w * c + w.h * s) / 2, bh = (w.w * s + w.h * c) / 2;
    const box: Box = [x - bw, y - bh, x + bw, y + bh];
    if (box[0] < 0 || box[1] < 0 || box[2] > at.width || box[3] > at.height) continue;
    if (boxes.some((b) => hits(b, box))) continue;
    boxes.push(box);
    out.push({ e: w.e, x, y, angle });
  }
  return out;
}

/** A link type as words: depends_on → depends on. */
export const wireName = (type: string, places?: string[]) => type.replace(/_/g, " ") + (places?.length ? ` · ${places.join(", ")}` : "");

/** A link name's size on screen at zoom `k`: its size in the map times the zoom, at most `most`; 0 when below `least`, too small to read. */
export function wireSize(size: number, k: number, least: number, most: number): number {
  const px = size * k;
  return px < least ? 0 : Math.min(most, px);
}

/** A name's fade: how strong it is now, and where it was last drawn. */
export interface WireFade {
  a: number;
  x: number;
  y: number;
  angle: number;
}

/**
 * Each name's fade, a step on: those placed now ease in to 1 (and move to
 * where they are placed), the rest ease out to 0 and are dropped there.
 * `k` is how far a step goes (0..1). True while any still moves.
 */
export function easeWires(fades: Map<number, WireFade>, placed: WirePlaced[], k: number): boolean {
  const now = new Map(placed.map((w) => [w.e, w]));
  let moving = false;
  for (const w of placed) if (!fades.has(w.e)) fades.set(w.e, { a: 0, x: w.x, y: w.y, angle: w.angle });
  for (const [e, f] of fades) {
    const w = now.get(e);
    if (w) (f.x = w.x), (f.y = w.y), (f.angle = w.angle);
    const want = w ? 1 : 0;
    f.a += (want - f.a) * k;
    if (Math.abs(f.a - want) < 0.01) f.a = want;
    if (f.a !== want) moving = true;
    if (!w && f.a === 0) fades.delete(e);
  }
  return moving;
}
