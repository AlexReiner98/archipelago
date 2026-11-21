/**
 * Painting the field on a 2D canvas: links as faint lines, one path per
 * kind; particles in their type's colour, each filled on its own (one
 * path of many circles fills far slower on a GPU canvas); the lit particle
 * and its links over the faded rest; then titles in screen space, each with a halo of the sea round its letters.
 */
import type { Dial } from "./behaviour.ts";
import { HUES, read } from "../../spec/style.ts";
import { neighbours, type G, type Grid, type Settings } from "./graph.ts";
import { place, type Want } from "./labels.ts";

/** The drawing's own dials. */
export const DRAW: Dial[] = [
  { key: "node_size", label: "particle size", min: 0.5, max: 12, step: 0.1, value: 3, then: "size", doc: "A particle's radius with no links, in world units." },
  { key: "node_grow", label: "grow with links", min: 0, max: 4, step: 0.05, value: 1.4, then: "size", doc: "How much a particle grows with its links: radius × (1 + this × log(1 + links))." },
  { key: "closed_fade", label: "closed fade", min: 0, max: 1, step: 0.01, value: 0.28, then: "paint", doc: "How faint a closed item (done, dropped, decided) is drawn." },
  { key: "link_alpha", label: "link strength", min: 0, max: 1, step: 0.01, value: 0.18, then: "paint", doc: "How strong a link's line is." },
  { key: "link_width", label: "link width", min: 0.1, max: 4, step: 0.1, value: 0.6, then: "paint", doc: "A link's width, in screen px." },
  { key: "label_px", label: "titles from", min: 2, max: 40, step: 0.5, value: 9, then: "paint", doc: "A particle's title shows once its radius reaches this on screen, in px." },
  { key: "label_hubs", label: "always name hubs", min: 0, max: 100, step: 1, value: 15, then: "paint", doc: "The this-many most linked items are named at any zoom, so the picture reads before you zoom in." },
  { key: "label_most", label: "titles at most", min: 0, max: 600, step: 10, value: 120, then: "paint", doc: "At most this many titles at once." },
  { key: "label_room", label: "room per title", min: 1000, max: 40000, step: 500, value: 9000, then: "paint", doc: "At most one title per this many square pixels of the view, so a small view is not buried in words." },
  { key: "label_gap", label: "title gap", min: 0, max: 20, step: 1, value: 4, then: "paint", doc: "Space between a particle and its title, in screen px." },
  { key: "label_chars", label: "title length", min: 8, max: 120, step: 1, value: 36, then: "paint", doc: "A title longer than this many letters is cut, with …; the whole of it shows on hover." },
  { key: "label_inside", label: "title inside from", min: 0, max: 200, step: 2, value: 40, then: "paint", doc: "A particle this many screen px across or more holds its title inside itself, cut to fit (0: never)." },
  { key: "label_cover_px", label: "titles avoid", min: 0, max: 20, step: 0.5, value: 2, then: "paint", doc: "A title never covers another particle this many screen px across or more (0: it covers none at all)." },
  { key: "label_halo", label: "title halo", min: 0, max: 8, step: 0.5, value: 3, then: "paint", doc: "A ring of the sea round every letter, in screen px, so words read over particles and links." },
  { key: "label_fade", label: "title fade-in", min: 0.1, max: 20, step: 0.1, value: 3, then: "paint", doc: "A title fades in as its particle grows on screen from 'titles from' to this much more." },
  { key: "query_fade", label: "find fades rest to", min: 0, max: 1, step: 0.01, value: 0.12, then: "paint", doc: "While the find line has words, how faint what it does not find is drawn (it never moves)." },
  { key: "hover_dim", label: "hover dims rest to", min: 0, max: 1, step: 0.01, value: 0.15, then: "paint", doc: "How faint the rest is while one particle is pointed at." },
  { key: "hover_grow", label: "hover grows", min: 0, max: 3, step: 0.05, value: 0.6, then: "paint", doc: "How much the particle pointed at grows (its neighbours a third of that), only into free room." },
  { key: "hover_ring", label: "hover ring", min: 0, max: 6, step: 0.1, value: 1.5, then: "paint", doc: "The accent ring round the particle pointed at, in screen px (0: none)." },
  { key: "hover_links", label: "lit link width", min: 0.5, max: 6, step: 0.1, value: 2, then: "paint", doc: "How much wider a lit link is than the rest." },
  { key: "dim_ms", label: "light eases in", min: 0, max: 1000, step: 10, value: 140, then: "paint", doc: "How long the dimming and lighting take to ease in or out, in ms." },
  { key: "dim_hold_ms", label: "light stays", min: 0, max: 2000, step: 10, value: 200, then: "paint", doc: "How long the light stays once the pointer leaves a particle, so crossing a gap does not blink." },
  { key: "fit_pad", label: "fit margin", min: 0, max: 200, step: 5, value: 40, then: "paint", doc: "Room round the picture when it is fitted, in screen px." },
  { key: "follow_ms", label: "camera eases", min: 0, max: 5000, step: 50, value: 1000, then: "paint", doc: "While it settles, how slowly the view follows the picture, in ms (about two thirds of the way in this time; 0: it snaps)." },
  { key: "follow", label: "fit while settling", min: 0, max: 1, step: 1, value: 1, choices: ["no", "yes"], then: "paint", doc: "Whether the view keeps fitting the picture while it settles, until you move it." },
];

export interface Ink {
  sea: string;
  text: string;
  muted: string;
  line: string;
  accent: string;
}
/** The page's colours, from the style tokens (their plain values when no style is loaded). */
export function ink(el: Element): Ink {
  return { sea: read("bg", el), text: read("fg", el), muted: read("dim", el), line: read("dim", el), accent: read("pick", el) };
}

/** The style's hues, for types in order; a type past the sixth gets its own (graph.ts hue). */
export function palette(el?: Element): string[] {
  return HUES.map((h) => read(h, el));
}

export interface Cam {
  k: number;
  tx: number;
  ty: number;
}

/** What is lit, eased over time: dim is how far the rest has faded, shine[i] how lit particle i is. */
export class Light {
  dim = 0;
  shine = new Float32Array(0);
  shining = new Set<number>();
  focus = -1;
  /** The ids named last frame: they are placed first, so names hold still while the map settles. */
  named = new Set<string>();
  private leftAt = 0;
  private last = 0;
  /** Eases toward the particle pointed at (hover) and its neighbours; true while it still moves. */
  ease(g: G, hover: number, S: Settings): boolean {
    const now = performance.now(), dt = this.last ? Math.min(100, now - this.last) : 16;
    this.last = now;
    if (this.shine.length !== g.n) (this.shine = new Float32Array(g.n)), this.shining.clear(), (this.focus = -1);
    if (hover >= 0) (this.focus = hover), (this.leftAt = 0);
    else if (this.focus >= 0 && !this.leftAt) this.leftAt = now;
    if (this.focus >= 0 && this.leftAt && now - this.leftAt > S.dim_hold_ms!) this.focus = -1;
    const k = S.dim_ms! > 0 ? 1 - Math.exp(-dt / S.dim_ms!) : 1;
    const lit = this.focus >= 0 ? neighbours(g, this.focus) : new Set<number>();
    const want = this.focus >= 0 ? 1 : 0;
    this.dim += (want - this.dim) * k;
    if (Math.abs(this.dim - want) < 0.005) this.dim = want;
    for (const i of lit) this.shining.add(i);
    let moving = (this.dim !== 0 && this.dim !== 1) || (this.focus >= 0 && !!this.leftAt);
    for (const i of this.shining) {
      const w = lit.has(i) ? 1 : 0;
      this.shine[i]! += (w - this.shine[i]!) * k;
      if (Math.abs(this.shine[i]! - w) < 0.005) this.shine[i] = w;
      if (this.shine[i] !== w) moving = true;
      if (!this.shine[i]) this.shining.delete(i);
    }
    return moving;
  }
}

/** Which particles are among the `most` most linked, worked out once per graph and count. */
const hubCache = new WeakMap<G, { most: number; hub: Uint8Array }>();
function hubs(g: G, most: number): Uint8Array {
  const had = hubCache.get(g);
  if (had && had.most === most) return had.hub;
  const hub = new Uint8Array(g.n);
  const order = Array.from({ length: g.n }, (_, i) => i).sort((p, q) => g.degree[q]! - g.degree[p]! || p - q);
  for (const i of order.slice(0, most)) hub[i] = 1;
  hubCache.set(g, { most, hub });
  return hub;
}

/** Words onto at most `rows` lines, each at most `px` wide in the canvas's font now; the last cut with … if more is left. */
function wrap(c: CanvasRenderingContext2D, s: string, px: number, rows: number): string[] {
  const words = s.split(/\s+/).filter(Boolean), lines: string[] = [];
  let line = "";
  for (let k = 0; k < words.length; k++) {
    const next = line ? `${line} ${words[k]}` : words[k]!;
    if (c.measureText(next).width <= px) {
      line = next;
      continue;
    }
    if (lines.length === rows - 1) return [...lines, fit(c, `${next} ${words.slice(k + 1).join(" ")}`.trim(), px)].filter(Boolean);
    if (line) lines.push(line);
    line = c.measureText(words[k]!).width <= px ? words[k]! : fit(c, words[k]!, px);
  }
  if (line) lines.push(line);
  return lines.length > rows ? lines.slice(0, rows) : lines;
}

/** The title cut, with …, to fit `px` wide in the canvas's font now. */
function fit(c: CanvasRenderingContext2D, s: string, px: number): string {
  if (c.measureText(s).width <= px) return s;
  let lo = 0, hi = s.length;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (c.measureText(`${s.slice(0, mid)}…`).width <= px) lo = mid;
    else hi = mid - 1;
  }
  return lo ? `${s.slice(0, lo).trimEnd()}…` : "";
}

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

/**
 * `match`: what the find line finds (1) and not (0), or null when it has no
 * words; what it does not find is drawn at `query_fade`.
 */
export function paint(c: CanvasRenderingContext2D, g: G, cam: Cam, S: Settings, light: Light, ink: Ink, grid: Grid, size: { width: number; height: number; dpr: number }, match: Uint8Array | null = null, clear: [number, number, number, number][] = []): void {
  const { width, height, dpr } = size;
  c.setTransform(dpr, 0, 0, dpr, 0, 0);
  c.globalAlpha = 1;
  c.fillStyle = ink.sea;
  c.fillRect(0, 0, width, height);
  if (!g.n) return;
  const vx0 = -cam.tx / cam.k, vy0 = -cam.ty / cam.k, vx1 = (width - cam.tx) / cam.k, vy1 = (height - cam.ty) / cam.k;
  const inView = (i: number, pad: number) => g.x[i]! > vx0 - pad && g.x[i]! < vx1 + pad && g.y[i]! > vy0 - pad && g.y[i]! < vy1 + pad;
  const faint = 1 - light.dim * (1 - S.hover_dim!);
  const { shine, shining, focus } = light;

  c.setTransform(dpr * cam.k, 0, 0, dpr * cam.k, dpr * cam.tx, dpr * cam.ty);
  // Links, faint, one path per kind (and per found or not); part_of in the muted ink.
  c.lineWidth = S.link_width! / cam.k;
  const partOf = g.linkKinds.indexOf("part_of");
  const fade = (i: number) => (match && !match[i] ? S.query_fade! : 1);
  for (let kind = 0; kind < g.linkKinds.length; kind++) for (const lit of match ? [0, 1] : [1]) {
    c.beginPath();
    for (let e = 0; e < g.m; e++) {
      if (g.kind[e] !== kind) continue;
      const a = g.a[e]!, b = g.b[e]!;
      if (match && (match[a]! && match[b]! ? 1 : 0) !== lit) continue;
      if (Math.max(g.x[a]!, g.x[b]!) < vx0 || Math.min(g.x[a]!, g.x[b]!) > vx1 || Math.max(g.y[a]!, g.y[b]!) < vy0 || Math.min(g.y[a]!, g.y[b]!) > vy1) continue;
      c.moveTo(g.x[a]!, g.y[a]!);
      c.lineTo(g.x[b]!, g.y[b]!);
    }
    c.globalAlpha = S.link_alpha! * faint * (kind === partOf ? 1.4 : 1) * (lit ? 1 : S.query_fade!);
    c.strokeStyle = kind === partOf ? ink.muted : ink.line;
    c.stroke();
  }
  // The links between lit particles, strong, as lit as their fainter end.
  c.strokeStyle = ink.accent;
  c.lineWidth = (S.link_width! * S.hover_links!) / cam.k;
  for (const i of shining) for (const e of g.incident[i]!) {
    const j = g.a[e] === i ? g.b[e]! : g.a[e]!;
    if (j < i && shining.has(j)) continue;
    const s = Math.min(shine[i]!, shine[j]!);
    if (!s) continue;
    c.globalAlpha = 0.9 * s;
    c.beginPath();
    c.moveTo(g.x[i]!, g.y[i]!);
    c.lineTo(g.x[j]!, g.y[j]!);
    c.stroke();
  }
  // Particles: the colour set once per type and openness, each circle filled on its own.
  for (let ty = 0; ty < g.types.length; ty++) {
    c.fillStyle = g.types[ty]!.colour;
    for (const [shut, hit] of [[1, 0], [0, 0], [1, 1], [0, 1]] as const) {
      if (!match && !hit) continue;
      c.globalAlpha = (shut ? S.closed_fade! : 1) * faint * (match && !hit ? S.query_fade! : 1);
      for (let i = 0; i < g.n; i++) {
        if (g.typeIx[i] !== ty || g.closed[i] !== shut || !inView(i, g.r[i]!)) continue;
        if (match && match[i] !== hit) continue;
        c.beginPath();
        c.arc(g.x[i]!, g.y[i]!, g.r[i]!, 0, 2 * Math.PI);
        c.fill();
      }
    }
  }
  // Lit particles over the faded rest: each grows, only into the room round it; the one pointed at gets a ring.
  let rmax = 0;
  for (let i = 0; i < g.n; i++) rmax = Math.max(rmax, g.r[i]!);
  const gap = S.collide_gap ?? 1;
  for (const i of shining) {
    const want = g.r[i]! * (1 + shine[i]! * (i === focus ? S.hover_grow! : S.hover_grow! / 3));
    let room = want;
    const reach = want + rmax + gap;
    grid.each(g.x[i]! - reach, g.y[i]! - reach, g.x[i]! + reach, g.y[i]! + reach, (j) => {
      if (j === i) return;
      const d = Math.hypot(g.x[j]! - g.x[i]!, g.y[j]! - g.y[i]!), free = d - g.r[i]! - g.r[j]! - gap / 2;
      room = Math.min(room, g.r[i]! + (shine[j]! > 0 ? free / 2 : free));
    });
    const rr = Math.max(g.r[i]!, room);
    c.globalAlpha = shine[i]!;
    c.fillStyle = g.types[g.typeIx[i]!]!.colour;
    c.beginPath();
    c.arc(g.x[i]!, g.y[i]!, rr, 0, 2 * Math.PI);
    c.fill();
    if (i === focus && S.hover_ring! > 0) {
      const lw = Math.min(S.hover_ring! / cam.k, rr / 2);
      c.strokeStyle = ink.accent;
      c.lineWidth = lw;
      c.beginPath();
      c.arc(g.x[i]!, g.y[i]!, rr - lw / 2, 0, 2 * Math.PI);
      c.stroke();
    }
  }

  // Words, in screen space (labels.ts places them): the lit first, then what the find line finds, then what was
  // named last frame, then hubs, then the largest; none over another word or particle, none off the view.
  c.setTransform(dpr, 0, 0, dpr, 0, 0);
  c.textBaseline = "middle";
  c.lineJoin = "round";
  c.font = "11px ui-sans-serif, system-ui, sans-serif";
  const hub = hubs(g, S.label_hubs!);
  const lit = light.dim > 0.5;
  const rank = (i: number) =>
    (i === focus ? 64 : 0) + (shine[i]! > 0 ? 32 : 0) + (match?.[i] ? 16 : 0) + (light.named.has(g.id[i]!) ? 8 : 0) + (hub[i] ? 4 : 0) + (g.closed[i] ? 0 : 2);
  const wants: number[] = [];
  for (let i = 0; i < g.n; i++) {
    if (!inView(i, 0)) continue;
    // While one is pointed at, only it and its neighbours are named; while the find line has words, what it finds.
    if (lit ? !(shine[i]! > 0.5) : match ? !match[i] : !(g.r[i]! * cam.k >= S.label_px! || hub[i])) continue;
    wants.push(i);
  }
  wants.sort((p, q) => rank(q) - rank(p) || g.r[q]! - g.r[p]! || p - q);
  const budget = Math.min(S.label_most!, Math.floor((width * height) / Math.max(1, S.label_room!)));
  const texts = new Map<number, string[]>();
  const LINE = 13;
  const want: Want[] = wants.slice(0, Math.max(budget * 4, 40)).map((i) => {
    const r = g.r[i]! * cam.k;
    // Wide enough: the title inside the particle, cut to what fits across most of it.
    // Wide enough: the title inside the particle, on as many lines as fit across it (at most three), the last cut with ….
    const rows = Math.min(3, Math.floor((2 * r * 0.75) / LINE));
    const lines = S.label_inside! > 0 && 2 * r >= S.label_inside! && rows >= 1 ? wrap(c, clip(g.title[i]!, S.label_chars!), 2 * r * 0.8, rows) : [];
    // Lines of under four letters in all say nothing: then the title goes beside, whole.
    const inside = lines.join("").replace("…", "").length >= 4;
    const text = inside ? lines : [clip(g.title[i]!, S.label_chars!)];
    texts.set(i, text);
    const w = Math.max(...text.map((t) => c.measureText(t).width)) + 4;
    return { i, x: g.x[i]! * cam.k + cam.tx, y: g.y[i]! * cam.k + cam.ty, r, w, h: text.length * LINE + 1, must: shine[i]! > 0.5, inside };
  });
  // Whether a box covers a particle other than i that is label_cover_px or more across on screen.
  const covers = (b: [number, number, number, number], i: number) => {
    let hit = false;
    grid.each((b[0] - cam.tx) / cam.k, (b[1] - cam.ty) / cam.k, (b[2] - cam.tx) / cam.k, (b[3] - cam.ty) / cam.k, (j) => {
      if (hit || j === i) return;
      const rs = g.r[j]! * cam.k;
      if (2 * rs < S.label_cover_px!) return;
      const cx = g.x[j]! * cam.k + cam.tx, cy = g.y[j]! * cam.k + cam.ty;
      const nx = Math.max(b[0], Math.min(cx, b[2])), ny = Math.max(b[1], Math.min(cy, b[3]));
      if (Math.hypot(cx - nx, cy - ny) < rs) hit = true;
    });
    return hit;
  };
  const placed = place(want, { width, height, room: S.label_room!, most: S.label_most!, gap: S.label_gap!, covers, clear });
  light.named = new Set(placed.map((p) => g.id[p.i]!));
  c.strokeStyle = ink.sea;
  for (const { i, box, within } of placed) {
    const rs = g.r[i]! * cam.k;
    const grow = shine[i]! > 0 || match?.[i] || hub[i] ? 1 : Math.min(1, 0.6 + (0.4 * (rs - S.label_px!)) / Math.max(0.1, S.label_fade!));
    // A closed item's title is muted, like its particle.
    const shut = g.closed[i] && !(shine[i]! > 0) && !within;
    c.globalAlpha = grow * Math.max(faint * fade(i), shine[i]!) * (shut ? 0.75 : 1);
    c.fillStyle = shut ? ink.muted : ink.text;
    const lines = texts.get(i)!, mid = (box[0] + box[2]) / 2;
    c.textAlign = within ? "center" : "left";
    lines.forEach((line, k) => {
      const x = within ? mid : box[0] + 2, y = box[1] + LINE * (k + 0.5) + 0.5;
      if (S.label_halo! > 0) (c.lineWidth = S.label_halo!), c.strokeText(line, x, y);
      c.fillText(line, x, y);
    });
  }
  c.textAlign = "left";
}
