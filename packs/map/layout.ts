/**
 * Where the canvas puts a query's items: a flow, left to right, with
 * right-angled wires. Pure.
 *
 * - An item stands right of what it needs: what it depends_on or waits_on,
 *   its parts (part_of), the evidence that bears_on it. `about` and any
 *   other kind of link don't order. Cycles are broken where found.
 * - Each column's rows are ordered by where their neighbours sit, a few
 *   sweeps each way, so wires cross less.
 * - Items with no links among the drawn ones are set apart below, in
 *   columns of their own.
 * - A wire leaves its left end's right edge, turns in the gap on a lane of
 *   its own, and enters its right end's left edge. Ends in one column join
 *   on the right side.
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

export const SIZE = { w: 250, h: 22, gapX: 64, gapY: 6, lone: 18 };

/** Which way a link orders its ends: "after" means `to` stands right of `from`. */
export function order(type: string): "before" | "after" | null {
  if (type === "depends_on" || type === "waits_on") return "before"; // from needs to: to is left
  if (type === "part_of" || type === "bears_on") return "after"; // to gathers from: to is right
  return null;
}

export function layout(input: In): Out {
  const ids = input.items.map((i) => i.id);
  const known = new Set(ids);
  const links = input.links.filter((l) => known.has(l.from) && known.has(l.to) && l.from !== l.to);
  // needs: right → the items left of it
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

  const cols: Id[][] = [];
  for (const id of flow) (cols[rank.get(id)!] ??= []).push(id);
  for (let i = 0; i < cols.length; i++) cols[i] ??= [];

  // Neighbours both ways, for ordering rows.
  const nb = new Map<Id, Id[]>(flow.map((id) => [id, []]));
  for (const l of links) {
    nb.get(l.from)?.push(l.to);
    nb.get(l.to)?.push(l.from);
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
  for (let pass = 0; pass < 4; pass++) {
    for (let i = 1; i < cols.length; i++) {
      sweep(cols[i]!, i - 1);
      place();
    }
    for (let i = cols.length - 2; i >= 0; i--) {
      sweep(cols[i]!, i + 1);
      place();
    }
  }

  const { w, h, gapX, gapY } = SIZE;
  const boxes = new Map<Id, Box>();
  cols.forEach((c, col) => c.forEach((id, row) => boxes.set(id, { id, col, x: col * (w + gapX), y: row * (h + gapY) })));
  const flowH = Math.max(0, ...cols.map((c) => c.length)) * (h + gapY);

  // The lone items, below, in columns of at most `lone` rows.
  const top = flow.length ? flowH + 2 * h : 0;
  const per = Math.max(SIZE.lone, Math.ceil(Math.sqrt(lone.length * 3)));
  lone.forEach((id, i) => {
    const col = Math.floor(i / per);
    boxes.set(id, { id, col: -1, x: col * (w + gapX), y: top + (i % per) * (h + gapY) });
  });
  const loneCols = Math.ceil(lone.length / per);
  const loneH = lone.length ? Math.min(lone.length, per) * (h + gapY) : 0;

  // Wires: each gap's lanes split evenly among the wires turning in it.
  const lanes = new Map<number, Path[]>();
  const paths: Path[] = [];
  for (const l of links) {
    const a = boxes.get(l.from)!;
    const b = boxes.get(l.to)!;
    const p: Path = { id: l.id, type: l.type, from: l.from, to: l.to, points: [] };
    paths.push(p);
    if (a.col !== b.col) {
      const gap = Math.min(a.col, b.col);
      (lanes.get(gap) ?? lanes.set(gap, []).get(gap)!).push(p);
    }
  }
  for (const [gap, list] of lanes) {
    list.sort((p, q) => {
      const ya = (id: Id) => boxes.get(id)!.y;
      return Math.min(ya(p.from), ya(p.to)) - Math.min(ya(q.from), ya(q.to));
    });
    list.forEach((p, i) => ((p as Path & { lane?: number }).lane = gap * (w + gapX) + w + ((i + 1) * gapX) / (list.length + 1)));
  }
  for (const p of paths) {
    const a = boxes.get(p.from)!;
    const b = boxes.get(p.to)!;
    const [l, r] = a.x <= b.x ? [a, b] : [b, a];
    const ly = l.y + h / 2;
    const ry = r.y + h / 2;
    if (l.col === r.col) {
      const x = l.x + w + 10;
      p.points = [[l.x + w, ly], [x, ly], [x, ry], [r.x + w, ry]];
    } else {
      const lane = (p as Path & { lane?: number }).lane ?? l.x + w + gapX / 2;
      p.points = [[l.x + w, ly], [lane, ly], [lane, ry], [r.x, ry]];
    }
    delete (p as Path & { lane?: number }).lane;
  }

  const width = Math.max(cols.length, loneCols, 1) * (w + gapX) - gapX;
  return { boxes, paths, width, height: Math.max(top + loneH, flowH, h) };
}
