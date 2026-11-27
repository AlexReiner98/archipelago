/**
 * The reciprocal frame's rules, as a DAG (rules.ts):
 *
 * ```
 * mesh ─▶ fans ─▶ rests ─▶ frame ─▶ solve ─▶ measure
 *   └──────────────────────▲          ▲
 *              radii ──────┴──────────┘
 * ```
 *
 * - `mesh`: the seeded input (`mesh`, `detail`).
 * - `fans`: each node's beams sorted round its normal.
 * - `rests`: who rests on whom, made a DAG (`turn`).
 * - `radii`: each beam's radius: `diameter`, or the beam's own (`d_<beam>`).
 * - `frame`: the particles, two per beam, seeded by sweeping the DAG from
 *   the supports up (`engage`).
 * - `solve` (live): each step the DAG's sweep, then the agents' rules
 *   pushed through the field's `step`.
 * - `measure` (live): each contact's gap and side.
 *
 * A change to a beam's diameter runs `radii` only; the solve takes the new
 * radii and warms again, from where it is.
 */
import { build, type FieldIn, type G, type Settings } from "../field/graph.ts";
import { step } from "../field/step.ts";
import { fans, rests, type Rests, type RF, type RG, endAt, farEnd } from "./beams.ts";
import { AGENTS, sweep } from "./agents.ts";
import { MESHES, mesh, type Mesh } from "./mesh.ts";
import type { Rule } from "./rules.ts";
import { at, closest, dot, len, sub } from "./vec.ts";

/** A beam's own diameter, by its index. */
export const diameterKey = (b: number) => `d_${b}`;

export function radii(m: number, S: Settings): Float32Array {
  return Float32Array.from({ length: m }, (_, b) => (S[diameterKey(b)] ?? S.diameter!) / 2);
}

/** The particles for a mesh: two ends per beam, each at its node; ends at supports are held. Then seeded by the DAG's sweep. */
export function frame(mesh: Mesh, fanOf: number[][], r: Rests, radius: Float32Array, S: Settings): RG {
  const m = mesh.edges.length;
  const input: FieldIn = {
    items: Array.from({ length: 2 * m }, (_, i) => ({ id: `b${i >> 1}.${i & 1}`, title: `beam ${i >> 1}, end ${i & 1}`, type: "end", status: "", closed: false })),
    links: mesh.edges.map(([], b) => ({ id: `b${b}`, type: "beam", from: `b${b}.0`, to: `b${b}.1` })),
  };
  const g = build(input, null) as RG;
  mesh.edges.forEach(([p, q], b) => {
    for (const [i, v] of [[2 * b, p], [2 * b + 1, q]] as const) {
      const n = mesh.nodes[v]!;
      (g.x[i] = n.p[0]), (g.y[i] = n.p[1]), (g.z[i] = n.p[2]);
      g.fixed[i] = n.support ? 1 : 0;
    }
  });
  g.rf = { mesh, fans: fanOf, rests: r, r: radius.slice(), home: new Float32Array(6 * m), len0: new Float32Array(m) };
  // From the supports up: each end placed on the beam beneath, the closing contacts caught up on the passes after.
  for (let k = 0; k < 4; k++) sweep(g, S, 1);
  for (let i = 0; i < 2 * m; i++) (g.rf.home[3 * i] = g.x[i]!), (g.rf.home[3 * i + 1] = g.y[i]!), (g.rf.home[3 * i + 2] = g.z[i]!);
  for (let b = 0; b < m; b++) g.rf.len0[b] = len(sub(at(g, 2 * b + 1), at(g, 2 * b)));
  g.sim = { alpha: 1, steps: 0 };
  return g;
}

/** One step of the solve: the DAG's sweep, then the agents' pushes, through the field's step. Returns what `step` does. */
export function solveStep(g: RG, S: Settings): number {
  sweep(g, S);
  return step(g, S, AGENTS);
}

export interface Measure {
  /** Each contact's gap (centrelines apart less the two radii; 0: touching) and whether the end is on the normal's side. */
  gap: Float32Array;
  above: Uint8Array;
  /** Each beam's worst gap, as a share of its diameter. */
  worst: Float32Array;
  /** The worst gap, as a share of the diameter there, and how many ends sit under where they rest. */
  most: number;
  under: number;
}

export function measure(g: RG): Measure {
  const { mesh, rests, r } = g.rf;
  const k = rests.contacts.length;
  const gap = new Float32Array(k), above = new Uint8Array(k), worst = new Float32Array(g.m);
  let most = 0, under = 0;
  rests.contacts.forEach((c, j) => {
    const P = at(g, endAt(mesh, c.over, c.node)), Pf = at(g, farEnd(mesh, c.over, c.node));
    const A = at(g, endAt(mesh, c.under, c.node)), B = at(g, farEnd(mesh, c.under, c.node));
    const cp = closest(P, Pf, A, B);
    const h = r[c.over]! + r[c.under]!;
    gap[j] = cp.d - h;
    above[j] = dot(cp.w, mesh.nodes[c.node]!.n) >= 0 ? 1 : 0;
    if (!above[j]) under++;
    const share = Math.abs(gap[j]!) / h;
    most = Math.max(most, share);
    for (const b of [c.over, c.under]) worst[b] = Math.max(worst[b]!, Math.abs(gap[j]!) / (2 * r[b]!));
  });
  return { gap, above, worst, most, under };
}

/** The rules, as the page and the test run them. */
export const RULES: Rule[] = [
  {
    name: "mesh",
    doc: "The input: nodes with their normals and supports, and the edges among them (seeded until meshes can be drawn).",
    needs: [],
    dials: ["mesh", "detail"],
    run: (_, S) => mesh(MESHES[S.mesh!] ?? "dome", S.detail),
    summary: (o) => {
      const m = o as Mesh;
      return `${m.nodes.length} nodes · ${m.edges.length} edges · ${m.nodes.filter((n) => n.support).length} supports`;
    },
  },
  {
    name: "fans",
    doc: "At each node not a support, its beams sorted round the node's normal.",
    needs: ["mesh"],
    dials: [],
    run: ({ mesh: m }) => fans(m as Mesh),
    summary: (o) => `${(o as number[][]).filter((f) => f.length).length} fans`,
  },
  {
    name: "rests",
    doc: "Who rests on whom: each beam on the next round its fan, made a DAG by closing each cycle at one contact.",
    needs: ["mesh", "fans"],
    dials: ["turn"],
    run: ({ mesh: m, fans: f }, S) => rests(m as Mesh, f as number[][], S.turn!),
    summary: (o) => {
      const r = o as Rests;
      return `${r.contacts.length} contacts · ${r.contacts.filter((c) => c.closing).length} closing · ${Math.max(0, ...r.level) + 1} levels`;
    },
  },
  {
    name: "radii",
    doc: "Each beam's radius: the default diameter, or the beam's own.",
    needs: ["mesh"],
    dials: ["diameter", "d_*"],
    run: ({ mesh: m }, S) => radii((m as Mesh).edges.length, S),
    summary: (o) => {
      const r = o as Float32Array;
      return r.length ? `⌀ ${(2 * Math.min(...r)).toFixed(1)}–${(2 * Math.max(...r)).toFixed(1)} cm` : "none";
    },
  },
  {
    name: "frame",
    doc: "Two particles per beam, its ends, seeded by sweeping the DAG from the supports up.",
    needs: ["mesh", "fans", "rests"],
    dials: ["engage"],
    run: ({ mesh: m, fans: f, rests: r }, S) => frame(m as Mesh, f as number[][], r as Rests, radii((m as Mesh).edges.length, S), S),
    summary: (o) => `${(o as G).n} agents · ${(o as G).m} beams`,
  },
  { name: "solve", doc: "Each step: the DAG's sweep, then the agents' rules (rest, engage, collide, hold, length) pushed through the Landscape's step.", needs: ["frame", "radii"], dials: [], live: true },
  { name: "measure", doc: "Each contact's gap and whether its end sits on the normal's side.", needs: ["solve"], dials: [], live: true },
];

export type { RF };
