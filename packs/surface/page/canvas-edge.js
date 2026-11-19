// The islands a canvas has on but not in sight, named at its frame's edge, each toward where it lies (the study "The
// canvas, by eye", verdicts e_amqnqtsn and round 2's): the camera opens readable on the islands that fit
// (packs/walls/page/pan-zoom.js openOn), and what it leaves out is never lost off an edge. The names stand in a band of
// the sea along the edge the line from the room's middle to each island's middle meets, in the order the islands are
// read, plain words and an arrow toward them, each island named once: across the top or foot a band on the sea's ground
// with its line, as the bars have; at a side one label as narrow as its words, hugging that edge on a gap of sea, never
// on an island's shore, else in the foot's band. A press brings that island into sight, as the side bar's does. Drawn again as the
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
 * its islands [id, [l, t, r, b]] in the picture's units, in reading order. Answers [id, side [across, down], cut] in
 * that order: for each wholly out of the room, the edge the line from the room's middle to the island's meets; for each
 * in sight but cut by the room's edge, the one edge it runs furthest past (`cut`), so nobody reads the cut as the island's end.
 */
export function outOfSight(boxes, [rl, rt, rw, rh], v) {
  const cx = rl + rw / 2, cy = rt + rh / 2;
  const out = [];
  for (const [id, [l, t, r, b]] of boxes) {
    const sl = (l - v.x) * v.s, st = (t - v.y) * v.s, sr = (r - v.x) * v.s, sb = (b - v.y) * v.s;
    // In sight, it is named once, on the edge it runs furthest past for its size: it goes on there (round 3's answer on
    // verdict e_uxs5858p; named once since round 2 of "The canvas, by eye"). The foot first where two are even.
    if (sr > rl && sl < rl + rw && sb > rt && st < rt + rh) {
      const w = Math.max(1, sr - sl), hh = Math.max(1, sb - st);
      const past = [[(sb - rt - rh) / hh, [0, 1]], [(sr - rl - rw) / w, [1, 0]], [(rl - sl) / w, [-1, 0]], [(rt - st) / hh, [0, -1]]];
      const [most, side] = past.reduce((a, b) => (b[0] > a[0] ? b : a));
      if (most > 0) out.push([id, side, true]);
      continue;
    }
    const mx = (sl + sr) / 2 - cx, my = (st + sb) / 2 - cy;
    // Scaled to the room's half sizes, the larger way is the edge the line meets.
    const ax = Math.abs(mx) / (rw / 2), ay = Math.abs(my) / (rh / 2);
    out.push([id, ax >= ay ? [Math.sign(mx) || 1, 0] : [0, Math.sign(my)], false]);
  }
  return out;
}

/**
 * Keep the names of a canvas's islands out of sight over its stage: `islands()` answers [id, title, box] in reading
 * order, `room()` the room the camera fits in, `go(id)` brings one into sight. Answers `stop`, and `now()`, which
 * draws them at once and answers the room their bands take [right, foot] (what the camera keeps clear as it opens).
 */
export function edgeNames(stage, moves, { islands, room: room_, go }) {
  const layer = h('div', { class: 'lf-edge-names' });
  stage.append(layer);
  let queued = 0;
  // What the last draw made: which island is named in which band, the room, and what it measured. A frame that names
  // the same islands in the same bands only moves the side bands: it adds nothing to the page, since an element added
  // there has the page's style worked out again (a `:has()` rule can hang on it), and reads nothing, since what it
  // would read is what it measured then.
  let kept = null;
  /** Where a side's band of `bw` by `bh` stands down its edge, naming `ids`, above a foot band `footH` tall: undefined where no sea is left. */
  const standAt = (key, bw, bh, footH, ids, list, land, v, [rl, rt, rw, rh]) => {
    const [sx] = key.split(',').map(Number);
    const x0 = sx > 0 ? rl + rw - bw : rl, x1 = x0 + bw, low = rt, high = rt + rh - footH - bh;
    const shore = land.filter(([l, , r]) => r > x0 && l < x1);
    const clear = (y) => y >= low && y <= high && shore.every(([, t, , b]) => b <= y || t >= y + bh);
    // Where they would stand: level with the middle of what they name, else the nearest gap of sea along that edge.
    const named = ids.map((id) => list.find(([i]) => i === id)?.[2]).filter(Boolean);
    const want = named.length ? named.reduce((a, [, t, , b]) => a + ((t + b) / 2 - v.y) * v.s, 0) / named.length - bh / 2 : low;
    return [low, Math.min(Math.max(want, low), high), ...shore.flatMap(([, t, , b]) => [b, t - bh])].filter(clear).sort((a, b) => Math.abs(a - want) - Math.abs(b - want))[0];
  };
  const draw = () => {
    queued = 0;
    const list = islands(), titles = new Map(list.map(([id, title]) => [id, title]));
    const room = room_(), [rl, rt, rw, rh] = room;
    const out = outOfSight(list.map(([id, , box]) => [id, box]), [rl, rt, rw, rh], moves.state());
    // The land in sight, on screen: a side's names stand on the sea beside it, never on its shore.
    const v = moves.state(), land = list.map(([, , [l, t, r, b]]) => [(l - v.x) * v.s, (t - v.y) * v.s, (r - v.x) * v.s, (b - v.y) * v.s]);
    const shape = JSON.stringify([room, out.map(([id, side, cut]) => [id, titles.get(id), side, cut])]);
    if (kept?.shape === shape && layer.isConnected) {
      const at = kept.sides.map((s) => standAt(s.key, s.bw, s.bh, s.footH, s.ids, list, land, v, room));
      // The same bands, each where it stands now; one that would fold into the foot's band now, or come out of it, is made again.
      if (kept.sides.every((s, n) => (at[n] === undefined) === s.folded)) {
        kept.sides.forEach((s, n) => !s.folded && (s.band.style.cssText = `top:${at[n]}px;left:${s.key.startsWith('1') ? rl + rw : rl}px`));
        return kept.answer;
      }
    }
    const bands = new Map();
    for (const [id, side, cut] of out) {
      const key = `${side}`, arrow = h('span', { class: 'lf-edge-arrow' }, ARROWS[key]), word = h('span', { class: 'lf-edge-word' }, titles.get(id));
      // The arrow is never cut, only the name; it stands on the side the island lies.
      const name = h('button', { type: 'button', class: 'lf-edge-name', title: cut ? `${titles.get(id)} goes on this way` : `${titles.get(id)}: bring it into sight`, 'data-item': id, onclick: () => go(id) }, ...(side[0] < 0 || side[1] < 0 ? [arrow, word] : [word, arrow]));
      if (!bands.has(key)) bands.set(key, h('div', { class: `lf-edge-band lf-edge-${BANDS[key]}` }));
      bands.get(key).append(name);
    }
    layer.replaceChildren(...bands.values());
    for (const key of ['0,1', '0,-1']) if (bands.has(key)) bands.get(key).style.cssText = `left:${rl}px;width:${rw}px;top:${key === '0,1' ? rt + rh : rt}px`;
    const foot = () => bands.get('0,1')?.offsetHeight ?? 0;
    const sides = [];
    for (const key of ['1,0', '-1,0']) {
      const band = bands.get(key);
      if (!band) continue;
      const bw = band.offsetWidth, bh = band.offsetHeight, footH = foot(), ids = [...band.children].map((el) => el.dataset.item);
      const at = standAt(key, bw, bh, footH, ids, list, land, v, room);
      sides.push({ key, band, bw, bh, footH, ids, folded: at === undefined });
      if (at !== undefined) {
        band.style.cssText = `top:${at}px;left:${key.startsWith('1') ? rl + rw : rl}px`;
        continue;
      }
      // No sea at that edge: its names go in the foot's band, each with its arrow toward where it lies.
      if (!bands.has('0,1')) layer.append(bands.set('0,1', h('div', { class: 'lf-edge-band lf-edge-foot', style: `left:${rl}px;width:${rw}px;top:${rt + rh}px` })).get('0,1'));
      bands.get('0,1').append(...band.children);
      band.remove();
      bands.delete(key);
    }
    layer.replaceChildren(...bands.values());
    const size = (key, way) => bands.get(key)?.[way] ?? 0;
    // Only the foot's band is kept clear as the camera opens: a side's names stand on a gap of sea the land leaves.
    const answer = [0, size('0,1', 'offsetHeight')];
    kept = { shape, sides, answer };
    return answer;
  };
  const soon = () => (queued ||= requestAnimationFrame(draw));
  const unwatch = moves.watch(soon);
  soon();
  const now = () => (cancelAnimationFrame(queued), draw());
  return { stop: () => (cancelAnimationFrame(queued), unwatch(), layer.remove()), now };
}
