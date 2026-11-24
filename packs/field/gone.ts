/**
 * Items that leave the map (a filter turned off, a find that keeps fewer)
 * fade out where they stood rather than vanish: each is kept for `gone_ms`
 * as a ghost, its shape and colour, drawn fainter and smaller each frame
 * until it is gone. Its links go the same way, and its title if it was
 * shown, so nothing on the map leaves in one frame.
 */
import type { G, Settings } from "./graph.ts";
import type { Cam, Ink } from "./paint.ts";
import { outline, CIRCLE, fill, reach } from "./shapes.ts";
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
  /** Its title, when it was shown as it left. */
  title?: string;
  /** How it was filled: 0 hollow, 1 half, 2 solid (shapes.ts fill). */
  how: 0 | 1 | 2;
}

/** A link that left with one of its ends: a line where it was drawn, fading as its ghost does. */
export interface GoneLink {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  /** How strong it was drawn. */
  alpha: number;
  partOf: boolean;
  at: number;
}

/** The links of `last` with an end `next` does not hold, set off at `now`; at most `most`. */
export function goneLinksOf(last: G | null, next: G, now: number, S: Settings, match: Uint8Array | null = null, most = 8000): GoneLink[] {
  if (!last || !S.gone_ms) return [];
  const out: GoneLink[] = [];
  const partOf = last.linkKinds.indexOf("part_of");
  for (let e = 0; e < last.m && out.length < most; e++) {
    const a = last.a[e]!, b = last.b[e]!;
    if (next.idIx.has(last.id[a]!) && next.idIx.has(last.id[b]!)) continue;
    if (!last.placed[a] || !last.placed[b]) continue;
    const isPart = last.kind[e] === partOf;
    out.push({
      x1: last.x[a]!, y1: last.y[a]!, x2: last.x[b]!, y2: last.y[b]!,
      alpha: S.link_alpha! * (isPart ? 1.4 : 1) * (match ? S.query_fade! : 1),
      partOf: isPart,
      at: now,
    });
  }
  return out;
}

/**
 * The ghosts of what `last` held and `next` does not, set off at `now`; at most `most` of them. Each starts
 * as strong as it was drawn: faint when closed, fainter still when the find line kept it only faint (`match`).
 */
export function goneOf(last: G | null, next: G, now: number, S: Settings, match: Uint8Array | null = null, most = 4000, named: ReadonlySet<string> | null = null): Ghost[] {
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
      how: S.shapes ? fill(last.side[i]!) : 2,
      ...(named?.has(last.id[i]!) ? { title: last.title[i]! } : {}),
    });
  }
  return out;
}

/** A change of size under way: each particle's radius before (NaN: new, none) and the one it goes to. */
export interface Resize {
  at: number;
  from: Float32Array;
  to: Float32Array;
}

/** The sizes `next` takes, from what each particle of `last` had: none when nothing kept changes size. */
export function resizeOf(last: G | null, next: G, now: number): Resize | null {
  if (!last) return null;
  const from = new Float32Array(next.n).fill(NaN);
  let any = false;
  for (let i = 0; i < next.n; i++) {
    const j = last.idIx.get(next.id[i]!);
    if (j === undefined) continue;
    from[i] = last.r[j]!;
    if (Math.abs(from[i]! - next.r[i]!) > 0.01) any = true;
  }
  return any ? { at: now, from, to: next.r.slice() } : null;
}

/** Sets each kept particle's radius along its change at `now`, eased over `ms`; true while still changing. */
export function resizeAt(g: G, rs: Resize, now: number, ms: number): boolean {
  if (rs.to.length !== g.n) return false;
  const k = comeFade(now - rs.at, ms);
  for (let i = 0; i < g.n; i++) {
    const f = rs.from[i]!;
    g.r[i] = Number.isNaN(f) ? rs.to[i]! : f + (rs.to[i]! - f) * k;
  }
  return k < 1;
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

/** Draws the ghosts and gone links still fading at `now` (titles in `ink`), and drops the rest; true while any is left. */
export function paintGone(c: CanvasRenderingContext2D, ghosts: Ghost[], cam: Cam, dpr: number, now: number, S: Settings, links: GoneLink[] = [], ink?: Ink): boolean {
  if (!ghosts.length && !links.length) return false;
  c.save();
  c.setTransform(dpr * cam.k, 0, 0, dpr * cam.k, dpr * cam.tx, dpr * cam.ty);
  let l = 0;
  c.lineWidth = S.link_width! / cam.k;
  for (const q of links) {
    const f = ghostFade(now - q.at, S.gone_ms!);
    if (f <= 0) continue;
    links[l++] = q;
    c.globalAlpha = q.alpha * f;
    c.strokeStyle = ink ? (q.partOf ? ink.muted : ink.line) : "#888";
    c.beginPath();
    c.moveTo(q.x1, q.y1);
    c.lineTo(q.x2, q.y2);
    c.stroke();
  }
  links.length = l;
  let w = 0;
  for (const q of ghosts) {
    const f = ghostFade(now - q.at, S.gone_ms!);
    if (f <= 0) continue;
    ghosts[w++] = q;
    c.globalAlpha = q.alpha * f;
    c.fillStyle = q.colour;
    const r = q.r * (0.6 + 0.4 * f);
    c.beginPath();
    outline(c, q.shape, q.x, q.y, r);
    c.fill();
    // Hollow or half as it was drawn (big enough on screen), its middle the sea, so it does not turn solid as it goes.
    if (q.how !== 2 && ink && r * cam.k >= S.hollow_px!) {
      const colour = c.fillStyle;
      c.fillStyle = ink.sea;
      c.save();
      if (q.how === 1) {
        const R = reach(q.shape) * r;
        c.beginPath();
        c.rect(q.x, q.y - R, R, 2 * R);
        c.clip();
      }
      c.beginPath();
      outline(c, q.shape, q.x, q.y, r * (1 - S.hollow_line!));
      c.fill();
      c.restore();
      c.fillStyle = colour;
    }
  }
  ghosts.length = w;
  // Titles over them, at the size they were read, fading with them.
  if (ink) {
    c.setTransform(dpr, 0, 0, dpr, 0, 0);
    c.font = "11px ui-sans-serif, system-ui, sans-serif";
    c.textBaseline = "middle";
    c.lineJoin = "round";
    c.strokeStyle = ink.sea;
    c.fillStyle = ink.text;
    for (const q of ghosts) {
      if (!q.title) continue;
      const f = ghostFade(now - q.at, S.gone_ms!);
      c.globalAlpha = q.alpha * f;
      const x = q.x * cam.k + cam.tx + q.r * cam.k + 4, y = q.y * cam.k + cam.ty;
      const text = q.title.length > S.label_chars! ? q.title.slice(0, S.label_chars! - 1) + "…" : q.title;
      if (S.label_halo! > 0) (c.lineWidth = S.label_halo!), c.strokeText(text, x, y);
      c.fillText(text, x, y);
    }
  }
  c.restore();
  return w > 0 || l > 0;
}
