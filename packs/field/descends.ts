/**
 * The rule every behaviour keeps: its push is the downhill slope of its
 * energy, so the run's energy falls step by step and the run settles where
 * the pushes balance. Pure; the field's test runs it on every behaviour,
 * and the Packs view runs it on the map in view (docs.ts).
 *
 * - **Slope:** at a few particles, the push `apply` gives is compared with
 *   the energy's slope measured by moving the particle a little each way.
 *   Off by more than `slope_off` (of the push's size), it fails.
 * - **Descent:** the behaviour runs with gather (so nothing flies off) from
 *   where the particles are, warmth held, for `steps` steps. The whole
 *   energy (the behaviours' and the particles' speed) must not rise by more
 *   than `rise_off` of where it started at any step.
 */
import type { Behaviour } from "./behaviour.ts";
import { build, type FieldIn, type G, type Settings } from "./graph.ts";
import { energy, push, step } from "./step.ts";

export interface Verdict {
  behaviour: string;
  /** The worst gap between push and slope, as a share of the push's size. */
  slope: number;
  /** Steps at which the energy rose by more than allowed, and the first. */
  rises: number;
  firstRise: number;
  /** The energy where it started and where it ended. */
  from: number;
  to: number;
  ok: boolean;
}

export const CHECK = { steps: 200, slope_off: 0.15, rise_off: 1e-4, probes: 12, h: 1e-3 };

/** A copy of the graph's first `most` particles and the links among them, where they are now: to run on without touching the one drawn. */
export function copy(g: G, most = g.n): G {
  const n = Math.min(most, g.n);
  const input: FieldIn = {
    items: g.id.slice(0, n).map((id, i) => ({ id, title: g.title[i]!, type: g.type[i]!, status: g.status[i]!, closed: !!g.closed[i], shape: g.shape[i]!, side: g.side[i]! })),
    links: Array.from({ length: g.m }, (_, e) => e)
      .filter((e) => g.a[e]! < n && g.b[e]! < n)
      .map((e) => ({ id: `e${e}`, type: g.linkKinds[g.kind[e]!]!, from: g.id[g.a[e]!]!, to: g.id[g.b[e]!]! })),
  };
  const c = build(input, null);
  c.x.set(g.x.subarray(0, n));
  c.y.set(g.y.subarray(0, n));
  c.z.set(g.z.subarray(0, n));
  c.r.set(g.r.subarray(0, n));
  c.placed.fill(1);
  return c;
}

/** Whether `b` keeps the rule on graph `g` (copied first) under settings `S`; `gather` keeps the picture bounded. */
export function descends(b: Behaviour, g0: G, S: Settings, gather: Behaviour, at = CHECK, most = g0.n): Verdict {
  const g = copy(g0, most);
  const only = { ...S, [`w_${b.name}`]: S[`w_${b.name}`] ?? 1 };
  // Slope: the push at a few particles against the energy's measured slope.
  let slope = 0;
  push(g, only, [b]);
  const fx = Float64Array.from(g.total.x), fy = Float64Array.from(g.total.y);
  const w = only[`w_${b.name}`]!;
  const probes = Array.from({ length: Math.min(at.probes, g.n) }, (_, k) => Math.floor((k * g.n) / Math.min(at.probes, g.n)));
  let scale = 0;
  for (let i = 0; i < g.n; i++) scale = Math.max(scale, Math.hypot(fx[i]!, fy[i]!));
  for (const i of probes) {
    const along = (axis: Float32Array) => {
      const was = axis[i]!;
      axis[i] = was + at.h;
      const up = b.energy(g, only);
      axis[i] = was - at.h;
      const down = b.energy(g, only);
      axis[i] = was;
      return (-(up - down) / (2 * at.h)) * w;
    };
    const gx = along(g.x), gy = along(g.y);
    slope = Math.max(slope, Math.hypot(gx - fx[i]!, gy - fy[i]!) / Math.max(scale, 1e-9));
  }
  // Descent: warmth held, nothing settles it early.
  const list = b === gather ? [b] : [gather, b];
  const run = { ...only, steps_most: Infinity, settle_move: 0, alpha_decay: 0 };
  g.sim = { alpha: 1, steps: 0 };
  const from = energy(g, run, list);
  let last = from, rises = 0, firstRise = -1;
  for (let s = 0; s < at.steps; s++) {
    step(g, run, list);
    const now = energy(g, run, list);
    if (now - last > at.rise_off * Math.abs(from)) {
      rises++;
      if (firstRise < 0) firstRise = s + 1;
    }
    last = now;
  }
  return { behaviour: b.name, slope, rises, firstRise, from, to: last, ok: slope <= at.slope_off && rises === 0 };
}
