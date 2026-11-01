// A mark moved by hand: the page follows a press on a mark that asked for `drag` (ui/marks.js) and tells the drawing
// where it is, in the picture's own units, each frame (`drag`) and once where it is let go (`drop`); the drawing moves
// it and what is tied to it. The drawing sees only the distance moved, never the pointer or the page. Let go, a mark
// that is a link to an item says so to whoever keeps where things were put (the canvas: a `drawing-drop` event on the
// picture's host, with the item and where its middle now is). A press that hardly moves is a click, as before.

/** The item a mark links to, or null. */
const itemOf = (el) => /^#\/e\/(e_[a-z0-9]{8})$/.exec(el?.getAttribute?.('href') ?? '')?.[1] ?? null;
/** The drag of one picture: `send(event)` tells its drawing; with `style.snap` on, where a mark is let go is rounded to the style's grid (`sizes.snap`). */
export function dragOf(host, keys, send, style) {
  return (key, ev) => {
    const el = keys.get(key);
    const svg = el?.ownerSVGElement;
    // A finger on a phone stands on a mark nearly everywhere: there it moves the picture, and a tap still opens the mark.
    if (!svg || ev.button !== 0 || ev.pointerType === 'touch') return;
    // The press is the mark's, not the frame's: the picture does not pan under it.
    ev.stopPropagation();
    const at = (e) => {
      const p = svg.createSVGPoint();
      [p.x, p.y] = [e.clientX, e.clientY];
      return p.matrixTransform(svg.getScreenCTM().inverse());
    };
    const start = at(ev), box = el.getBBox();
    // Where it is now: where it was drawn, and where a drag before this moved it to (its transform).
    const shift = el.transform?.baseVal?.consolidate?.()?.matrix;
    const middle = [box.x + box.width / 2 + (shift?.e ?? 0), box.y + box.height / 2 + (shift?.f ?? 0)];
    const scale = svg.getScreenCTM().a;
    let moved = false, frame = 0, by = [0, 0];
    // Let go on a grid, when the reader asked for one: the middle on the nearest line.
    // Never above or left of the picture's corner, where it could not be seen.
    const snapped = ([dx, dy]) => {
      const g = style.snap ? Number(style.sizes?.snap) : 0;
      const [x, y] = g > 0 ? [Math.round((middle[0] + dx) / g) * g, Math.round((middle[1] + dy) / g) * g] : [middle[0] + dx, middle[1] + dy];
      return [Math.max(x, box.width / 2) - middle[0], Math.max(y, box.height / 2) - middle[1]];
    };
    const move = (e) => {
      const p = at(e);
      by = [p.x - start.x, p.y - start.y];
      if (!moved && Math.hypot(...by) * scale < 4) return;
      moved = true;
      el.classList.add('dragging');
      frame ||= requestAnimationFrame(() => ((frame = 0), send({ key, name: 'drag', dx: by[0], dy: by[1] })));
    };
    const up = () => {
      removeEventListener('pointermove', move);
      cancelAnimationFrame(frame);
      el.classList.remove('dragging');
      if (!moved) return;
      // The click that ends a drag does not open what was dragged.
      el.addEventListener('click', (e) => (e.preventDefault(), e.stopPropagation()), { capture: true, once: true });
      const [dx, dy] = snapped(by);
      send({ key, name: 'drop', dx, dy });
      const id = itemOf(el);
      if (id) host.dispatchEvent(new CustomEvent('drawing-drop', { bubbles: true, detail: { id, x: middle[0] + dx, y: middle[1] + dy } }));
    };
    addEventListener('pointermove', move);
    addEventListener('pointerup', up, { once: true });
  };
}
