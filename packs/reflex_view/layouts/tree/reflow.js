// Layer: motion. The tree drawn again moves to its new shape, live, in the one picture on screen (the owner, 19 Nov
// 2026: "It should be running live"). A legend entry turned, or the map changed under the view (an item added, edited,
// retired or gone), lays the tree out again from the new answer; its marks are drawn first where the last picture of
// the same view had them (./draw.js, `was`), in that picture's frame, and then one batch of patches moves each to its
// new place over reflex_reflow ms: the page plays them (a patch's `over`), so nothing is sent per frame. A node that
// stays moves, its branch with it; the frame moves to the new one (the svg's viewBox), which fits the new tree to the
// pane; what leaves fades where it stood and is taken out; what is new is grown by the player, sparking where it was
// written (./play.js). Names do not show while the tree moves, and are chosen again once it has (./names.js).

import { at } from './marks.js';

/** The last frame and places each view drew, by its query: what it is drawn from when drawn again. */
const laid = new Map();

/** What a picture keeps of its layout to be drawn from again: its frame, each node's place and branch. */
const frameOf = (placed) => ({ place: new Map([...placed.place].map(([id, p]) => [id, { x: p.x, y: p.y }])), branch: new Map(placed.branch), width: placed.width, height: placed.height, centre: { ...placed.centre } });

/** The layout the view named `name` had last, and this one kept as the next one's: null the first time, or still. */
export function lastLaid(name, placed, still) {
  const was = still ? null : laid.get(name) ?? null;
  laid.set(name, frameOf(placed));
  return was;
}

/** The patches that move the tree from `was` to `placed` (`start`), and those that end the move (`end`). */
export function movesOf(tree, placed, was, over) {
  const root = tree.root.item ? `n:${tree.root.id}` : 'rt-root';
  const leaving = [...was.place.keys()].filter((id) => id !== tree.root.id && !tree.nodes.has(id));
  const start = [
    { key: 'rt-all', toggle: { 'rt-moving': true } },
    { key: 'rt-svg', set: { viewBox: `0 0 ${at(placed.width)} ${at(placed.height)}` }, over },
    { key: 'rt-frame', set: { width: at(placed.width), height: at(placed.height) }, over },
    { key: root, set: { cx: at(placed.centre.x), cy: at(placed.centre.y) }, over },
  ];
  for (const node of tree.order) {
    if (!node.parent || !was.place.has(node.id)) continue;
    const p = placed.place.get(node.id);
    start.push({ key: `n:${node.id}`, set: { transform: `translate(${at(p.x)} ${at(p.y)})` }, over }, { key: `b:${node.id}`, set: { d: placed.branch.get(node.id) }, over });
  }
  for (const id of leaving) start.push({ key: `n:${id}`, toggle: { 'rt-gone': true } }, { key: `b:${id}`, toggle: { 'rt-gone': true } });
  const end = [{ key: 'rt-all', toggle: { 'rt-moving': false } }, ...leaving.flatMap((id) => [{ key: `n:${id}`, remove: true }, { key: `b:${id}`, remove: true }])];
  return { start, end };
}
