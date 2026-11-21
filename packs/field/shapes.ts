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
