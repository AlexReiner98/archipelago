/**
 * One particle drawn on a 2D canvas (its shape or icon, hollow or half by
 * its status), and the text fitting a title uses: wrapped onto lines, cut
 * with … to a width.
 */
import type { G, Settings } from "./graph.ts";
import { CIRCLE, fill, outline, reach } from "./shapes.ts";

/** Each icon's path, made once (Path2D is the page's, so it is made where it is drawn). */
const ICONS = new Map<string, Path2D>();

/** A type's icon in place of its shape: the 24 by 24 path stroked in the particle's colour, as wide as the shape would be. */
function icon(c: CanvasRenderingContext2D, d: string, x: number, y: number, r: number): void {
  let p = ICONS.get(d);
  if (!p) ICONS.set(d, (p = new Path2D(d)));
  const s = (r * 2.2) / 24;
  c.save();
  c.translate(x - 12 * s, y - 12 * s);
  c.scale(s, s);
  c.strokeStyle = c.fillStyle;
  c.lineWidth = 2;
  c.lineJoin = "round";
  c.lineCap = "round";
  c.stroke(p);
  c.restore();
}

/**
 * One particle, in the fill and alpha set now: its shape, hollow or half by
 * its status when shapes are on and it is big enough on screen. Hollow is a
 * ring: the shape with its middle the sea. Half is one shape whose right
 * half is that ring and whose left half stays solid, as ◐ (one fill, the
 * hole punched only on the right, so it never reads as two shapes).
 */
export function particle(c: CanvasRenderingContext2D, g: G, i: number, r: number, S: Settings, k: number, sea: string): void {
  const shape = S.shapes ? g.shape[i]! : CIRCLE, x = g.x[i]!, y = g.y[i]!;
  const d = g.types[g.typeIx[i]!]?.icon;
  if (d) return icon(c, d, x, y, r);
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
export function wrap(c: CanvasRenderingContext2D, s: string, px: number, rows: number): string[] {
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

export const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);
