/**
 * The tree over the Landscape while it is arranged into a context profile
 * (packs/arrange): its branches, its boughs' names and the nodes no item on
 * the map holds, drawn in the world's units at `tree_scale`, under the
 * particles that fly into it. It comes in as they arrive: its strength is
 * how near the items are to their places (`arrived`).
 */
import type { G, Settings } from "./graph.ts";
import type { Cam, Ink } from "./paint.ts";

type Spot = [number, number];

/** A name placed as the context view places it: turned (degrees), moved along its line and across, from its start or end. */
export interface Placed {
  turn: number;
  dx: number;
  dy: number;
  anchor: "start" | "end";
}

/** What packs/arrange sets on the page (`arrange.tree`), as the Landscape reads it. */
export interface Arranged {
  profile: string;
  items: Record<string, Spot>;
  wires: Spot[][];
  /** The branches as the context view draws them (curve, width, strength); without them, the wires as lines. */
  branches?: { d: string; width: number; ink: number }[];
  boughs: { at: Spot; text: string; label?: Placed }[];
  ghosts: { at: Spot; text: string; label?: Placed }[];
  /** The size the names were placed for, in the tree's units. */
  nameText?: number;
  /** Each item's name as the context view places it: the tree draws it, with the item, as it lands. */
  names?: Record<string, { text: string; label: Placed }>;
}

/** The four corners of a name placed at (x, y) as `l` says, in the tree's units, its width guessed from its length. */
export function nameCorners(x: number, y: number, text: string, l: Placed, size: number): [number, number][] {
  const w = text.length * size * 0.55, t = (l.turn * Math.PI) / 180, c = Math.cos(t), s = Math.sin(t);
  const u0 = l.anchor === "end" ? l.dx - w : l.dx, v0 = l.dy - size * 0.7, v1 = l.dy + size * 0.7;
  return [[u0, v0], [u0 + w, v0], [u0, v1], [u0 + w, v1]].map(([u, v]) => [x + u! * c - v! * s, y + u! * s + v! * c]);
}

/** Sets each particle's place from the arrangement, at `scale`; none, no targets. */
export function targetsOf(g: G, a: Arranged | null, scale: number): G["target"] {
  if (!a) return undefined;
  const t = { on: new Uint8Array(g.n), x: new Float32Array(g.n), y: new Float32Array(g.n) };
  for (const [id, [x, y]] of Object.entries(a.items)) {
    const i = g.idIx.get(id);
    if (i === undefined) continue;
    t.on[i] = 1;
    t.x[i] = x * scale;
    t.y[i] = y * scale;
  }
  return t;
}

/**
 * A flight into the tree: where each item stood when it was arranged and its
 * place, and when it set off. While it lasts (`tree_ms`), the place each
 * item is pulled to moves from the one to the other, eased, so the items are
 * seen to fly however fast the physics runs.
 */
export interface Flight {
  at: number;
  fx: Float32Array;
  fy: Float32Array;
  px: Float32Array;
  py: Float32Array;
}

/** Sets off from where the items stand now to the places `g.target` holds; none, no flight. */
export function takeOff(g: G, now: number): Flight | null {
  const t = g.target;
  if (!t) return null;
  return { at: now, fx: g.x.slice(0, g.n), fy: g.y.slice(0, g.n), px: t.x.slice(), py: t.y.slice() };
}

/** Moves each place along its flight at `now`, eased in and out over `ms`; true while still flying. */
export function fly(g: G, f: Flight, now: number, ms: number): boolean {
  const t = g.target;
  if (!t || t.x.length !== f.px.length) return false;
  const p = ms > 0 ? Math.min(1, (now - f.at) / ms) : 1;
  const e = p < 0.5 ? 2 * p * p : 1 - (-2 * p + 2) ** 2 / 2;
  for (let i = 0; i < g.n; i++) {
    if (!t.on[i]) continue;
    t.x[i] = f.fx[i]! + (f.px[i]! - f.fx[i]!) * e;
    t.y[i] = f.fy[i]! + (f.py[i]! - f.fy[i]!) * e;
  }
  return p < 1;
}

/** How near the items are to their places, 0 (far) to 1 (there): the mean distance against a few names' length. With a flight, to where it ends. */
export function arrived(g: G, scale: number, f?: Flight | null): number {
  const t = g.target;
  if (!t) return 0;
  const px = f && f.px.length === t.x.length ? f.px : t.x, py = f && f.py.length === t.y.length ? f.py : t.y;
  let d = 0, n = 0;
  for (let i = 0; i < g.n; i++) if (t.on[i]) (d += Math.hypot(g.x[i]! - px[i]!, g.y[i]! - py[i]!)), n++;
  if (!n) return 1;
  return Math.max(0, Math.min(1, 1 - d / n / (60 * scale)));
}

/**
 * How strong the tree is drawn `since` ms after the map was arranged into it: nothing for `tree_in_ms`,
 * while what left the map fades out (so the two are never drawn over each other), then in as the items
 * arrive (`arrived`), and at least as fast as `gone_ms`.
 */
export function treeStrength(arrivedNow: number, since: number, S: Settings): number {
  const wait = S.tree_in_ms ?? 0;
  if (since < wait) return 0;
  const life = S.gone_ms ?? 0;
  const k = life > 0 ? Math.min(1, (since - wait) / life) : 1;
  return Math.max(arrivedNow, k * k * (3 - 2 * k));
}

/** The box the tree takes, at `scale`, its names' width guessed from their length: what the camera fits while arranged. */
export function treeBox(a: Arranged, scale: number, S: Settings): [number, number, number, number] {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  const take = (x: number, y: number, rx = 0, ry = 0) => {
    x0 = Math.min(x0, (x - rx) * scale);
    y0 = Math.min(y0, (y - ry) * scale);
    x1 = Math.max(x1, (x + rx) * scale);
    y1 = Math.max(y1, (y + ry) * scale);
  };
  const size = S.tree_text ?? 11;
  for (const w of a.wires) for (const [x, y] of w) take(x, y);
  for (const [x, y] of Object.values(a.items)) take(x, y, size * 8, size);
  // Names placed along their rays count where they reach, so the fit keeps every one in view.
  const nt = a.nameText ?? 11;
  for (const g of [...a.ghosts, ...a.boughs]) {
    if (g.label) for (const [x, y] of nameCorners(g.at[0], g.at[1], g.text, g.label, nt)) take(x, y);
    else take(g.at[0], g.at[1], g.text.length * size * 0.3, size * 2.5);
  }
  for (const [id, n] of Object.entries(a.names ?? {})) {
    const at = a.items[id];
    if (at) for (const [x, y] of nameCorners(at[0], at[1], n.text, n.label, nt)) take(x, y);
  }
  return x0 < Infinity ? [x0, y0, x1, y1] : [0, 0, 1, 1];
}

const paths = new Map<string, Path2D>();
/** A branch's curve, made once. */
function pathOf(d: string): Path2D {
  let p = paths.get(d);
  if (!p) {
    if (paths.size > 4000) paths.clear();
    paths.set(d, (p = new Path2D(d)));
  }
  return p;
}

type Box = [number, number, number, number];

/**
 * Where the tree's own names stand on screen (css px, as paintTree draws them: the boughs' above their
 * spot, the ghosts' below theirs), so the items' titles give way to them. `measure` gives a text's width at a size.
 */
export function treeNameBoxes(a: Arranged, cam: Cam, scale: number, S: Settings, measure: (text: string, px: number) => number): Box[] {
  const size = (S.tree_text ?? 11) * scale * cam.k, ghost = (S.tree_ghost_text ?? 7) * scale * cam.k;
  const box = (x: number, y: number, text: string, px: number, dy: number): Box => {
    const sx = x * scale * cam.k + cam.tx, sy = y * scale * cam.k + cam.ty + dy, w = measure(text, px) / 2 + 2;
    return [sx - w, sy - px * 0.7, sx + w, sy + px * 0.7];
  };
  const turned = (x: number, y: number, text: string, l: Placed): Box => {
    const k = scale * cam.k, px = (a.nameText ?? 11) * k, w = measure(text, px), t = (l.turn * Math.PI) / 180;
    const x0 = l.anchor === "end" ? l.dx * k - w : l.dx * k, y0 = l.dy * k - px * 0.7, y1 = l.dy * k + px * 0.7;
    const cx = x * k + cam.tx, cy = y * k + cam.ty, c = Math.cos(t), s = Math.sin(t);
    const pts = [[x0, y0], [x0 + w, y0], [x0, y1], [x0 + w, y1]].map(([u, v]) => [cx + u! * c - v! * s, cy + u! * s + v! * c]);
    return [Math.min(...pts.map((p) => p[0]!)) - 2, Math.min(...pts.map((p) => p[1]!)), Math.max(...pts.map((p) => p[0]!)) + 2, Math.max(...pts.map((p) => p[1]!))];
  };
  return [
    ...a.ghosts.map((g) => (g.label ? turned(g.at[0], g.at[1], g.text, g.label) : box(g.at[0], g.at[1], g.text, ghost, ghost * 1.3))),
    ...a.boughs.map((b) => (b.label ? turned(b.at[0], b.at[1], b.text, b.label) : box(b.at[0], b.at[1], b.text, size, -size * 0.9))),
  ];
}

/** Paints the tree: branches, then the ghosts' dots and every name, at strength `alpha`. */
export function paintTree(c: CanvasRenderingContext2D, a: Arranged, cam: Cam, dpr: number, scale: number, alpha: number, ink: Ink, S: Settings, itemAt?: (id: string) => [number, number, number] | undefined): void {
  if (alpha <= 0.01) return;
  c.save();
  c.setTransform(dpr * cam.k, 0, 0, dpr * cam.k, dpr * cam.tx, dpr * cam.ty);
  c.lineCap = "round";
  c.lineJoin = "round";
  if (a.branches?.length) {
    // The context view's own curves and strokes, in the tree's units, so the two draw the same tree.
    c.save();
    c.scale(scale, scale);
    c.strokeStyle = ink.branch;
    for (const b of a.branches) {
      c.globalAlpha = alpha * b.ink;
      c.lineWidth = b.width;
      c.stroke(pathOf(b.d));
    }
    c.restore();
  } else {
    c.strokeStyle = ink.muted;
    c.globalAlpha = alpha * 0.8;
    c.lineWidth = 1.4 / cam.k;
    for (const w of a.wires) {
      c.beginPath();
      w.forEach(([x, y], j) => (j ? c.lineTo(x * scale, y * scale) : c.moveTo(x * scale, y * scale)));
      c.stroke();
    }
  }
  const size = (S.tree_text ?? 11) * scale;
  c.font = `500 ${size}px ui-sans-serif, system-ui, sans-serif`;
  c.textBaseline = "middle";
  c.textAlign = "center";
  c.lineJoin = "round";
  const word = (x: number, y: number, text: string, fill: string, dy: number, px: number) => {
    c.font = `500 ${px}px ui-sans-serif, system-ui, sans-serif`;
    c.globalAlpha = alpha;
    c.strokeStyle = ink.sea;
    c.lineWidth = px / 3;
    c.strokeText(text, x, y + dy);
    c.fillStyle = fill;
    c.fillText(text, x, y + dy);
  };
  // A node no item holds is named smaller than a bough, so neighbours' names don't run together.
  const ghost = (S.tree_ghost_text ?? 7) * scale;
  // A name placed as the context view places it: turned along its ray, from its start or its end.
  const placedWord = (x: number, y: number, text: string, l: Placed, fill: string, weight: string, strength = 1) => {
    const px = (a.nameText ?? 11) * scale;
    c.save();
    c.translate(x * scale, y * scale);
    if (l.turn) c.rotate((l.turn * Math.PI) / 180);
    c.font = `${weight} ${px}px ui-sans-serif, system-ui, sans-serif`;
    c.textAlign = l.anchor === "end" ? "right" : "left";
    c.textBaseline = "middle";
    c.globalAlpha = alpha * strength;
    c.strokeStyle = ink.sea;
    c.lineWidth = px / 3;
    c.strokeText(text, l.dx * scale, l.dy * scale);
    c.fillStyle = fill;
    c.fillText(text, l.dx * scale, l.dy * scale);
    c.restore();
  };
  for (const g of a.ghosts) {
    c.globalAlpha = alpha * 0.6;
    c.fillStyle = ink.muted;
    c.beginPath();
    c.arc(g.at[0] * scale, g.at[1] * scale, 3 * scale, 0, Math.PI * 2);
    c.fill();
    if (g.label) placedWord(g.at[0], g.at[1], g.text, g.label, ink.muted, "400");
    else word(g.at[0] * scale, g.at[1] * scale, g.text, ink.muted, ghost * 1.3, ghost);
  }
  for (const b of a.boughs) {
    if (b.label) placedWord(b.at[0], b.at[1], b.text, b.label, ink.text, "600");
    else word(b.at[0] * scale, b.at[1] * scale, b.text, ink.text, -size * 0.9, size);
  }
  // Each item's name, where the item is (in the tree's units), as strong as it is near its place: it lands with it.
  if (itemAt) for (const [id, n] of Object.entries(a.names ?? {})) {
    const p = itemAt(id);
    if (p && p[2] > 0.01) placedWord(p[0] / scale, p[1] / scale, n.text, n.label, ink.text, "500", p[2]);
  }
  c.restore();
}
