// The page's half of the gestures a drawing opts into (decision e_qpaqnmrc, axis F; the drawing's half is `gestures`
// in ui/draw-marks.js): a mark that asks for `grab` can be dragged onto another that does, and the drawing is told
// `drop` on the one it lands on, with the one it came from; a mark that asks for `add` is told `add` on a double
// click. While one is dragged it is marked `grabbing` and the mark under the pointer `drop-on`, for the drawing's
// stylesheet to show. The plane does not pan from a mark that can be grabbed; a click that ends a drag opens nothing.

/** The mark that can be grabbed under a point, if any. */
const grabAt = (x, y) => document.elementFromPoint(x, y)?.closest?.('[data-grab]') ?? null;

/** Let `el`, keyed `key`, be dragged onto another grabbable mark; `tell(key, name, ev, from)` says where it was dropped. */
export function grabbable(el, key, tell) {
  el.dataset.grab = key;
  el.addEventListener('pointerdown', (down) => {
    if (down.button !== 0) return;
    // Neither the plane's pan nor the browser's own drag of a link starts from it.
    down.stopPropagation();
    down.preventDefault();
    let over = null, moved = false;
    const move = (ev) => {
      const under = grabAt(ev.clientX, ev.clientY);
      if (!moved && under !== el) ((moved = true), el.classList.add('grabbing'));
      const on = under && under !== el ? under : null;
      if (on !== over) (over?.classList.remove('drop-on'), (over = on), over?.classList.add('drop-on'));
    };
    const up = (ev) => {
      removeEventListener('pointermove', move);
      removeEventListener('pointerup', up);
      removeEventListener('pointercancel', up);
      el.classList.remove('grabbing');
      over?.classList.remove('drop-on');
      if (!moved) return;
      // The click a drag ends with is not a click on what it started on (a step's link would open its page).
      const eat = (c) => (c.preventDefault(), c.stopPropagation());
      addEventListener('click', eat, { capture: true, once: true });
      setTimeout(() => removeEventListener('click', eat, { capture: true }), 0);
      if (ev.type === 'pointerup' && over) tell(over.dataset.grab, 'drop', ev, key);
    };
    addEventListener('pointermove', move);
    addEventListener('pointerup', up);
    addEventListener('pointercancel', up);
  });
}

/** Tell the drawing of a double click on `el`, keyed `key`. */
export function addable(el, key, tell) {
  el.addEventListener('dblclick', (ev) => (ev.preventDefault(), ev.stopPropagation(), tell(key, 'add', ev)));
}
