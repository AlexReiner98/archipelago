// Layer: metrics. Where each node of the tree stands: a radial tree about the root, each subtree given a share of the
// circle in proportion to its leaves, a ring out for each level (reflex_ring), each node a little nearer or farther
// by its id (reflex_jitter), the whole spread wider than tall (reflex_spread_x, following the frame's shape), the root
// at the centre. Each branch is an S-curve: out of the
// parent along its own direction, into the child along the child's. The same tree is placed the same each time.

import { at } from './marks.js';
import { hash } from './tree.js';

/** A text cut to `most` letters, the cut marked. */
export const cut = (text, most) => (text.length <= most ? text : `${text.slice(0, Math.max(1, most - 1))}…`);

/**
 * Each node's place ({ x, y } about the root) and its branch's path, in the picture's units, the root at the picture's
 * centre (`centre`), so the frame that fits the picture centres the tree. `aspect` is the frame's width over its height:
 * the spread wider than tall follows it by reflex_aspect_follow (0 keeps reflex_spread_x as it is).
 */
export function radial(tree, z, n, measure, aspect = 1) {
  const jitter = n('reflex_jitter');
  const sx = n('reflex_spread_x') * Math.pow(Math.max(0.1, aspect), n('reflex_aspect_follow'));
  const leaves = new Map();
  const count = (node) => {
    const c = node.kids.length ? node.kids.reduce((s, k) => s + count(k), 0) : 1;
    leaves.set(node.id, c);
    return c;
  };
  count(tree.root);
  // Every node is named, along its ray: the rings stand far enough apart that the leaves nearest the root each have a
  // line of room (a name reflex_name_text tall, times reflex_name_room), and never nearer than reflex_ring.
  const tall = z('reflex_name_text') * n('reflex_name_room');
  const nearest = Math.max(1, Math.min(...tree.order.filter((node) => node.parent && !node.kids.length).map((node) => node.depth)));
  const ring = Math.max(z('reflex_ring'), (tall * leaves.get(tree.root.id)) / (Math.PI * 2 * nearest));
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
  // Each name runs out from its node along the ray the node stands on, read left to right on either side, cut to
  // reflex_name_most letters; its far end counts in the picture's bounds.
  const gap = z('reflex_name_gap');
  const names = new Map(), ends = [...place.values()].map((p) => [p.x, p.y]);
  for (const node of tree.order) {
    if (!node.parent || !node.title) continue;
    const p = polar.get(node.id), at0 = place.get(node.id);
    const ray = Math.atan2(Math.sin(p.a), Math.cos(p.a) * sx), dx = Math.cos(ray), dy = Math.sin(ray);
    const text = cut(node.title, n('reflex_name_most')), wide = measure(text, z('reflex_name_text'));
    const right = dx >= 0;
    names.set(node.id, { text, right, x: at0.x + dx * gap, y: at0.y + dy * gap, turn: ((ray + (right ? 0 : Math.PI)) * 180) / Math.PI });
    const far = gap + wide;
    for (const side of [-1, 1]) ends.push([at0.x + dx * far - (dy * side * tall) / 2, at0.y + dy * far + (dx * side * tall) / 2]);
  }
  // The root at the middle: as far each way as the farthest thing on either side.
  const room = z('reflex_margin');
  const half = { x: Math.max(...ends.map((e) => Math.abs(e[0]))) + room, y: Math.max(...ends.map((e) => Math.abs(e[1]))) + room };
  const width = half.x * 2, height = half.y * 2;
  const centre = { x: half.x, y: half.y };
  for (const p of place.values()) (p.x += centre.x), (p.y += centre.y);
  for (const nm of names.values()) (nm.x += centre.x), (nm.y += centre.y);
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
