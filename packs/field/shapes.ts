/**
 * A particle's shape: its base's mark shape (spec/style.ts SHAPES: square,
 * diamond, circle, triangle), and how full it is by where its status sits
 * (fresh hollow, moving half, done and gone full), as the item marks are.
 * Pure: the outline as a path, and how far the edge is from the middle in
 * a direction, which collide reads so flat sides pack closer than corners.
 *
 * Each shape has the area of the circle of the particle's radius r, so no
 * base looks bigger than another of the same size.
 */
import { SHAPES, SIDES, type Shape, type Side } from "../../spec/style.ts";

/** A shape's index in SHAPES; CIRCLE when shapes are off. */
export const CIRCLE = SHAPES.indexOf("circle");

/** Regular polygons: sides, the angle of the first corner, and the circumradius for the area of a unit circle. */
const POLY: Record<Exclude<Shape, "circle">, { n: number; at: number; R: number }> = {
  // (2a)² = π → a = √π/2, corner at a√2.
  square: { n: 4, at: Math.PI / 4, R: Math.sqrt(Math.PI / 2) },
  diamond: { n: 4, at: 0, R: Math.sqrt(Math.PI / 2) },
  // (3√3/4)R² = π.
  triangle: { n: 3, at: -Math.PI / 2, R: Math.sqrt((4 * Math.PI) / (3 * Math.sqrt(3))) },
};

const polyOf = (shape: number) => (shape === CIRCLE ? null : POLY[SHAPES[shape] as Exclude<Shape, "circle">] ?? null);

/** The farthest the edge reaches, as a share of r. */
export function reach(shape: number): number {
  return polyOf(shape)?.R ?? 1;
}

/** How far the edge is from the middle toward angle `th` (radians, screen y down), as a share of r. */
export function edge(shape: number, th: number): number {
  const p = polyOf(shape);
  if (!p) return 1;
  const span = (2 * Math.PI) / p.n, inner = p.R * Math.cos(Math.PI / p.n);
  // The angle from the nearest side's middle.
  const off = ((((th - p.at - Math.PI / p.n + span / 2) % span) + span) % span) - span / 2;
  return inner / Math.cos(off);
}

/** How fast `edge` changes with the angle at `th` (its slope), as a share of r per radian. */
export function edgeSlope(shape: number, th: number): number {
  const p = polyOf(shape);
  if (!p) return 0;
  const span = (2 * Math.PI) / p.n, inner = p.R * Math.cos(Math.PI / p.n);
  const off = ((((th - p.at - Math.PI / p.n + span / 2) % span) + span) % span) - span / 2;
  return (inner * Math.sin(off)) / Math.cos(off) ** 2;
}

/** The outline as a path (not begun, not filled). */
export function outline(c: CanvasRenderingContext2D, shape: number, x: number, y: number, r: number): void {
  const p = polyOf(shape);
  if (!p) {
    c.moveTo(x + r, y);
    c.arc(x, y, r, 0, 2 * Math.PI);
    return;
  }
  for (let k = 0; k < p.n; k++) {
    const a = p.at + (k * 2 * Math.PI) / p.n;
    const px = x + p.R * r * Math.cos(a), py = y + p.R * r * Math.sin(a);
    if (k) c.lineTo(px, py);
    else c.moveTo(px, py);
  }
  c.closePath();
}

/** How full a side is drawn: 0 hollow, 1 half, 2 full. */
export function fill(side: number): 0 | 1 | 2 {
  const s = SIDES[side] as Side | undefined;
  return s === "fresh" ? 0 : s === "moving" ? 1 : 2;
}

const f2 = (v: number) => +v.toFixed(2);
const ring = (pts: [number, number][]) => `M${pts.map(([x, y]) => `${f2(x)} ${f2(y)}`).join("L")}Z`;

/** A shape's corners round (x, y) at radius r; null for a circle. */
function corners(shape: number, x: number, y: number, r: number): [number, number][] | null {
  const p = polyOf(shape);
  if (!p) return null;
  return Array.from({ length: p.n }, (_, k) => {
    const a = p.at + (k * 2 * Math.PI) / p.n;
    return [x + p.R * r * Math.cos(a), y + p.R * r * Math.sin(a)];
  });
}

/** A polygon cut to its part right of x = cx (one half-plane, Sutherland–Hodgman). */
function rightOf(pts: [number, number][], cx: number): [number, number][] {
  const out: [number, number][] = [];
  for (let k = 0; k < pts.length; k++) {
    const a = pts[k]!, b = pts[(k + 1) % pts.length]!, ina = a[0] >= cx, inb = b[0] >= cx;
    if (ina) out.push(a);
    if (ina !== inb) {
      const t = (cx - a[0]) / (b[0] - a[0]);
      out.push([cx, a[1] + t * (b[1] - a[1])]);
    }
  }
  return out;
}

/**
 * A particle as the canvas draws it (`particle` in paint.ts), as an SVG path
 * to fill with `fill-rule: evenodd`: the shape, with its middle cut out by
 * `line` (a share of r, the hollow outline) when `how` is 0 (hollow), or only
 * its right half cut out when 1 (half, ◐). The legend draws its keys with it.
 */
export function markPath(shape: number, how: 0 | 1 | 2, x: number, y: number, r: number, line: number): string {
  const outer = corners(shape, x, y, r);
  const whole = outer ? ring(outer) : `M${f2(x - r)} ${f2(y)}a${f2(r)} ${f2(r)} 0 1 0 ${f2(2 * r)} 0a${f2(r)} ${f2(r)} 0 1 0 ${f2(-2 * r)} 0Z`;
  if (how === 2) return whole;
  const ri = r * (1 - line), inner = corners(shape, x, y, ri);
  if (how === 0) return whole + (inner ? ring(inner) : `M${f2(x - ri)} ${f2(y)}a${f2(ri)} ${f2(ri)} 0 1 0 ${f2(2 * ri)} 0a${f2(ri)} ${f2(ri)} 0 1 0 ${f2(-2 * ri)} 0Z`);
  return whole + (inner ? ring(rightOf(inner, x)) : `M${f2(x)} ${f2(y - ri)}A${f2(ri)} ${f2(ri)} 0 0 1 ${f2(x)} ${f2(y + ri)}Z`);
}
