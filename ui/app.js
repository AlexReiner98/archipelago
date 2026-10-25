// The pelago web UI. No framework and no build step: it calls the same tools as the CLI through /api/<tool>.
// Two surfaces: the canvas (canvas.js), the map drawn across the page, which is where everything is; and the sheet,
// which opens from the side over it to read and act on one thing: an item read as a document, a new item, the
// workspace, a screen, what waits for you. This module routes between them; each part is its own module.

import { SignInNeeded, api, h, hooks, join, main, part, showIdentity, signIn, state, store } from './base.js';
import { HOME, canvasHas, canvasHref, mark, refreshCanvas, showCanvas } from './canvas.js';
import { drawFind } from './find.js';
import { newEntity } from './forms.js';
import { home } from './home.js';
import { entity } from './item.js';
import { readLens } from './lens.js';
import { stale } from './live.js';
import { drawNav, screenOfPage, screenPage } from './nav.js';
import { loadSchema } from './words.js';
import { workspace } from './workspace.js';

/** The pages the sheet holds, by the name in their address. */
const SHEET = { e: 'item', new: 'item', s: 'screen', workspace: 'workspace', you: 'you' };
const sheet = document.getElementById('sheet');
const close = () => (location.hash = canvasHref());
document.getElementById('sheet-close').addEventListener('click', close);
addEventListener('keydown', (ev) => ev.key === 'Escape' && document.body.dataset.sheet && !document.querySelector('dialog[open]') && !/^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName ?? '') && close());

/** How many things wait for you: changes held for your word, and what only you can move. A mark in the bar, opening them. */
async function drawMarks() {
  const [held, mine] = await Promise.all([api('proposals').catch(() => []), api('view', { name: 'attention', params: { person: 'me', reasons: ['waits_on', 'to_confirm', 'due', 'unsettled'], limit: 50 } }).catch(() => ({ items: [] }))]);
  const n = held.length + mine.items.length;
  document.getElementById('marks').replaceChildren(n ? h('a', { class: `count${held.length ? ' held' : ''}`, href: '#/you', title: [held.length && `${held.length} held for your word`, mine.items.length && `${mine.items.length} your move`].filter(Boolean).join(', ') }, String(n)) : '');
}

/** `pulse`: the map changed under the page, which is drawn again where it stands. */
async function route(pulse = false) {
  // What follows a ? says how the page is to be drawn (a lens and a style), not which page it is.
  const [where, query = ''] = location.hash.split('?');
  const [, name = '', arg] = where.split('/');
  // Addresses from before the canvas still lead somewhere.
  if (name === 'join' && arg) return join(arg);
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
  const params = new URLSearchParams(query);
  // The canvas: what is up stays up when the item asked for is on it; else it moves to where the item stands.
  if (pulse) refreshCanvas();
  else if (name === 'v') showCanvas(readLens(query).lens, params.get('here') ?? undefined);
  else if (name === 'e' && arg) {
    const within = params.get('in');
    if (within) showCanvas({ ...readLens(query).lens, from: within }, arg);
    else if (canvasHas(arg)) mark(arg);
    else {
      const got = await api('get', { id: arg }).catch(() => null);
      const up = got?.trail?.at(-1)?.id;
      showCanvas(up ? { from: up } : HOME, arg);
    }
  } else if (!SHEET[name] || !document.querySelector('#canvas .lens-wrap')) showCanvas(HOME);
  if (name !== 'e') mark(undefined);
  // The sheet: open over the canvas for what it holds, else shut.
  const page = SHEET[name];
  document.body.dataset.sheet = page ? 'open' : '';
  state.dirty = false;
  stale.hidden = true;
  drawMarks();
  if (!page) return showIdentity();
  if (main.firstElementChild?.dataset.part !== page) main.replaceChildren(h('div', { class: 'part', 'data-part': page }));
  const draw = {
    item: () => (name === 'e' ? entity(arg, params.get('here') ?? undefined) : newEntity(arg)),
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
window.addEventListener('hashchange', () => route());

route();
