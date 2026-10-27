// Moving panes by hand (ui/panes.js): a pane's name pressed and dragged shows where it would dock, as a code editor
// does: over a pane's side, docked on that side of it; over its middle, swapped with it; out of the window, popped
// out into one of its own. The line between two panes is dragged to share the room between them.

import { h } from './base.js';

/** The overlay that says where a pane let go now would dock. */
let zones = null;
const overlay = () => (zones ??= document.body.appendChild(h('div', { class: 'pane-zone', hidden: true })));

/** Which side of this box a point is nearest, or its middle: the third of it round its centre. */
function zoneOf(box, x, y) {
  const fx = (x - box.left) / box.width, fy = (y - box.top) / box.height;
  if (Math.abs(fx - 0.5) < 1 / 6 && Math.abs(fy - 0.5) < 1 / 6) return 'center';
  const near = { left: fx, right: 1 - fx, above: fy, below: 1 - fy };
  return Object.entries(near).sort((a, b) => a[1] - b[1])[0][0];
}
/** The part of a box a zone covers, as the overlay draws it. */
function zoneBox(box, zone) {
  const half = { left: [0, 0, 0.5, 1], right: [0.5, 0, 0.5, 1], above: [0, 0, 1, 0.5], below: [0, 0.5, 1, 0.5], center: [0, 0, 1, 1] }[zone];
  return { left: box.left + half[0] * box.width, top: box.top + half[1] * box.height, width: half[2] * box.width, height: half[3] * box.height };
}

/** Follow a press on pane `id`'s name until it is let go; then `drop(id, target group, zone)`. */
export function dragPane(ev, id, el, { groups, drop }) {
  if (ev.button !== 0) return;
  const start = [ev.clientX, ev.clientY];
  const grip = ev.currentTarget;
  grip.setPointerCapture(ev.pointerId);
  let at = null, moved = false;
  const move = (e) => {
    if (!moved && Math.hypot(e.clientX - start[0], e.clientY - start[1]) < 4) return;
    moved = true;
    document.body.dataset.dragging = 'pane';
    const out = e.clientX < 0 || e.clientY < 0 || e.clientX > innerWidth || e.clientY > innerHeight;
    const over = out ? null : groups().find(([g, box]) => g !== id && inside(box.getBoundingClientRect(), e.clientX, e.clientY));
    at = out ? [null, 'out'] : over ? [over[0], zoneOf(over[1].getBoundingClientRect(), e.clientX, e.clientY)] : null;
    const z = overlay();
    z.hidden = !at || out;
    z.dataset.zone = at?.[1] ?? '';
    if (over) Object.assign(z.style, Object.fromEntries(Object.entries(zoneBox(over[1].getBoundingClientRect(), at[1])).map(([k, v]) => [k, `${v}px`])));
  };
  const up = () => {
    grip.removeEventListener('pointermove', move);
    grip.removeEventListener('pointerup', up);
    grip.removeEventListener('pointercancel', up);
    delete document.body.dataset.dragging;
    overlay().hidden = true;
    if (moved && at) drop(id, at[0], at[1]);
  };
  grip.addEventListener('pointermove', move);
  grip.addEventListener('pointerup', up);
  grip.addEventListener('pointercancel', up);
}
const inside = (r, x, y) => x >= r.left && x <= r.right && y >= r.top && y <= r.bottom;

/** The lines between groups along `dir`, each dragged to move the share between the two it parts: `moved(n, at)`, `at` the line's place as a share of the page. */
export function sashes(host, dir, frames, moved) {
  const lines = frames.slice(0, -1).map(([, box]) => (dir === 'row' ? 1 - box.right : 1 - box.bottom));
  let have = [...host.querySelectorAll(':scope > .pane-sash')];
  // The lines being dragged are moved, not made again: a press keeps its line.
  if (have.length !== lines.length || have.some((s) => s.dataset.dir !== dir)) {
    for (const old of have) old.remove();
    have = lines.map((_, n) => {
      const sash = h('div', { class: `pane-sash ${dir}`, 'data-dir': dir, title: 'Drag to share the room between these two' });
      sash.addEventListener('pointerdown', (ev) => {
        sash.setPointerCapture(ev.pointerId);
        document.body.dataset.dragging = 'sash';
        const go = (e) => moved(n, dir === 'row' ? e.clientX / innerWidth : e.clientY / innerHeight);
        const stop = () => (sash.removeEventListener('pointermove', go), sash.removeEventListener('pointerup', stop), delete document.body.dataset.dragging);
        sash.addEventListener('pointermove', go);
        sash.addEventListener('pointerup', stop);
      });
      return host.appendChild(sash);
    });
  }
  lines.forEach((at, n) => (have[n].style[dir === 'row' ? 'left' : 'top'] = `${(at * 100).toFixed(3)}%`));
}
