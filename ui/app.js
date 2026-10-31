// The pelago web UI. No framework and no build step: it calls the same tools as the CLI through /api/<tool>.
// Two surfaces: the canvas (canvas.js), the map drawn across the page, which is where everything is; and the sheet,
// which opens from the side over it to read and act on one thing: an item read as a document, a new item, the
// workspace, a screen, what waits for you. This module routes between them; each part is its own module.

import { authorizePage } from './authorize.js';
import { SignInNeeded, h, hooks, join, main, part, showIdentity, signIn, state, store } from './base.js';
import { canvasHas, mark, refreshCanvas } from './canvas.js';
import { mayLeave, newItem } from './draft.js';
import { drawFind } from './find.js';
import { signupPage, welcome } from './signup.js';
import { home } from './home.js';
import { entity } from './item.js';
import { heldPage } from './item-held.js';
import { stale } from './live.js';
import { drawNav, screenOfPage, screenPage } from './nav.js';
import { loadSchema, typeChoice, types, workType } from './words.js';
import { atOf } from './pane-address.js';
import { startTabs } from './pane-land.js';
import { hrefNow, toAddress } from './panes.js';
import { startTips } from './tip.js';
import { workspace } from './workspace.js';

/** The pages the sheet holds, by the name in their address. */
const SHEET = { e: 'item', held: 'item', new: 'item', s: 'screen', workspace: 'workspace', you: 'you' };
const sheet = document.getElementById('sheet');
startTips();
const close = () => (location.hash = hrefNow());
document.getElementById('sheet-close').addEventListener('click', close);
addEventListener('keydown', (ev) => ev.key === 'Escape' && document.body.dataset.sheet && !document.querySelector('dialog[open]') && !/^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName ?? '') && close());

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
  if (name === 'authorize') return void ((document.body.dataset.sheet = 'open'), authorizePage(query));
  // Buying a workspace, and the page a buyer comes back to: in the sheet, before anything is read of a map.
  if (name === 'signup' || name === 'welcome') return void ((document.body.dataset.sheet = 'open'), name === 'signup' ? signupPage() : welcome());
  if (['home', 'activity', 'review', 'projects', 'today', 'map', 'automations'].includes(name)) return void (location.hash = '#/');
  if (name === 'graph') return void (location.hash = arg ? `#/v?from=${arg}` : `#/v?${query}`);
  if (name === 'roadmap' || name === 'questions') return void (location.hash = arg ? `#/e/${arg}` : '#/');
  try {
    if (!state.schema) await loadSchema();
  } catch (err) {
    document.body.dataset.sheet = 'open';
    if (err instanceof SignInNeeded) return signIn(store.token ? 'Your token is no longer accepted.' : '');
    return main.replaceChildren(h('div', { class: 'error' }, err.message));
  }
  if (name === 'time') return void (location.hash = screenOfPage('time') ? `#/s/${screenOfPage('time').id}` : '#/workspace');
  drawFind();
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
      name === 'held'
        ? heldPage(arg)
        : name === 'e'
        ? entity(arg, params.get('here') ?? undefined)
        : newItem(part('item'), { type: arg ?? workType(), title: params.get('title') ?? '', types, choices: [types.get(workType()), ...state.schema.types.filter((t) => t.id !== workType())].filter((t) => t && !t.dormant && !t.retired && !t.system && t.kind !== 'system' && !t.id.startsWith('sys.')).map((t) => ({ id: t.id, label: typeChoice(t) })) }),
    screen: () => screenPage(decodeURIComponent(arg ?? '')),
    workspace,
    you: home,
  }[page];
  try {
    await draw();
  } catch (err) {
    if (err instanceof SignInNeeded) return signIn(store.token ? 'Your token is no longer accepted.' : '');
    part(page).replaceChildren(h('div', { class: 'error' }, err.message));
  }
  if (!pulse) sheet.scrollTop = 0;
  showIdentity();
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

route();
