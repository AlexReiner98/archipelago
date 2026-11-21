/**
 * The names on the wires (a bough's name, along its branch) give way: one
 * that overlaps anything shown (another name, a node's dot) fades out, and
 * comes back when zoom or a move clears it. They are drawn in the tree's
 * own units, so they grow and shrink with the zoom. A bough nearer the
 * root keeps its name over a deeper one. Each name is tested by its own
 * turned outline, not the box round it, with a little room round it,
 * against the nodes' names and dots, the boughs' dots and the root.
 */

export type Quad = [number, number][];

/** Whether two convex quads overlap (separating axes). */
export function quadsOverlap(a: Quad, b: Quad): boolean {
  for (const q of [a, b]) {
    for (let i = 0; i < q.length; i++) {
      const [x1, y1] = q[i]!, [x2, y2] = q[(i + 1) % q.length]!;
      const nx = y2 - y1, ny = x1 - x2;
      let aMin = Infinity, aMax = -Infinity, bMin = Infinity, bMax = -Infinity;
      for (const [x, y] of a) {
        const d = x * nx + y * ny;
        aMin = Math.min(aMin, d), (aMax = Math.max(aMax, d));
      }
      for (const [x, y] of b) {
        const d = x * nx + y * ny;
        bMin = Math.min(bMin, d), (bMax = Math.max(bMax, d));
      }
      if (aMax <= bMin || bMax <= aMin) return false;
    }
  }
  return true;
}

/** Which of the wire names to hide: in order (nearest the root first), each that overlaps a shown thing or a name kept before it. */
export function crowded(names: Quad[], shown: Quad[]): boolean[] {
  const kept: Quad[] = [];
  return names.map((q) => {
    const hit = shown.some((s) => quadsOverlap(q, s)) || kept.some((k) => quadsOverlap(q, k));
    if (!hit) kept.push(q);
    return hit;
  });
}

/** An element's outline on screen, its box turned and scaled as it is drawn, `pad` pixels in. */
function quadOf(el: SVGGraphicsElement, pad = 1): Quad | undefined {
  const m = el.getScreenCTM();
  if (!m) return undefined;
  const b = el.getBBox();
  if (!b.width && !b.height) return undefined;
  const pts: [number, number][] = [[b.x, b.y], [b.x + b.width, b.y], [b.x + b.width, b.y + b.height], [b.x, b.y + b.height]];
  const q = pts.map(([x, y]) => {
    const p = new DOMPoint(x, y).matrixTransform(m);
    return [p.x, p.y] as [number, number];
  });
  // Pulled in a little, so names that only touch both stay.
  const cx = q.reduce((s, p) => s + p[0], 0) / 4, cy = q.reduce((s, p) => s + p[1], 0) / 4;
  return q.map(([x, y]) => {
    const d = Math.hypot(x - cx, y - cy) || 1;
    return [x - ((x - cx) / d) * pad, y - ((y - cy) / d) * pad] as [number, number];
  });
}

const shownNow = (el: Element) => getComputedStyle(el).opacity !== "0" && !el.closest(".rx-wait");

/** Fades the wire names that overlap anything, in the svg as drawn now. */
export function fadeCrowded(svg: SVGSVGElement): void {
  const boughs = Array.from(svg.querySelectorAll<SVGGElement>("g.rx-bough")).sort((a, b) => Number(a.dataset.depth ?? 0) - Number(b.dataset.depth ?? 0));
  const names = boughs.map((g) => g.querySelector<SVGTextElement>(".rx-name")).filter((t): t is SVGTextElement => !!t);
  const others: Quad[] = [];
  // Everything shown that a name may not cover: the nodes' names and dots, the boughs' dots, the root.
  for (const el of Array.from(svg.querySelectorAll<SVGGraphicsElement>("g.rx-node .rx-name, g.rx-node .rx-dot, g.rx-bough .rx-dot, circle.rx-root"))) {
    if (!shownNow(el)) continue;
    const q = quadOf(el, 0);
    if (q) others.push(q);
  }
  // Names keep a little room round them (a negative pad grows the outline).
  const quads = names.map((t) => quadOf(t, -2));
  const hide = crowded(quads.map((q) => q ?? []), others);
  names.forEach((t, i) => t.classList.toggle("rx-hide", !!quads[i] && hide[i]!));
}
