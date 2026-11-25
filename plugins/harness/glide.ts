/**
 * A tree's layout that glides when the tree changes: a node added or gone re-lays the whole radial picture, and
 * instead of the new one at once, each frame for `ms` shows it part way there (`glide`), eased. So
 * branches move, and a light running along one follows it (lights.ts reads its route each frame).
 */
import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import { placedAt, type Placed, type RadialOptions, type Tree } from "./layout.ts";

/**
 * The tree drawn between two of its layouts, `u` of the way from `from` to `to` (0 to 1): each node's angle and
 * ring eased, the short way round, and the branches, names and bounds made from those. A node new in `to` grows
 * out of where its parent was; one gone from it is gone. So a change to the tree is seen moving, not a jump.
 */
export function glide(tree: Tree, from: Placed, to: Placed, u: number, options: RadialOptions = {}): Placed {
  if (u >= 1) return to;
  const turn = (a: number, b: number) => a + ((((b - a) % (2 * Math.PI)) + 3 * Math.PI) % (2 * Math.PI) - Math.PI) * u;
  const polar = new Map<string, { a: number; r: number }>();
  for (const t of tree.order) {
    const end = to.polar.get(t.id)!;
    let start = from.polar.get(t.id);
    for (let up = t.parent; !start && up; up = up.parent) start = from.polar.get(up.id);
    start ??= end;
    polar.set(t.id, { a: turn(start.a, end.a), r: start.r + (end.r - start.r) * u });
  }
  return placedAt(tree, polar, from.ring + (to.ring - from.ring) * u, options);
}

/** Eased in and out. */
const ease = (u: number) => u * u * (3 - 2 * u);

export function useGlide(tree: Tree, placed: Placed, ms: number, nameMost?: number): Placed {
  const shown = useRef(placed), to = useRef(placed);
  const [frame, setFrame] = useState<Placed | null>(null);
  // The first frame of a change is drawn now, at its start, so the new tree is never drawn with the old places.
  const start = useMemo(() => (placed === to.current ? null : glide(tree, shown.current, placed, 0, { nameMost })), [placed]);
  useEffect(() => {
    if (placed === to.current) return;
    const from = shown.current;
    to.current = placed;
    if (!ms) {
      shown.current = placed;
      setFrame(null);
      return;
    }
    const t0 = performance.now();
    let raf = 0;
    const step = () => {
      const u = Math.min(1, (performance.now() - t0) / ms);
      const p = glide(tree, from, placed, ease(u), { nameMost });
      shown.current = p;
      setFrame(u < 1 ? p : null);
      if (u < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [placed]);
  if (start && placed !== to.current) return start;
  return frame ?? placed;
}
