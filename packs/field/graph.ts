/**
 * The field's graph as flat arrays, so a physics loop runs over it without
 * a Map in sight; where particles start (seed); and small helpers. Pure.
 *
 * Given the last graph, a particle that was already there keeps its place
 * and speed, so a change to the map is seen as motion, not a new picture.
 */
import type { Id } from "../../spec/common.ts";

/** What the field draws: items and the links among them. No item belongs to a group: clusters come from the links. */
export interface FieldIn {
  items: { id: Id; title: string; type: string; status: string; closed: boolean; kind?: string }[];
  links: { id: Id; type: string; from: Id; to: Id }[];
}

/** The dials' values, by key. */
export type Settings = Record<string, number>;

/** How the run goes: how warm it is and how far it has come. */
export interface Sim {
  alpha: number;
  steps: number;
  energy?: number;
}

export interface G {
  n: number;
  m: number;
  id: Id[];
  title: string[];
  type: string[];
  status: string[];
  closed: Uint8Array;
  /** The types drawn, each with its colour; a particle's colour is its type's. */
  types: { name: string; colour: string }[];
  typeIx: Int32Array;
  linkKinds: string[];
  x: Float32Array;
  y: Float32Array;
  z: Float32Array;
  vx: Float32Array;
  vy: Float32Array;
  vz: Float32Array;
  r: Float32Array;
  fixed: Uint8Array;
  placed: Uint8Array;
  degree: Int32Array;
  a: Int32Array;
  b: Int32Array;
  kind: Int32Array;
  /** Each particle's neighbours, as compressed rows. */
  adjStart: Int32Array;
  adj: Int32Array;
  /** Each particle's links, by link index. */
  incident: number[][];
  idIx: Map<Id, number>;
  sim: Sim;
  /** Scratch, kept so each step does not allocate. */
  force: { x: Float32Array; y: Float32Array; z: Float32Array };
  total: { x: Float32Array; y: Float32Array; z: Float32Array };
}

export function build(input: FieldIn, last: G | null, pal: string[] = []): G {
  const items = input.items;
  const n = items.length;
  const at = new Map(items.map((it, i) => [it.id, i]));
  const types = typeColours(items.map((it) => it.type), pal);
  const typeNames = types.map((t) => t.name);
  const typeIx = new Map(typeNames.map((t, k) => [t, k]));
  const links = input.links.filter((l) => at.has(l.from) && at.has(l.to) && l.from !== l.to);
  const linkKinds = [...new Set(links.map((l) => l.type))];
  const m = links.length;
  const f32 = () => new Float32Array(n);
  const g: G = {
    n,
    m,
    id: items.map((it) => it.id),
    title: items.map((it) => it.title),
    type: items.map((it) => it.type),
    status: items.map((it) => it.status),
    closed: Uint8Array.from(items, (it) => (it.closed ? 1 : 0)),
    types,
    typeIx: new Int32Array(n),
    linkKinds,
    x: f32(),
    y: f32(),
    z: f32(),
    vx: f32(),
    vy: f32(),
    vz: f32(),
    r: f32(),
    fixed: new Uint8Array(n),
    placed: new Uint8Array(n),
    degree: new Int32Array(n),
    a: new Int32Array(m),
    b: new Int32Array(m),
    kind: new Int32Array(m),
    adjStart: new Int32Array(n + 1),
    adj: new Int32Array(2 * m),
    incident: Array.from({ length: n }, () => []),
    idIx: at,
    sim: last?.sim ? { ...last.sim } : { alpha: 1, steps: 0 },
    force: { x: f32(), y: f32(), z: f32() },
    total: { x: f32(), y: f32(), z: f32() },
  };
  items.forEach((it, i) => {
    g.typeIx[i] = typeIx.get(it.type)!;
    const was = last?.idIx.get(it.id);
    if (last && was !== undefined) {
      g.x[i] = last.x[was]!;
      g.y[i] = last.y[was]!;
      g.z[i] = last.z[was]!;
      g.vx[i] = last.vx[was]!;
      g.vy[i] = last.vy[was]!;
      g.vz[i] = last.vz[was]!;
      g.placed[i] = 1;
    }
  });
  links.forEach((l, e) => {
    const a = at.get(l.from)!;
    const b = at.get(l.to)!;
    g.a[e] = a;
    g.b[e] = b;
    g.kind[e] = linkKinds.indexOf(l.type);
    g.degree[a]!++;
    g.degree[b]!++;
    g.incident[a]!.push(e);
    g.incident[b]!.push(e);
  });
  for (let i = 0; i < n; i++) g.adjStart[i + 1] = g.adjStart[i]! + g.degree[i]!;
  const fill = g.adjStart.slice(0, n);
  for (let e = 0; e < m; e++) {
    g.adj[fill[g.a[e]!]!++] = g.b[e]!;
    g.adj[fill[g.b[e]!]!++] = g.a[e]!;
  }
  return g;
}

/**
 * Where particles start: one sunflower spiral round the middle, sized by
 * the count (`seed_spread`). The order along it walks the links outward
 * from the most linked particle, so linked particles start near each other
 * and clusters form from the links alone. The same answer starts the same
 * way. A particle already placed stays; a new one starts beside a placed
 * neighbour, or on the spiral. Also sets each particle's radius.
 */
export function seed(g: G, S: Settings): void {
  const golden = Math.PI * (3 - Math.sqrt(5));
  const reach = S.seed_spread! * S.node_size! * Math.sqrt(g.n + 1);
  // Breadth first along the links, each time from the most linked particle not yet met.
  const order: number[] = [];
  const met = new Uint8Array(g.n);
  const starts = Array.from({ length: g.n }, (_, i) => i).sort((p, q) => g.degree[q]! - g.degree[p]! || p - q);
  for (const s0 of starts) {
    if (met[s0]) continue;
    met[s0] = 1;
    const ring = [s0];
    for (let h = 0; h < ring.length; h++) {
      const i = ring[h]!;
      order.push(i);
      for (let p = g.adjStart[i]!; p < g.adjStart[i + 1]!; p++) {
        const j = g.adj[p]!;
        if (!met[j]) (met[j] = 1), ring.push(j);
      }
    }
  }
  // Kept particles stay; only then does a new one start beside a kept neighbour.
  const kept = g.placed.slice();
  order.forEach((i, s) => {
    if (g.placed[i]) return;
    let nb = -1;
    for (let p = g.adjStart[i]!; p < g.adjStart[i + 1]!; p++) if (kept[g.adj[p]!]) nb = g.adj[p]!;
    if (nb >= 0) {
      g.x[i] = g.x[nb]! + S.node_size! * 4 * Math.cos(i);
      g.y[i] = g.y[nb]! + S.node_size! * 4 * Math.sin(i);
    } else {
      const rr = reach * Math.sqrt((s + 0.5) / Math.max(1, g.n));
      g.x[i] = rr * Math.cos(s * golden);
      g.y[i] = rr * Math.sin(s * golden);
    }
    g.z[i] = 0;
    g.placed[i] = 1;
  });
  sizes(g, S);
}

/** Each particle's radius: node_size, grown by node_grow with the log of its links. */
export function sizes(g: G, S: Settings): void {
  for (let i = 0; i < g.n; i++) g.r[i] = S.node_size! * (1 + S.node_grow! * Math.log1p(g.degree[i]!));
}

export function bounds(g: G): [number, number, number, number] {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (let i = 0; i < g.n; i++) {
    const x = g.x[i]!, y = g.y[i]!, r = g.r[i]!;
    if (x - r < x0) x0 = x - r;
    if (y - r < y0) y0 = y - r;
    if (x + r > x1) x1 = x + r;
    if (y + r > y1) y1 = y + r;
  }
  return g.n ? [x0, y0, x1, y1] : [0, 0, 1, 1];
}

export function neighbours(g: G, i: number): Set<number> {
  const s = new Set([i]);
  for (let p = g.adjStart[i]!; p < g.adjStart[i + 1]!; p++) s.add(g.adj[p]!);
  return s;
}

/** The types among these, sorted, each with its colour (from `pal`, the style's hues, then its own): what the particles and the legend use. */
export function typeColours(names: string[], pal: string[] = []): { name: string; colour: string }[] {
  return [...new Set(names)].sort().map((name, k) => ({ name, colour: pal[k] ?? hue(k) }));
}

/** Type colours: evenly round the hue wheel, lightness alternating so neighbours in the list differ. */
export function hue(k: number): string {
  const h = (k * 360 * 0.618034) % 360;
  return `hsl(${h.toFixed(0)} ${k % 2 ? 55 : 68}% ${k % 3 === 0 ? 52 : k % 3 === 1 ? 60 : 45}%)`;
}

/** A hashed grid of particles, for what is near a point. */
export interface Grid {
  each(x0: number, y0: number, x1: number, y1: number, fn: (i: number) => void): void;
  nearest(x: number, y: number, slack: number): number;
}
export function grid(g: G, cellOf?: number): Grid {
  const [x0, y0, x1, y1] = bounds(g);
  const cell = cellOf ?? Math.max(1, Math.sqrt(((x1 - x0) * (y1 - y0)) / Math.max(1, g.n)) * 2);
  const cells = new Map<number, number[]>();
  const key = (cx: number, cy: number) => (cx * 73856093) ^ (cy * 19349663);
  for (let i = 0; i < g.n; i++) {
    const k = key(Math.floor(g.x[i]! / cell), Math.floor(g.y[i]! / cell));
    let list = cells.get(k);
    if (!list) cells.set(k, (list = []));
    list.push(i);
  }
  const each = (ax: number, ay: number, bx: number, by: number, fn: (i: number) => void) => {
    const cx0 = Math.floor(ax / cell), cx1 = Math.floor(bx / cell), cy0 = Math.floor(ay / cell), cy1 = Math.floor(by / cell);
    if ((cx1 - cx0 + 1) * (cy1 - cy0 + 1) > 40000) {
      for (let i = 0; i < g.n; i++) fn(i);
      return;
    }
    for (let cy = cy0; cy <= cy1; cy++) for (let cx = cx0; cx <= cx1; cx++) for (const i of cells.get(key(cx, cy)) ?? []) fn(i);
  };
  return {
    each,
    nearest(x, y, slack) {
      let best = -1, bd = Infinity;
      const reach = cell;
      each(x - reach, y - reach, x + reach, y + reach, (i) => {
        const d = Math.hypot(g.x[i]! - x, g.y[i]! - y) - g.r[i]!;
        if (d < slack && d < bd) {
          bd = d;
          best = i;
        }
      });
      return best;
    },
  };
}
