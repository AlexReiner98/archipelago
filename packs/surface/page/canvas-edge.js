// The islands a canvas has on but not in sight, named at its frame's edge, each toward where it lies (the study "The
// canvas, by eye", verdicts e_amqnqtsn and round 2's): the camera opens readable on the islands that fit
// (packs/walls/page/pan-zoom.js openOn), and what it leaves out is never lost off an edge. The names stand in a band of
// the sea along the edge the line from the room's middle to each island's middle meets, in the order the islands are
// read, plain words and an arrow toward them; the band has the sea's ground and its line, as the bars do, so no name is
// ever drawn over an island's land. A press brings that island into sight, as the side bar's does. Drawn again as the
// view moves, once a frame; the camera asks the bands' room first, so it opens beside them (`now`).

/** An element of the page: its tag, its attributes, its children (a press for `onclick`). Imports nothing, so the pure part is tried without a page. */
function h(tag, attrs, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) k === 'onclick' ? el.addEventListener('click', v) : el.setAttribute(k, v);
  el.append(...kids);
  return el;
}

/** The arrow toward an edge, by [across, down]. */
const ARROWS = { '-1,0': '←', '1,0': '→', '0,-1': '↑', '0,1': '↓' };
/** Each edge's band by [across, down], as its class says it (shell.css). */
const BANDS = { '-1,0': 'left', '1,0': 'right', '0,-1': 'top', '0,1': 'foot' };

/**
 * Which islands are out of sight, in the room [left, top, width, height] of a frame seen from `v` { x, y, s }: `boxes`
 * its islands [id, [l, t, r, b]] in the picture's units, in reading order. Answers [id, side [across, down]] for each
 * wholly out of the room, in that order: the side is the edge the line from the room's middle to the island's meets.
 */
export function outOfSight(boxes, [rl, rt, rw, rh], v) {
  const cx = rl + rw / 2, cy = rt + rh / 2;
  const out = [];
  for (const [id, [l, t, r, b]] of boxes) {
    const sl = (l - v.x) * v.s, st = (t - v.y) * v.s, sr = (r - v.x) * v.s, sb = (b - v.y) * v.s;
    // Any of it in the room is in sight: a cut island is seen where it is, and named only once wholly out.
    if (sr > rl && sl < rl + rw && sb > rt && st < rt + rh) continue;
    const mx = (sl + sr) / 2 - cx, my = (st + sb) / 2 - cy;
    // Scaled to the room's half sizes, the larger way is the edge the line meets.
    const ax = Math.abs(mx) / (rw / 2), ay = Math.abs(my) / (rh / 2);
    out.push([id, ax >= ay ? [Math.sign(mx) || 1, 0] : [0, Math.sign(my)]]);
  }
  return out;
}

/**
 * Keep the names of a canvas's islands out of sight over its stage: `islands()` answers [id, title, box] in reading
 * order, `room()` the room the camera fits in, `go(id)` brings one into sight. Answers `stop`, and `now()`, which
 * draws them at once and answers the room their bands take [right, foot] (what the camera keeps clear as it opens).
 */
export function edgeNames(stage, moves, { islands, room, go }) {
  const layer = h('div', { class: 'lf-edge-names' });
  stage.append(layer);
  let queued = 0;
  const draw = () => {
    queued = 0;
    const list = islands(), titles = new Map(list.map(([id, title]) => [id, title]));
    const [rl, rt, rw, rh] = room();
    const out = outOfSight(list.map(([id, , box]) => [id, box]), [rl, rt, rw, rh], moves.state());
    const bands = new Map();
    for (const [id, side] of out) {
      const key = `${side}`, arrow = h('span', { class: 'lf-edge-arrow' }, ARROWS[key]), word = h('span', { class: 'lf-edge-word' }, titles.get(id));
      // The arrow is never cut, only the name; it stands on the side the island lies.
      const name = h('button', { type: 'button', class: 'lf-edge-name', title: `${titles.get(id)}: bring it into sight`, 'data-item': id, onclick: () => go(id) }, ...(side[0] < 0 || side[1] < 0 ? [arrow, word] : [word, arrow]));
      if (!bands.has(key)) bands.set(key, h('div', { class: `lf-edge-band lf-edge-${BANDS[key]}` }));
      bands.get(key).append(name);
    }
    // Each band along its edge of the room: its own size is its class's, its place the room's.
    for (const [key, band] of bands) {
      const [sx, sy] = key.split(',').map(Number);
      Object.assign(band.style, sx ? { top: `${rt}px`, height: `${rh}px`, left: `${sx > 0 ? rl + rw : rl}px` } : { left: `${rl}px`, width: `${rw}px`, top: `${sy > 0 ? rt + rh : rt}px` });
    }
    layer.replaceChildren(...bands.values());
    const size = (key, way) => bands.get(key)?.[way] ?? 0;
    return [size('1,0', 'offsetWidth'), size('0,1', 'offsetHeight')];
  };
  const soon = () => (queued ||= requestAnimationFrame(draw));
  const unwatch = moves.watch(soon);
  soon();
  const now = () => (cancelAnimationFrame(queued), draw());
  return { stop: () => (cancelAnimationFrame(queued), unwatch(), layer.remove()), now };
}
