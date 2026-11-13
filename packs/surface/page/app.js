// The pelago web UI. No framework and no build step: it calls the same tools as the CLI through /api/<tool>.
// Two surfaces: the canvas (canvas.js), the map drawn across the page, which is where everything is; and the sheet,
// which opens from the side over it to read and act on one thing: an item read as a document, a new item, the
// workspace, a screen, what waits for you. This module routes between them; each part is its own module.

import { authorizePage } from './authorize.js';
import { SignInNeeded, api, drawSlot, drawnNone, h, hooks, join, loadMay, may, main, part, showIdentity, signIn, state, store, ungate } from './base.js';
import { canvasHas, mark, refreshCanvas } from './canvas.js';
import { warmLayouts } from './layout.js';
import { mayLeave, newItem, unsaved } from './draft.js';
import { home } from './home.js';
import { entity } from './item.js';
import { heldPage } from './item-held.js';
import { linkFirst } from './item-link.js';
import { stale } from './live.js';
import { drawNav, screenPage } from './screen-page.js';
import { loadSchema, typeChoice, types, workType } from './words.js';
import { atOf } from './pane-address.js';
import { startTabs } from './pane-land.js';
import { hrefNow, toAddress } from './panes.js';
import { startTips } from './tip.js';
import { workspace } from './workspace.js';

/** The pages the sheet holds, by the name in their address. */
/** The address of an item a held change would make, as a drawing links it (packs/surface/page/replica.js). */
const GHOST = /^p_[a-z0-9]+:/;
const SHEET = { e: 'item', held: 'item', new: 'item', s: 'screen', workspace: 'workspace', you: 'you' };
const sheet = document.getElementById('sheet');
// An item named outside the app (?link=): a tab open on its workspace takes it, else this page opens on it there.
const linked = await linkFirst();
startTips();
// The frame drawings run in, and the drawing this browser drew last loaded in it, started before anything is read: the
// worker is ready when the first answer comes.
warmLayouts();
// A sheet opened where the address stays (the sign-in form, from Home) is shut by drawing that address again.
const close = () => (location.hash === hrefNow() ? route() : (location.hash = hrefNow()));
document.getElementById('sheet-close').addEventListener('click', close);
addEventListener('keydown', (ev) => ev.key === 'Escape' && document.body.dataset.sheet && !document.querySelector('dialog[open]') && !/^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName ?? '') && close());

/** Find at the canvas's foot, the find pack's part (slot `find`), drawn once: it follows the address itself. */
let findDrawn = false;
function drawFindSlot() {
  const node = document.querySelector('#find .find-part');
  if (findDrawn || !node) return;
  findDrawn = true;
  drawSlot(node, { slot: 'find' }).catch((err) => console.warn(err.message));
}

/** `pulse`: the map changed under the page, which is drawn again where it stands. */
async function route(pulse = false) {
  // An address as a show answers it, without its slash (#v?…, #e/…), is the page it names (e_jk63uduv).
  if (/^#[^/]/.test(location.hash)) return void location.replace(`#/${location.hash.slice(1)}`);
  // What follows a ? says how the page is to be drawn (a lens and a style), not which page it is.
  const [where, query = ''] = location.hash.split('?');
  const [, name = '', arg] = where.split('/');
  // Addresses from before the canvas still lead somewhere.
  if (name === 'join' && arg) return join(arg);
  // A client asking to connect: before anything is read of a map, as whoever may not be signed in yet.
  if (name === 'authorize') return void authorizePage(query);
  if (['home', 'activity', 'review', 'projects', 'today', 'map', 'automations'].includes(name)) return void (location.hash = '#/');
  if (name === 'graph') return void (location.hash = arg ? `#/v?from=${arg}` : `#/v?${query}`);
  if (name === 'roadmap' || name === 'questions') return void (location.hash = arg ? `#/e/${arg}` : '#/');
  try {
    if (!state.schema) await loadSchema();
    // What this session may do, before anything is drawn: each control is drawn only where it may (packs/surface/page/base.js may).
    await loadMay();
    // One signed in who only reads has no map of their own to change either: shown the same way to one.
    if (!may('write')) startOwn();
  } catch (err) {
    document.body.dataset.sheet = 'open';
    if (err instanceof SignInNeeded) return signIn(store.token ? 'Your sign-in has run out. Sign in again.' : '');
    return main.replaceChildren(h('div', { class: 'error' }, err.message));
  }
  // In a workspace: the page is the app again, whatever signed-out page was up.
  ungate();
  drawFindSlot();
  drawNav();
  startTabs();
  const params = new URLSearchParams(query);
  // The canvas: the pane in focus draws the lens the address says (ui/query-bar.js shows it); an item's page with none
  // keeps what is up when it draws the item, and else opens on the item.
  if (pulse) refreshCanvas(true);
  else if (name === 'e' && arg) toAddress(atOf(location.hash) ?? (canvasHas(arg) ? undefined : `e/${arg}`), arg);
  else if (!SHEET[name]) toAddress(atOf(location.hash) ?? 'v', params.get('here') ?? undefined);
  if (name !== 'e') mark(params.get('here') ?? undefined);
  // The sheet: open over the canvas for what it holds, else shut.
  const page = SHEET[name];
  document.body.dataset.sheet = page ? 'open' : '';
  state.dirty = false;
  stale.hidden = true;
  if (!page) return showIdentity();
  if (main.firstElementChild?.dataset.part !== page) main.replaceChildren(h('div', { class: 'part', 'data-part': page }));
  const draw = {
    item: () =>
      name === 'held' || GHOST.test(arg)
        ? heldPage(arg.split(':')[0])
        : name === 'e'
        ? entity(arg, params.get('here') ?? undefined)
        : newItem(part('item'), { type: arg ?? workType(), title: params.get('title') ?? '', types, choices: [types.get(workType()), ...state.schema.types.filter((t) => t.id !== workType())].filter((t) => t && !t.dormant && !t.retired && !t.system && !t.id.startsWith('sys.')).map((t) => ({ id: t.id, label: typeChoice(t) })) }),
    screen: () => screenPage(decodeURIComponent(arg ?? '')),
    workspace,
    you: home,
  }[page];
  try {
    await draw();
  } catch (err) {
    if (err instanceof SignInNeeded) return signIn(store.token ? 'Your sign-in has run out. Sign in again.' : '');
    part(page).replaceChildren(h('div', { class: 'error' }, err.message));
  }
  if (!pulse) sheet.scrollTop = 0;
  showIdentity();
  // A page drawn in the sheet lets what waits for a drawing be read, whether or not a canvas draws behind it.
  drawnNone();
}

hooks.route = route;
// Words written in the sheet and not saved are not left behind without asking (ui/draft.js).
let at = location.hash, back = false;
window.addEventListener('hashchange', async () => {
  if (back) return void (back = false);
  if (!(await mayLeave())) return void ((back = true), (location.hash = at));
  at = location.hash;
  route();
});
// Nor lost to a reload or a closed tab: the browser asks, in its own words.
window.addEventListener('beforeunload', (e) => {
  if (unsaved()) (e.preventDefault(), (e.returnValue = ''));
});

if (linked !== 'gate') route();

/**
 * Someone reading what was shared with them is shown a way to start a map of their own, loud, in the bar: a member
 * who only reads (signed in already) by the menu. The
 * words the style gives (start, core's house style), to where this server says a person with no account begins.
 */
async function startOwn() {
  if (document.querySelector('#nav .start-own')) return;
  const words = (await api('view', { name: 'style' }).catch(() => null))?.style?.start;
  if (typeof words !== 'string' || !words) return;
  // The one thing the page asks of a stranger, loud.
  const a = h('a', { class: 'start-own', href: '/', title: 'Make a map of your own, for your own work and agents' }, words);
  document.getElementById('more')?.before(a);
  fetch('/connect/start').then((r) => (r.ok ? r.json() : null)).then((r) => r?.url && a.setAttribute('href', r.url), () => null);
}
