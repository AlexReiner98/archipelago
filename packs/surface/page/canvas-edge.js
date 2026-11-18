// The islands a canvas has on but not in sight, named at its frame's edge, each toward where it lies (the study "The
// canvas, by eye", verdict e_amqnqtsn): the camera opens readable on the islands that fit (packs/walls/page/pan-zoom.js
// openOn), and what it leaves out is never lost off an edge. A name stands on the edge the line from the room's middle
// to the island's middle meets, level with the island's top or left, an arrow on its side toward the island; names on
// one edge never cover each other. A press brings that island into sight, as the side bar's does. Drawn again as the view moves, once a frame.

/** An element of the page: its tag, its attributes, its children (a press for `onclick`). Imports nothing, so the pure part is tried without a page. */
function h(tag, attrs, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) k === 'onclick' ? el.addEventListener('click', v) : el.setAttribute(k, v);
  el.append(...kids);
  return el;
}

/** The arrow toward an edge, by [across, down]. */
const ARROWS = { '-1,0': '←', '1,0': '→', '0,-1': '↑', '0,1': '↓' };

/**
 * Where each island out of sight is named, in the room [left, top, width, height] of a frame seen from `v` { x, y, s }:
 * `boxes` its islands [id, [l, t, r, b]] in the picture's units. Answers [id, side [across, down], point [x, y]] for each
 * wholly out of the room, its point on that edge (level with the island's top or left), in the frame's pixels.
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
    const ax = Math.abs(mx) / (rw / 2), ay = Math.abs(my) / (rh / 2), far = Math.max(ax, ay) || 1;
    const side = ax >= ay ? [Math.sign(mx) || 1, 0] : [0, Math.sign(my)];
    // On that edge, level with the island's top (a side edge) or its left (the top or foot), so a row reads in order.
    out.push([id, side, side[0] ? [cx + mx / far, st] : [sl, cy + my / far]]);
  }
  return out;
}

/**
 * Keep the names of `canvas`'s islands out of sight over its stage: `islands()` answers [id, title, box] in reading
 * order, `room()` the room the camera fits in, `go(id)` brings one into sight. Answers how to stop.
 */
export function edgeNames(stage, moves, { islands, room, go }) {
  const layer = h('div', { class: 'lf-edge-names' });
  stage.append(layer);
  let queued = 0;
  const draw = () => {
    queued = 0;
    const list = islands(), titles = new Map(list.map(([id, title]) => [id, title]));
    const [rl, rt, rw, rh] = room(), v = moves.state();
    const out = outOfSight(list.map(([id, , box]) => [id, box]), [rl, rt, rw, rh], v);
    layer.replaceChildren(
      ...out.map(([id, [sx, sy]]) => {
        const arrow = ARROWS[`${sx},${sy}`] ?? '→';
        // The arrow is never cut: only the name is, where it does not fit.
        const name = h('span', { class: 'lf-edge-word' }, titles.get(id)), mark = h('span', { class: 'lf-edge-arrow' }, arrow);
        const words = sx < 0 || (sx === 0 && sy < 0) ? [mark, name] : [name, mark];
        return h('button', { type: 'button', class: 'lf-edge-name', title: `${titles.get(id)}: bring it into sight`, 'data-item': id, onclick: () => go(id) }, ...words);
      }),
    );
    // Each name inside the room, at its point, kept off the edge by its own margin; on one edge, in order along it, each
    // past the one before, so none covers another.
    const placed = [...layer.children].map((el, k) => {
      const [, [sx, sy], [px, py]] = out[k];
      const m = parseFloat(getComputedStyle(el).marginTop) || 0, w = el.offsetWidth, ht = el.offsetHeight;
      const x = sx > 0 ? px - w - m : px + m, y = sy > 0 ? py - ht - m : py + m;
      return { el, m, w, ht, along: sx !== 0, edge: `${sx},${sy}`, x: Math.min(Math.max(x, rl + m), rl + rw - w - m), y: Math.min(Math.max(y, rt + m), rt + rh - ht - m) };
    });
    for (const edge of new Set(placed.map((p) => p.edge))) {
      const on = placed.filter((p) => p.edge === edge), key = on[0].along ? 'y' : 'x', size = on[0].along ? 'ht' : 'w';
      on.sort((a, b) => a[key] - b[key]).forEach((p, k) => k && (p[key] = Math.max(p[key], on[k - 1][key] + on[k - 1][size])));
    }
    // Its margin already stands it in from its corner: the place is said without it.
    for (const p of placed) p.el.style.transform = `translate(${p.x - p.m}px, ${p.y - p.m}px)`;
  };
  const soon = () => (queued ||= requestAnimationFrame(draw));
  const unwatch = moves.watch(soon);
  soon();
  return () => (cancelAnimationFrame(queued), unwatch(), layer.remove());
}
