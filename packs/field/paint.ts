/**
 * Painting the field on a 2D canvas: links as faint lines, one path per
 * kind; particles in their type's colour, each filled on its own (one
 * path of many circles fills far slower on a GPU canvas); the lit particle
 * and its links over the faded rest; then titles in screen space, each with a halo of the sea round its letters.
 */
import type { Dial } from "./behaviour.ts";
import { HUES, read } from "../../spec/style.ts";
import { neighbours, type G, type Grid, type Settings } from "./graph.ts";
import { hubSet, place, type Want } from "./labels.ts";
import { FAINT, FOUND } from "./filter.ts";
import { CIRCLE, edge, fill, outline, reach } from "./shapes.ts";
import { arrow, easeWires, placeWires, wireName, wireSize, type WireFade, type WireWant } from "./wires.ts";
import { comeFade, type Label } from "./gone.ts";

/** The drawing's own dials. */
export const DRAW: Dial[] = [
  { key: "node_size", label: "particle size", min: 0.5, max: 12, step: 0.1, value: 3, then: "size", doc: "A particle's radius with no links, in world units." },
  { key: "node_grow", label: "grow with links", min: 0, max: 4, step: 0.05, value: 1.4, then: "size", doc: "How much a particle grows with its links: radius × (1 + this × log(1 + links))." },
  { key: "shapes", label: "shapes", min: 0, max: 1, step: 1, value: 1, choices: ["circles", "by base"], then: "warm", doc: "Each particle in its base's mark shape (square, diamond, circle, triangle), hollow while its status is the first open one, half while later open, full once closed; collide packs them by their edges. Circles: every particle round and full." },
  { key: "hollow_line", label: "hollow outline", min: 0.1, max: 0.9, step: 0.01, value: 0.4, then: "paint", doc: "A hollow or half particle's outline, as a share of its size." },
  { key: "hollow_px", label: "hollow from", min: 0, max: 20, step: 0.5, value: 3, then: "paint", doc: "A particle smaller than this on screen (radius, px) is drawn full whatever its status: a hollow speck would vanish." },
  { key: "closed_fade", label: "closed fade", min: 0, max: 1, step: 0.01, value: 0.28, then: "paint", doc: "How faint a closed item (done, dropped, decided) is drawn." },
  { key: "gone_ms", label: "gone fades", min: 0, max: 2000, step: 50, value: 600, then: "paint", doc: "How long an item that leaves the map (a filter turned off, a find that keeps fewer) takes to fade out where it stood, in ms (0: it vanishes at once)." },
  { key: "resize_ms", label: "size eases", min: 0, max: 2000, step: 50, value: 600, then: "paint", doc: "How long an item that stays on the map but takes a new size (fewer links shown, a find that keeps a part) takes to grow or shrink to it, in ms (0: at once)." },
  { key: "come_ms", label: "new fades in", min: 0, max: 2000, step: 50, value: 600, then: "paint", doc: "How long an item that comes onto the map (a filter turned on, a find that keeps more) takes to fade in where it lands, in ms (0: it shows at once)." },
  { key: "link_alpha", label: "link strength", min: 0, max: 1, step: 0.01, value: 0.18, then: "paint", doc: "How strong a link's line is." },
  { key: "link_width", label: "link width", min: 0.1, max: 4, step: 0.1, value: 0.6, then: "paint", doc: "A link's width, in screen px." },
  { key: "arrows", label: "arrows", min: 0, max: 1, step: 1, value: 1, choices: ["no", "yes"], then: "paint", doc: "Each link has an arrowhead at the end it points to (A depends_on B points at B)." },
  { key: "arrow_px", label: "arrow size", min: 2, max: 20, step: 0.5, value: 6, then: "paint", doc: "An arrowhead's length, in screen px (its width is two thirds of that)." },
  { key: "arrow_strength", label: "arrow strength", min: 1, max: 10, step: 0.1, value: 4, then: "paint", doc: "How much stronger an arrowhead is than its line, so a faint link still says which way it goes." },
  { key: "arrow_keep", label: "arrows keep", min: 0, max: 1, step: 0.01, value: 0.5, then: "paint", doc: "While a pointer dims the rest or find fades its outer ring, an arrowhead keeps at least this share of its strength, though its line fades further." },
  { key: "arrow_lit", label: "lit arrow size", min: 1, max: 3, step: 0.05, value: 1.4, then: "paint", doc: "How much bigger an arrowhead is on a lit link, to go with its wider line." },
  { key: "arrow_from_px", label: "arrows from", min: 0, max: 200, step: 2, value: 24, then: "paint", doc: "A link shorter than this on screen, in px, has no arrowhead." },
  { key: "link_names", label: "link names", min: 0, max: 1, step: 1, value: 1, choices: ["no", "yes"], then: "paint", doc: "A link long enough on screen has its type's name along its middle: a lit one, or one whose ends are both big enough to be titled ('titles from')." },
  { key: "link_name_from_px", label: "link names from", min: 20, max: 400, step: 5, value: 90, then: "paint", doc: "A link shorter than this on screen, in px, is not named." },
  { key: "link_name_size", label: "link name size", min: 1, max: 40, step: 0.5, value: 9, then: "paint", doc: "A link name's size in the map: on screen it is this times the zoom, so it grows and shrinks with the view." },
  { key: "link_name_least_px", label: "link names least", min: 2, max: 20, step: 0.5, value: 6, then: "paint", doc: "A link name smaller than this on screen, in px, isn't drawn." },
  { key: "link_name_most_px", label: "link names most", min: 6, max: 60, step: 1, value: 22, then: "paint", doc: "A link name stops growing at this size on screen, in px." },
  { key: "link_name_fade_ms", label: "link names fade", min: 0, max: 1000, step: 10, value: 220, then: "paint", doc: "How long a link name takes to fade in or out when it gains or loses its room, in ms." },
  { key: "link_name_most", label: "link names at most", min: 0, max: 200, step: 5, value: 40, then: "paint", doc: "At most this many link names at once: the lit first, then the longest." },
  { key: "label_px", label: "titles from", min: 2, max: 40, step: 0.5, value: 9, then: "paint", doc: "A particle's title shows once its radius reaches this on screen, in px." },
  { key: "label_hubs", label: "always name hubs", min: 0, max: 100, step: 1, value: 12, then: "paint", doc: "The this-many most linked items, the map's central topics, are named at any zoom and stay named, over other particles if need be, so the picture reads before you zoom in." },
  { key: "label_hub_links", label: "hubs from", min: 1, max: 100, step: 1, value: 8, then: "paint", doc: "An item needs at least this many links to be named as a hub." },
  { key: "label_hub_keep", label: "hubs hold", min: 0, max: 50, step: 1, value: 4, then: "paint", doc: "A hub stays named until this many more items outrank it, so the named set holds still while links come and go." },
  { key: "label_most", label: "titles at most", min: 0, max: 600, step: 10, value: 120, then: "paint", doc: "At most this many titles at once." },
  { key: "label_room", label: "room per title", min: 1000, max: 40000, step: 500, value: 9000, then: "paint", doc: "At most one title per this many square pixels of the view, so a small view is not buried in words." },
  { key: "label_gap", label: "title gap", min: 0, max: 20, step: 1, value: 4, then: "paint", doc: "Space between a particle and its title, in screen px." },
  { key: "label_chars", label: "title length", min: 8, max: 120, step: 1, value: 36, then: "paint", doc: "A title longer than this many letters is cut, with …; the whole of it shows on hover." },
  { key: "label_inside", label: "title inside from", min: 0, max: 200, step: 2, value: 40, then: "paint", doc: "A particle this many screen px across or more holds its title inside itself, cut to fit (0: never)." },
  { key: "label_cover_px", label: "titles avoid", min: 0, max: 20, step: 0.5, value: 2, then: "paint", doc: "A title never covers another particle this many screen px across or more (0: it covers none at all)." },
  { key: "label_move_ms", label: "moved title fades", min: 0, max: 1000, step: 10, value: 220, then: "paint", doc: "A title that must take another side of its particle (room taken) fades out where it was and in where it goes over this long, rather than jump (0: it jumps)." },
  { key: "label_halo", label: "title halo", min: 0, max: 8, step: 0.5, value: 3, then: "paint", doc: "A ring of the sea round every letter, in screen px, so words read over particles and links." },
  { key: "label_fade", label: "title fade-in", min: 0.1, max: 20, step: 0.1, value: 3, then: "paint", doc: "A title fades in as its particle grows on screen from 'titles from' to this much more." },
  { key: "query_fade", label: "find fades rest to", min: 0, max: 1, step: 0.01, value: 0.12, then: "paint", doc: "While the find line has words, how faint the outer ring it keeps (find_faint) is drawn." },
  { key: "hover_px", label: "hover reach", min: 0, max: 40, step: 1, value: 12, then: "paint", doc: "How far from a particle's edge the pointer still picks it, to light or click, in screen px (the nearest wins)." },
  { key: "hover_dim", label: "hover dims rest to", min: 0, max: 1, step: 0.01, value: 0.15, then: "paint", doc: "How faint the rest is while one particle is pointed at." },
  { key: "hover_grow", label: "hover grows", min: 0, max: 3, step: 0.05, value: 0.6, then: "paint", doc: "How much the particle pointed at grows (its neighbours a third of that), only into free room." },
  { key: "hover_ring", label: "hover ring", min: 0, max: 6, step: 0.1, value: 1.5, then: "paint", doc: "The accent ring round the particle pointed at, in screen px (0: none)." },
  { key: "hover_links", label: "lit link width", min: 0.5, max: 6, step: 0.1, value: 2, then: "paint", doc: "How much wider a lit link is than the rest." },
  { key: "dim_ms", label: "light eases in", min: 0, max: 1000, step: 10, value: 140, then: "paint", doc: "How long the dimming and lighting take to ease in or out, in ms." },
  { key: "dim_hold_ms", label: "light stays", min: 0, max: 2000, step: 10, value: 200, then: "paint", doc: "How long the light stays once the pointer leaves a particle, so crossing a gap does not blink." },
  { key: "fit_pad", label: "fit margin", min: 0, max: 200, step: 5, value: 40, then: "paint", doc: "Room round the picture when it is fitted, in screen px." },
  { key: "fit_zoom_most", label: "fit zooms at most", min: 0.5, max: 40, step: 0.5, value: 3, then: "paint", doc: "A fit never zooms in past this (screen px per world unit), so a map of one or two items shows them at their size, not filling the view." },
  { key: "follow_ms", label: "camera eases", min: 0, max: 5000, step: 50, value: 1000, then: "paint", doc: "While it settles, how slowly the view follows the picture, in ms (about two thirds of the way in this time; 0: it snaps)." },
  { key: "follow", label: "fit while settling", min: 0, max: 1, step: 1, value: 1, choices: ["no", "yes"], then: "paint", doc: "Whether the view keeps fitting the picture while it settles, until you move it." },
];

export interface Ink {
  sea: string;
  text: string;
  muted: string;
  line: string;
  accent: string;
  /** A tree's branches: the context view's own ink for them. */
  branch: string;
}
/** The page's colours, from the style tokens (their plain values when no style is loaded). */
export function ink(el: Element): Ink {
  return { sea: read("bg", el), text: read("fg", el), muted: read("dim", el), line: read("dim", el), accent: read("pick", el), branch: read("say", el) };
}

/**
 * The titles that took another spot than last frame's while their particle held still (within `still` px on
 * screen since then): one newly named, kept where it was, or carried by a moving particle has not moved.
 */
export function movedTitles(was: ReadonlyMap<string, number>, now: [string, number | undefined][], wasAt?: ReadonlyMap<string, [number, number]>, at?: ReadonlyMap<string, [number, number]>, still = 2): string[] {
  return now
    .filter(([id, spot]) => {
      if (!was.has(id) || was.get(id) === spot) return false;
      const a = wasAt?.get(id), b = at?.get(id);
      return !a || !b || Math.hypot(a[0] - b[0], a[1] - b[1]) <= still;
    })
    .map(([id]) => id);
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
  /** Each link name's fade, by link: names fade in and out, never pop (wires.ts). */
  wires = new Map<number, WireFade>();
  /** True while a link name is still fading: the view keeps painting. */
  wiresMoving = false;
  private wiresAt = 0;
  /** A step of the link names' fade. */
  easeWires(placed: Parameters<typeof easeWires>[1], ms: number): void {
    const now = performance.now(), dt = this.wiresAt ? Math.min(100, now - this.wiresAt) : 16;
    this.wiresAt = now;
    this.wiresMoving = easeWires(this.wires, placed, ms > 0 ? 1 - Math.exp(-dt / ms) : 1);
  }
  /** The ids named last frame: they are placed first, so names hold still while the map settles. */
  named = new Set<string>();
  /** Where each named title stood last frame, in world units (gone.ts Label). */
  labels = new Map<string, Label>();
  /** The spot each title took last frame (labels.ts), tried first so it keeps its side. */
  spots = new Map<string, number>();
  /** Where each named particle stood on screen last frame, so a title it carries as it moves is not faded. */
  spotsAt = new Map<string, [number, number]>();
  /** When each title last took another spot (performance.now), so it fades in there. */
  movedAt = new Map<string, number>();
  /** Titles fading out from where they stood before they moved. */
  leaving: { label: Label; at: number }[] = [];
  /** True while a moved title still fades. */
  labelsMoving = false;
  /** The hubs named at any zoom, by id: kept from graph to graph (labels.ts hubSet). */
  hubIds = new Set<string>();
  private hubOf: { g: G; key: string; mask: Uint8Array } | null = null;
  /** Which particles are hubs now: worked out again only when the graph or the dials change. */
  hubs(g: G, S: Settings): Uint8Array {
    const key = `${S.label_hubs}|${S.label_hub_links}|${S.label_hub_keep}`;
    if (this.hubOf && this.hubOf.g === g && this.hubOf.key === key) return this.hubOf.mask;
    this.hubIds = hubSet(g.id, g.degree, this.hubIds, S.label_hubs!, S.label_hub_links!, S.label_hub_keep!);
    const mask = new Uint8Array(g.n);
    for (let i = 0; i < g.n; i++) if (this.hubIds.has(g.id[i]!)) mask[i] = 1;
    this.hubOf = { g, key, mask };
    return mask;
  }
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

/**
 * One particle, in the fill and alpha set now: its shape, hollow or half by
 * its status when shapes are on and it is big enough on screen. Hollow is a
 * ring: the shape with its middle the sea. Half is one shape whose right
 * half is that ring and whose left half stays solid, as ◐ (one fill, the
 * hole punched only on the right, so it never reads as two shapes).
 */
function particle(c: CanvasRenderingContext2D, g: G, i: number, r: number, S: Settings, k: number, sea: string): void {
  const shape = S.shapes ? g.shape[i]! : CIRCLE, x = g.x[i]!, y = g.y[i]!;
  c.beginPath();
  outline(c, shape, x, y, r);
  c.fill();
  const how = S.shapes && r * k >= S.hollow_px! ? fill(g.side[i]!) : 2;
  if (how === 2) return;
  const colour = c.fillStyle, inner = r * (1 - S.hollow_line!);
  c.fillStyle = sea;
  if (how === 1) {
    const R = reach(shape) * r;
    c.save();
    c.beginPath();
    c.rect(x, y - R, R, 2 * R);
    c.clip();
  }
  c.beginPath();
  outline(c, shape, x, y, inner);
  c.fill();
  if (how === 1) c.restore();
  c.fillStyle = colour;
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
 * `match`: how each particle is drawn while the find line has words (filter.ts
 * FOUND, NEAR, FAINT), or null when it has none; FAINT is drawn at `query_fade`,
 * and only FOUND is always named.
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
  const at = performance.now();
  // A particle new to the map fades in (gone.ts); one already there is whole.
  const come = (i: number) => (g.born && S.come_ms ? comeFade(at - g.born[i]!, S.come_ms) : 1);
  const fade = (i: number) => (match && match[i] === FAINT ? S.query_fade! : 1) * come(i);
  const full = (i: number) => (match ? (match[i] !== FAINT ? 1 : 0) : 1);
  // Lit particles grow, only into the room round them (drawn after the links); the one pointed at also has a
  // ring. Their drawn edge is known first, so an arrowhead at one ends there rather than under it.
  let rmax = 0;
  for (let i = 0; i < g.n; i++) rmax = Math.max(rmax, g.r[i]!);
  const gap = S.collide_gap ?? 1;
  const grown = new Map<number, number>();
  for (const i of shining) {
    const want = g.r[i]! * (1 + shine[i]! * (i === focus ? S.hover_grow! : S.hover_grow! / 3));
    let room = want;
    const reach = want + rmax + gap;
    grid.each(g.x[i]! - reach, g.y[i]! - reach, g.x[i]! + reach, g.y[i]! + reach, (j) => {
      if (j === i) return;
      const d = Math.hypot(g.x[j]! - g.x[i]!, g.y[j]! - g.y[i]!), free = d - g.r[i]! - g.r[j]! - gap / 2;
      room = Math.min(room, g.r[i]! + (shine[j]! > 0 ? free / 2 : free));
    });
    grown.set(i, Math.max(g.r[i]!, room));
  }
  const ringOf = (i: number, rr: number) => (i === focus && S.hover_ring! > 0 ? Math.min(S.hover_ring! / cam.k, rr / 2) : 0);
  // An arrowhead at a link's `to`, its tip on that particle's edge as drawn: added to a path, filled after the lines.
  const alen = S.arrow_px! / cam.k, awide = (S.arrow_px! * 2) / 3 / cam.k, afrom = S.arrow_from_px! / cam.k;
  const head = (path: Path2D, e: number, grow = 1) => {
    const a = g.a[e]!, b = g.b[e]!, dx = g.x[a]! - g.x[b]!, dy = g.y[a]! - g.y[b]!;
    if (Math.hypot(dx, dy) < afrom) return;
    const rb = grown.get(b) ?? g.r[b]!;
    const back = (rb + ringOf(b, rb)) * (S.shapes ? edge(g.shape[b]!, Math.atan2(dy, dx)) : 1);
    const p = arrow(g.x[a]!, g.y[a]!, g.x[b]!, g.y[b]!, back, alen * grow, awide * grow);
    path.moveTo(p[0], p[1]);
    path.lineTo(p[2], p[3]);
    path.lineTo(p[4], p[5]);
    path.closePath();
  };
  for (let kind = 0; kind < g.linkKinds.length; kind++) for (const lit of match ? [0, 1] : [1]) {
    c.beginPath();
    const heads = new Path2D();
    for (let e = 0; e < g.m; e++) {
      if (g.kind[e] !== kind) continue;
      const a = g.a[e]!, b = g.b[e]!;
      if (match && (full(a) && full(b) ? 1 : 0) !== lit) continue;
      if (Math.max(g.x[a]!, g.x[b]!) < vx0 || Math.min(g.x[a]!, g.x[b]!) > vx1 || Math.max(g.y[a]!, g.y[b]!) < vy0 || Math.min(g.y[a]!, g.y[b]!) > vy1) continue;
      c.moveTo(g.x[a]!, g.y[a]!);
      c.lineTo(g.x[b]!, g.y[b]!);
      if (S.arrows) head(heads, e);
    }
    const strength = S.link_alpha! * (kind === partOf ? 1.4 : 1), dimmed = faint * (lit ? 1 : S.query_fade!);
    c.globalAlpha = strength * dimmed;
    c.strokeStyle = kind === partOf ? ink.muted : ink.line;
    c.stroke();
    // Heads stronger than their line, and fading less with it, so a faint link still says which way it goes.
    c.globalAlpha = Math.min(1, strength * S.arrow_strength!) * Math.max(dimmed, S.arrow_keep!);
    c.fillStyle = c.strokeStyle;
    c.fill(heads);
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
    if (S.arrows) {
      const one = new Path2D();
      head(one, e, S.arrow_lit!);
      c.globalAlpha = s;
      c.fillStyle = ink.accent;
      c.fill(one);
    }
  }
  // Particles: the colour set once per type and openness, each circle filled on its own.
  for (let ty = 0; ty < g.types.length; ty++) {
    c.fillStyle = g.types[ty]!.colour;
    for (const [shut, hit] of [[1, 0], [0, 0], [1, 1], [0, 1]] as const) {
      if (!match && !hit) continue;
      for (let i = 0; i < g.n; i++) {
        if (g.typeIx[i] !== ty || g.closed[i] !== shut || !inView(i, g.r[i]!)) continue;
        if (match && full(i) !== hit) continue;
        // What the find line finds is drawn whole, closed or not: a plan's done steps still read.
        c.globalAlpha = (shut && match?.[i] !== FOUND ? S.closed_fade! : 1) * faint * (match && !hit ? S.query_fade! : 1) * come(i);
        particle(c, g, i, g.r[i]!, S, cam.k, ink.sea);
      }
    }
  }
  // Lit particles over the faded rest, at the size worked out above; the one pointed at gets a ring.
  for (const i of shining) {
    const rr = grown.get(i)!;
    c.globalAlpha = shine[i]!;
    c.fillStyle = g.types[g.typeIx[i]!]!.colour;
    particle(c, g, i, rr, S, cam.k, ink.sea);
    if (i === focus && S.hover_ring! > 0) {
      const lw = ringOf(i, rr);
      c.strokeStyle = ink.accent;
      c.lineWidth = lw;
      c.lineJoin = "round";
      c.beginPath();
      outline(c, S.shapes ? g.shape[i]! : CIRCLE, g.x[i]!, g.y[i]!, rr + lw / 2);
      c.stroke();
    }
  }

  // Words, in screen space (labels.ts places them): the lit first, then what the find line finds, then what was
  // named last frame, then hubs, then the largest; none over another word or particle, none off the view.
  c.setTransform(dpr, 0, 0, dpr, 0, 0);
  c.textBaseline = "middle";
  c.lineJoin = "round";
  c.font = "11px ui-sans-serif, system-ui, sans-serif";
  const hub = light.hubs(g, S);
  // The rest's titles fade out as the light comes in (over dim_ms), and only go once it is all but in.
  const lit = light.dim > 0.98;
  const rest = 1 - light.dim;
  const rank = (i: number) =>
    (i === focus ? 64 : 0) + (shine[i]! > 0 ? 32 : 0) + (match?.[i] === FOUND ? 16 : 0) + (hub[i] ? 8 : 0) + (light.named.has(g.id[i]!) ? 4 : 0) + (g.closed[i] ? 0 : 2);
  const wants: number[] = [];
  for (let i = 0; i < g.n; i++) {
    if (!inView(i, 0)) continue;
    // While one is pointed at, only it and its neighbours are named; while the find line has words, what it finds,
    // then what is near it as room allows, never the faint edge.
    if (lit ? !(shine[i]! > 0.5) : match ? !(match[i] === FOUND || (full(i) && (g.r[i]! * cam.k >= S.label_px! || hub[i]))) : !(g.r[i]! * cam.k >= S.label_px! || hub[i])) continue;
    wants.push(i);
  }
  // Among equals, the more linked first: hubs by their links, the rest by their size.
  wants.sort((p, q) => rank(q) - rank(p) || (hub[p] && hub[q] ? g.degree[q]! - g.degree[p]! : 0) || g.r[q]! - g.r[p]! || p - q);
  const budget = Math.min(S.label_most!, Math.floor((width * height) / Math.max(1, S.label_room!)));
  const texts = new Map<number, string[]>();
  const LINE = 13;
  const want: Want[] = wants.slice(0, Math.max(budget * 4, 40)).map((i) => {
    const r = g.r[i]! * cam.k;
    // Wide enough: the title inside the particle, on as many lines as fit across it (at most three), the last cut with ….
    const rows = Math.min(3, Math.floor((2 * r * 0.75) / LINE));
    const lines = S.label_inside! > 0 && 2 * r >= S.label_inside! && rows >= 1 ? wrap(c, clip(g.title[i]!, S.label_chars!), 2 * r * 0.8, rows) : [];
    // Lines of under four letters in all say nothing: then the title goes beside, whole.
    const inside = lines.join("").replace("…", "").length >= 4;
    const text = inside ? lines : [clip(g.title[i]!, S.label_chars!)];
    texts.set(i, text);
    const w = Math.max(...text.map((t) => c.measureText(t).width)) + 4;
    return { i, x: g.x[i]! * cam.k + cam.tx, y: g.y[i]! * cam.k + cam.ty, r, w, h: text.length * LINE + 1, must: shine[i]! > 0.5 || (!lit && !!hub[i]), inside, spot: light.spots.get(g.id[i]!) };
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
  // A title that takes another spot fades out where it stood and in where it goes (label_move_ms).
  const moveMs = S.label_move_ms ?? 0;
  if (moveMs > 0) {
    const nowAt = new Map(placed.map((p) => [g.id[p.i]!, [g.x[p.i]! * cam.k + cam.tx, g.y[p.i]! * cam.k + cam.ty] as [number, number]]));
    for (const id of movedTitles(light.spots, placed.map((p) => [g.id[p.i]!, p.spot]), light.spotsAt, nowAt)) {
      light.movedAt.set(id, at);
      const old = light.labels.get(id);
      if (old) light.leaving.push({ label: old, at });
    }
  }
  // Where each title stands, in world units, so one that leaves the map fades where it was read (gone.ts).
  light.labels = new Map(placed.map((p) => [g.id[p.i]!, { x: ((p.within ? (p.box[0] + p.box[2]) / 2 : p.box[0] + 2) - cam.tx) / cam.k, y: (p.box[1] - cam.ty) / cam.k, lines: texts.get(p.i)!, center: !!p.within }]));
  light.spots = new Map(placed.map((p) => [g.id[p.i]!, p.spot]));
  light.spotsAt = new Map(placed.map((p) => [g.id[p.i]!, [g.x[p.i]! * cam.k + cam.tx, g.y[p.i]! * cam.k + cam.ty] as [number, number]]));
  const moved = (i: number) => {
    const t = light.movedAt.get(g.id[i]!);
    return t === undefined || !moveMs ? 1 : comeFade(at - t, moveMs);
  };
  c.strokeStyle = ink.sea;
  for (const { i, box, within } of placed) {
    const rs = g.r[i]! * cam.k;
    const grow = shine[i]! > 0 || match?.[i] === FOUND || hub[i] ? 1 : Math.min(1, 0.6 + (0.4 * (rs - S.label_px!)) / Math.max(0.1, S.label_fade!));
    // A closed item's title is muted, like its particle.
    const shut = g.closed[i] && !(shine[i]! > 0) && !within && match?.[i] !== FOUND;
    c.globalAlpha = grow * Math.max(faint * fade(i) * (shine[i]! > 0.5 ? 1 : rest), shine[i]!) * (shut ? 0.75 : 1) * come(i) * moved(i);
    c.fillStyle = shut ? ink.muted : ink.text;
    const lines = texts.get(i)!, mid = (box[0] + box[2]) / 2;
    c.textAlign = within ? "center" : "left";
    lines.forEach((line, k) => {
      const x = within ? mid : box[0] + 2, y = box[1] + LINE * (k + 0.5) + 0.5;
      if (S.label_halo! > 0) (c.lineWidth = S.label_halo!), c.strokeText(line, x, y);
      c.fillText(line, x, y);
    });
  }
  // The moved titles where they stood, fading out.
  let still = 0;
  for (const q of light.leaving) {
    const f = moveMs ? 1 - comeFade(at - q.at, moveMs) : 0;
    if (f <= 0) continue;
    light.leaving[still++] = q;
    c.globalAlpha = f * faint;
    c.fillStyle = ink.text;
    c.textAlign = q.label.center ? "center" : "left";
    const x = q.label.x * cam.k + cam.tx, top = q.label.y * cam.k + cam.ty;
    q.label.lines.forEach((line, k) => {
      const y = top + LINE * (k + 0.5) + 0.5;
      if (S.label_halo! > 0) (c.lineWidth = S.label_halo!), c.strokeText(line, x, y);
      c.fillText(line, x, y);
    });
  }
  light.leaving.length = still;
  for (const [id, t] of light.movedAt) if (at - t >= moveMs) light.movedAt.delete(id);
  light.labelsMoving = still > 0 || light.movedAt.size > 0;
  c.textAlign = "left";

  // Link names, along their middles, over nothing named: the lit first, then the longest on screen.
  // They grow and shrink with the zoom, and fade in and out as they gain or lose their room.
  const namePx = S.link_names && S.link_name_most! > 0 ? wireSize(S.link_name_size!, cam.k, S.link_name_least_px!, S.link_name_most_px!) : 0;
  if (!namePx && !light.wires.size) return void (light.wiresMoving = false);
  c.font = `${(namePx || S.link_name_least_px!).toFixed(1)}px ui-sans-serif, system-ui, sans-serif`;
  const sx = (i: number) => g.x[i]! * cam.k + cam.tx, sy = (i: number) => g.y[i]! * cam.k + cam.ty;
  const wires: WireWant[] = [];
  for (let e = 0; namePx && e < g.m; e++) {
    const a = g.a[e]!, b = g.b[e]!;
    if (match && !(full(a) && full(b))) continue;
    const on = shine[a]! > 0.5 && shine[b]! > 0.5;
    if (lit && !on) continue;
    if (!inView(a, 0) && !inView(b, 0)) continue;
    // Not lit: named only at the zoom where both ends' titles show, so the whole map is not buried in link names.
    if (!on && Math.min(g.r[a]!, g.r[b]!) * cam.k < S.label_px!) continue;
    wires.push({ e, x1: sx(a), y1: sy(a), x2: sx(b), y2: sy(b), w: c.measureText(wireName(g.linkKinds[g.kind[e]!]!)).width + 4, h: namePx + 2, lit: on });
  }
  const taken = [...clear, ...placed.map((p) => p.box as [number, number, number, number])];
  // The particles' own room at each end, so a name sits clear of both.
  const named = namePx ? placeWires(wires, { width, height, from: S.link_name_from_px!, most: S.link_name_most!, ends: 12, taken }) : [];
  light.easeWires(named, S.link_name_fade_ms!);
  c.textAlign = "center";
  c.lineWidth = S.label_halo!;
  for (const [e, w] of light.wires) {
    if (e >= g.m) continue;
    const a = g.a[e]!, b = g.b[e]!;
    c.globalAlpha = Math.max(faint, Math.min(shine[a]!, shine[b]!)) * 0.9 * w.a;
    c.fillStyle = ink.muted;
    c.save();
    c.translate(w.x, w.y);
    c.rotate(w.angle);
    const t = wireName(g.linkKinds[g.kind[e]!]!);
    if (S.label_halo! > 0) c.strokeText(t, 0, 0);
    c.fillText(t, 0, 0);
    c.restore();
  }
  c.textAlign = "left";
}
