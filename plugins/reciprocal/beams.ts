/**
 * A reciprocal frame's beams, as particles: each edge of the mesh is a
 * beam, and each beam is two particles, its ends, in the same flat arrays
 * the Landscape settles (packs/field/graph.ts), linked by a `beam` link.
 * Beam `b`'s end at its edge's first node is particle `2b`, at the second
 * `2b + 1`.
 *
 * - **Fans.** At each node that is not a support, the beams that meet it
 *   are sorted round the node's normal; each rests on the next (`turn`
 *   picks which way round). That makes a cycle per fan: that is what
 *   reciprocal means.
 * - **The DAG.** "Rests on" among the beams, made acyclic: beams are taken
 *   from the supports up, each once everything it rests on is placed; when
 *   every beam left rests on one not yet placed (a fan's cycle), the one
 *   nearest the supports is placed anyway, and each contact that waited is
 *   marked `closing`. What is left is a DAG: a beam's level is one more
 *   than the highest beam it rests on through contacts that are not
 *   closing. The solve sweeps beams in this order.
 */
import type { G } from "../field/graph.ts";
import type { Mesh, V3 } from "./mesh.ts";
import { cross, dot, flat, sub, unit } from "./vec.ts";

export interface Contact {
  node: number;
  /** The beam whose end rests, and the beam it rests on. */
  over: number;
  under: number;
  /** A contact the DAG leaves out: it closes a fan's cycle, and only the step's pushes keep it. */
  closing: boolean;
}

export interface Rests {
  contacts: Contact[];
  /** The beams, in an order where each comes after every beam it rests on (closing contacts aside). */
  order: number[];
  level: Int32Array;
  /** Each beam's contacts as the one resting. */
  overOf: number[][];
  /** Pairs of beams in one fan that are not next to each other: kept apart, never touching. */
  clash: [number, number, number][];
}

/** Everything the agents read: the mesh, its fans, the DAG, each beam's radius and where each end started. */
export interface RF {
  mesh: Mesh;
  fans: number[][];
  rests: Rests;
  r: Float32Array;
  home: Float32Array;
  len0: Float32Array;
}

export interface RG extends G {
  rf: RF;
}

/** The particle that is beam `b`'s end at `node`. */
export const endAt = (mesh: Mesh, b: number, node: number) => 2 * b + (mesh.edges[b]![0] === node ? 0 : 1);
/** The particle at beam `b`'s other end from `node`. */
export const farEnd = (mesh: Mesh, b: number, node: number) => endAt(mesh, b, node) ^ 1;

/** Two unit vectors square to `n` and to each other. */
export function plane(n: V3): [V3, V3] {
  const a: V3 = Math.abs(n[2]) < 0.9 ? [0, 0, 1] : [1, 0, 0];
  const u = unit(cross(n, a));
  return [u, cross(n, u)];
}

/** At each node not a support, with three beams or more, its beams sorted round its normal; else none. */
export function fans(mesh: Mesh): number[][] {
  const meet: number[][] = mesh.nodes.map(() => []);
  mesh.edges.forEach(([a, b], e) => (meet[a]!.push(e), meet[b]!.push(e)));
  return mesh.nodes.map((node, v) => {
    if (node.support || meet[v]!.length < 3) return [];
    const [u, w] = plane(node.n);
    const angle = (e: number) => {
      const [a, b] = mesh.edges[e]!;
      const d = flat(sub(mesh.nodes[a === v ? b : a]!.p, node.p), node.n);
      return Math.atan2(dot(d, w), dot(d, u));
    };
    return meet[v]!.map((e) => [e, angle(e)] as const).sort((p, q) => p[1] - q[1]).map(([e]) => e);
  });
}

/** The contacts of every fan, and the DAG of "rests on" with each fan's cycle closed by one contact. */
export function rests(mesh: Mesh, fanOf: number[][], turn: number): Rests {
  const m = mesh.edges.length;
  const contacts: Contact[] = [];
  const clash: [number, number, number][] = [];
  fanOf.forEach((fan, node) => {
    const k = fan.length;
    for (let i = 0; i < k; i++) {
      const a = fan[i]!, b = fan[(i + 1) % k]!;
      contacts.push(turn ? { node, over: b, under: a, closing: false } : { node, over: a, under: b, closing: false });
      for (let j = i + 2; j < k; j++) if (!(i === 0 && j === k - 1)) clash.push([node, a, fan[j]!]);
    }
  });
  const overOf: number[][] = Array.from({ length: m }, () => []);
  contacts.forEach((c, k) => overOf[c.over]!.push(k));

  // How far each beam is from the supports, in beams: the DAG starts there.
  const reach = new Int32Array(m).fill(-1);
  const byNode: number[][] = mesh.nodes.map(() => []);
  mesh.edges.forEach(([a, b], e) => (byNode[a]!.push(e), byNode[b]!.push(e)));
  let ring = mesh.edges.flatMap(([a, b], e) => (mesh.nodes[a]!.support || mesh.nodes[b]!.support ? [e] : []));
  if (!ring.length) ring = [0];
  for (const e of ring) reach[e] = 0;
  for (let d = 0; ring.length; d++) {
    const next: number[] = [];
    for (const e of ring) for (const v of mesh.edges[e]!) for (const f of byNode[v]!) if (reach[f] === -1) (reach[f] = d + 1), next.push(f);
    ring = next;
  }

  const placed = new Uint8Array(m), order: number[] = [];
  const waits = (b: number) => overOf[b]!.filter((k) => !contacts[k]!.closing && !placed[contacts[k]!.under]).length;
  const byReach = (p: number, q: number) => reach[p]! - reach[q]! || p - q;
  while (order.length < m) {
    const ready = Array.from({ length: m }, (_, b) => b).filter((b) => !placed[b] && !waits(b)).sort(byReach);
    if (ready.length) {
      for (const b of ready) (placed[b] = 1), order.push(b);
      continue;
    }
    // A cycle: the beam nearest the supports, waiting on the fewest, goes anyway, and what it waited on closes.
    const b = Array.from({ length: m }, (_, x) => x).filter((x) => !placed[x]).sort((p, q) => reach[p]! - reach[q]! || waits(p) - waits(q) || p - q)[0]!;
    for (const k of overOf[b]!) if (!placed[contacts[k]!.under]) contacts[k]!.closing = true;
    placed[b] = 1;
    order.push(b);
  }
  const level = new Int32Array(m);
  for (const b of order) for (const k of overOf[b]!) if (!contacts[k]!.closing) level[b] = Math.max(level[b]!, level[contacts[k]!.under]! + 1);
  return { contacts, order, level, overOf, clash };
}
