/**
 * The step: every behaviour that is on adds its push (the downhill slope of
 * its energy), times its weight; then each particle moves by its push over
 * its mass (one plus `mass_links` times its links, so a hub that feels all
 * its springs at once does not shake), its speed kept by `friction`'s share
 * less each step. Friction is low, so the run goes fast down long gentle
 * slopes; when the particles as a whole move against the push (they
 * overshot), every speed drops to nothing (`uphill_stop`), so it never
 * swings.
 *
 * The run settles: it ends once the push left is under `settle_push` on
 * `settle_share` of the particles, where the pushes balance (or after `steps_most`, and says
 * so). Not by how little particles move: right after a speed drop they
 * barely move while the push is still there. Warmth (alpha) only caps how
 * far a particle may move in a step, `speed_most` times it: it starts at 1
 * and cools to `alpha_min`, so the first steps may move far, but no push is
 * ever cooled away. Steps are counted, not timed, from the seed, so the same
 * answer settles into the same picture on every machine; a new answer, a
 * drag or a dial warms it again.
 */
import type { Behaviour, Dial } from "./behaviour.ts";
import type { G, Settings } from "./graph.ts";
import collide from "./behaviours/collide.ts";
import tree from "./behaviours/tree.ts";
import flow from "./behaviours/flow.ts";
import aspect from "./behaviours/aspect.ts";
import edges from "./behaviours/edges.ts";
import gather from "./behaviours/gather.ts";
import repel from "./behaviours/repel.ts";
import springs from "./behaviours/springs.ts";

/** The behaviours, in the order they run. */
export const BEHAVIOURS: Behaviour[] = [gather, aspect, edges, repel, springs, flow, collide, tree];

/** Whether a behaviour runs: its `on_<name>` dial, else its own default. */
export const isOn = (b: Behaviour, S: Settings) => (S[`on_${b.name}`] ?? (b.on ? 1 : 0)) > 0 && (S[`w_${b.name}`] ?? 1) > 0;

/** The run's own dials, beside each behaviour's. */
export const RUN: Dial[] = [
  { key: "settle_push", label: "settled under", min: 0.001, max: 1, step: 0.001, value: 0.02, doc: "A particle is at rest once the push left on it is under this." },
  { key: "settle_share", label: "settled share", min: 0.5, max: 1, step: 0.01, value: 0.98, doc: "The run ends once this share of the particles is at rest. Not the mean: a few hundred leaves at rest would hide a cluster still on its way." },
  { key: "steps_most", label: "steps at most", min: 100, max: 10000, step: 100, value: 3000, doc: "A run that has not settled by this many steps stops anyway, and says so." },
  { key: "alpha_decay", label: "cooling", min: 0.001, max: 0.1, step: 0.001, value: 0.012, doc: "How much warmth the run loses each step, until it is at 'coolest'." },
  { key: "alpha_min", label: "coolest", min: 0.01, max: 1, step: 0.01, value: 0.1, doc: "The least warmth: the slowest a particle may still move is 'fastest' times this." },
  { key: "alpha_warm", label: "rewarm to", min: 0, max: 1, step: 0.01, value: 0.25, doc: "How warm a change to the map, a drag or a dial makes the run again." },
  { key: "alpha_filter", label: "filter rewarms to", min: 0, max: 1, step: 0.01, value: 0.6, doc: "How warm a change to the legend's filter or the find line makes the run: the graph settles again with what is shown (1: from fully hot)." },
  { key: "friction", label: "friction", min: 0, max: 0.95, step: 0.01, value: 0.1, doc: "The share of its speed a particle loses each step. Low: fast down long gentle slopes ('stop uphill' keeps it from swinging)." },
  { key: "mass_links", label: "mass per link", min: 0, max: 2, step: 0.05, value: 0.5, doc: "A particle's mass is one plus this times its links: a hub feels all its springs at once, so it is heavier and does not shake. Mass never moves where the pushes balance, only how the run gets there." },
  { key: "uphill_stop", label: "stop uphill", min: 0, max: 1, step: 1, value: 1, choices: ["no", "yes"], doc: "When the particles as a whole move against the push (they overshot), every speed drops to nothing and the run goes on downhill from there: low friction without swinging." },
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

/** The whole energy: the behaviours' on, each times its weight, and the particles' motion (half of each mass times its speed squared). */
export function energy(g: G, S: Settings, list: Behaviour[] = BEHAVIOURS): number {
  let u = 0;
  for (const b of list) if (isOn(b, S)) u += b.energy(g, S) * (S[`w_${b.name}`] ?? 1);
  for (let i = 0; i < g.n; i++) if (!g.fixed[i]) u += ((1 + S.mass_links! * g.degree[i]!) * (g.vx[i]! ** 2 + g.vy[i]! ** 2 + g.vz[i]! ** 2)) / 2;
  return u;
}

/** One step. Returns how far particles moved, on average, or 0 once the run has settled (or hit steps_most). */
export function step(g: G, S: Settings, list: Behaviour[] = BEHAVIOURS): number {
  const sim = g.sim, n = g.n;
  push(g, S, list);
  const total = g.total;
  let left = 0, free = 0, rest = 0;
  for (let i = 0; i < n; i++) {
    if (g.fixed[i]) continue;
    const p = Math.hypot(total.x[i]!, total.y[i]!, total.z[i]!);
    left += p;
    free++;
    if (p < S.settle_push!) rest++;
  }
  left /= Math.max(1, free);
  sim.push = left;
  if (sim.steps >= (sim.from ?? 0) + S.steps_most!) {
    sim.settled = false;
    return 0;
  }
  const dt = S.dt!, keep = 1 - S.friction!, most = S.speed_most! * Math.max(sim.alpha, S.alpha_min!);
  // Uphill: where the run as a whole moves against the push, it has overshot; with `uphill_stop` on, every speed is
  // dropped and it starts down again from where it is. So friction can stay low (fast down long gentle slopes) and
  // still never swing back and forth.
  if (S.uphill_stop) {
    let power = 0;
    for (let i = 0; i < n; i++) power += g.vx[i]! * total.x[i]! + g.vy[i]! * total.y[i]! + g.vz[i]! * total.z[i]!;
    if (power < 0) (g.vx.fill(0), g.vy.fill(0), g.vz.fill(0));
  }
  let energy = 0, moved = 0;
  for (let i = 0; i < n; i++) {
    if (g.fixed[i]) {
      g.vx[i] = g.vy[i] = g.vz[i] = 0;
      continue;
    }
    // Heavier with its links: a hub feels every one of its springs at once, and would shake if it were as light as a leaf.
    const m = 1 + S.mass_links! * g.degree[i]!;
    let vx = (g.vx[i]! + (total.x[i]! / m) * dt) * keep;
    let vy = (g.vy[i]! + (total.y[i]! / m) * dt) * keep;
    let vz = (g.vz[i]! + (total.z[i]! / m) * dt) * keep;
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
  // Settled: the pushes balance on all but a few particles. Never on the first step of a run.
  sim.settled = rest >= (S.settle_share ?? 1) * free && sim.steps > (sim.from ?? 0) + 1;
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
