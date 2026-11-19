// Layer: metrics. Where each node of the tree stands: a radial tree about the root, each subtree given a share of the
// circle in proportion to its leaves, a ring out for each level (reflex_ring), each node a little nearer or farther
// by its id (reflex_jitter), the whole spread wider than tall (reflex_spread_x). Each branch is an S-curve: out of the
// parent along its own direction, into the child along the child's. The same tree is placed the same each time.

import { at } from './marks.js';
import { hash } from './tree.js';

/** A text cut to `most` letters, the cut marked. */
export const cut = (text, most) => (text.length <= most ? text : `${text.slice(0, Math.max(1, most - 1))}…`);

/** Each node's place ({ x, y } about the root) and its branch's path, in the picture's units with the root at `centre`. */
export function radial(tree, z, n, measure) {
  const ring = z('reflex_ring'), sx = n('reflex_spread_x'), jitter = n('reflex_jitter');
  const leaves = new Map();
  const count = (node) => {
    const c = node.kids.length ? node.kids.reduce((s, k) => s + count(k), 0) : 1;
    leaves.set(node.id, c);
    return c;
  };
  count(tree.root);
  const polar = new Map([[tree.root.id, { a: -Math.PI / 2, r: 0 }]]);
  const share = (node, from, span) => {
    let cur = from;
    for (const kid of node.kids) {
      const s = (span * leaves.get(kid.id)) / leaves.get(node.id);
      polar.set(kid.id, { a: cur + s / 2, r: ring * (kid.depth + (hash(kid.id) - 0.5) * jitter) });
      share(kid, cur, s);
      cur += s;
    }
  };
  share(tree.root, -Math.PI / 2, Math.PI * 2);
  const xy = (p) => ({ x: Math.cos(p.a) * p.r * sx, y: Math.sin(p.a) * p.r });
  const place = new Map([...polar].map(([id, p]) => [id, xy(p)]));
  // A name is written on the first levels (reflex_name_depth), beside its node and outward, shallow and full boughs
  // first: one whose box would meet a name already written, or a node, is left to its tip. Its width counts in the
  // picture's bounds. Boxes are a line tall (reflex_name_text, times reflex_name_room).
  const gap = z('reflex_name_gap'), tall = z('reflex_name_text') * n('reflex_name_room');
  const names = new Map(), ends = [...place.values()].map((p) => [p.x, p.y]), boxes = [];
  const meets = (b) => boxes.some((o) => b[0] < o[2] && o[0] < b[2] && b[1] < o[3] && o[1] < b[3]);
  const dot = z('reflex_node');
  for (const p of place.values()) boxes.push([p.x - dot, p.y - dot, p.x + dot, p.y + dot]);
  const asked = tree.order.filter((node) => node.parent && node.title && node.depth <= n('reflex_name_depth'));
  asked.sort((a, b) => a.depth - b.depth || leaves.get(b.id) - leaves.get(a.id));
  for (const node of asked) {
    const p = polar.get(node.id), at0 = place.get(node.id);
    const text = cut(node.title, n('reflex_name_most')), right = Math.cos(p.a) >= -0.2, wide = measure(text, z('reflex_name_text'));
    const x0 = right ? at0.x + gap : at0.x - gap - wide;
    const box = [x0, at0.y - tall / 2, x0 + wide, at0.y + tall / 2];
    if (meets(box)) continue;
    boxes.push(box);
    names.set(node.id, { text, right });
    ends.push([box[0], box[1]], [box[2], box[3]]);
  }
  const xs = ends.map((e) => e[0]), ys = ends.map((e) => e[1]);
  const room = z('reflex_margin');
  const left = Math.min(...xs) - room, top = Math.min(...ys) - room;
  const width = Math.max(...xs) + room - left, height = Math.max(...ys) + room - top;
  const centre = { x: -left, y: -top };
  for (const p of place.values()) (p.x += centre.x), (p.y += centre.y);
  const pt = (a, r) => `${at(centre.x + Math.cos(a) * r * sx)} ${at(centre.y + Math.sin(a) * r)}`;
  const branch = new Map(), along = new Map();
  const steps = Math.max(1, n('reflex_curve_steps'));
  const xyOf = (a, r) => [centre.x + Math.cos(a) * r * sx, centre.y + Math.sin(a) * r];
  for (const node of tree.order) {
    if (!node.parent) continue;
    const p = polar.get(node.parent.id), c = polar.get(node.id), half = (c.r - p.r) / 2;
    const ends = [[p.a, p.r], node.parent === tree.root ? [c.a, half] : [p.a, p.r + half], [c.a, c.r - half], [c.a, c.r]];
    branch.set(node.id, `M${pt(...ends[0])} C${pt(...ends[1])} ${pt(...ends[2])} ${pt(...ends[3])}`);
    // The same curve as points, for a light to run along it.
    const [p0, p1, p2, p3] = ends.map((e) => xyOf(...e));
    along.set(node.id, Array.from({ length: steps + 1 }, (_, i) => {
      const u = i / steps, v = 1 - u, w = [v * v * v, 3 * v * v * u, 3 * v * u * u, u * u * u];
      return [0, 1].map((k) => w[0] * p0[k] + w[1] * p1[k] + w[2] * p2[k] + w[3] * p3[k]);
    }));
  }
  // How far out the tree reaches, from the root: the camera pulls back as it grows to this.
  const reach = Math.max(ring, ...[...polar.values()].map((p) => p.r));
  return { place, polar, branch, along, names, width, height, centre, reach, leaves };
}
