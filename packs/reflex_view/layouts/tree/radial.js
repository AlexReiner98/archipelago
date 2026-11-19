// Layer: metrics. Where each node of the tree stands: a radial tree about the root, every node on a ray of its own in
// the tree's order, a ring out for each level, the whole spread wider than tall (reflex_spread_x, following the
// frame's shape), the root at the centre, and every name along its ray where it meets no other name and no wire. Each
// branch leaves its parent toward the child's ray and comes into the child along it. The same tree is placed the same
// each time.

import { at } from './marks.js';

/** A text cut to `most` letters, the cut marked. */
export const cut = (text, most) => (text.length <= most ? text : `${text.slice(0, Math.max(1, most - 1))}…`);

/**
 * Each node's place ({ x, y } about the root) and its branch's path, in the picture's units, the root at the picture's
 * centre (`centre`), so the frame that fits the picture centres the tree. `aspect` is the frame's width over its height:
 * the spread wider than tall follows it by reflex_aspect_follow (0 keeps reflex_spread_x as it is).
 */
export function radial(tree, z, n, measure, aspect = 1) {
  const sx = n('reflex_spread_x') * Math.pow(Math.max(0.1, aspect), n('reflex_aspect_follow'));
  const leaves = new Map();
  const count = (node) => {
    const c = node.kids.length ? node.kids.reduce((s, k) => s + count(k), 0) : 1;
    leaves.set(node.id, c);
    return c;
  };
  count(tree.root);
  // Every node but the root has its own slot of the circle, in the tree's order (a bough, then what grows from it),
  // so no two names share a ray. The first ring stands where one slot holds a name reflex_name_room names tall; each
  // ring after it reflex_ring further out. A wider ring only parts the names more.
  const named = tree.order.filter((node) => node.parent);
  const slot = (Math.PI * 2) / Math.max(1, named.length), tall = z('reflex_name_text');
  const ring = z('reflex_ring'), first = Math.max(ring, (tall * n('reflex_name_room')) / slot);
  const polar = new Map([[tree.root.id, { a: -Math.PI / 2, r: 0 }]]);
  named.forEach((node, i) => polar.set(node.id, { a: -Math.PI / 2 + (i + 0.5) * slot, r: first + (node.depth - 1) * ring }));
  const xy = (p) => ({ x: Math.cos(p.a) * p.r * sx, y: Math.sin(p.a) * p.r });
  const place = new Map([...polar].map(([id, p]) => [id, xy(p)]));
  // Each name lies along its node's ray, outward, read left to right on either side, cut to reflex_name_most
  // letters. A bough's is lifted off its ray (reflex_name_lift names) to the side away from what grows from it, whose
  // wires leave toward their own rays. `box` is the name's four corners; its far end counts in the picture's bounds.
  const gap = z('reflex_name_gap');
  const names = new Map(), ends = [...place.values()].map((p) => [p.x, p.y]);
  for (const node of named) {
    if (!node.title) continue;
    const p = polar.get(node.id), at0 = place.get(node.id);
    const ray = Math.atan2(Math.sin(p.a), Math.cos(p.a) * sx), dx = Math.cos(ray), dy = Math.sin(ray);
    const text = cut(node.title, n('reflex_name_most')), wide = measure(text, tall);
    const right = dx >= 0, lift = node.kids.length ? tall * n('reflex_name_lift') : 0;
    // Off the ray toward the slots before it: (dy, -dx) turns the ray back a quarter.
    const x = at0.x + dx * gap + dy * lift, y = at0.y + dy * gap - dx * lift;
    const corner = (along, side) => [x + dx * along - dy * side, y + dy * along + dx * side];
    const box = [corner(0, -tall / 2), corner(wide, -tall / 2), corner(wide, tall / 2), corner(0, tall / 2)];
    names.set(node.id, { text, right, x, y, box, turn: ((ray + (right ? 0 : Math.PI)) * 180) / Math.PI });
    ends.push(...box);
  }
  // The root at the middle: as far each way as the farthest thing on either side.
  const room = z('reflex_margin');
  const half = { x: Math.max(...ends.map((e) => Math.abs(e[0]))) + room, y: Math.max(...ends.map((e) => Math.abs(e[1]))) + room };
  const width = half.x * 2, height = half.y * 2;
  const centre = { x: half.x, y: half.y };
  for (const p of place.values()) (p.x += centre.x), (p.y += centre.y);
  for (const nm of names.values()) (nm.x += centre.x), (nm.y += centre.y), nm.box.forEach((c) => ((c[0] += centre.x), (c[1] += centre.y)));
  const pt = (a, r) => `${at(centre.x + Math.cos(a) * r * sx)} ${at(centre.y + Math.sin(a) * r)}`;
  const branch = new Map(), along = new Map();
  const steps = Math.max(1, n('reflex_curve_steps'));
  const xyOf = (a, r) => [centre.x + Math.cos(a) * r * sx, centre.y + Math.sin(a) * r];
  for (const node of tree.order) {
    if (!node.parent) continue;
    const p = polar.get(node.parent.id), c = polar.get(node.id), half = (c.r - p.r) / 2;
    // It leaves its parent toward its own ray and comes into the child along it, so it never runs along a name.
    const ends = [[p.a, p.r], [c.a, p.r + half], [c.a, c.r - half], [c.a, c.r]];
    branch.set(node.id, `M${pt(...ends[0])} C${pt(...ends[1])} ${pt(...ends[2])} ${pt(...ends[3])}`);
    // The same curve as points, for a light to run along it.
    const [p0, p1, p2, p3] = ends.map((e) => xyOf(...e));
    along.set(node.id, Array.from({ length: steps + 1 }, (_, i) => {
      const u = i / steps, v = 1 - u, w = [v * v * v, 3 * v * v * u, 3 * v * u * u, u * u * u];
      return [0, 1].map((k) => w[0] * p0[k] + w[1] * p1[k] + w[2] * p2[k] + w[3] * p3[k]);
    }));
  }
  // How far out the tree reaches, from the root: the camera pulls back as it grows to this.
  const reach = Math.max(first, ...[...polar.values()].map((p) => p.r));
  return { place, polar, branch, along, names, width, height, centre, reach, leaves };
}
