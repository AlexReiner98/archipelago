/**
 * The canvas's camera, as pure parts: when it fits, what a press picks,
 * and how it is set on the picture while it moves (canvas.ts).
 */
import type { Placed } from "./layout.ts";

/**
 * What a fit depends on: how many nodes, and the bounds, rounded. A tree
 * read again with the same shape keeps the camera where it is.
 */
export function fitKey(count: number, b: Placed["box"]): string {
  return `${count}|${[b.x, b.y, b.width, b.height].map((n) => Math.round(n)).join(",")}`;
}

/**
 * Whether the camera fits now: when asked (a double-click), always; never once moved by hand; else its first
 * time, and again only when the tree has outgrown the view (a profile that hears more), so all of it stays in sight.
 */
export function shouldFit(s: { fitted: boolean; manual: boolean; asked: boolean; outgrown?: boolean }): boolean {
  return s.asked || (!s.manual && (!s.fitted || !!s.outgrown));
}

/** Whether a box reaches past the camera's view of a W×H canvas. */
export function outgrown(b: Placed["box"], v: { x: number; y: number; k: number }, W: number, H: number): boolean {
  const e = 0.5;
  return b.x < v.x - e || b.y < v.y - e || b.x + b.width > v.x + W / v.k + e || b.y + b.height > v.y + H / v.k + e;
}

/** How far round a dot, in screen px, a press still picks its node. */
export const HIT_PX = 22;

/** The nearest of the points within `r` of `p`, by id; none further. */
export function nearest(points: { id: string; x: number; y: number }[], p: { x: number; y: number }, r: number): string | undefined {
  let best: string | undefined, d = r;
  for (const q of points) {
    const dd = Math.hypot(q.x - p.x, q.y - p.y);
    if (dd < d) (d = dd), (best = q.id);
  }
  return best;
}

/** How long after the last wheel or move the picture is drawn again for its zoom. */
export const SETTLE_MS = 140;
/** The camera as the picture's transform. */
export const cameraOf = (v: { x: number; y: number; k: number }) => `scale(${v.k}) translate(${-v.x} ${-v.y})`;
