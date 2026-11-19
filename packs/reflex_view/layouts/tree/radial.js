// Layer: metrics. Where each node of the tree stands: a radial tree about the root, each subtree given a share of the
// circle in proportion to its leaves, a ring out for each level (reflex_ring), the whole spread wider than tall
// (reflex_spread_x, following the frame's shape), the root at the centre, and every node's name laid out along its
// ray. Each branch is an S-curve: out of the parent along its own direction, into the child along the child's. The
// same tree is placed the same each time.

import { at } from './marks.js';

/**
 * A name's four corners at `f` times its size (the page's zoom keeps names one size on screen), `pad` round it: along
 * its ray from its node, outward or inward, its middle `lift` off the ray toward the slots before it.
 */
export const boxOf = (l, f, pad) => {
  const from = l.out > 0 ? l.gap * f : -(l.gap + l.wide) * f, to = l.out > 0 ? (l.gap + l.wide) * f : -l.gap * f;
  const mid = l.lift * f, half = (l.tall * f) / 2 + pad;
  // (dy, -dx) is the ray turned back a quarter.
  const at = (along, side) => [l.x + l.dx * along + l.dy * side, l.y + l.dy * along - l.dx * side];
  return [at(from - pad, mid - half), at(to + pad, mid - half), at(to + pad, mid + half), at(from - pad, mid + half)];
};

/** A text cut to `most` letters, the cut marked. */
export const cut = (text, most) => (text.length <= most ? text : `${text.slice(0, Math.max(1, most - 1))}…`);

/**
 * Each node's place ({ x, y } about the root) and its branch's path, in the picture's units, the root at the picture's
 * centre (`centre`), so the frame that fits the picture centres the tree. `aspect` is the frame's width over its height:
 * the spread wider than tall follows it by reflex_aspect_follow (0 keeps reflex_spread_x as it is).
 */
export function radial(tree, z, n, measure, aspect = 1, room = null) {
  // Given the room it is shown in (in the picture's units), the rings close up until the grown tree, its names with
  // it, fits there; never below reflex_ring_least, never past reflex_ring. Names are a fixed length, so it takes a few
  // tries to close in.
  const least = z('reflex_ring_least');
  let ring = z('reflex_ring'), laid = layOut(tree, z, n, measure, aspect, ring);
  const fits = (l) => !room || (l.width <= room.width && l.height <= room.height);
  // Its size grows about in line with its rings: each try solves for the ring that fits from the last two.
  let before = null;
  for (let k = 0; !fits(laid) && ring > least && k < n('reflex_fit_tries'); k++) {
    const by = Math.min(room.width / laid.width, room.height / laid.height);
    let next = ring * by;
    if (before && before.ring !== ring) {
      const solve = (size, target) => {
        const slope = (size(laid) - size(before.laid)) / (ring - before.ring);
        return slope > 0 ? ring + (target - size(laid)) / slope : next;
      };
      next = Math.min(solve((l) => l.width, room.width), solve((l) => l.height, room.height)) * n('reflex_fit_inside');
    }
    before = { ring, laid };
    ring = Math.max(least, Math.min(ring * n('reflex_fit_inside'), next));
    laid = layOut(tree, z, n, measure, aspect, ring);
  }
  return laid;
}

function layOut(tree, z, n, measure, aspect, ring) {
  const sx = n('reflex_spread_x') * Math.pow(Math.max(0.1, aspect), n('reflex_aspect_follow'));
  const leaves = new Map();
  const count = (node) => {
    const c = node.kids.length ? node.kids.reduce((s, k) => s + count(k), 0) : 1;
    leaves.set(node.id, c);
    return c;
  };
  count(tree.root);
  // Each subtree its share of the circle by its leaves, each node in the middle of its share, a ring out a level.
  const polar = new Map([[tree.root.id, { a: -Math.PI / 2, r: 0 }]]);
  const share = (node, from, span) => {
    let cur = from;
    for (const kid of node.kids) {
      const s = (span * leaves.get(kid.id)) / leaves.get(node.id);
      polar.set(kid.id, { a: cur + s / 2, r: ring * kid.depth });
      share(kid, cur, s);
      cur += s;
    }
  };
  share(tree.root, -Math.PI / 2, Math.PI * 2);
  const xy = (p) => ({ x: Math.cos(p.a) * p.r * sx, y: Math.sin(p.a) * p.r });
  const place = new Map([...polar].map(([id, p]) => [id, xy(p)]));
  // Every node's name, laid out along its ray at full size: a leaf's outward, a bough's inward along the branch it
  // grows on and lifted beside it (reflex_name_lift names). Which of them show is ./names.js's. Each name's far end
  // at full size counts in the picture's bounds.
  const gap = z('reflex_name_gap'), tall = z('reflex_name_text');
  const labels = new Map(), ends = [...place.values()].map((p) => [p.x, p.y]);
  for (const node of tree.order) {
    if (!node.parent || !node.title) continue;
    const p = polar.get(node.id), at0 = place.get(node.id);
    const ray = Math.atan2(Math.sin(p.a), Math.cos(p.a) * sx), dx = Math.cos(ray), dy = Math.sin(ray);
    const text = cut(node.title, n('reflex_name_most')), wide = measure(text, tall);
    const out = node.kids.length ? -1 : 1, lift = out > 0 ? 0 : tall * n('reflex_name_lift');
    const label = { id: node.id, text, x: at0.x, y: at0.y, dx, dy, wide, out, lift, gap, tall, right: dx >= 0, turn: ((ray + (dx >= 0 ? 0 : Math.PI)) * 180) / Math.PI };
    labels.set(node.id, label);
    ends.push(...boxOf(label, 1, 0));
  }
  // The root at the middle: as far each way as the farthest thing on either side.
  const room = z('reflex_margin');
  const half = { x: Math.max(...ends.map((e) => Math.abs(e[0]))) + room, y: Math.max(...ends.map((e) => Math.abs(e[1]))) + room };
  const width = half.x * 2, height = half.y * 2;
  const centre = { x: half.x, y: half.y };
  for (const p of place.values()) (p.x += centre.x), (p.y += centre.y);
  for (const l of labels.values()) (l.x += centre.x), (l.y += centre.y);
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
  return { place, polar, branch, along, labels, width, height, centre, reach, leaves };
}
