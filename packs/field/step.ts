/**
 * The step: every behaviour that is on adds its push, times its weight and
 * the run's warmth; then each particle moves. Pure, over the graph.
 *
 * The run cools: warmth (alpha) starts at 1 and falls each step, every push
 * is scaled by it, and the run sleeps under `alpha_min`. Steps are counted,
 * not timed, from the seed, so the same answer settles into the same
 * picture on every machine; a new answer, a drag or a dial warms it again.
 */
import type { Behaviour, Dial } from "./behaviour.ts";
import type { G, Settings } from "./graph.ts";
import collide from "./behaviours/collide.ts";
import flow from "./behaviours/flow.ts";
import gather from "./behaviours/gather.ts";
import plane from "./behaviours/plane.ts";
import repel from "./behaviours/repel.ts";
import springs from "./behaviours/springs.ts";
import untangle from "./behaviours/untangle.ts";

/** The behaviours, in the order they run. */
export const BEHAVIOURS: Behaviour[] = [gather, repel, springs, collide, untangle, flow, plane];

/** Whether a behaviour runs: its `on_<name>` dial, else its own default. */
export const isOn = (b: Behaviour, S: Settings) => (S[`on_${b.name}`] ?? (b.on ? 1 : 0)) > 0 && (S[`w_${b.name}`] ?? 1) > 0;

/** The run's own dials, beside each behaviour's. */
export const RUN: Dial[] = [
  { key: "alpha_decay", label: "cooling", min: 0.001, max: 0.1, step: 0.001, value: 0.012, doc: "How much warmth the run loses each step: about 450 steps from hot to asleep." },
  { key: "alpha_min", label: "asleep under", min: 0.0005, max: 0.05, step: 0.0005, value: 0.004, doc: "The forces sleep once warmth falls under this." },
  { key: "alpha_warm", label: "rewarm to", min: 0, max: 1, step: 0.01, value: 0.25, doc: "How warm a new answer, a drag or a dial makes the run again." },
  { key: "friction", label: "friction", min: 0, max: 0.95, step: 0.01, value: 0.4, doc: "The share of its speed a particle loses each step." },
  { key: "speed_most", label: "fastest", min: 1, max: 100, step: 1, value: 30, doc: "No particle moves further than this in one step." },
  { key: "dt", label: "time per step", min: 0.1, max: 3, step: 0.05, value: 1, doc: "Physics time per step." },
  { key: "frame_ms", label: "ms per frame", min: 1, max: 40, step: 1, value: 12, then: "paint", doc: "How long each frame may spend stepping. Changes how fast it settles, not where." },
];

/** One step. Returns the warmth left, or 0 when nothing moves any more. */
export function step(g: G, S: Settings, list: Behaviour[] = BEHAVIOURS): number {
  const sim = g.sim;
  const on = list.filter((b) => isOn(b, S));
  if (sim.alpha < S.alpha_min!) {
    // Asleep, a search that is not done (untangle) still runs, alone, without the forces.
    const busy = on.filter((b) => b.busy?.(sim));
    if (!busy.length) return 0;
    for (const b of busy) b.move?.(g, S, sim);
    sim.steps++;
    return S.alpha_min!;
  }
  const f = g.force, total = g.total, n = g.n;
  total.x.fill(0);
  total.y.fill(0);
  total.z.fill(0);
  for (const b of on) {
    f.x.fill(0);
    f.y.fill(0);
    f.z.fill(0);
    b.apply(g, f, S, sim);
    const w = S[`w_${b.name}`] ?? 1;
    const k = b.firm ? w / sim.alpha : w; // a firm behaviour's push is not cooled
    for (let i = 0; i < n; i++) {
      total.x[i]! += f.x[i]! * k;
      total.y[i]! += f.y[i]! * k;
      total.z[i]! += f.z[i]! * k;
    }
  }
  const dt = S.dt!, keep = 1 - S.friction!, most = S.speed_most!, a = sim.alpha;
  let energy = 0;
  for (let i = 0; i < n; i++) {
    if (g.fixed[i]) {
      g.vx[i] = g.vy[i] = g.vz[i] = 0;
      continue;
    }
    let vx = (g.vx[i]! + total.x[i]! * a * dt) * keep;
    let vy = (g.vy[i]! + total.y[i]! * a * dt) * keep;
    let vz = (g.vz[i]! + total.z[i]! * a * dt) * keep;
    const sp = Math.hypot(vx, vy, vz);
    if (sp > most) (vx *= most / sp), (vy *= most / sp), (vz *= most / sp);
    g.vx[i] = vx;
    g.vy[i] = vy;
    g.vz[i] = vz;
    g.x[i]! += vx * dt;
    g.y[i]! += vy * dt;
    g.z[i]! += vz * dt;
    energy += vx * vx + vy * vy + vz * vz;
  }
  for (const b of on) b.move?.(g, S, sim);
  sim.alpha *= 1 - S.alpha_decay!;
  sim.steps++;
  // Asleep, a map the plane holds ends flat; without the plane, z is never used.
  if (sim.alpha < S.alpha_min! || !on.some((b) => b.name === "plane")) g.z.fill(0);
  sim.energy = energy / Math.max(1, n);
  return sim.alpha;
}

/** Warm the run again, never past `alpha_warm` unless it is warmer already; the searches start over. */
export function warm(g: G, S: Settings): void {
  g.sim.alpha = Math.max(g.sim.alpha, S.alpha_warm!);
  g.sim.un = undefined;
}

/** Every dial's starting value, by key. */
export function defaults(dials: Dial[]): Settings {
  return Object.fromEntries(dials.map((d) => [d.key, d.value]));
}
