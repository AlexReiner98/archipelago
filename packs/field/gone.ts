/**
 * Items that leave the map (a filter turned off, a find that keeps fewer)
 * fade out where they stood rather than vanish: each is kept for `gone_ms`
 * as a ghost, its shape and colour, drawn fainter and smaller each frame
 * until it is gone.
 */
import type { G, Settings } from "./graph.ts";
import type { Cam } from "./paint.ts";
import { outline, CIRCLE } from "./shapes.ts";
import { FAINT, FOUND } from "./filter.ts";

export interface Ghost {
  x: number;
  y: number;
  r: number;
  shape: number;
  colour: string;
  /** How strong it was drawn when it left. */
  alpha: number;
  /** When it left, in ms (performance.now). */
  at: number;
}

/**
 * The ghosts of what `last` held and `next` does not, set off at `now`; at most `most` of them. Each starts
 * as strong as it was drawn: faint when closed, fainter still when the find line kept it only faint (`match`).
 */
export function goneOf(last: G | null, next: G, now: number, S: Settings, match: Uint8Array | null = null, most = 4000): Ghost[] {
  if (!last || !S.gone_ms) return [];
  const out: Ghost[] = [];
  for (let i = 0; i < last.n && out.length < most; i++) {
    if (next.idIx.has(last.id[i]!) || !last.placed[i]) continue;
    out.push({
      x: last.x[i]!,
      y: last.y[i]!,
      r: last.r[i]!,
      shape: S.shapes ? last.shape[i]! : CIRCLE,
      colour: last.types[last.typeIx[i]!]?.colour ?? "#888",
      alpha: (last.closed[i] && match?.[i] !== FOUND ? S.closed_fade! : 1) * (match?.[i] === FAINT ? S.query_fade! : 1),
      at: now,
    });
  }
  return out;
}

/** When each particle of `next` came: what `last` held keeps its time, what is new came `now`; a first map, long ago. */
export function bornOf(last: G | null, next: G, now: number): Float64Array {
  const out = new Float64Array(next.n).fill(-Infinity);
  if (!last) return out;
  for (let i = 0; i < next.n; i++) {
    const j = last.idIx.get(next.id[i]!);
    out[i] = j === undefined ? now : (last.born?.[j] ?? -Infinity);
  }
  return out;
}

/** How strong a particle is `ms` after it came, over `life` ms: eased from 0 to 1. */
export function comeFade(ms: number, life: number): number {
  return 1 - ghostFade(ms, life);
}

/** How strong a ghost is `ms` after it left, over `life` ms: eased from 1 to 0. */
export function ghostFade(ms: number, life: number): number {
  if (life <= 0 || ms >= life) return 0;
  const k = Math.max(0, ms / life);
  return 1 - k * k * (3 - 2 * k);
}

/** Draws the ghosts still fading at `now`, and drops the rest; true while any is left. */
export function paintGone(c: CanvasRenderingContext2D, ghosts: Ghost[], cam: Cam, dpr: number, now: number, S: Settings): boolean {
  if (!ghosts.length) return false;
  c.save();
  c.setTransform(dpr * cam.k, 0, 0, dpr * cam.k, dpr * cam.tx, dpr * cam.ty);
  let w = 0;
  for (const q of ghosts) {
    const f = ghostFade(now - q.at, S.gone_ms!);
    if (f <= 0) continue;
    ghosts[w++] = q;
    c.globalAlpha = q.alpha * f;
    c.fillStyle = q.colour;
    c.beginPath();
    outline(c, q.shape, q.x, q.y, q.r * (0.6 + 0.4 * f));
    c.fill();
  }
  ghosts.length = w;
  c.restore();
  return w > 0;
}
