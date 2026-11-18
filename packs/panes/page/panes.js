// The canvas: one pane, at the page's address (decision e_mnuthcap, Alex, 17 Nov 2026: the tabs went; what a person
// sees is the islands they have on, and a show adds its island rather than taking the view). It draws a lens, a saved
// canvas, an item (`e/<id>`), or nothing (`v?shown=none`), and keeps the page's address as it moves. The band holds
// back and forward. A look's page, and a frozen link's, draw their one view the same way, with no band.

import { api, h, hooks } from './base.js';
import { still } from './look.js';
import { atOf } from './pane-address.js';
import { activate, canvasIn, focusOn, homeReady, islandsLens } from './canvas.js';
import { islandsIn } from './islands-on.js';
import { islandsName, islandsOfLens } from './islands-lens.js';
import { presetSettings, savedCanvases, viewParts } from './views-kept.js';
import { addressOf, opening, readAddress } from './query.js';
import { titles } from './words.js';

/**
 * The item a canvas opened last, and the lens it opened it over: a drawing's own click on it opens it again by its bare
 * address (packs/walls/page/layout.js), which then keeps that lens, as the address it was opened at said.
 */
let lastOpened = { item: null, query: '' };
addEventListener('hashchange', () => {
  const item = /^#\/e\/(e_[a-z0-9]{8})$/.exec(location.hash)?.[1];
  if (item && item === lastOpened.item && lastOpened.query) history.replaceState(history.state, '', `#/e/${item}?${lastOpened.query}`);
});

/** The address of a pane beside a replay that has reached no milestone yet: it draws nothing. */
const NONE = 'v?shown=none';

/** Where a saved view that lists its islands keeps each one's corner, by view (feature e_u52abqr4): an address carries its lens, not these. */
const cornersBy = new Map();
/** A saved view as read from the map: its title, and its islands' corners. */
const known = (entity) => (titles.set(entity.id, entity.title), cornersBy.set(entity.id, viewParts(entity).style.placed ?? null));

/** The lens and style a pane's address names (no lens for Home): a saved canvas named alone is read from the map. */
async function lensOf(at) {
  const [where, query = ''] = at.split('?');
  // A list of islands an address names (an agent's show): drawn, the person's own list left as it was (decision e_n42s8jvn).
  const named = islandsIn(query);
  const asked = readAddress(query);
  // A saved canvas that draws a list of islands is read as the view it is, below: its name and its corners.
  if (named && !asked.style.canvas) return { lens: islandsLens(named), style: asked.style };
  // A saved canvas is named by its title, read from the map when the page does not know it yet.
  if (asked.style.canvas && !cornersBy.has(asked.style.canvas) && asked.lens) await api('get', { id: asked.style.canvas }).then((got) => known(got.entity), () => {});
  // Its islands' corners come from the view itself, whatever the address says of its lens (an item opened over it among them).
  const placed = asked.style.canvas && cornersBy.get(asked.style.canvas);
  if (asked.lens) return asked.style.canvas ? (placed ? { ...asked, style: { ...asked.style, placed } } : asked) : { ...asked, style: { ...presetSettings(asked.lens), ...asked.style } };
  if (asked.style.canvas) {
    const got = await api('get', { id: asked.style.canvas });
    known(got.entity);
    opening.set(got.entity.id, got.entity);
    // The saved views read again with it, so the bar weighs it as the map has it now (bump e_4j6xvm82).
    savedCanvases(true);
    return viewParts(got.entity);
  }
  const id = /^e\/(e_[a-z0-9]{8})/.exec(where)?.[1];
  // An item's own address draws its island under its page (decision e_n42s8jvn); one on no island, the item and what it holds.
  if (id) {
    const island = (await api('get', { id }).catch(() => null))?.entity?.props?.island;
    return { lens: island ? islandsLens([island]) : focusOn(id), style: {}, here: id };
  }
  // Home: the person's own islands, read before it is drawn.
  await homeReady();
  return { lens: null, style: {} };
}
/** A pane's address for an address of the page: an item's page draws the lens beside it, else the item's own canvas. */
function paneAt(href) {
  const bare = String(href ?? '').replace(/^#\//, '') || 'v';
  const [where, query = ''] = bare.split('?');
  const item = /^e\/(e_[a-z0-9]{8})$/.exec(where)?.[1];
  if (!item) return bare;
  if (islandsIn(query) || readAddress(query).lens) return `v?${query}`;
  return `e/${item}`;
}

/**
 * Draw a canvas at address `at` in `el`, telling `said(name, value)` what is done in it: `open` another address, an
 * item `opened` (its page opened over the pane), what it is `named` and the items it has `drawn`. Answers how to stop it.
 */
export function drawPane(at, el, said) {
  let live = true;
  // A canvas of its own in a node of its own, laid out as a pane's (packs/surface/page/shell.css: #canvas .pane-canvas): the runtime keeps
  // `el` as the pane's address changes, and what listened on the canvas before must go with it.
  const host = h('div', { class: 'pane-canvas' });
  el.replaceChildren(host);
  // A view a drawing names finds its pane by it (packs/walls/page/view-frame.js).
  const pane = /^pane:(.+)$/.exec(el.closest('[data-key]')?.dataset.key ?? '')?.[1];
  // The pane it stands in (none for a page's lone pane, which is always the one in focus).
  const paneEl = el.closest('.pm-pane');
  const selected = () => !paneEl || paneEl.getAttribute('aria-selected') === 'true';
  if (pane) el.dataset.pane = pane;
  // What it draws now; in focus, with no page over it, the page's address is this pane's (decision e_h2pqjy2q).
  let now = at;
  const hrefOf = (to) => (!to || to === 'v' ? '#/' : `#/${to}`);
  const moved = (to) => {
    if (!live) return;
    now = to;
    said('open', { at: to });
    if (!selected()) return;
    // An item's page open over it stays open, over the lens it draws now; another page over it keeps the address its own.
    const open = /^#\/e\/(e_[a-z0-9]{8})/.exec(location.hash)?.[1];
    const query = to.split('?')[1];
    const href = document.body.dataset.sheet !== 'open' ? hrefOf(to) : open ? `#/e/${open}${query ? `?${query}` : ''}` : null;
    if (href && location.hash !== href) location.hash = href;
  };
  const canvas = canvasIn(host, {
    go: (lens) => moved(lens ? `v?${addressOf(lens, canvas.asked)}` : 'v'),
    open: (href) => moved(paneAt(href)),
    opened: (item, lens) => {
      if (!live) return;
      // This pane is the one touched before its item's page opens over it (a click with no press before it too).
      host.dispatchEvent(new FocusEvent('focusin', { bubbles: true }));
      said('opened', { item, at: `v?${addressOf(lens, canvas.asked)}` });
      lastOpened = { item, query: addressOf(lens, canvas.asked) };
      location.hash = `#/e/${item}?${lastOpened.query}`;
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
      // A list of islands is named by its islands ("X growth + 2"), any other lens by what its filter finds.
      const islands = islandsOfLens(lens);
      const lensName = () => (islands ? islandsName(islands, (id) => hooks.nameSaid?.(id, naming) ?? titles.get(id) ?? '…') : hooks.lensSaid?.(lens.filter, naming));
      const naming = () => live && said('named', String((style.canvas && titles.get(style.canvas)) || (lens ? lensName() : 'Home') || 'Canvas').slice(0, 120));
      naming();
      canvas.show(lens, here, style);
      // The bar and find act on the pane in focus alone: a pane drawn beside it does not take them.
      if (selected()) activate(canvas);
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
  // Its pane coming into focus (pressed, a tab brought into sight, the part's choice) gives it the bar and find.
  const focus = new MutationObserver(() => live && selected() && activate(canvas));
  if (paneEl) focus.observe(paneEl, { attributes: true, attributeFilter: ['aria-selected'] });
  return () => ((live = false), watching.disconnect(), focus.disconnect(), clearTimeout(soon), canvas.close());
}
hooks.paneFrame = drawPane;

// ---- The page's one pane, at the page's address.

let lone = null;
/** The page's address given to the pane (packs/shell/page/app.js): drawn again only for another. */
export function toAddress(at) {
  if (!lone || at === undefined || at === lone.at) return;
  lone.stop?.();
  lone.at = at;
  // Where the canvas moves (another lens) it writes the page's address, which draws it again here.
  lone.stop = drawPane(at, lone.body, () => {});
}
/** Start the page's pane in #canvas, once the map's schema is read (packs/shell/page/app.js): what it draws is read through it. */
export function startCanvas() {
  if (lone) return;
  const canvas = document.getElementById('canvas');
  const body = h('section', { class: 'pane' });
  canvas?.replaceChildren(body);
  lone = { at: null, body, stop: null };
  if (!still) {
    // One pane: the page's own rules lay it out alone (packs/surface/page/shell.css, island-picker.css: body[data-panes]).
    document.body.dataset.panes = '1';
    // The sheet or the side bar opened or shut moves the canvas's frame: what fits itself to it (find, the drawing) is told.
    let soon;
    new MutationObserver(() => (clearTimeout(soon), (soon = setTimeout(() => dispatchEvent(new Event('resize')), 30)))).observe(document.body, { attributes: true, attributeFilter: ['data-sheet', 'data-islands', 'data-islands-over'] });
    const button = (label, title, mark, onclick) => h('button', { type: 'button', class: 'q-save q-travel', title, 'aria-label': label, onclick }, mark);
    hooks.paneButtons = () => [button('Back', 'Back to what the canvas drew before', '‹', () => history.back()), button('Forward', 'Forward again', '›', () => history.forward())];
  }
  toAddress(atOf(location.hash) ?? 'v');
}
/** Where closing the page over the canvas goes: the address the canvas stands at, else the lens the page's address carries. */
export function hrefNow(from = '') {
  if (lone?.at) return lone.at === 'v' ? '#/' : `#/${lone.at}`;
  const query = (from || location.hash).split('?')[1];
  return query ? `#/v?${query}` : '#/';
}
