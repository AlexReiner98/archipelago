// A picture in a published document (/p/...): the lens's answer as it was frozen when the document was published,
// drawn by the app's own shapes, read by anyone with no login. Nothing is asked of the map: the answer is all there
// is. A part opens nowhere; clicked, it says its first line over the picture.

import { h } from './base.js';
import { drawWith } from './drawing.js';
import { drawFlow } from './flow.js';
import { drawGrid } from './grid.js';
import { dress } from './lens-base.js';
import { drawTime } from './timeline.js';
import { types } from './words.js';

/** The shapes a published picture is drawn in; any other is drawn as a flow. */
const SHAPES = { flow: drawFlow, grid: drawGrid, time: drawTime };
const ITEM = /^#\/e\/(e_[a-z0-9]{8})$/;

/** Draw one frozen answer into host. `typeTitles` names each type the picture holds. */
export function drawFrozen(host, answer, typeTitles = {}) {
  for (const [id, title] of Object.entries(typeTitles)) if (!types.has(id)) types.set(id, { id, title });
  // Read here, a picture holds still and asks nothing: no lighting to switch, no zoom, its key always open.
  const style = { ...answer.style, noLit: true, still: true };
  const body = h('div', { class: 'lens-view' });
  const said = h('p', { class: 'lens-said muted', hidden: true });
  // What a clicked part says is over the picture, where the eye already is.
  host.replaceChildren(said, body);
  dress(body, style);
  // A picture on a time axis is drawn along it, as in the app.
  (style.drawing ? drawWith : (SHAPES[answer.lens.time && !SHAPES[style.shape] ? 'time' : style.shape] ?? drawFlow))(body, answer, style, () => {});
  const byId = new Map(answer.items.map((item) => [item.id, item]));
  const tell = (id) => {
    const item = byId.get(id);
    if (!item) return false;
    said.replaceChildren(h('strong', {}, item.title), item.gist ? ` ${item.gist}` : '');
    said.title = [item.title, item.gist].filter(Boolean).join(' — ');
    said.hidden = false;
    return true;
  };
  // A part is a way to its page in the app; here it says what it is instead.
  body.addEventListener('click', (ev) => {
    const link = ev.target.closest?.('a');
    if (!link) return;
    ev.preventDefault();
    if (!tell(ITEM.exec(link.getAttribute('href') ?? '')?.[1])) said.hidden = true;
  });
  // A shape that opens an item by the address (a bar in time) is told the same, and the address is put back.
  addEventListener('hashchange', () => {
    if (tell(ITEM.exec(location.hash)?.[1])) history.replaceState(null, '', location.pathname);
  });
}
