// Layer: motion. The tree drawn again moves to its new shape, live, in the one picture on screen (the owner, 19 Nov
// 2026: "It should be running live"). A legend entry turned, or the map changed under the view (an item added, edited,
// retired or gone), lays the tree out again from the new answer; its marks are drawn first where the last picture of
// the same view showed them (./draw.js, `was`), and then one batch of patches moves each to its new place over
// reflex_reflow ms: the page plays them (a patch's `over`), so nothing is sent per frame. A node that stays moves, its
// branch with it; what leaves fades where it stood and is taken out; what is new is grown by the player, sparking
// where it was written (./play.js). Names do not show while the tree moves, and are chosen again once it has
// (./names.js). The camera is the page's (it moves the svg's viewBox): the tree fits itself to the pane by its frame,
// and drawn again in place, by a group that fits the new frame into the box the picture was mounted in (`fit`).

import { at } from './marks.js';

/** The last layout each view drew, by its query, as it was shown: what it is drawn from when drawn again. */
const laid = new Map();

/** How many of the pane's units a unit of the picture takes: the page fits its box to the pane, the fit its frame to the box. */
export const shownScale = (placed, box, pane, fit) => {
  const w = box?.width > 0 ? box.width : placed.width, h = box?.height > 0 ? box.height : placed.height;
  return (pane?.width > 0 && pane?.height > 0 ? Math.min(pane.width / w, pane.height / h) : 1) * fit;
};

/** The transform that fits a frame into the box the picture was mounted in, about their centres. */
export const fitOf = (placed, box, fit) => `translate(${at(box.width / 2)} ${at(box.height / 2)}) scale(${Math.round(fit * 10000) / 10000}) translate(${at(-placed.centre.x)} ${at(-placed.centre.y)})`;

/**
 * The layout the view named `name` showed last, put into this one's frame so it is drawn where it was seen: each
 * node's place and branch ({ place, branch }), or null the first time or under less motion. This one is kept as the
 * next one's, with `scale` (shownScale) to put it in the next frame.
 */
export function lastLaid(name, placed, still, scale) {
  const was = still ? null : laid.get(name) ?? null;
  laid.set(name, { place: new Map([...placed.place].map(([id, p]) => [id, { x: p.x, y: p.y }])), branch: new Map(placed.branch), scale, centre: { ...placed.centre } });
  if (!was) return null;
  const r = was.scale / scale, c = placed.centre;
  const to = (x, y) => ({ x: c.x + r * (x - was.centre.x), y: c.y + r * (y - was.centre.y) });
  const path = (d) => d.replace(/(-?\d*\.?\d+) (-?\d*\.?\d+)/g, (_, x, y) => ((p) => `${at(p.x)} ${at(p.y)}`)(to(+x, +y)));
  return { place: new Map([...was.place].map(([id, p]) => [id, to(p.x, p.y)])), branch: new Map([...was.branch].map(([id, d]) => [id, path(d)])) };
}

/** The patches that move the tree from `was` to `placed` (`start`), and those that end the move (`end`). */
export function movesOf(tree, placed, was, over) {
  const leaving = [...was.place.keys()].filter((id) => id !== tree.root.id && !tree.nodes.has(id));
  const start = [{ key: 'rt-all', toggle: { 'rt-moving': true } }];
  for (const node of tree.order) {
    if (!node.parent || !was.place.has(node.id)) continue;
    const p = placed.place.get(node.id);
    start.push({ key: `n:${node.id}`, set: { transform: `translate(${at(p.x)} ${at(p.y)})` }, over }, { key: `b:${node.id}`, set: { d: placed.branch.get(node.id) }, over });
  }
  for (const id of leaving) start.push({ key: `n:${id}`, toggle: { 'rt-gone': true } }, { key: `b:${id}`, toggle: { 'rt-gone': true } });
  const end = [{ key: 'rt-all', toggle: { 'rt-moving': false } }, ...leaving.flatMap((id) => [{ key: `n:${id}`, remove: true }, { key: `b:${id}`, remove: true }])];
  return { start, end };
}
