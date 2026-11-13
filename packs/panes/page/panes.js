// A pane's canvas: the panes pack's part decides which panes stand where and what each draws (packs/panes/parts/index.js),
// the runtime lays them out (the `pane` mark, packs/walls/page/part-pane.js), and this draws the canvas in each, at
// the address the part names: a lens, a saved canvas, an item (`e/<id>`), or nothing (`v?shown=none`). It tells the
// part what is done there (another lens, an item opened) and what it draws (its name, its items). The pane pressed
// is the one the query bar and find act on (decision e_h2pqjy2q). A look's page, and a frozen link's, draw their one
// view in a pane of their own, with no tabs.

import { api, h, hooks } from './base.js';
import { activate, canvasIn, focusOn } from './canvas.js';
import { presetSettings, savedCanvases, viewParts } from './views-kept.js';
import { addressOf, opening, readAddress } from './query.js';
import { filterSaid } from './query-bar.js';
import { titles } from './words.js';

/** The address of a pane beside a replay that has reached no milestone yet: it draws nothing. */
const NONE = 'v?shown=none';

/** The lens and style a pane's address names (no lens for Home): a saved canvas named alone is read from the map. */
async function lensOf(at) {
  const [where, query = ''] = at.split('?');
  const asked = readAddress(query);
  // A saved canvas is named by its title, read from the map when the page does not know it yet.
  if (asked.style.canvas && !titles.has(asked.style.canvas) && asked.lens) await api('get', { id: asked.style.canvas }).then((got) => titles.set(got.entity.id, got.entity.title), () => {});
  if (asked.lens) return asked.style.canvas ? asked : { ...asked, style: { ...presetSettings(asked.lens), ...asked.style } };
  if (asked.style.canvas) {
    const got = await api('get', { id: asked.style.canvas });
    titles.set(got.entity.id, got.entity.title);
    opening.set(got.entity.id, got.entity);
    // The saved views read again with it, so the bar weighs it as the map has it now (bump e_4j6xvm82).
    savedCanvases(true);
    return viewParts(got.entity);
  }
  const id = /^e\/(e_[a-z0-9]{8})/.exec(where)?.[1];
  return id ? { lens: focusOn(id), style: {}, here: id } : { lens: null, style: {} };
}
/** A pane's address for an address of the page: an item's page draws the lens beside it, else the item's own canvas. */
function paneAt(href) {
  const bare = String(href ?? '').replace(/^#\//, '') || 'v';
  const [where, query = ''] = bare.split('?');
  const item = /^e\/(e_[a-z0-9]{8})$/.exec(where)?.[1];
  if (!item) return bare;
  return `v?${readAddress(query).lens ? query : addressOf(focusOn(item), {})}`;
}

/**
 * Draw a canvas at address `at` in `el`, telling `said(name, value)` what is done in it: `open` another address, an
 * item `opened` (its page opened over the pane), what it is `named` and the items it has `drawn`. Answers how to stop it.
 */
export function drawPane(at, el, said) {
  let live = true;
  // A canvas of its own in a node of its own, laid out as a pane's (ui/shell.css: #canvas .pane-canvas): the runtime keeps
  // `el` as the pane's address changes, and what listened on the canvas before must go with it.
  const host = h('div', { class: 'pane-canvas' });
  el.replaceChildren(host);
  // A view a drawing names finds its pane by it (packs/walls/page/view-frame.js).
  const pane = /^pane:(.+)$/.exec(el.closest('[data-key]')?.dataset.key ?? '')?.[1];
  if (pane) el.dataset.pane = pane;
  // What it draws now; in focus, with no page over it, the page's address is this pane's (decision e_h2pqjy2q).
  let now = at;
  const hrefOf = (to) => (!to || to === 'v' ? '#/' : `#/${to}`);
  const inFocus = () => el.closest('[aria-selected]')?.getAttribute('aria-selected') === 'true' && document.body.dataset.sheet !== 'open';
  const moved = (to) => {
    if (!live) return;
    now = to;
    said('open', { at: to });
    if (inFocus() && location.hash !== hrefOf(to)) location.hash = hrefOf(to);
  };
  const canvas = canvasIn(host, {
    go: (lens) => moved(lens ? `v?${addressOf(lens, canvas.asked)}` : 'v'),
    open: (href) => moved(paneAt(href)),
    opened: (item, lens) => {
      if (!live) return;
      // This pane is the one touched before its item's page opens over it (a click with no press before it too).
      host.dispatchEvent(new FocusEvent('focusin', { bubbles: true }));
      said('opened', { item, at: `v?${addressOf(lens, canvas.asked)}` });
      location.hash = `#/e/${item}?${addressOf(lens, canvas.asked)}`;
    },
  });
  // Pressed, or the focus gone into a drawing's frame in it, it is the canvas the bar and find act on.
  const touched = () => {
    if (!live) return;
    activate(canvas);
    if (document.body.dataset.sheet !== 'open' && location.hash !== hrefOf(now)) history.replaceState(history.state, '', hrefOf(now));
  };
  host.addEventListener('pointerdown', touched, true);
  host.addEventListener('focusin', touched);
  if (at === NONE) canvas.empty();
  else
    lensOf(at).then(({ lens, style, here }) => {
      if (!live) return;
      const naming = () => live && said('named', String((style.canvas && titles.get(style.canvas)) || (lens ? filterSaid(lens.filter, naming) : 'Home') || 'Canvas').slice(0, 120));
      naming();
      canvas.show(lens, here, style);
      activate(canvas);
    }, (err) => live && host.replaceChildren(h('div', { class: 'error' }, err.message)));
  // What it draws, told again as it is drawn anew (the map changed, another lens): a tab that watches what it draws reads it.
  let told = '';
  const tell = () => {
    const ids = canvas.ids?.() ?? [];
    if (live && ids.join(' ') !== told) ((told = ids.join(' ')), said('drawn', ids.slice(0, 500)));
  };
  let soon;
  const watching = new MutationObserver(() => (clearTimeout(soon), (soon = setTimeout(tell, 300))));
  watching.observe(host, { childList: true, subtree: true });
  return () => ((live = false), watching.disconnect(), clearTimeout(soon), canvas.close());
}
hooks.paneFrame = drawPane;

/**
 * A view a drawing in pane `from` names (a replay's milestone, packs/walls/page/view-frame.js), drawn in a pane of its
 * own on its right: the part opens it once and moves it to each view named.
 */
hooks.besidePane = (from, view) => hooks.tellSlot?.('tabs', { name: 'beside', pane: from, view: view ?? null });

// ---- A page with no tabs (a look's, a frozen link's): its one view in a pane of its own, at the page's address.

let lone = null;
/** The page's address given to the lone pane of a page with no tabs (packs/surface/page/app.js): drawn again only for another. */
export function toAddress(at) {
  if (!lone || at === undefined || at === lone.at) return;
  lone.stop?.();
  lone.at = at;
  lone.stop = drawPane(at, lone.body, () => {});
}
/** Start the lone pane of a page with no tabs, in #canvas. */
export function lonePane(at) {
  const canvas = document.getElementById('canvas');
  const body = h('section', { class: 'pane' });
  canvas?.replaceChildren(body);
  lone = { at: null, body, stop: null };
  toAddress(at);
}
/** Where closing the page over the canvas goes: the address the pane in focus stands at, as the panes part publishes it (`data-pane_at`), else the lens the page's address carries. */
export function hrefNow(from = '') {
  const at = document.documentElement.dataset.pane_at;
  if (at) return at;
  const query = (from || location.hash).split('?')[1];
  return query ? `#/v?${query}` : '#/';
}
