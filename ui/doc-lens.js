// A picture in a published document (/p/...): the lens's answer as it was frozen when the document was published,
// drawn by its drawing, read by anyone with no login (and a draft's, read now, on /read/<id>). Nothing is asked of the map: the
// answer is all there is. A part opens nowhere: what it says of itself, its drawing says (in a tip, ui/layout-tip.js).

import { h } from './base.js';
import { drawWith } from './layout.js';
import { dress } from './query-base.js';
import { types } from './words.js';

const ITEM = /^#\/e\/(e_[a-z0-9]{8})$/;

/** Draw one frozen answer into host. `typeTitles` names each type the picture holds. `inApp`: drawn in the app's sheet, whose addresses are its own. */
export function drawFrozen(host, answer, typeTitles = {}, { inApp = false } = {}) {
  for (const [id, title] of Object.entries(typeTitles)) if (!types.has(id)) types.set(id, { id, title });
  // Read here, a picture holds still and asks nothing: no lighting to switch, no zoom, its key always open.
  const style = { ...answer.style, noLit: true, still: true };
  const body = h('div', { class: 'lens-view' });
  host.replaceChildren(body);
  dress(body, style);
  // Beside the hero, a picture is as wide as the text, whatever its box reaches past it for a story's conversation.
  const main = host.closest('main');
  if (main && !host.classList.contains('wide')) {
    const cs = getComputedStyle(main);
    body.dataset.room = String(Math.round(main.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight)));
  }
  // Every picture has a drawing: src/published.ts gives one to a picture frozen without.
  if (style.drawing) drawWith(body, answer, style, () => {});
  else body.replaceChildren(h('div', { class: 'empty' }, 'This view cannot be drawn here.'));
  const byId = new Map(answer.items.map((item) => [item.id, item]));
  // A part is a way to its page in the app; here it leads nowhere.
  body.addEventListener('click', (ev) => ev.target.closest?.('a') && ev.preventDefault());
  // A shape that opens an item by the address (a bar in time) has the address put back.
  if (!inApp)
    addEventListener('hashchange', () => {
      if (byId.has(ITEM.exec(location.hash)?.[1])) history.replaceState(null, '', location.pathname);
    });
}
