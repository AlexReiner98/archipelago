/**
 * Painting a tree's scene (scene.ts) on a 2D canvas, as the Landscape
 * paints its field (packs/field/paint.ts): one canvas, the camera a
 * transform, no element per node. Branches first, then each node in the
 * tree's order (its window mark, verdict ring, dot and name, so a later
 * dot covers an earlier name as the SVG did), the root, then the lights.
 * What is outside the view is skipped.
 */
import { read } from "../../spec/style.ts";
import type { DotShape } from "./channels.ts";
import { shapeRadius } from "./key.ts";
import { STYLE } from "./layout.ts";
import type { Atlas } from "./sprites.ts";
import { dotInk, INK, nameInk, nameRuns, runInk, wireInk, type Lit, type Mark, type Scene } from "./scene.ts";

const S = STYLE;

/** CSS colours resolved for a canvas, each once: a token's `var(...)`, a hue, a run's colour. */
export class Ink {
  private seen = new Map<string, string>();
  private probe: HTMLElement;
  font = "system-ui, sans-serif";
  bold = "600";
  private el: HTMLElement;
  constructor(el: HTMLElement) {
    this.el = el;
    this.probe = document.createElement("span");
    this.probe.style.display = "none";
    el.append(this.probe);
    this.clear();
  }
  /** Forget what was resolved: the style changed. */
  clear(): void {
    this.seen.clear();
    this.font = read("font", this.el) || this.font;
    this.bold = read("bold", this.el) || this.bold;
  }
  color(css: string): string {
    let c = this.seen.get(css);
    if (c === undefined) {
      this.probe.style.color = "";
      this.probe.style.color = css;
      c = getComputedStyle(this.probe).color || css;
      this.seen.set(css, c);
    }
    return c;
  }
  dispose(): void {
    this.probe.remove();
  }
}

/** A dot's outline at radius r, centred on (x, y): the same shapes as channels.ts `shapePath`. */
export function outline(c: CanvasRenderingContext2D | Path2D, shape: DotShape | "circle", x: number, y: number, r: number): void {
  switch (shape) {
    case "circle":
      c.moveTo(x + r, y);
      c.arc(x, y, r, 0, Math.PI * 2);
      return;
    case "square": {
      const s = r * 0.9;
      c.rect(x - s, y - s, 2 * s, 2 * s);
      return;
    }
    case "diamond": {
      const d = r * 1.25;
      c.moveTo(x, y - d), c.lineTo(x + d, y), c.lineTo(x, y + d), c.lineTo(x - d, y), c.closePath();
      return;
    }
    case "hexagon": {
      const hx = r * 1.1, hy = hx * 0.87;
      c.moveTo(x - hx, y), c.lineTo(x - hx / 2, y - hy), c.lineTo(x + hx / 2, y - hy), c.lineTo(x + hx, y), c.lineTo(x + hx / 2, y + hy), c.lineTo(x - hx / 2, y + hy), c.closePath();
      return;
    }
    case "triangle": {
      const t = r * 1.3;
      c.moveTo(x, y - t), c.lineTo(x + t * 0.87, y + t * 0.5), c.lineTo(x - t * 0.87, y + t * 0.5), c.closePath();
      return;
    }
  }
}

/** A dot's half-extents on each axis, for its shape at radius r. */
export function dotExtent(shape: DotShape | "circle", r: number): { x0: number; x1: number; y0: number; y1: number } {
  switch (shape) {
    case "square":
      return { x0: -0.9 * r, x1: 0.9 * r, y0: -0.9 * r, y1: 0.9 * r };
    case "diamond":
      return { x0: -1.25 * r, x1: 1.25 * r, y0: -1.25 * r, y1: 1.25 * r };
    case "hexagon":
      return { x0: -1.1 * r, x1: 1.1 * r, y0: -1.1 * r * 0.87, y1: 1.1 * r * 0.87 };
    case "triangle":
      return { x0: -1.3 * r * 0.87, x1: 1.3 * r * 0.87, y0: -1.3 * r, y1: 1.3 * r * 0.5 };
    default:
      return { x0: -r, x1: r, y0: -r, y1: r };
  }
}

/** A mark's dot as drawn: its shape and radius at zoom k. */
export function dotOf(m: Mark, k: number, small: boolean): { shape: DotShape | "circle"; r: number } {
  if (m.shape) return { shape: m.shape, r: shapeRadius(m.r, k, small) };
  return { shape: "circle", r: small ? 3.5 : m.r };
}

/** A name's size in the picture's units: larger in a preview, where it is seen small. */
export const nameSize = (small: boolean) => (small ? 15 : S.nameText);

export interface Camera {
  x: number;
  y: number;
  k: number;
}

export interface PaintState {
  /** Nodes a light is on its way to: their names wait for it. */
  waiting: ReadonlySet<string>;
  lit: ReadonlyMap<string, Lit>;
  /** How far each wire name is shown (1) or faded out where it is crowded (0), by tree id. */
  shown: ReadonlyMap<string, number>;
  small: boolean;
  /**
   * While the camera moves: names are drawn at one of this many sizes for each doubling of the zoom, not
   * at every size it passes, so the letters drawn for one frame serve the next (the `name_steps` dial). 0: at every size.
   */
  steps: number;
  /** The zoom is changing: names are drawn from the atlas. */
  zooming: boolean;
}

/** The zoom a name is drawn at: k itself, or the nearest of `steps` sizes per doubling. */
export function textZoom(k: number, steps: number): number {
  return steps > 0 && k > 0 ? 2 ** (Math.round(Math.log2(k) * steps) / steps) : k;
}

/** Text widths, by font and text: names are measured once. */
export class Widths {
  private seen = new Map<string, number>();
  private c: CanvasRenderingContext2D;
  constructor(c: CanvasRenderingContext2D) {
    this.c = c;
  }
  of(font: string, text: string): number {
    const key = `${font}\u0000${text}`;
    let w = this.seen.get(key);
    if (w === undefined) {
      this.c.font = font;
      w = this.c.measureText(text).width;
      if (this.seen.size > 20000) this.seen.clear();
      this.seen.set(key, w);
    }
    return w;
  }
  /** How far above the baseline a name's middle is: half its font's x-height, as SVG's `dominant-baseline: middle` sets it. */
  middle(font: string): number {
    const key = `${font}x`;
    let m = this.seen.get(key);
    if (m === undefined) {
      this.c.font = font;
      m = this.c.measureText("x").actualBoundingBoxAscent / 2;
      this.seen.set(key, m);
    }
    return m;
  }
}

/** A name's font as CSS. */
export const fontOf = (ink: Ink, weight: string, italic: boolean, size: number) => `${italic ? "italic " : ""}${weight === "bold" ? ink.bold : weight} ${size}px ${ink.font}`;

/** The pieces of a name with their fonts and widths, and where the whole starts along its line. */
export function nameLayout(m: Mark, ink: Ink, widths: Widths, small: boolean, weight: string, italic: boolean) {
  const size = nameSize(small);
  const runs = nameRuns(m).map((r) => {
    const font = fontOf(ink, r.kind === "count" ? "400" : weight, italic, size);
    return { ...r, font, w: widths.of(font, r.text) };
  });
  const total = runs.reduce((s, r) => s + r.w, 0);
  const start = m.label.anchor === "end" ? m.label.dx - total : m.label.dx;
  return { size, runs, total, start };
}

/**
 * A name's pieces on a line from x, its baseline at y: a halo of the page round its letters first (a
 * preview's), then each piece in its colour, then the strike through it when it is struck.
 */
function drawRuns(c: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D, L: ReturnType<typeof nameLayout>, x0: number, y: number, ink: (kind: string) => string, halo?: string, struck?: string, mid = 0): void {
  c.textBaseline = "alphabetic";
  c.textAlign = "left";
  if (halo) {
    c.strokeStyle = halo;
    c.lineWidth = 3;
    c.lineJoin = "round";
    let x = x0;
    for (const r of L.runs) (c.font = r.font), c.strokeText(r.text, x, y), (x += r.w);
  }
  let x = x0;
  for (const r of L.runs) {
    c.font = r.font;
    c.fillStyle = ink(r.kind);
    c.fillText(r.text, x, y);
    x += r.w;
  }
  if (struck) {
    // Through the letters' middle: the baseline less half the x-height.
    c.fillStyle = struck;
    c.fillRect(x0, y - mid - L.size * 0.04, L.total, Math.max(0.6, L.size / 14));
  }
}

/** Paints the scene. `cam` is the world point at the canvas's top left, and its zoom. */
export function paint(c: CanvasRenderingContext2D, scene: Scene, cam: Camera, view: { width: number; height: number; dpr: number }, ink: Ink, widths: Widths, state: PaintState, paths: Map<string, Path2D>, after?: (c: CanvasRenderingContext2D) => void, atlas?: Atlas): void {
  const { k } = cam, { dpr, width, height } = view;
  c.setTransform(1, 0, 0, 1, 0, 0);
  c.clearRect(0, 0, width * dpr, height * dpr);
  c.setTransform(dpr * k, 0, 0, dpr * k, -cam.x * k * dpr, -cam.y * k * dpr);
  // The view in the picture's units, and a margin a name may reach in from.
  const vx0 = cam.x, vy0 = cam.y, vx1 = cam.x + width / k, vy1 = cam.y + height / k;
  c.lineCap = "round";
  c.lineJoin = "round";

  for (const w of scene.wires) {
    if (!w.d) continue;
    let p = paths.get(w.d);
    if (!p) paths.set(w.d, (p = new Path2D(w.d)));
    const s = wireInk(w, state.small);
    c.globalAlpha = s.alpha;
    c.strokeStyle = ink.color(s.color);
    c.lineWidth = s.width;
    c.stroke(p);
  }

  for (const m of scene.marks) {
    const reach = (m.label.text.length + 6) * S.nameText * 0.7 + 20;
    if (m.x < vx0 - reach || m.x > vx1 + reach || m.y < vy0 - reach || m.y > vy1 + reach) continue;
    const waiting = !!m.node && state.waiting.has(m.id);
    const base = m.hold === "held" ? 0.38 : 1;
    // Its window mark (not in a preview), then its verdict ring.
    if (m.window && !state.small) {
      c.globalAlpha = base;
      c.setLineDash([]);
      c.beginPath();
      if (m.window === "in") {
        c.arc(m.x, m.y, m.r + 5, 0, Math.PI * 2);
        c.globalAlpha = base * 0.16;
        c.fillStyle = ink.color(INK.say);
        c.fill();
      } else if (m.window === "listed") {
        c.arc(m.x, m.y, m.r + 4.5, 0, Math.PI * 2);
        c.strokeStyle = ink.color(INK.dim);
        c.lineWidth = 1.1;
        c.setLineDash([1, 2]);
        c.stroke();
        c.setLineDash([]);
      }
    }
    if (m.ring) {
      c.globalAlpha = base;
      c.beginPath();
      c.arc(m.x, m.y, m.r + 2.5, 0, Math.PI * 2);
      c.strokeStyle = ink.color(m.ring === "held" ? INK.say : m.ring === "failed" ? INK.fail : INK.quiet);
      c.lineWidth = 1.6;
      if (m.ring === "quiet") c.setLineDash([1.5, 1.5]);
      c.stroke();
      c.setLineDash([]);
    }
    const dot = dotOf(m, k, state.small);
    const di = dotInk(m, waiting);
    c.beginPath();
    outline(c, dot.shape, m.x, m.y, dot.r);
    if (di.fill) {
      c.globalAlpha = base * di.fillAlpha;
      c.fillStyle = ink.color(di.fill);
      c.fill();
    }
    if (di.stroke) {
      c.globalAlpha = base;
      c.strokeStyle = ink.color(di.stroke);
      c.lineWidth = di.strokeWidth;
      if (di.dash) c.setLineDash(di.dash);
      c.stroke();
      c.setLineDash([]);
    }
    if (m.window === "dropped" && !state.small) {
      const d = m.r + 3;
      c.globalAlpha = base;
      c.beginPath();
      c.moveTo(m.x - d, m.y + d);
      c.lineTo(m.x + d, m.y - d);
      c.strokeStyle = ink.color(INK.dim);
      c.lineWidth = 1.4;
      c.stroke();
    }
    // Its name.
    const lit = state.lit.get(m.id);
    const ni = nameInk(m, { waiting, ...(lit ? { lit } : {}), small: state.small });
    const shown = m.bough && !state.small ? (state.shown.get(m.id) ?? 1) : 1;
    const alpha = base * ni.alpha * shown;
    if (alpha <= 0.004) continue;
    const L = nameLayout(m, ink, widths, state.small, ni.weight, ni.italic);
    const color = ink.color(ni.color);
    const ink2 = (kind: string) => (kind === "name" ? color : ink.color(runInk(kind as never, ni.color)));
    const halo = state.small ? ink.color(INK.bg) : undefined;
    const mid = widths.middle(L.runs[0]!.font);
    const start = m.label.anchor === "end" ? m.label.dx - L.total : m.label.dx;
    c.save();
    c.translate(m.x, m.y);
    if (m.label.turn) c.rotate((m.label.turn * Math.PI) / 180);
    c.globalAlpha = alpha;
    // While the zoom changes, the name as a picture drawn upright once at a stepped size (sprites.ts); else as text.
    const s = atlas && state.zooming ? textZoom(k, state.steps) * dpr : 0;
    const pad = 3;
    const spot = s
      ? atlas!.get(`${s.toFixed(4)}|${L.runs.map((r) => `${r.font}·${r.kind}·${r.text}`).join("¦")}|${color}|${halo ?? ""}|${ni.struck ? 1 : 0}`, Math.ceil(L.total * s) + 2 * pad, Math.ceil(2 * L.size * s) + 2 * pad, (a, ax, ay) => {
          a.translate(ax + pad, ay + pad);
          a.scale(s, s);
          drawRuns(a, L, 0, L.size + mid, ink2, halo, ni.struck ? color : undefined, mid);
        })
      : undefined;
    if (spot) c.drawImage(atlas!.canvas, spot.x, spot.y, spot.w, spot.h, start - pad / s, m.label.dy - L.size - pad / s, spot.w / s, spot.h / s);
    else drawRuns(c, L, start, m.label.dy + mid, ink2, halo, ni.struck ? color : undefined, mid);
    c.restore();
  }

  c.globalAlpha = 1;
  c.beginPath();
  c.arc(0, 0, S.root, 0, Math.PI * 2);
  c.fillStyle = ink.color(INK.fg);
  c.fill();
  after?.(c);
  c.globalAlpha = 1;
}
