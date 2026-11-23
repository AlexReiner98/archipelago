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

/** How near the items are to their places, 0 (far) to 1 (there): the mean distance against a few names' length. */
export function arrived(g: G, scale: number): number {
  const t = g.target;
  if (!t) return 0;
  let d = 0, n = 0;
  for (let i = 0; i < g.n; i++) if (t.on[i]) (d += Math.hypot(g.x[i]! - t.x[i]!, g.y[i]! - t.y[i]!)), n++;
  if (!n) return 1;
  return Math.max(0, Math.min(1, 1 - d / n / (60 * scale)));
}

/** Paints the tree: branches, then the ghosts' dots and every name, at strength `alpha`. */
export function paintTree(c: CanvasRenderingContext2D, a: Arranged, cam: Cam, dpr: number, scale: number, alpha: number, ink: Ink, S: Settings): void {
  if (alpha <= 0.01) return;
  c.save();
  c.setTransform(dpr * cam.k, 0, 0, dpr * cam.k, dpr * cam.tx, dpr * cam.ty);
  c.lineCap = "round";
  c.strokeStyle = ink.muted;
  c.globalAlpha = alpha * 0.8;
  c.lineWidth = 1.4 / cam.k;
  for (const w of a.wires) {
    c.beginPath();
    w.forEach(([x, y], j) => (j ? c.lineTo(x * scale, y * scale) : c.moveTo(x * scale, y * scale)));
    c.stroke();
  }
  const size = (S.tree_text ?? 11) * scale;
  c.font = `500 ${size}px ui-sans-serif, system-ui, sans-serif`;
  c.textBaseline = "middle";
  c.textAlign = "center";
  c.lineJoin = "round";
  const word = (x: number, y: number, text: string, fill: string, dy: number) => {
    c.globalAlpha = alpha;
    c.strokeStyle = ink.sea;
    c.lineWidth = size / 3;
    c.strokeText(text, x, y + dy);
    c.fillStyle = fill;
    c.fillText(text, x, y + dy);
  };
  for (const g of a.ghosts) {
    c.globalAlpha = alpha * 0.6;
    c.fillStyle = ink.muted;
    c.beginPath();
    c.arc(g.at[0] * scale, g.at[1] * scale, 3 * scale, 0, Math.PI * 2);
    c.fill();
    word(g.at[0] * scale, g.at[1] * scale, g.text, ink.muted, size);
  }
  for (const b of a.boughs) word(b.at[0] * scale, b.at[1] * scale, b.text, ink.text, -size * 0.9);
  c.restore();
}
