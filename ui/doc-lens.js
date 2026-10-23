// A picture in a published document (/p/...): the lens's answer as it was frozen when the document was published,
// drawn by its drawing or by the app's own shapes, read by anyone with no login. Nothing is asked of the map: the
// answer is all there is. A part opens nowhere: what it says of itself, its drawing says (in a tip, ui/drawing-tip.js).

import { h } from './base.js';
import { drawWith } from './drawing.js';
import { dress } from './lens-base.js';
import { types } from './words.js';

/** The shapes a published picture is drawn in by the app's own code, each loaded when one is drawn; any other has a
 * pack's drawing (src/published.ts gives one to a picture frozen without). */
const SHAPES = { grid: () => import('./grid.js').then((m) => m.drawGrid), time: () => import('./timeline.js').then((m) => m.drawTime) };
const ITEM = /^#\/e\/(e_[a-z0-9]{8})$/;

/** Draw one frozen answer into host. `typeTitles` names each type the picture holds. */
export function drawFrozen(host, answer, typeTitles = {}) {
  for (const [id, title] of Object.entries(typeTitles)) if (!types.has(id)) types.set(id, { id, title });
  // Read here, a picture holds still and asks nothing: no lighting to switch, no zoom, its key always open.
  const style = { ...answer.style, noLit: true, still: true };
  const body = h('div', { class: 'lens-view' });
  host.replaceChildren(body);
  dress(body, style);
  // A picture on a time axis is drawn along it, as in the app.
  if (style.drawing) drawWith(body, answer, style, () => {});
  else (SHAPES[answer.lens.time && !SHAPES[style.shape] ? 'time' : style.shape] ?? SHAPES.grid)().then((draw) => draw(body, answer, style, () => {}));
  const byId = new Map(answer.items.map((item) => [item.id, item]));
  // A part is a way to its page in the app; here it leads nowhere.
  body.addEventListener('click', (ev) => ev.target.closest?.('a') && ev.preventDefault());
  // A shape that opens an item by the address (a bar in time) has the address put back.
  addEventListener('hashchange', () => {
    if (byId.has(ITEM.exec(location.hash)?.[1])) history.replaceState(null, '', location.pathname);
  });
}
