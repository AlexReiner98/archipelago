/**
 * The input a reciprocal frame is solved from: nodes (a point, its normal,
 * and whether it is a support) and the edges among them. Each edge becomes
 * one beam. Until meshes can be drawn on the page, a few are seeded here:
 * a dome (a geodesic hemisphere), a vault (a triangulated barrel) and a
 * fan (one node and its ring). Pure; lengths in centimetres.
 */

export type V3 = [number, number, number];

export interface MeshNode {
  p: V3;
  /** Which way is up at the node: the over beam of each pair sits on this side of the under one. */
  n: V3;
  /** A support: the beams that reach it are held there, and it has no fan. */
  support: boolean;
}

export interface Mesh {
  name: string;
  nodes: MeshNode[];
  edges: [number, number][];
}

/** The seeded meshes, in the order the `mesh` dial names them. */
export const MESHES = ["dome", "vault", "fan"] as const;
export type MeshName = (typeof MESHES)[number];

const add = (a: V3, b: V3): V3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const mul = (a: V3, s: number): V3 => [a[0] * s, a[1] * s, a[2] * s];
const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const unit = (a: V3): V3 => mul(a, 1 / (Math.hypot(a[0], a[1], a[2]) || 1));

/** A mesh by name; `detail` is how finely (dome: subdivisions, vault: bays, fan: beams less three). */
export function mesh(name: MeshName, detail = 2): Mesh {
  const d = Math.max(1, Math.round(detail));
  if (name === "fan") return fan(3 + d);
  if (name === "vault") return vault(d);
  return dome(d);
}

/** One interior node, a little raised, and `k` supports round it. */
function fan(k: number): Mesh {
  const nodes: MeshNode[] = [{ p: [0, 0, 40], n: [0, 0, 1], support: false }];
  const edges: [number, number][] = [];
  for (let i = 0; i < k; i++) {
    const a = (2 * Math.PI * i) / k;
    nodes.push({ p: [150 * Math.cos(a), 150 * Math.sin(a), 0], n: [0, 0, 1], support: true });
    edges.push([0, i + 1]);
  }
  return { name: "fan", nodes, edges };
}

/** Triangles to nodes and edges: each edge once, normals from the faces round a node, supports on the border. */
function fromFaces(name: string, points: V3[], faces: [number, number, number][], normalOf?: (p: V3) => V3): Mesh {
  const count = new Map<string, number>();
  const key = (a: number, b: number) => (a < b ? `${a},${b}` : `${b},${a}`);
  const normals: V3[] = points.map(() => [0, 0, 0]);
  for (const [a, b, c] of faces) {
    for (const [p, q] of [[a, b], [b, c], [c, a]] as const) count.set(key(p, q), (count.get(key(p, q)) ?? 0) + 1);
    let fn = cross(sub(points[b]!, points[a]!), sub(points[c]!, points[a]!));
    if (fn[2] < 0) fn = mul(fn, -1);
    for (const v of [a, b, c]) normals[v] = add(normals[v]!, fn);
  }
  const border = new Set<number>();
  for (const [k, c] of count) if (c === 1) for (const v of k.split(",")) border.add(Number(v));
  // Only the points a face uses, renumbered.
  const used = [...new Set(faces.flat())].sort((p, q) => p - q);
  const at = new Map(used.map((v, i) => [v, i]));
  return {
    name,
    nodes: used.map((v) => ({ p: points[v]!, n: normalOf ? normalOf(points[v]!) : unit(normals[v]!), support: border.has(v) })),
    edges: [...count.keys()].map((k) => k.split(",").map((v) => at.get(Number(v))!) as [number, number]),
  };
}

/** A geodesic hemisphere: an icosahedron split `f` times along each edge, its upper faces kept; edges about 120 cm. */
function dome(f: number): Mesh {
  const t = (1 + Math.sqrt(5)) / 2;
  const ico: V3[] = [[-1, t, 0], [1, t, 0], [-1, -t, 0], [1, -t, 0], [0, -1, t], [0, 1, t], [0, -1, -t], [0, 1, -t], [t, 0, -1], [t, 0, 1], [-t, 0, -1], [-t, 0, 1]].map((p) => unit(p as V3));
  // Turned so a vertex is at the top: the dome is round, not lopsided.
  const top = unit(ico[5]!), axis = unit(cross(top, [0, 0, 1])), ang = Math.acos(top[2]);
  const turn = (p: V3): V3 => {
    const c = Math.cos(ang), s = Math.sin(ang), k = axis;
    const kp = cross(k, p), kd = k[0] * p[0] + k[1] * p[1] + k[2] * p[2];
    return add(add(mul(p, c), mul(kp, s)), mul(k, kd * (1 - c)));
  };
  const base: V3[] = ico.map(turn);
  const tri: [number, number, number][] = [[0, 11, 5], [0, 5, 1], [0, 1, 7], [0, 7, 10], [0, 10, 11], [1, 5, 9], [5, 11, 4], [11, 10, 2], [10, 7, 6], [7, 1, 8], [3, 9, 4], [3, 4, 2], [3, 2, 6], [3, 6, 8], [3, 8, 9], [4, 9, 5], [2, 4, 11], [6, 2, 10], [8, 6, 7], [9, 8, 1]];
  const R = (120 * f) / 1.05;
  const points: V3[] = [];
  const index = new Map<string, number>();
  const pointAt = (p: V3) => {
    const u = unit(p);
    const k = u.map((x) => x.toFixed(5)).join(",");
    let i = index.get(k);
    if (i === undefined) (i = points.length), index.set(k, i), points.push(mul(u, R));
    return i;
  };
  const faces: [number, number, number][] = [];
  for (const [a, b, c] of tri) {
    const A = base[a]!, B = base[b]!, C = base[c]!;
    const at = (i: number, j: number) => add(add(mul(A, (f - i - j) / f), mul(B, i / f)), mul(C, j / f));
    for (let i = 0; i < f; i++)
      for (let j = 0; j < f - i; j++) {
        faces.push([pointAt(at(i, j)), pointAt(at(i + 1, j)), pointAt(at(i, j + 1))]);
        if (i + j < f - 1) faces.push([pointAt(at(i + 1, j)), pointAt(at(i + 1, j + 1)), pointAt(at(i, j + 1))]);
      }
  }
  // The upper half, cut a little under the equator so the rim is whole.
  const kept = faces.filter((fc) => fc.reduce((z, v) => z + points[v]![2], 0) / 3 > -0.08 * R);
  const lift = Math.min(...kept.flat().map((v) => points[v]![2]));
  const raised = points.map((p) => [p[0], p[1], p[2] - lift] as V3);
  return fromFaces("dome", raised, kept, (p) => unit([p[0], p[1], p[2] + lift]));
}

/** A barrel vault: `bays + 2` bays long and four across, its long sides on supports; edges about 110 cm. */
function vault(bays: number): Mesh {
  const nx = bays + 3, ny = 5, span = 4 * 110, R = span * 0.62;
  const points: V3[] = [];
  for (let i = 0; i < nx; i++)
    for (let j = 0; j < ny; j++) {
      const y = -span / 2 + (span * j) / (ny - 1);
      // Every other row shifts half a bay, so the triangles are near even.
      const x = (i + (j % 2 ? 0.5 : 0) - (nx - 1) / 2) * 110;
      points.push([x, y, Math.sqrt(R * R - y * y) - Math.sqrt(R * R - (span / 2) ** 2)]);
    }
  const id = (i: number, j: number) => i * ny + j;
  const faces: [number, number, number][] = [];
  for (let i = 0; i < nx - 1; i++)
    for (let j = 0; j < ny - 1; j++) {
      if (j % 2 === 0) faces.push([id(i, j), id(i + 1, j), id(i, j + 1)], [id(i + 1, j), id(i + 1, j + 1), id(i, j + 1)]);
      else faces.push([id(i, j), id(i + 1, j), id(i + 1, j + 1)], [id(i, j), id(i + 1, j + 1), id(i, j + 1)]);
    }
  return fromFaces("vault", points, faces);
}
