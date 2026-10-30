// Tabs at the top of the page (decision e_mzer5m4t): each a set of panes side by side, every one alike (ui/panes.js),
// kept by ui/tabs.js. Several sessions at work each keep a tab of their own, named by the session and marked in its hue
// (ui/words.js), so their work mirrors into the page without squeezing a pane or opening a window; where a step lands
// is ui/pane-route.js. There is no most: many tabs shrink to their mark and first letters (e_q3amet26). A tab, not a
// pane, pops out into a window of its own, from its strip or dragged out of the page, and docks back whole (e_ezb7s3a7).
// What is the tab's own lives on the strip, never in the query bar, which shows the lens (decision e_j7ggggjr, asked):
// every tab has ⋯ (whom it follows, pop out) and ×, the same in sight or not, and + ends the strip, which shows with one tab too.

import { api, h, hooks, state } from './base.js';
import { readFlatLens } from './lens.js';
import { lookMode } from './look.js';
import { placeBy } from './menu-place.js';
import { windowOf, windows } from './pane-busy.js';
import { heard, nameOf } from './pane-route.js';
import { activeAt, activeIs, close, draw, paneAt, paneButtons, startPanes } from './panes.js';
import { filterSaid } from './query-bar.js';
import { focusOf, front, freshTab, isOutKey, keep, landed, listKey, named, outKey, outTabs, poppedTab, read, save, tabHref, tabOf, tabs } from './tabs.js';
import { sessionHue, titles } from './words.js';

read();
const strip = document.getElementById('tabs');

/** Bring tab `t` into sight: its panes drawn, the address its pane in focus's, the page it had open over it open again. */
function show(t) {
  tabs.front = t.id;
  t.unseen = false;
  keep();
  draw();
  // The bar goes back to the pane last touched in it (decision e_x9b9yv5g, asked).
  activeIs(focusOf(t));
  drawStrip();
  const href = tabHref(t);
  if ((location.hash || '#/') !== href) location.replace(href);
}
/** Bring tab `id` into sight, keeping where the one in sight stands. */
export function toFront(id) {
  const t = tabOf(id);
  if (!t || id === tabs.front) return;
  show(t);
}
/** Open a tab on this address (`own`: whom it follows, its name), in sight or in the background, marked. Answers its id. */
export function openTab(at, own = {}, inSight = true) {
  const t = freshTab(paneAt(at), own);
  tabs.list.push(t);
  if (inSight) toFront(t.id);
  else arrived(t.id);
  return t.id;
}
/**
 * Move pane `id` of the tab in sight into a tab of its own, beside this one and in sight, with its history. A pane held
 * for a session takes the session with it: the new tab follows it, so its next show goes there (decision e_c5stzz6z).
 */
hooks.paneToTab = (id) => {
  const from = front();
  const pane = from.panes[id];
  if (!pane || from.groups.length < 2) return;
  const { held, ...kept } = pane;
  const t = { ...freshTab('#/'), ...(held && { follows: held, named: heard.has(held) ? nameOf(held) : undefined, word: heard.get(held)?.name }) };
  t.groups = [id];
  t.focus = id;
  t.panes = { [id]: kept };
  const went = landed.get(`${from.id}:${id}`);
  if (went) (landed.delete(`${from.id}:${id}`), landed.set(`${t.id}:${id}`, went));
  close(id);
  tabs.list.splice(tabs.list.indexOf(from) + 1, 0, t);
  toFront(t.id);
};
/** Mark tab `id`, out of sight, as having something new: its mark rings until it is brought into sight. */
export function arrived(id) {
  const t = tabOf(id);
  if (!t || id === tabs.front) return;
  t.unseen = true;
  keep();
  drawStrip();
  const el = strip.querySelector(`[data-tab="${id}"]`);
  el?.classList.remove('tab-shown');
  void el?.offsetWidth;
  el?.classList.add('tab-shown');
}
function closeTab(id) {
  const n = tabs.list.findIndex((t) => t.id === id);
  if (n < 0 || tabs.list.length < 2) return;
  tabs.list.splice(n, 1);
  for (const key of [...landed.keys()]) if (key.startsWith(`${id}:`)) landed.delete(key);
  if (id === tabs.front) show(tabs.list[Math.max(0, n - 1)]);
  else (keep(), drawStrip());
}
/** Pop tab `id` out into a window of its own, its panes with it; the page draws it no more until it is docked back. */
function popOut(id) {
  const t = tabOf(id);
  if (!t || tabs.list.length < 2) return;
  save(outKey(id), t);
  const win = window.open(`${location.pathname}${tabHref(t)}`, `pelago-tab:${id}`, `popup,width=${Math.round(innerWidth / 2)},height=${Math.round(innerHeight)}`);
  if (!win) return save(outKey(id), null);
  windows.set(id, win);
  const n = tabs.list.indexOf(t);
  tabs.list.splice(n, 1);
  if (id === tabs.front) show(tabs.list[Math.max(0, n - 1)]);
  else (keep(), drawStrip());
}

// ---- The strip: a tab for each, in the top bar.

/** What a tab is called: the session it follows, in its hue, else what its pane in focus draws (a saved canvas or an item by its name, a lens by what it finds). */
function nameOfTab(t) {
  const session = t.follows && !['all', 'none'].includes(t.follows) ? t.follows : null;
  if (session) return { name: heard.has(session) ? nameOf(session) : (t.named ?? nameOf(session)), hue: sessionHue(heard.get(session)?.name ?? t.word ?? t.named), session };
  const id = named(t.panes[focusOf(t)]?.at);
  if (/^e_[a-z0-9]{8}$/.test(id) && !titles.has(id) && !asked.has(id)) {
    asked.add(id);
    api('get', { id }).then((got) => (titles.set(id, got.entity.title), drawStrip()), () => {});
  }
  if (/^e_[a-z0-9]{8}$/.test(id)) return { name: titles.get(id) ?? '…' };
  const lens = id ? readFlatLens(id.split('?')[1] ?? '').lens : null;
  // A lens that names a view, by the canvas a pack ships for it, else by the view's name.
  if (lens?.view) return { name: (state.schema?.canvases ?? []).find((c) => c.props?.view === lens.view)?.title ?? lens.view };
  // Named by what it finds but its types, which say little of a tab; by its types only when it has nothing else.
  const { types, ...rest } = lens?.filter ?? {};
  return { name: (lens && (filterSaid(rest, drawStrip) || filterSaid(lens.filter, drawStrip))) || 'Home' };
}
/** The items a tab is named by whose titles were asked for, once each. */
const asked = new Set();
/** Follow a press on a tab: a press brings it into sight, a drag out of the page pops it out. */
function pressTab(ev, t, out) {
  if (ev.button !== 0 || ev.target.closest('.tab-act')) return;
  const el = ev.currentTarget;
  el.setPointerCapture(ev.pointerId);
  const up = (e) => {
    el.removeEventListener('pointerup', up);
    const outside = e.clientX < 0 || e.clientY < 0 || e.clientX > innerWidth || e.clientY > innerHeight;
    if (out) windowOf(t.id)?.focus();
    else if (outside) popOut(t.id);
    else toFront(t.id);
  };
  el.addEventListener('pointerup', up);
}
function tabEl(t, out) {
  const { name, hue, session } = nameOfTab(t);
  const inSight = t.id === tabs.front && !out;
  const whom = t.follows === 'none' ? 'follows nobody' : session ? 'follows its session' : 'follows everyone';
  const act = (label, mark, onclick) => h('button', { type: 'button', class: 'tab-act', title: label, 'aria-label': label, onclick }, mark);
  const el = h(
    'div',
    {
      class: `tab${out ? ' tab-out' : ''}`,
      role: 'tab',
      tabindex: '0',
      'aria-selected': String(inSight),
      'data-tab': t.id,
      'data-unseen': t.unseen && !inSight ? 'true' : null,
      'data-follows': t.follows === 'none' ? 'none' : null,
      title: [session && heard.get(session)?.label && `Session ${heard.get(session).name}`, name, whom, out && 'in a window of its own: press to go to it', !out && !inSight && 'drag it out of the page to pop it out'].filter(Boolean).join(' · '),
      style: hue ? `--session-hue: ${hue}` : null,
    },
    h('span', { class: `tab-name${session ? ' who-session' : ''}` }, name),
    // Every tab has the same controls, in sight or not, so nothing moves when another is brought into sight.
    !out && act('This tab: whom it follows, pop it out', '⋯', (ev) => tabMenu(ev.currentTarget, t)),
    !out && tabs.list.length > 1 && act('Close this tab', '×', () => closeTab(t.id)),
  );
  el.addEventListener('pointerdown', (ev) => pressTab(ev, t, out));
  el.addEventListener('keydown', (ev) => ev.key === 'Enter' && toFront(t.id));
  // A middle press closes it, as a browser's tab.
  el.addEventListener('auxclick', (ev) => ev.button === 1 && !out && closeTab(t.id));
  return el;
}
export function drawStrip() {
  if (!strip || poppedTab) return;
  const out = outTabs().filter((t) => !tabOf(t.id));
  const all = [...tabs.list.map((t) => [t, false]), ...out.map((t) => [t, true])];
  const fresh = h('button', { type: 'button', class: 'tab-new', title: 'New tab: this canvas in a tab of its own', 'aria-label': 'New tab', onclick: () => openTab(activeAt()) }, '+');
  strip.replaceChildren(...all.map(([t, o]) => tabEl(t, o)), fresh);
  document.body.dataset.tabs = String(all.length);
}

// ---- Whom the tab in sight follows: everyone, nobody, or one session (its run, or the agent's name).

/** The reader picks whom the tab in sight follows; a session it held lets go of it. */
function setFollows(follows, t = front()) {
  Object.assign(t, { follows, named: heard.has(follows) ? nameOf(follows) : undefined, word: heard.get(follows)?.name });
  for (const key of [...landed.keys()]) if (key.startsWith(`${t.id}:`)) landed.delete(key);
  keep();
  drawStrip();
}
/** A tab's menu, over everything (a popover: the strip clips what hangs below it): whom it follows (everyone, nobody, the sessions heard from lately, newest first), and pop out. */
const menuEl = h('div', { class: 'menu-items tab-menu', popover: 'auto', role: 'menu', 'aria-label': 'This tab' });
document.body.append(menuEl);
function tabMenu(anchor, t) {
  const now = t.follows ?? 'all';
  const sessions = [...heard].sort(([, a], [, b]) => b.at - a.at).map(([key]) => key);
  if (!['all', 'none', ...sessions].includes(now)) sessions.unshift(now);
  const pick = (key, said, title) => h('button', { type: 'button', role: 'menuitemradio', 'aria-checked': String(key === now), title, onclick: () => (menuEl.hidePopover(), setFollows(key, t)) }, said);
  menuEl.replaceChildren(
    ...[
      h('div', { class: 'tab-menu-head', title: 'Whose shows and changes come into this tab' }, 'Follows'),
      pick('all', 'Everyone', 'Every session’s, unless another tab follows it'),
      pick('none', 'Nobody', 'No agent moves this tab'),
      ...sessions.map((key) => pick(key, key === now && !heard.has(key) ? (t.named ?? nameOf(key)) : nameOf(key), key)),
      tabs.list.length > 1 && h('hr'),
      tabs.list.length > 1 && h('button', { type: 'button', role: 'menuitem', title: 'Into a window of its own: ⇲ there docks it back', onclick: () => (menuEl.hidePopover(), popOut(t.id)) }, 'Pop out'),
    ].filter(Boolean),
  );
  menuEl.showPopover();
  placeBy(menuEl, anchor);
}

/** The query bar's own: the pane's buttons (in a popped window, dock back). Whom the tab follows and a new tab are the strip's. */
hooks.paneButtons = () => {
  const button = (label, title, mark, onclick) => h('button', { type: 'button', class: 'q-save', title, 'aria-label': label, onclick }, mark);
  return [...paneButtons(), poppedTab && button('Dock back', 'Dock this window back into the main one, as a tab', '⇲', dockBack)].filter(Boolean);
};

// ---- In a window popped out: the tab keeps itself where the main page reads it, docks back whole, and is let go when closed.

let docking = false;
function dockBack() {
  save(outKey(poppedTab), { ...front(), docked: true });
  docking = true;
  window.close();
}
if (poppedTab) {
  document.body.dataset.popped = 'true';
  // A reload is a pagehide too: the window keeps its tab for itself, and the main page reads it again once it has drawn.
  addEventListener('pagehide', () => {
    save('pelago-tab', front(), sessionStorage);
    if (!docking) save(outKey(poppedTab), null);
  });
  setTimeout(keep, 0);
}

// The page open over the tab in sight is the tab's: it keeps it, and its name in the strip follows its panes.
const sheetOf = (hash) => (/^#\/(e\/e_[a-z0-9]{8}|s\/[^?]*|workspace|you|new[^?]*)/.exec(hash)?.[1]);
addEventListener('hashchange', () => {
  front().sheet = sheetOf(location.hash);
  keep();
  drawStrip();
});
hooks.paneMoved = () => drawStrip();
// What a popped window docked back or let go, or another of the reader's pages changed, is drawn here as it is kept.
addEventListener('storage', (ev) => {
  if (poppedTab) return;
  if (isOutKey(ev.key)) {
    const before = new Set(tabs.list.map((t) => t.id));
    outTabs();
    const back = tabs.list.find((t) => !before.has(t.id));
    if (back) toFront(back.id);
    keep();
    drawStrip();
  } else if (ev.key === listKey()) {
    const mine = tabs.front;
    read();
    if (tabOf(mine)) tabs.front = mine;
    draw();
    drawStrip();
  }
});

let started = false;
/** Draw the tabs kept and the panes of the one in sight, once the map's schema is read (ui/app.js): what they draw is read through it. */
export function startTabs() {
  if (started) return;
  started = true;
  // A look's page (the server's own, ui/look.js) draws the view it was asked for alone, in one pane, with no tabs.
  if (lookMode) {
    tabs.list = [freshTab(location.hash || '#/')];
    tabs.front = tabs.list[0].id;
    return startPanes();
  }
  // The page opened on an address: the page it names is open over the tab in sight (its lens goes to the pane in focus, ui/app.js).
  front().sheet = sheetOf(location.hash);
  keep();
  startPanes();
  drawStrip();
}
