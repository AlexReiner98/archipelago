// A picture in a published document (/p/...): the lens's answer as it was frozen when the document was published,
// drawn by its drawing, read by anyone with no login (and a draft's, read now, on /read/<id>). Nothing is asked of the map: the
// answer is all there is. A part opens nowhere: what it says of itself, its drawing says (in a tip, ui/layout-tip.js).

import { h } from './base.js';
import { drawWith } from './layout.js';
import { dress } from './query-base.js';
import { types } from './words.js';

const ITEM = /^#\/e\/(e_[a-z0-9]{8})$/;

/** The items of each picture drawn outside the app, by its host: one listener for all of them puts the address back. */
const outside = new Map();
let listening = false;
function keepAddress(host, byId) {
  outside.set(host, byId);
  if (listening) return;
  listening = true;
  addEventListener('hashchange', () => {
    const id = ITEM.exec(location.hash)?.[1];
    for (const [at, ids] of outside) {
      if (!at.isConnected) outside.delete(at);
      else if (ids.has(id)) return void history.replaceState(null, '', location.pathname);
    }
  });
}

/** Draw one frozen answer into host. `typeTitles` names each type the picture holds. `inApp`: drawn in the app's sheet, whose addresses are its own. `onItem`: a part opens there (a link's page opens it in its sheet, ui/doc-sheet.js). */
export function drawFrozen(host, answer, typeTitles = {}, { inApp = false, onItem = null } = {}) {
  for (const [id, title] of Object.entries(typeTitles)) if (!types.has(id)) types.set(id, { id, title });
  // Read here, a picture holds still and asks nothing: no lighting to switch, no zoom, its key always open.
  const style = { ...answer.style, noLit: true, still: true };
  const body = h('div', { class: 'lens-view' });
  host.replaceChildren(body);
  dress(body, style);
  // Every picture has a drawing: src/published.ts gives one to a picture frozen without.
  if (style.drawing) drawWith(body, answer, style, () => {});
  else body.replaceChildren(h('div', { class: 'empty' }, 'This view cannot be drawn here.'));
  // A link leaves out what is private; the page says so, rather than reading as a view with nothing in it.
  if (answer.hidden) host.append(h('p', { class: 'muted small' }, `${answer.hidden} ${answer.hidden === 1 ? 'item here is' : 'items here are'} private and not shown.`));
  const byId = new Map(answer.items.map((item) => [item.id, item]));
  // A part is a way to its page in the app; here it leads nowhere, or, where the page can, to its page in a sheet.
  body.addEventListener('click', (ev) => {
    const a = ev.target.closest?.('a');
    if (!a) return;
    ev.preventDefault();
    const id = ITEM.exec(a.getAttribute('href') ?? '')?.[1];
    if (id && onItem && byId.has(id)) onItem(id);
  });
  // A shape that opens an item by the address (a bar in time) has the address put back.
  if (!inApp) keepAddress(host, byId);
}
