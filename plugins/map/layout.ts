/**
 * Where the canvas puts a query's items: a flow, left to right, with
 * right-angled wires that never share a run or cross a card. Pure.
 *
 * - An item stands right of what it needs: what it depends_on or waits_on,
 *   its parts (part_of), the evidence that bears_on it. `about` and any
 *   other kind of link don't order. Cycles are broken where found.
 * - A wire that spans columns gets a slot of its own in each column it
 *   passes (a placeholder row), so it never runs through a card.
 * - Each column's rows are ordered by where their neighbours sit, a few
 *   sweeps each way, so wires cross less.
 * - Each card side spreads its wire ends along its edge, ordered by where
 *   each wire goes, so two wires never share a horizontal run.
 * - Between two columns, each wire turns on a lane of its own.
 * - Items with no links among the drawn ones are set apart below.
 */
import type { Id } from "../../spec/common.ts";

export interface In {
  items: { id: Id }[];
  links: { id: Id; type: string; from: Id; to: Id }[];
}

export interface Box {
  id: Id;
  x: number;
  y: number;
  col: number;
}
export interface Path {
  id: Id;
  type: string;
  from: Id;
  to: Id;
  /** Points of a polyline, right angles only. */
  points: [number, number][];
}
export interface Out {
  boxes: Map<Id, Box>;
  paths: Path[];
  width: number;
  height: number;
}

export const SIZE = { w: 250, h: 22, gapX: 72, gapY: 6, lone: 18 };

/** Which way a link orders its ends: "after" means `to` stands right of `from`. */
export function order(type: string): "before" | "after" | null {
  if (type === "depends_on" || type === "waits_on") return "before"; // from needs to: to is left
  if (type === "part_of" || type === "bears_on") return "after"; // to gathers from: to is right
  return null;
}

/** A piece of a wire between two neighbouring columns (or, for ends in one column, beside it). */
interface Seg {
  wire: number;
  a: Id; // left end (a node or a placeholder)
  b: Id; // right end
  gap: number; // the column it leaves from
  ya?: number;
  yb?: number;
  lane?: number;
}

export function layout(input: In): Out {
  const { w, h, gapX, gapY } = SIZE;
  const ids = input.items.map((i) => i.id);
  const known = new Set(ids);
  const links = input.links.filter((l) => known.has(l.from) && known.has(l.to) && l.from !== l.to);
  const needs = new Map<Id, Id[]>(ids.map((id) => [id, []]));
  for (const l of links) {
    const o = order(l.type);
    if (o === "before") needs.get(l.from)!.push(l.to);
    else if (o === "after") needs.get(l.to)!.push(l.from);
  }
  const rank = new Map<Id, number>();
  const visiting = new Set<Id>();
  const rankOf = (id: Id): number => {
    if (rank.has(id)) return rank.get(id)!;
    if (visiting.has(id)) return 0; // a cycle: break it here
    visiting.add(id);
    let r = 0;
    for (const n of needs.get(id)!) r = Math.max(r, rankOf(n) + 1);
    visiting.delete(id);
    rank.set(id, r);
    return r;
  };
  const linked = new Set<Id>();
  for (const l of links) linked.add(l.from).add(l.to);
  const flow = ids.filter((id) => linked.has(id));
  const lone = ids.filter((id) => !linked.has(id));
  for (const id of flow) rankOf(id);

  // Each wire as a chain of nodes left to right, with a placeholder in every column it passes.
  const real = new Set(flow);
  const chains: Id[][] = links.map((l, i) => {
    const [a, b] = rank.get(l.from)! <= rank.get(l.to)! ? [l.from, l.to] : [l.to, l.from];
    const chain = [a];
    for (let c = rank.get(a)! + 1; c < rank.get(b)!; c++) {
      const d = `~${i}~${c}`;
      rank.set(d, c);
      chain.push(d);
    }
    chain.push(b);
    return chain;
  });

  const cols: Id[][] = [];
  for (const [id, r] of rank) if (real.has(id) || id.startsWith("~")) (cols[r] ??= []).push(id);
  for (let i = 0; i < cols.length; i++) cols[i] ??= [];

  const nb = new Map<Id, Id[]>([...rank.keys()].map((id) => [id, []]));
  for (const chain of chains) {
    for (let i = 1; i < chain.length; i++) {
      nb.get(chain[i - 1]!)!.push(chain[i]!);
      nb.get(chain[i]!)!.push(chain[i - 1]!);
    }
  }
  const pos = new Map<Id, number>();
  const place = () => cols.forEach((c) => c.forEach((id, i) => pos.set(id, i)));
  place();
  const sweep = (c: Id[], from: number) => {
    const bary = (id: Id) => {
      const ns = nb.get(id)!.filter((n) => rank.get(n) === from);
      return ns.length ? ns.reduce((s, n) => s + pos.get(n)!, 0) / ns.length : pos.get(id)!;
    };
    const keyed = c.map((id) => [id, bary(id)] as const);
    keyed.sort((a, b) => a[1] - b[1]);
    c.splice(0, c.length, ...keyed.map(([id]) => id));
  };
  for (let pass = 0; pass < 6; pass++) {
    for (let i = 1; i < cols.length; i++) (sweep(cols[i]!, i - 1), place());
    for (let i = cols.length - 2; i >= 0; i--) (sweep(cols[i]!, i + 1), place());
  }

  // Rows: a card takes a full row, a placeholder a thin one.
  const thin = 10;
  const boxes = new Map<Id, Box>();
  const at = new Map<Id, { x: number; y: number; col: number }>();
  let flowH = 0;
  cols.forEach((c, col) => {
    let y = 0;
    for (const id of c) {
      const isReal = real.has(id);
      at.set(id, { x: col * (w + gapX), y, col });
      if (isReal) boxes.set(id, { id, col, x: col * (w + gapX), y });
      y += (isReal ? h : thin) + gapY;
    }
    flowH = Math.max(flowH, y);
  });

  // The lone items, below, in columns.
  const top = flow.length ? flowH + 2 * h : 0;
  const per = Math.max(SIZE.lone, Math.ceil(Math.sqrt(lone.length * 3)));
  lone.forEach((id, i) => {
    boxes.set(id, { id, col: -1, x: Math.floor(i / per) * (w + gapX), y: top + (i % per) * (h + gapY) });
  });
  const loneCols = Math.ceil(lone.length / per);
  const loneH = lone.length ? Math.min(lone.length, per) * (h + gapY) : 0;

  // Segments, and each card side's ports spread by where their wires go.
  const segs: Seg[] = [];
  chains.forEach((chain, wire) => {
    if (chain.length === 2 && rank.get(chain[0]!) === rank.get(chain[1]!)) {
      segs.push({ wire, a: chain[0]!, b: chain[1]!, gap: rank.get(chain[0]!)! }); // ends in one column: beside it
      return;
    }
    for (let i = 1; i < chain.length; i++) segs.push({ wire, a: chain[i - 1]!, b: chain[i]!, gap: rank.get(chain[i - 1]!)! });
  });
  const mid = (id: Id) => at.get(id)!.y + (real.has(id) ? h : thin) / 2;
  const sides = new Map<string, { seg: Seg; end: "a" | "b"; other: number }[]>();
  const side = (id: Id, s: "l" | "r") => `${id}|${s}`;
  for (const seg of segs) {
    const same = rank.get(seg.a) === rank.get(seg.b);
    const add = (id: Id, s: "l" | "r", end: "a" | "b", other: Id) => {
      const k = side(id, s);
      (sides.get(k) ?? sides.set(k, []).get(k)!).push({ seg, end, other: mid(other) });
    };
    add(seg.a, "r", "a", seg.b);
    add(seg.b, same ? "r" : "l", "b", seg.a);
  }
  for (const [k, list] of sides) {
    const id = k.slice(0, k.lastIndexOf("|"));
    const span = real.has(id) ? h - 6 : 0;
    list.sort((p, q) => p.other - q.other);
    list.forEach((p, i) => {
      const y = at.get(id)!.y + (real.has(id) ? 3 : thin / 2) + (list.length > 1 ? (span * i) / (list.length - 1) : span / 2);
      p.seg[p.end === "a" ? "ya" : "yb"] = y;
    });
  }

  // Lanes: each gap's segments on lanes of their own, ordered to cross less.
  const byGap = new Map<number, Seg[]>();
  for (const s of segs) (byGap.get(s.gap) ?? byGap.set(s.gap, []).get(s.gap)!).push(s);
  for (const [gap, list] of byGap) {
    // Going down: the lower start turns first (leftmost); going up, the reverse, so they nest.
    list.sort((p, q) => {
      const dp = p.yb! - p.ya!;
      const dq = q.yb! - q.ya!;
      if (Math.sign(dp) !== Math.sign(dq)) return dp - dq;
      return dp >= 0 ? q.ya! - p.ya! : p.ya! - q.ya!;
    });
    const x0 = gap * (w + gapX) + w;
    list.forEach((s, i) => (s.lane = x0 + ((i + 1) * gapX) / (list.length + 1)));
  }

  const paths: Path[] = links.map((l, wire) => {
    const mine = segs.filter((s) => s.wire === wire);
    const points: [number, number][] = [];
    for (const s of mine) {
      const A = at.get(s.a)!;
      const B = at.get(s.b)!;
      const same = A.col === B.col;
      const ax = A.x + (real.has(s.a) ? w : w); // a placeholder is passed straight through its column
      const bx = same ? B.x + w : B.x;
      if (!points.length) points.push([real.has(s.a) ? ax : A.x, s.ya!]);
      if (!real.has(s.a)) points.push([ax, s.ya!]);
      points.push([s.lane!, s.ya!], [s.lane!, s.yb!], [bx, s.yb!]);
    }
    return { id: l.id, type: l.type, from: l.from, to: l.to, points: tidy(points) };
  });

  const width = Math.max(cols.length, loneCols, 1) * (w + gapX) - gapX;
  return { boxes, paths, width, height: Math.max(top + loneH, flowH, h) };
}

/** Drops repeated points and the middle of three in a line. */
function tidy(ps: [number, number][]): [number, number][] {
  const out: [number, number][] = [];
  for (const p of ps) {
    const last = out[out.length - 1];
    if (last && last[0] === p[0] && last[1] === p[1]) continue;
    const prev = out[out.length - 2];
    if (prev && last && ((prev[0] === last[0] && last[0] === p[0]) || (prev[1] === last[1] && last[1] === p[1]))) out.pop();
    out.push(p);
  }
  return out;
}
