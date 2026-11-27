/**
 * The agents' rules. Every beam end is an agent, a particle like the
 * Landscape's, and each rule is a behaviour of the field's kind
 * (packs/field/behaviour.ts): an energy, and a push that is its downhill
 * slope, so the field's own `step` settles them. Each rule is one piece of
 * vector code applied to every agent it touches:
 *
 * - `rest`: each end moves to where it rests on the beam beneath
 *   (`restAt`): `engage` of that beam's length in from the node, its two
 *   radii off that beam's centreline along the two beams' common
 *   perpendicular, on the node normal's side. The beam beneath takes the
 *   other side of the push, shared between its ends.
 * - `collide`: beams of one fan that are not next to each other keep at
 *   least their two radii apart.
 * - `hold` and `length` (off to start): each end drawn to where it
 *   started, each beam to the length it started with.
 *
 * `sweep` is the DAG's rule, and applies the same vector code as `rest`:
 * once a step, in the DAG's order (from the supports up), each end that
 * rests on a beam through a contact that is not closing is moved `sweep`
 * of the way to `restAt`. The beam beneath has already moved this step,
 * so a change at the supports reaches the top in one sweep; closing
 * contacts are left to the pushes. Both aim at the same point, so they
 * settle at the same place.
 *
 * `rest` is an agent's rule: it pushes each end toward a target worked
 * out from where its neighbours are now, so its push is its energy's
 * slope with that target held. `collide`, `hold` and `length` are exact
 * slopes (the test checks them).
 */
import { weight, type Behaviour, type Dial, type Force } from "../field/behaviour.ts";
import type { G, Settings } from "../field/graph.ts";
import { endAt, farEnd, type RG } from "./beams.ts";
import type { V3 } from "./mesh.ts";
import { add, at, closest, cross, dot, flat, len, mul, pushOn, sub, unit } from "./vec.ts";

const rfOf = (g: G) => (g as RG).rf;
const free = (g: G, i: number) => !g.fixed[i];

/** Where the end of `over` at `node` wants to be, on `under`: `engage` in along it, its two radii off it, on the normal's side. */
export function restAt(g: G, node: number, over: number, under: number, S: Settings): V3 {
  const { mesh, r } = rfOf(g);
  const N = mesh.nodes[node]!.n;
  const P = at(g, endAt(mesh, over, node)), Pf = at(g, farEnd(mesh, over, node));
  const A = at(g, endAt(mesh, under, node)), B = at(g, farEnd(mesh, under, node));
  const Q = add(A, mul(sub(B, A), S.engage!));
  let n = cross(sub(P, Pf), sub(B, A));
  n = len(n) > 1e-6 ? unit(n) : N;
  if (dot(n, N) < 0) n = mul(n, -1);
  return add(Q, mul(n, r[over]! + r[under]!));
}

/** The DAG's sweep: each resting end, in order from the supports up, moved `sweep` of the way to where it rests. */
export function sweep(g: G, S: Settings, share = S.sweep ?? 1): void {
  if (!share) return;
  const { mesh, rests } = rfOf(g);
  for (const b of rests.order)
    for (const k of rests.overOf[b]!) {
      const c = rests.contacts[k]!;
      if (c.closing) continue;
      const i = endAt(mesh, c.over, c.node);
      if (!free(g, i)) continue;
      const to = restAt(g, c.node, c.over, c.under, S);
      g.x[i]! += (to[0] - g.x[i]!) * share;
      g.y[i]! += (to[1] - g.y[i]!) * share;
      g.z[i]! += (to[2] - g.z[i]!) * share;
    }
}

/** The four ends of a pair, the first's at the node first, and how far apart their centrelines are. */
function pair(g: G, node: number, p: number, q: number) {
  const { mesh } = rfOf(g);
  const e = [endAt(mesh, p, node), farEnd(mesh, p, node), endAt(mesh, q, node), farEnd(mesh, q, node)] as const;
  const c = closest(at(g, e[0]), at(g, e[1]), at(g, e[2]), at(g, e[3]));
  return { e, c };
}

/** Adds -k times the slope of the pair's distance to its four ends. */
function pushPair(g: G, f: Force, e: readonly [number, number, number, number], c: ReturnType<typeof closest>, k: number) {
  pushOn(f, e[0], c.w, -k * (1 - c.s));
  pushOn(f, e[1], c.w, -k * c.s);
  pushOn(f, e[2], c.w, k * (1 - c.t));
  pushOn(f, e[3], c.w, k * c.t);
}

export const ENGAGE: Dial = { key: "engage", label: "engagement", min: 0.02, max: 0.45, step: 0.01, value: 0.15, then: "seed", doc: "How far in along the beam beneath an end rests, as a share of that beam's length from the node: the size of the little polygon each fan makes." };

/** A contact's end, the beam beneath's two ends, and how far the end is from where it rests. */
function restGap(g: G, node: number, over: number, under: number, S: Settings) {
  const { mesh } = rfOf(g);
  const P = endAt(mesh, over, node), A = endAt(mesh, under, node), B = farEnd(mesh, under, node);
  return { P, A, B, gap: sub(at(g, P), restAt(g, node, over, under, S)) };
}

export const rest: Behaviour = {
  name: "rest",
  doc: "Each end moves to where it rests on the beam beneath (restAt); the beam beneath takes the other side of the push.",
  on: true,
  dials: () => [weight("rest", 0.5, 1)],
  energy(g, S) {
    let u = 0;
    for (const c of rfOf(g).rests.contacts) {
      const { gap } = restGap(g, c.node, c.over, c.under, S);
      u += dot(gap, gap) / 2;
    }
    return u;
  },
  apply(g, f, S) {
    for (const c of rfOf(g).rests.contacts) {
      const { P, A, B, gap } = restGap(g, c.node, c.over, c.under, S);
      pushOn(f, P, gap, -1);
      pushOn(f, A, gap, 1 - S.engage!);
      pushOn(f, B, gap, S.engage!);
    }
  },
};

export const collide: Behaviour = {
  name: "collide",
  doc: "Beams of one fan that are not next to each other keep at least their two radii apart.",
  on: true,
  dials: () => [weight("collide", 0.6)],
  energy(g) {
    const { rests, r } = rfOf(g);
    let u = 0;
    for (const [node, p, q] of rests.clash) u += Math.max(0, r[p]! + r[q]! - pair(g, node, p, q).c.d) ** 2 / 2;
    return u;
  },
  apply(g, f) {
    const { rests, r } = rfOf(g);
    for (const [node, p, q] of rests.clash) {
      const { e, c } = pair(g, node, p, q);
      const over = r[p]! + r[q]! - c.d;
      if (over > 0) pushPair(g, f, e, c, -over);
    }
  },
};

export const hold: Behaviour = {
  name: "hold",
  doc: "Each end is drawn, weakly, to where it started. Off to start: rest alone fixes every end from the supports up, and hold would pull against it.",
  on: false,
  dials: () => [weight("hold", 0.02, 1)],
  energy(g) {
    const h = rfOf(g).home;
    let u = 0;
    for (let i = 0; i < g.n; i++) u +=((g.x[i]! - h[3 * i]!) ** 2 + (g.y[i]! - h[3 * i + 1]!) ** 2 + (g.z[i]! - h[3 * i + 2]!) ** 2) / 2;
    return u;
  },
  apply(g, f) {
    const h = rfOf(g).home;
    for (let i = 0; i < g.n; i++) {
      f.x[i]! -= g.x[i]! - h[3 * i]!;
      f.y[i]! -= g.y[i]! - h[3 * i + 1]!;
      f.z[i]! -= g.z[i]! - h[3 * i + 2]!;
    }
  },
};

export const length: Behaviour = {
  name: "length",
  doc: "Each beam keeps, weakly, the length it started with. Off to start, as hold.",
  on: false,
  dials: () => [weight("length", 0.1, 1)],
  energy(g) {
    const L = rfOf(g).len0;
    let u = 0;
    for (let b = 0; b < g.m; b++) u += (len(sub(at(g, 2 * b + 1), at(g, 2 * b))) - L[b]!) ** 2 / 2;
    return u;
  },
  apply(g, f) {
    const L = rfOf(g).len0;
    for (let b = 0; b < g.m; b++) {
      const d = sub(at(g, 2 * b + 1), at(g, 2 * b)), l = len(d) || 1e-9;
      const k = (l - L[b]!) / l;
      pushOn(f, 2 * b, d, k);
      pushOn(f, 2 * b + 1, d, -k);
    }
  },
};

/** The agents' rules, in the order they push. */
export const AGENTS: Behaviour[] = [rest, collide, hold, length];

export const SWEEP: Dial = { key: "sweep", label: "sweep", min: 0, max: 1, step: 0.05, value: 0.5, doc: "Once a step, each resting end is moved this share of the way to where it rests, in the DAG's order from the supports up (0: the DAG is not swept, only the pushes solve)." };
