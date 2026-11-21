/**
 * The step: every behaviour that is on adds its push (the downhill slope of
 * its energy), times its weight; then each particle moves, its speed kept
 * by `friction`'s share less each step (easing to `friction_cool` as it cools).
 *
 * The run settles: it ends once particles move, on average, less than
 * `settle_move` a step, which is too little to see (or after `steps_most`).
 * Not a push left under some size: repel's Barnes-Hut is close to its
 * energy's slope, not on it, so a little push is always left over. Warmth (alpha) only caps how far a
 * particle may move in a step, `speed_most` times it: it starts at 1 and
 * cools to `alpha_min`, so the first steps may move far and the last move
 * gently, but no push is ever cooled away, so where it ends is where the
 * pushes balance. Steps are counted, not timed, from the seed, so the same
 * answer settles into the same picture on every machine; a new answer, a
 * drag or a dial warms it again.
 */
import type { Behaviour, Dial } from "./behaviour.ts";
import type { G, Settings } from "./graph.ts";
import collide from "./behaviours/collide.ts";
import flow from "./behaviours/flow.ts";
import gather from "./behaviours/gather.ts";
import repel from "./behaviours/repel.ts";
import springs from "./behaviours/springs.ts";

/** The behaviours, in the order they run. */
export const BEHAVIOURS: Behaviour[] = [gather, repel, springs, flow, collide];

/** Whether a behaviour runs: its `on_<name>` dial, else its own default. */
export const isOn = (b: Behaviour, S: Settings) => (S[`on_${b.name}`] ?? (b.on ? 1 : 0)) > 0 && (S[`w_${b.name}`] ?? 1) > 0;

/** The run's own dials, beside each behaviour's. */
export const RUN: Dial[] = [
  { key: "settle_move", label: "settled under", min: 0.001, max: 1, step: 0.001, value: 0.05, doc: "The run ends once particles move less than this a step, on average, in world units: too little to see." },
  { key: "steps_most", label: "steps at most", min: 100, max: 10000, step: 100, value: 3000, doc: "A run that has not settled by this many steps stops anyway, and says so." },
  { key: "alpha_decay", label: "cooling", min: 0.001, max: 0.1, step: 0.001, value: 0.012, doc: "How much warmth the run loses each step, until it is at 'coolest'." },
  { key: "alpha_min", label: "coolest", min: 0.01, max: 1, step: 0.01, value: 0.1, doc: "The least warmth: the slowest a particle may still move is 'fastest' times this." },
  { key: "alpha_warm", label: "rewarm to", min: 0, max: 1, step: 0.01, value: 0.25, doc: "How warm a change to the map, a drag or a dial makes the run again." },
  { key: "alpha_filter", label: "filter rewarms to", min: 0, max: 1, step: 0.01, value: 0.6, doc: "How warm a change to the legend's filter or the find line makes the run: the graph settles again with what is shown (1: from fully hot)." },
  { key: "friction", label: "friction", min: 0, max: 0.95, step: 0.01, value: 0.15, doc: "The share of its speed a particle loses each step, while the run is warm." },
  { key: "friction_cool", label: "friction cool", min: 0, max: 0.95, step: 0.01, value: 0.6, doc: "The friction once the run is at its coolest; between, it eases with the warmth. Friction never moves where the pushes balance, only how fast the run gets there, so a run that is nearly there stops trembling." },
  { key: "speed_most", label: "fastest", min: 1, max: 100, step: 1, value: 30, doc: "At full warmth, no particle moves further than this in one step." },
  { key: "dt", label: "time per step", min: 0.1, max: 3, step: 0.05, value: 1, doc: "Physics time per step." },
  { key: "frame_ms", label: "ms per frame", min: 1, max: 40, step: 1, value: 12, then: "paint", doc: "How long each frame may spend stepping. Changes how fast it settles, not where." },
];

/** The pushes of the behaviours on, each times its weight, summed into g.total. */
export function push(g: G, S: Settings, list: Behaviour[] = BEHAVIOURS): void {
  const f = g.force, total = g.total, n = g.n;
  total.x.fill(0);
  total.y.fill(0);
  total.z.fill(0);
  for (const b of list) {
    if (!isOn(b, S)) continue;
    f.x.fill(0);
    f.y.fill(0);
    f.z.fill(0);
    b.apply(g, f, S, g.sim);
    const w = S[`w_${b.name}`] ?? 1;
    for (let i = 0; i < n; i++) {
      total.x[i]! += f.x[i]! * w;
      total.y[i]! += f.y[i]! * w;
      total.z[i]! += f.z[i]! * w;
    }
  }
}

/** The whole energy: the behaviours' on, each times its weight, and the particles' speed (half of each squared). */
export function energy(g: G, S: Settings, list: Behaviour[] = BEHAVIOURS): number {
  let u = 0;
  for (const b of list) if (isOn(b, S)) u += b.energy(g, S) * (S[`w_${b.name}`] ?? 1);
  for (let i = 0; i < g.n; i++) if (!g.fixed[i]) u += (g.vx[i]! ** 2 + g.vy[i]! ** 2 + g.vz[i]! ** 2) / 2;
  return u;
}

/** One step. Returns how far particles moved, on average, or 0 once the run has settled (or hit steps_most). */
export function step(g: G, S: Settings, list: Behaviour[] = BEHAVIOURS): number {
  const sim = g.sim, n = g.n;
  push(g, S, list);
  const total = g.total;
  let left = 0, free = 0;
  for (let i = 0; i < n; i++) if (!g.fixed[i]) (left += Math.hypot(total.x[i]!, total.y[i]!, total.z[i]!)), free++;
  left /= Math.max(1, free);
  sim.push = left;
  if (sim.steps >= (sim.from ?? 0) + S.steps_most!) {
    sim.settled = false;
    return 0;
  }
  const cool = Math.min(1, Math.max(0, (1 - sim.alpha) / Math.max(1e-9, 1 - S.alpha_min!)));
  const dt = S.dt!, keep = 1 - (S.friction! + (S.friction_cool! - S.friction!) * cool), most = S.speed_most! * Math.max(sim.alpha, S.alpha_min!);
  let energy = 0, moved = 0;
  for (let i = 0; i < n; i++) {
    if (g.fixed[i]) {
      g.vx[i] = g.vy[i] = g.vz[i] = 0;
      continue;
    }
    let vx = (g.vx[i]! + total.x[i]! * dt) * keep;
    let vy = (g.vy[i]! + total.y[i]! * dt) * keep;
    let vz = (g.vz[i]! + total.z[i]! * dt) * keep;
    const sp = Math.hypot(vx, vy, vz) * dt;
    if (sp > most) (vx *= most / sp), (vy *= most / sp), (vz *= most / sp);
    g.vx[i] = vx;
    g.vy[i] = vy;
    g.vz[i] = vz;
    g.x[i]! += vx * dt;
    g.y[i]! += vy * dt;
    g.z[i]! += vz * dt;
    energy += vx * vx + vy * vy + vz * vz;
    moved += Math.hypot(vx, vy, vz) * dt;
  }
  sim.alpha = Math.max(S.alpha_min!, sim.alpha * (1 - S.alpha_decay!));
  sim.steps++;
  sim.energy = energy / Math.max(1, n);
  moved /= Math.max(1, free);
  sim.moved = moved;
  // Settled: nothing moves enough to see. Never on the first step of a run, when nothing has had a push yet.
  sim.settled = moved < S.settle_move! && sim.steps > (sim.from ?? 0) + 1;
  return sim.settled ? 0 : Math.max(moved, 1e-9);
}

/** Warm the run again, to `to` (else `alpha_warm`), never cooler than it is already. */
export function warm(g: G, S: Settings, to?: number): void {
  g.sim.alpha = Math.max(g.sim.alpha, to ?? S.alpha_warm!);
  g.sim.from = g.sim.steps;
}

/** Every dial's starting value, by key. */
export function defaults(dials: Dial[]): Settings {
  return Object.fromEntries(dials.map((d) => [d.key, d.value]));
}
