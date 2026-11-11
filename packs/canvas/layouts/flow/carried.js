// Where a wire cut onto a trunk (the Map layout's trunks) goes on: the stretch of each wire that carries it to the item they
// share. Hovering a step lights its wires, and one cut onto a trunk is lit on along it, all the way (the owner, 10 Nov
// 2026). Layer: marks. Pure: wires in, stretches out.

import { tidy } from './polyline.js';

const onStretch = (p, a, b) => (a[0] === b[0] && p[0] === a[0] && p[1] >= Math.min(a[1], b[1]) && p[1] <= Math.max(a[1], b[1]))
  || (a[1] === b[1] && p[1] === a[1] && p[0] >= Math.min(a[0], b[0]) && p[0] <= Math.max(a[0], b[0]));
/** The stretch of `line` that `p` lies on, by the index of its far point, or -1. */
const stretchOf = (line, p) => line.findIndex((q, i) => i > 0 && onStretch(p, line[i - 1], q));

/**
 * For each of `wires` ({ a, b, points, toPort, stop, fromPort }), what carries it on: [{ k, end, points }], each the
 * index of a wire it runs on and that wire's stretch from where it joins to the item they share. A wire that ends on a
 * trunk (`toPort`) is carried on to its `b` (`end`, where the trunk's head is); one that starts at a stop on it
 * (`stop`, `fromPort`) back to its `a`.
 */
export function carried(wires) {
  const cutAtEnd = (w) => Boolean(w.toPort), cutAtStart = (w) => Boolean(w.stop || w.fromPort);
  // The wire that carries it runs to the item they share at either of its ends: one that ends there (a fan in), or
  // one that starts there (a trunk in that lands on the trunk out, as the strips draw a step both waited on and waiting).
  const follow = (j, atEnd, seen, out) => {
    const w = wires[j], tip = atEnd ? w.points.at(-1) : w.points[0], shared = atEnd ? w.b : w.a;
    const k = wires.findIndex((u, k) => !seen.has(k) && (u.b === shared || u.a === shared) && stretchOf(u.points, tip) > 0);
    if (k < 0) return out;
    const u = wires[k], i = stretchOf(u.points, tip), end = u.b === shared;
    out.push({ k, end, points: tidy(end ? [tip, ...u.points.slice(i)] : [...u.points.slice(0, i), tip]) });
    seen.add(k);
    return (end ? cutAtEnd(u) : cutAtStart(u)) ? follow(k, end, seen, out) : out;
  };
  return wires.map((w, j) => [
    ...(cutAtEnd(w) ? follow(j, true, new Set([j]), []) : []),
    ...(cutAtStart(w) ? follow(j, false, new Set([j]), []) : []),
  ]);
}
