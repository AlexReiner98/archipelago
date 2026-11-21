/**
 * How an event reaches between the tree and an agent: a curve drawn as an
 * extension of the tree's own. It leaves its node along the branch's
 * tangent and runs on past the names (`reach_out`). An agent near it takes
 * it straight in, as one bezier. One further round (past `reach_bend`)
 * takes it on its own lane: an ellipse between the tree and the agents,
 * one per seat, so two agents' curves never share a stretch. Then it
 * comes into the agent (`reach_in`).
 *
 * The curve is drawn: it sweeps from where it starts to where it ends
 * (`reach_sweep`), then fades (`reach_linger`). Nothing else moves. A say
 * or a refusal sweeps from the node to the agent; an act from the agent to
 * the bough of its place; a hold leaves its node and stops part way
 * (`reach_hold`); a begin or an end pulses the agent.
 *
 * Every number is a dial (`DIALS`), shown in the harness's Dials panel and
 * kept in the page key `harness.dials`. Colours are style tokens: the
 * run's hue, `failed` for a refusal or a failed act, `quiet` for a hold.
 */
import type { ExchangeEvent } from "../../spec/exchange.ts";
import { HUES } from "../../spec/style.ts";
import { lightOf, spotOf, type Placed, type Tree } from "./layout.ts";

export type Pt = [number, number];

export interface Dial {
  key: string;
  label: string;
  min: number;
  max: number;
  step: number;
  value: number;
  doc: string;
}

export const DIALS: readonly Dial[] = [
  { key: "agents_out", label: "agents out", min: 40, max: 400, step: 5, value: 120, doc: "How far past the tree's names the agents sit; their lanes share the gap." },
  { key: "reach_out", label: "leave", min: 0, max: 300, step: 5, value: 80, doc: "How far a curve runs on along its branch before it bends." },
  { key: "reach_in", label: "arrive", min: 0, max: 300, step: 5, value: 60, doc: "How straight a curve comes into its agent." },
  { key: "reach_bend", label: "bend past", min: 10, max: 180, step: 5, value: 60, doc: "Degrees round the tree an agent may be before its curve takes its own lane." },
  { key: "reach_width", label: "width", min: 0.5, max: 6, step: 0.1, value: 1.8, doc: "The curve's width, at a zoom of 1." },
  { key: "reach_ink", label: "ink", min: 0.1, max: 1, step: 0.05, value: 0.75, doc: "How strong a curve is drawn when it is lit." },
  { key: "reach_sweep", label: "sweep s", min: 0.1, max: 3, step: 0.05, value: 0.6, doc: "Seconds a curve takes to draw from its start to its end." },
  { key: "reach_linger", label: "linger s", min: 0, max: 10, step: 0.1, value: 2.5, doc: "Seconds a drawn curve takes to fade." },
  { key: "reach_hold", label: "hold stops", min: 0.1, max: 0.9, step: 0.05, value: 0.4, doc: "How far along its curve a hold gets before it stops." },
];

export type Dials = Record<string, number>;

/** The dials' values: each one given, within its range; else where it starts. */
export function dialsOf(given: unknown): Dials {
  const g = given && typeof given === "object" ? (given as Record<string, unknown>) : {};
  return Object.fromEntries(DIALS.map((d) => {
    const x = g[d.key];
    return [d.key, typeof x === "number" && Number.isFinite(x) ? Math.min(d.max, Math.max(d.min, x)) : d.value];
  }));
}

export interface Ellipse {
  rx: number;
  ry: number;
}
/** Where the agents sit, and the tree's own bounds inside it. */
export interface Orbit extends Ellipse {
  rim: Ellipse;
}
export interface Seat {
  x: number;
  y: number;
  /** Its angle on the orbit, in the ellipse's own frame. */
  a: number;
}

/** The orbit: past the tree's bounds (names included) by `pad`. */
export function orbitOf(box: Placed["box"], pad = 120): Orbit {
  const rim = { rx: Math.max(Math.abs(box.x), Math.abs(box.x + box.width)), ry: Math.max(Math.abs(box.y), Math.abs(box.y + box.height)) };
  return { rx: rim.rx + pad, ry: rim.ry + pad, rim };
}

/** The seat of colour slot `slot` of `slots`, the first at the top, the rest clockwise. */
export function seatOf(orbit: Ellipse, slot: number, slots: number = HUES.length): Seat {
  const a = -Math.PI / 2 + (slot * 2 * Math.PI) / slots;
  return { a, x: Math.cos(a) * orbit.rx + 0, y: Math.sin(a) * orbit.ry + 0 };
}

/** The bounds of the tree and its orbit, agents' names under their seats included. */
export function orbitBox(orbit: Ellipse, label = 130): Placed["box"] {
  return { x: -orbit.rx - label, y: -orbit.ry - 24, width: 2 * (orbit.rx + label), height: 2 * orbit.ry + 24 + 64 };
}

/** Slot `slot`'s lane: an ellipse of its own between the tree's rim and the orbit. */
export function laneOf(orbit: Orbit, slot: number, slots: number = HUES.length): Ellipse {
  const k = (slot + 1) / (slots + 1);
  return { rx: orbit.rim.rx + (orbit.rx - orbit.rim.rx) * k, ry: orbit.rim.ry + (orbit.ry - orbit.rim.ry) * k };
}

const unit = (x: number, y: number): Pt => {
  const l = Math.hypot(x, y) || 1;
  return [x / l, y / l];
};
const wrap = (d: number) => {
  while (d > Math.PI) d -= 2 * Math.PI;
  while (d < -Math.PI) d += 2 * Math.PI;
  return d;
};
const STEP = 8;

/** A cubic bezier from `a` to `b`, as points about STEP apart. */
export function cubic(a: Pt, c1: Pt, c2: Pt, b: Pt): Pt[] {
  const rough = Math.hypot(c1[0] - a[0], c1[1] - a[1]) + Math.hypot(c2[0] - c1[0], c2[1] - c1[1]) + Math.hypot(b[0] - c2[0], b[1] - c2[1]);
  const n = Math.max(2, Math.ceil(rough / STEP));
  return Array.from({ length: n + 1 }, (_, i) => {
    const t = i / n, u = 1 - t;
    return [u * u * u * a[0] + 3 * u * u * t * c1[0] + 3 * u * t * t * c2[0] + t * t * t * b[0], u * u * u * a[1] + 3 * u * u * t * c1[1] + 3 * u * t * t * c2[1] + t * t * t * b[1]] as Pt;
  });
}

/** The direction a tree node's branch comes into it: its curve's last step; from the root, straight out. */
export function tangentOf(placed: Placed, id: string): Pt {
  const along = placed.along.get(id);
  const p = placed.xy.get(id) ?? { x: 0, y: 0 };
  if (along && along.length >= 2) {
    const [a, b] = [along[along.length - 2]!, along[along.length - 1]!];
    if (a[0] !== b[0] || a[1] !== b[1]) return unit(b[0] - a[0], b[1] - a[1]);
  }
  return p.x || p.y ? unit(p.x, p.y) : [0, -1];
}

/**
 * The curve from a point of the tree, leaving along `tangent`, to a seat:
 * straight in when the seat is near, else by way of its own lane.
 */
export function reach(from: Pt, tangent: Pt, seat: Seat, lane: Ellipse, d: Dials): Pt[] {
  const A = Math.atan2(from[1] / lane.ry, from[0] / lane.rx);
  const turn = wrap(seat.a - A);
  const bend = (d.reach_bend! * Math.PI) / 180;
  const ways = Math.abs(turn) <= bend ? 0 : Math.ceil(Math.abs(turn) / (Math.PI / 2));
  const sign = Math.sign(turn) || 1;
  // The stops: the node, a waypoint per quarter turn on the lane, the seat; each with its way through.
  const stops: { p: Pt; t: Pt }[] = [{ p: from, t: tangent }];
  for (let j = 1; j <= ways; j++) {
    const m = A + (turn * j) / (ways + 1);
    stops.push({ p: [Math.cos(m) * lane.rx, Math.sin(m) * lane.ry], t: unit(-Math.sin(m) * lane.rx * sign, Math.cos(m) * lane.ry * sign) });
  }
  const end: Pt = [seat.x, seat.y];
  const into = ways ? unit(-Math.sin(seat.a) * sign, Math.cos(seat.a) * sign) : unit(seat.x, seat.y);
  stops.push({ p: end, t: into });
  const out: Pt[] = [];
  for (let i = 0; i + 1 < stops.length; i++) {
    const a = stops[i]!, b = stops[i + 1]!;
    const chord = Math.hypot(b.p[0] - a.p[0], b.p[1] - a.p[1]);
    const armA = i === 0 ? d.reach_out! : chord / 3;
    const armB = i + 2 === stops.length ? d.reach_in! : chord / 3;
    const seg = cubic(a.p, [a.p[0] + a.t[0] * armA, a.p[1] + a.t[1] * armA], [b.p[0] - b.t[0] * armB, b.p[1] - b.t[1] * armB], b.p);
    out.push(...(i ? seg.slice(1) : seg));
  }
  return out;
}

/** How long a run of points is. */
export function lengthOf(pts: Pt[]): number {
  let l = 0;
  for (let i = 1; i < pts.length; i++) l += Math.hypot(pts[i]![0] - pts[i - 1]![0], pts[i]![1] - pts[i - 1]![1]);
  return l;
}

/** The first `u` (0 to 1) of a run of points, by length. */
export function partOf(pts: Pt[], u: number): Pt[] {
  const want = lengthOf(pts) * u;
  const out: Pt[] = [pts[0]!];
  let l = 0;
  for (let i = 1; i < pts.length; i++) {
    const s = Math.hypot(pts[i]![0] - pts[i - 1]![0], pts[i]![1] - pts[i - 1]![1]);
    if (l + s >= want) {
      const f = s ? (want - l) / s : 0;
      out.push([pts[i - 1]![0] + (pts[i]![0] - pts[i - 1]![0]) * f, pts[i - 1]![1] + (pts[i]![1] - pts[i - 1]![1]) * f]);
      return out;
    }
    l += s;
    out.push(pts[i]!);
  }
  return out;
}

export interface Reach {
  /** out: node to agent; in: agent to the place; hold: out and stopping short; pulse: at the agent only. */
  way: "out" | "in" | "hold" | "pulse";
  /** In the order it is drawn. */
  points: Pt[];
  tone: "say" | "fail" | "write" | "hold";
  /** The tree node it leaves or lands on. */
  at?: string;
}

/** How an event reaches between the tree and its agent, on slot `slot`'s lane. Nothing when it has no place in the tree. */
export function reachOf(tree: Tree, placed: Placed, orbit: Orbit, slot: number, e: Pick<ExchangeEvent, "kind" | "node" | "place" | "act">, d: Dials): Reach | undefined {
  const seat = seatOf(orbit, slot);
  if (e.kind === "begin" || e.kind === "end") return { way: "pulse", points: [[seat.x, seat.y]], tone: "say" };
  const lane = laneOf(orbit, slot);
  const from = (at: string): Pt[] | undefined => {
    const p = placed.xy.get(at);
    return p && reach([p.x, p.y], tangentOf(placed, at), seat, lane, d);
  };
  if (e.kind === "gated") {
    const at = e.node && tree.byId.has(e.node) ? e.node : spotOf(tree, e.place).id;
    const pts = from(at);
    return pts && { way: "hold", points: partOf(pts, d.reach_hold!), tone: "hold", at };
  }
  const l = lightOf(tree, e);
  if (!l) return undefined;
  const pts = from(l.at);
  if (!pts) return undefined;
  if (e.kind === "say" || e.kind === "refuse") return { way: "out", points: pts, tone: l.tone, at: l.at };
  return { way: "in", points: pts.reverse(), tone: l.tone, at: l.at };
}
