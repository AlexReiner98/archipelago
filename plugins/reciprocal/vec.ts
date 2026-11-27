/**
 * The vector code the rules are made of: reading a beam end out of the
 * particles' flat arrays, and the closest points of two segments. Pure.
 */
import type { G } from "../field/graph.ts";
import type { V3 } from "./mesh.ts";

export const at = (g: G, i: number): V3 => [g.x[i]!, g.y[i]!, g.z[i]!];
export const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const add = (a: V3, b: V3): V3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
export const mul = (a: V3, s: number): V3 => [a[0] * s, a[1] * s, a[2] * s];
export const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
export const len = (a: V3) => Math.hypot(a[0], a[1], a[2]);
export const unit = (a: V3): V3 => mul(a, 1 / (len(a) || 1));
/** `a` less its part along the unit `n`: in the plane square to it. */
export const flat = (a: V3, n: V3): V3 => sub(a, mul(n, dot(a, n)));

/** Adds `v` times `s` to particle `i`'s force. */
export function pushOn(f: { x: Float32Array; y: Float32Array; z: Float32Array }, i: number, v: V3, s: number): void {
  f.x[i]! += v[0] * s;
  f.y[i]! += v[1] * s;
  f.z[i]! += v[2] * s;
}

export interface Closest {
  /** Where on each segment, 0 at its first point and 1 at its second. */
  s: number;
  t: number;
  /** How far apart, and the unit from the second's point to the first's. */
  d: number;
  w: V3;
}

const clamp = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x);

/** The closest points of segments p1-q1 and p2-q2 (Ericson, Real-Time Collision Detection 5.1.9). */
export function closest(p1: V3, q1: V3, p2: V3, q2: V3): Closest {
  const d1 = sub(q1, p1), d2 = sub(q2, p2), r = sub(p1, p2);
  const a = dot(d1, d1), e = dot(d2, d2), f = dot(d2, r), eps = 1e-9;
  let s = 0, t = 0;
  if (a <= eps && e <= eps) s = t = 0;
  else if (a <= eps) t = clamp(f / e);
  else {
    const c = dot(d1, r);
    if (e <= eps) s = clamp(-c / a);
    else {
      const b = dot(d1, d2), den = a * e - b * b;
      s = den > eps ? clamp((b * f - c * e) / den) : 0;
      t = (b * s + f) / e;
      if (t < 0) (t = 0), (s = clamp(-c / a));
      else if (t > 1) (t = 1), (s = clamp((b - c) / a));
    }
  }
  const c1 = add(p1, mul(d1, s)), c2 = add(p2, mul(d2, t));
  const gap = sub(c1, c2), d = len(gap);
  return { s, t, d, w: d > 1e-9 ? mul(gap, 1 / d) : [0, 0, 1] };
}
