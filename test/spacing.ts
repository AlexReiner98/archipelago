// How wires stand beside one another: the flow's measure (packs/canvas/layouts/flow/faults.js until 9 Nov 2026, now at
// git tag archive/layouts-2026-11-09), kept for the checks every wired drawing is held to (test/structure.test.ts).

// @ts-expect-error a drawing's modules are plain JavaScript
import { tidy } from '../packs/canvas/layouts/flow/polyline.js';

/**
 * How wires stand beside one another, for wires running `down` and those running `across`. `lines` are { ends, points }.
 * `overlaps` and `overlapLength` are stretches of wires of different boxes on one line, `shared` those of wires of one box;
 * of neighbours with no wire between them, `under` stand nearer than `gap`, `at` at it, `between` past it and under
 * twice it, and `wide` from twice it to three times it, past which they are not neighbours.
 */
export function spacing(lines: { ends: string[]; points: number[][] }[], gap: number): any {
  const empty = (): Record<string, number> => ({ overlaps: 0, overlapLength: 0, shared: 0, under: 0, at: 0, between: 0, wide: 0 }), out = [empty(), empty()], SLACK = 0.5, BESIDE = 8;
  const runs = lines.flatMap((l) => {
    const p: number[][] = tidy(l.points);
    return p.slice(1).flatMap((q, i) => {
      const a = p[i], ax = a[0] === q[0] ? 0 : a[1] === q[1] ? 1 : -1;
      return ax < 0 ? [] : [{ l, ax, at: a[ax], lo: Math.min(a[1 - ax], q[1 - ax]), hi: Math.max(a[1 - ax], q[1 - ax]) }];
    });
  });
  for (const ax of [0, 1]) {
    const on = runs.filter((r) => r.ax === ax).sort((p, q) => p.at - q.at), c = out[ax];
    for (let i = 0; i < on.length; i++) for (let j = i + 1; j < on.length && on[j].at - on[i].at < gap * 3; j++) {
      const [p, q] = [on[i], on[j]], along = Math.min(p.hi, q.hi) - Math.max(p.lo, q.lo), apart = q.at - p.at;
      if (p.l === q.l || along <= 1) continue;
      if (apart < SLACK) {
        if (p.l.ends.some((e: string) => q.l.ends.includes(e))) c.shared++;
        else (c.overlaps++, (c.overlapLength += along));
        continue;
      }
      if (along < BESIDE || on.slice(i + 1, j).some((m) => m.l !== p.l && m.l !== q.l && m.at > p.at + SLACK && m.at < q.at - SLACK && Math.min(m.hi, p.hi, q.hi) - Math.max(m.lo, p.lo, q.lo) > 1)) continue;
      c[apart < gap - SLACK ? 'under' : apart <= gap + SLACK ? 'at' : apart < gap * 2 ? 'between' : 'wide']++;
    }
  }
  return { down: out[0], across: out[1] };
}
