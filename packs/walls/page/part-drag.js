// A mark the person drags (`drag` on a box, a button or a pane: packs/walls/page/part-check.js): the host follows the
// pointer, shows where it would land, and tells the part `drop { onto, zone }` once it is let go. Over a pane's side it
// would dock on that side of it, over its middle in its place (`left right above below center`, onto the pane's key);
// over another dragged mark (a tab) or a box that docks (`dock`, the strip of tabs), into the tabs (onto the tab's key,
// or nothing); off the page, `out`. Moved less than a few pixels, it was a press, and the press goes on as one.

/** Which side of a box a point is nearest, or its middle: the third of it round its centre. */
export function zoneOf(box, x, y) {
  const fx = (x - box.left) / box.width, fy = (y - box.top) / box.height;
  if (Math.abs(fx - 0.5) < 1 / 6 && Math.abs(fy - 0.5) < 1 / 6) return 'center';
  const near = { left: fx, right: 1 - fx, above: fy, below: 1 - fy };
  return Object.entries(near).sort((a, b) => a[1] - b[1])[0][0];
}

/** The part of a box a zone covers, as the overlay draws it. */
export function zoneBox(box, zone) {
  const half = { left: [0, 0, 0.5, 1], right: [0.5, 0, 0.5, 1], above: [0, 0, 1, 0.5], below: [0, 0.5, 1, 0.5] }[zone] ?? [0, 0, 1, 1];
  return { left: box.left + half[0] * box.width, top: box.top + half[1] * box.height, width: half[2] * box.width, height: half[3] * box.height };
}

/** Where a drag of `el` would land at this point: { onto, zone, box } or nothing. */
export function landing(el, x, y) {
  if (x < 0 || y < 0 || x > innerWidth || y > innerHeight) return { onto: null, zone: 'out' };
  const under = document.elementFromPoint(x, y);
  const tab = under?.closest('[data-drag]:not(.pm-pane)');
  if (tab && tab !== el && !el.contains(tab)) return { onto: tab.dataset.key ?? null, zone: 'tabs', box: tab.getBoundingClientRect() };
  const dock = under?.closest('[data-dock]');
  if (dock) return { onto: null, zone: 'tabs', box: dock.getBoundingClientRect() };
  const pane = under?.closest('.pm-pane');
  if (pane && pane !== el && !pane.contains(el)) {
    const box = pane.getBoundingClientRect();
    const zone = zoneOf(box, x, y);
    return { onto: pane.dataset.key ?? null, zone, box: zoneBox(box, zone) };
  }
  return null;
}

/** The overlay that says where a mark let go now would land: one for the page. */
let shown = null;
const overlay = () => (shown ??= document.body.appendChild(Object.assign(document.createElement('div'), { className: 'pm-zone', hidden: true })));

/** Follow presses on `el` (drawn from a mark with `drag`), telling the part `drop` by the key of the mark it is drawn from now (`keyOf()`). */
export function draggable(el, keyOf, tell) {
  // The click that ends a drag is not a press.
  let dragged = false;
  el.addEventListener('click', (c) => dragged && (c.stopPropagation(), c.preventDefault()), true);
  el.addEventListener('pointerdown', (ev) => {
    if (ev.button !== 0 || !el.dataset.drag) return;
    // A press in a field or on a control inside a pane is that control's, not a drag of the pane.
    if (el.classList.contains('pm-pane') && !ev.target.closest?.('.pm-pane-strip')) return;
    if (ev.target.closest?.('input, textarea, select')) return;
    const start = [ev.clientX, ev.clientY];
    const id = ev.pointerId;
    let moved = false, at = null;
    el.setPointerCapture?.(id);
    const move = (e) => {
      if (e.pointerId !== id) return;
      if (!moved && Math.hypot(e.clientX - start[0], e.clientY - start[1]) < 4) return; // A few pixels of the screen: less was a press, as ui/pane-drag.js had it.
      if (!moved) document.body.dataset.dragging = el.dataset.drag;
      moved = true;
      at = landing(el, e.clientX, e.clientY);
      const z = overlay();
      z.hidden = !at?.box;
      z.dataset.zone = at?.zone ?? '';
      if (at?.box) for (const k of ['left', 'top', 'width', 'height']) z.style[k] = `${at.box[k]}px`;
    };
    const up = (e) => {
      if (e.pointerId !== id) return;
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerup', up);
      el.removeEventListener('pointercancel', up);
      if (!moved) return;
      delete document.body.dataset.dragging;
      overlay().hidden = true;
      dragged = true;
      setTimeout(() => (dragged = false), 0);
      if (e.type === 'pointerup' && at) tell({ key: keyOf(), name: 'drop', value: { onto: at.onto, zone: at.zone } });
    };
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
  });
}
