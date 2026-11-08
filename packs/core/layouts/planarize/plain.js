// The embedding drawn plainly, to be judged before it is shaped (task e_snvzsxj4): a visibility drawing (Tamassia and
// Tollis). Each node stands on the row of its longest way down from the top; each stretch runs straight down a column
// of its own, the column of the face on its left counted across from the outer face's left side, so no two stretches
// cross but at the points the embedding put there. Each node spans the columns of its stretches. It shows which wires
// cross, where ports fall and that the order runs down, not how the picture will look. Layer: metrics. Pure: an
// embedding in, rows and columns out.

import { sidesOf } from './topology.js';

/**
 * Rows and columns for `e` (of ./embedding.js: faces, outer, number, s, t, owner): `row` of each node, `column` of each
 * stretch by its pair key, and `span` of each node, the first and last column it touches.
 */
export function visibility(e) {
  const { left, right, LEFT } = sidesOf(e.faces, e.outer, e.number, e.s, e.t);
  // The faces in order from left to right: each stretch's left face before its right one, by the longest way there.
  const after = new Map(), into = new Map();
  for (const key of e.owner.keys()) {
    const [a, b] = [left.get(key), right.get(key)];
    (after.get(a) ?? after.set(a, []).get(a)).push(b);
    into.set(b, (into.get(b) ?? 0) + 1);
    if (!into.has(a)) into.set(a, 0);
  }
  const depth = new Map([[LEFT, 0]]), queue = [...into].filter(([, n]) => !n).map(([f]) => f);
  for (const f of queue) if (!depth.has(f)) depth.set(f, 0);
  for (let k = 0; k < queue.length; k++) for (const b of after.get(queue[k]) ?? []) {
    depth.set(b, Math.max(depth.get(b) ?? 0, depth.get(queue[k]) + 1));
    into.set(b, into.get(b) - 1);
    if (!into.get(b)) queue.push(b);
  }
  const column = new Map([...e.owner.keys()].map((key) => [key, depth.get(left.get(key)) ?? 0]));
  // Each node's row: one under the lowest of what runs into it, the numbering saying which way each stretch runs.
  const near = new Map();
  for (const key of e.owner.keys()) {
    const [a, b] = key.split('|');
    (near.get(a) ?? near.set(a, []).get(a)).push(b);
    (near.get(b) ?? near.set(b, []).get(b)).push(a);
  }
  const row = new Map();
  for (const v of [...near.keys()].sort((p, q) => e.number.get(p) - e.number.get(q))) {
    row.set(v, 1 + Math.max(-1, ...near.get(v).filter((w) => e.number.get(w) < e.number.get(v)).map((w) => row.get(w) ?? 0)));
  }
  const span = new Map([...near].map(([v, list]) => {
    const cols = list.map((w) => column.get(e.owner.has(`${v}|${w}`) ? `${v}|${w}` : `${w}|${v}`));
    return [v, [Math.min(...cols), Math.max(...cols)]];
  }));
  return { row, column, span };
}
