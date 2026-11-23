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

/** What packs/arrange sets on the page (`arrange.tree`), as the Landscape reads it. */
export interface Arranged {
  profile: string;
  items: Record<string, Spot>;
  wires: Spot[][];
  /** The branches as the context view draws them (curve, width, strength); without them, the wires as lines. */
  branches?: { d: string; width: number; ink: number }[];
  boughs: { at: Spot; text: string }[];
  ghosts: { at: Spot; text: string }[];
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
  for (const g of [...a.ghosts, ...a.boughs]) take(g.at[0], g.at[1], g.text.length * size * 0.3, size * 2.5);
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

/** Paints the tree: branches, then the ghosts' dots and every name, at strength `alpha`. */
export function paintTree(c: CanvasRenderingContext2D, a: Arranged, cam: Cam, dpr: number, scale: number, alpha: number, ink: Ink, S: Settings): void {
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
  for (const g of a.ghosts) {
    c.globalAlpha = alpha * 0.6;
    c.fillStyle = ink.muted;
    c.beginPath();
    c.arc(g.at[0] * scale, g.at[1] * scale, 3 * scale, 0, Math.PI * 2);
    c.fill();
    word(g.at[0] * scale, g.at[1] * scale, g.text, ink.muted, ghost * 1.3, ghost);
  }
  for (const b of a.boughs) word(b.at[0] * scale, b.at[1] * scale, b.text, ink.text, -size * 0.9, size);
  c.restore();
}
