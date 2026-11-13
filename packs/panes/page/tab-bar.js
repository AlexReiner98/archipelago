// Tabs at the top of the page (decision e_mzer5m4t): each a set of panes side by side, every one alike (packs/panes/page/panes.js),
// kept by packs/panes/page/tabs.js. Every chat at work has a tab of its own, named by its title and marked in its hue (ui/words.js),
// opened and closed as the chat begins and ends (packs/panes/page/tab-life.js), so its work mirrors into the page without squeezing a
// pane or opening a window; where a step lands is packs/panes/page/pane-route.js. The owner's own tabs stand at the left, the chats'
// after them (e_pfpgendq). There is no most: many tabs shrink to their mark and first letters (e_q3amet26). A tab, not a
// pane, pops out into a window of its own, from its strip or dragged out of the page, and docks back whole (e_ezb7s3a7).
// Tabs merge: from ⋯, or a tab dragged onto another, and a pane dragged onto a tab joins it (e_c5stzz6z's way back).
// What is the tab's own lives on the strip, never in the query bar, which shows the lens (decision e_j7ggggjr, asked):
// every tab has ⋯ (whom it follows, pop out) and ×, the same in sight or not, and + ends the strip, which shows with one tab too.
// A session's tab carries a mark for its state, and beside the strip a count of the sessions waiting on the owner goes
// to the oldest one (ui/tab-count.js, e_82rggead).

import { api, drawSlot, firstDrawn, h, hooks, state } from './base.js';
import { readAddress } from './query.js';
import { still } from './look.js';
import { placeBy } from './menu-place.js';
import { windowOf, windows } from './pane-busy.js';
import { followable, heard, hearOpen, nameOf, WATCH } from './pane-route.js';
import { activeIs, close, draw, paneAt, paneButtons, startPanes } from './panes.js';
import { filterSaid } from './query-bar.js';
import { countGoes, countTip, onYou, stateSaid } from './tab-count.js';
import { BLANK, byPart, dismissed, focusOf, front, freshTab, isOutKey, keep, landed, listKey, named, outKey, outTabs, poppedTab, read, save, tabHref, tabOf, tabs } from './tabs.js';
import { sessionHue, titles } from './words.js';

read();
const strip = document.getElementById('tabs');

/** Bring tab `t` into sight: its panes drawn, the address its pane in focus's, the page it had open over it open again. */
function show(t) {
  // A tab struck because its chat ended while it was in sight goes once the reader leaves it (packs/panes/page/tab-life.js).
  const left = front();
  if (left && left !== t && left.ended) for (const run of left.ended) hooks.settleTab?.(left, run);
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
hooks.paneToTab = (id, into) => {
  const from = front();
  const pane = from.panes[id];
  const to = tabOf(into);
  if (pane && to) return void (to !== from && joinTab(from, to, [id]));
  if (!pane || from.groups.length < 2) return;
  const { held, ...kept } = pane;
  const went = landed.get(`${from.id}:${id}`);
  // Whose it is: held for a session, in a tab that follows one, or named by the session that last drew there.
  const session = held ?? sessionOfTab(from) ?? (pane.slot ? went?.session : undefined);
  const t = { ...freshTab(), ...(session && { follows: session, named: heard.has(session) ? nameOf(session) : undefined, word: heard.get(session)?.name }) };
  t.groups = [id];
  t.focus = id;
  t.panes = { [id]: kept };
  if (went) (landed.delete(`${from.id}:${id}`), landed.set(`${t.id}:${id}`, went));
  close(id);
  tabs.list.splice(tabs.list.indexOf(from) + 1, 0, t);
  toFront(t.id);
};
/** The session a tab follows, if it follows one. */
const sessionOfTab = (t) => (t.follows && !['all', 'none', WATCH].includes(t.follows) ? t.follows : null);
/**
 * The way back: move panes of tab `from`, all of them unless named, into tab `to`, beside its own, in sight, the pane in
 * focus there staying so (the one in focus is the reader's: an agent's show never takes it). A tab left with no pane
 * goes. Panes from a tab following a session are held for it again, so its next show finds them wherever they went.
 */
function joinTab(from, to, ids = from.groups) {
  const session = from.follows === to.follows ? null : sessionOfTab(from);
  for (const id of ids) {
    to.panes[id] = { ...from.panes[id], ...(session && { held: session }) };
    delete from.panes[id];
    const went = landed.get(`${from.id}:${id}`);
    if (went) (landed.delete(`${from.id}:${id}`), landed.set(`${to.id}:${id}`, went));
  }
  const share = (t) => t.groups.map(() => 1 / t.groups.length);
  to.groups = [...to.groups, ...ids];
  to.sizes = share(to);
  from.groups = from.groups.filter((g) => !ids.includes(g));
  from.sizes = share(from);
  if (!from.groups.length) tabs.list = tabs.list.filter((t) => t !== from);
  show(to);
}
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
/** Whether tab `t` can be closed: any chat's, and the owner's while they have another (a page always keeps one of theirs). */
const closable = (t) => Boolean(t.chat) || tabs.list.filter((o) => !o.chat).length > 1;
function closeTab(id) {
  const n = tabs.list.findIndex((t) => t.id === id);
  if (n < 0 || !closable(tabs.list[n])) return;
  // A running chat's tab closed by hand stays closed until the chat next shows something (e_qvdrv6h3).
  const chat = tabs.list[n].chat;
  if (chat && !tabs.list[n].ended && !heard.get(chat)?.ended) dismissed.add(chat);
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
  const session = sessionOfTab(t);
  if (session) return { name: heard.has(session) ? nameOf(session) : (t.named ?? nameOf(session)), hue: sessionHue(heard.get(session)?.name ?? t.word ?? t.named), session };
  const id = named(t.panes[focusOf(t)]?.at);
  if (/^e_[a-z0-9]{8}$/.test(id) && !titles.has(id) && !asked.has(id)) {
    asked.add(id);
    firstDrawn.then(() => api('get', { id })).then((got) => (titles.set(id, got.entity.title), drawStrip()), () => {});
  }
  if (/^e_[a-z0-9]{8}$/.test(id)) return { name: titles.get(id) ?? '…' };
  const lens = id ? readAddress(id.split('?')[1] ?? '').lens : null;
  // A lens that names a view, by the canvas a pack ships for it, else by the view's name.
  if (lens?.view) return { name: (state.schema?.canvases ?? []).find((c) => c.props?.view === lens.view)?.title ?? lens.view };
  // A blank one, with no query, is a new tab.
  if (lens && !lens.filter.find?.length) return { name: 'New tab' };
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
  // Over another tab, a tab let go merges into it.
  const onto = (e) => (out ? null : [document.elementFromPoint(e.clientX, e.clientY)?.closest('#tabs > .tab:not(.tab-out)')].find((o) => o && o !== el));
  const lit = () => strip.querySelector('.tab-drop')?.classList.remove('tab-drop');
  const move = (e) => (lit(), onto(e)?.classList.add('tab-drop'));
  const up = (e) => {
    el.removeEventListener('pointermove', move);
    el.removeEventListener('pointerup', up);
    lit();
    const outside = e.clientX < 0 || e.clientY < 0 || e.clientX > innerWidth || e.clientY > innerHeight;
    const other = onto(e);
    if (out) windowOf(t.id)?.focus();
    else if (outside) popOut(t.id);
    else if (other) joinTab(t, tabOf(other.dataset.tab));
    else toFront(t.id);
  };
  el.addEventListener('pointermove', move);
  el.addEventListener('pointerup', up);
}
function tabEl(t, out) {
  const { name, hue, session } = nameOfTab(t);
  const inSight = t.id === tabs.front && !out;
  const one = session ? heard.get(session) : undefined;
  const st = session ? stateSaid(open.find((s) => s.id === session)?.session) : null;
  const whom = t.chat ? 'this chat’s tab: it closes as the chat ends' : session ? 'yours, following this chat' : 'yours';
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
      'data-chat': t.chat ? 'true' : null,
      'data-ended': t.chat && t.ended?.includes(t.chat) ? 'true' : null,
      'data-quiet': one?.quiet && !one.ended ? 'true' : null,
      'data-state': st?.state ?? null,
      title: [name, st?.said, whom, t.chat && t.ended?.includes(t.chat) && 'its chat has ended or gone quiet: it goes when you leave it', one?.quiet && !one.ended && 'not heard from for a while', out && 'in a window of its own: press to go to it', !out && !inSight && 'drag it out of the page to pop it out'].filter(Boolean).join(' · '),
      style: hue ? `--session-hue: ${hue}` : null,
    },
    st?.mark && h('span', { class: 'tab-state', 'aria-hidden': 'true' }, st.mark),
    h('span', { class: `tab-name${session ? ' who-session' : ''}` }, name),
    // Every tab has the same controls, in sight or not, so nothing moves when another is brought into sight.
    !out && act('This tab: whom it follows, pop it out', '⋯', (ev) => tabMenu(ev.currentTarget, t)),
    !out && closable(t) && act('Close this tab', '×', () => closeTab(t.id)),
  );
  el.addEventListener('pointerdown', (ev) => pressTab(ev, t, out));
  el.addEventListener('keydown', (ev) => ev.key === 'Enter' && toFront(t.id));
  // A middle press closes it, as a browser's tab.
  el.addEventListener('auxclick', (ev) => ev.button === 1 && !out && closeTab(t.id));
  return el;
}
export function drawStrip() {
  // The part draws the strip; the count of sessions waiting on the owner beside it is still drawn here.
  if (byPart.on) return void (poppedTab || drawCount([]));
  if (!strip || poppedTab) return;
  const out = outTabs().filter((t) => !tabOf(t.id));
  // The owner's tabs first, then the chats', each in the order they opened.
  const all = [...tabs.list.map((t) => [t, false]), ...out.map((t) => [t, true])].sort(([a], [b]) => Boolean(a.chat) - Boolean(b.chat));
  const fresh = h('button', { type: 'button', class: 'tab-new', title: 'New tab', 'aria-label': 'New tab', onclick: () => openTab(BLANK) }, '+');
  const els = all.map(([t, o]) => tabEl(t, o));
  // Set apart by space where the chats' begin.
  els.find((el, n) => n > 0 && el.dataset.chat && !els[n - 1].dataset.chat)?.classList.add('tab-chats');
  strip.replaceChildren(...els, fresh);
  document.body.dataset.tabs = String(all.length);
  drawCount(all.map(([t]) => t));
}

// ---- The sessions waiting on the owner, counted beside the strip, so every tab sees them.

/** The sessions open now, as the `sessions` view last answered. */
let open = [];
const countEl = h('button', { type: 'button', class: 'tab-count', hidden: true });
strip?.after(countEl);
function drawCount(all) {
  const yours = onYou(open);
  countEl.hidden = !yours.length || Boolean(poppedTab);
  if (countEl.hidden) return;
  const tip = countTip(yours, (s) => (heard.has(s.id) ? nameOf(s.id) : s.title ?? s.id));
  countEl.title = tip;
  countEl.setAttribute('aria-label', `${yours.length} waiting on you: ${tip}`);
  countEl.replaceChildren(h('span', { class: 'tab-state', 'aria-hidden': 'true' }, '↩'), String(yours.length));
  countEl.onclick = () => {
    const to = countGoes(yours, all);
    if (to?.tab) return tabOf(to.tab) ? toFront(to.tab) : windowOf(to.tab)?.focus();
    if (to?.page) location.hash = to.page;
  };
}

// ---- Whom the tab in sight follows: nobody, or one session (its run, or the agent's name).

/** The reader picks whom the tab in sight follows; a session it held lets go of it. */
function setFollows(follows, t = front()) {
  Object.assign(t, { follows, named: heard.has(follows) ? nameOf(follows) : undefined, word: heard.get(follows)?.name });
  for (const key of [...landed.keys()]) if (key.startsWith(`${t.id}:`)) landed.delete(key);
  keep();
  drawStrip();
}
/** A tab's menu, over everything (a popover: the strip clips what hangs below it): whom it follows (everyone, nobody, the sessions open now, newest first), pop out, and merge. */
const menuEl = h('div', { class: 'menu-items tab-menu', popover: 'auto', role: 'menu', 'aria-label': 'This tab' });
document.body.append(menuEl);
/** Ask which sessions are open: the menu is drawn at once from what is known, and again with the answer. */
const readOpen = () => api('view', { name: 'sessions' }).then((got) => ((open = got.open ?? []), hearOpen(open), hooks.sessionsOpen?.(open), drawStrip()), () => {});
/** A session was heard from (packs/surface/page/live.js): its state may have moved, so the open ones are read again, once for a burst. */
let rereading;
hooks.sessionsMoved = () => {
  if (poppedTab || rereading) return;
  rereading = setTimeout(() => ((rereading = undefined), readOpen()), 1000);
};
function tabMenu(anchor, t) {
  drawMenu(t);
  menuEl.showPopover();
  placeBy(menuEl, anchor);
  readOpen().then(() => {
    if (!menuEl.matches(':popover-open')) return;
    drawMenu(t);
    placeBy(menuEl, anchor);
  });
}
function drawMenu(t) {
  const now = t.follows ?? 'none';
  const sessions = followable({ now: Date.now(), recent: 600_000 });
  // What the tab follows stays in sight, ended or not, so the reader can see it and change it.
  if (!['none', WATCH, ...sessions].includes(now)) sessions.unshift(now);
  const pick = (key, said, title) => h('button', { type: 'button', role: 'menuitemradio', 'aria-checked': String(key === now), title, onclick: () => (menuEl.hidePopover(), setFollows(key, t)) }, said);
  menuEl.replaceChildren(
    ...[
      h('div', { class: 'tab-menu-head', title: 'Whose shows and changes come into this tab' }, 'Follows'),
      pick('none', 'Nobody', 'No agent moves this tab'),
      h('button', { type: 'button', role: 'menuitemradio', 'aria-checked': String(now === WATCH), title: 'Every session working on what this tab draws: each is drawn on its step, and its shows share one pane beside it', onclick: () => (menuEl.hidePopover(), hooks.watchTab?.(t), drawStrip()) }, 'Sessions in what it draws'),
      ...sessions.map((key) => pick(key, key === now && !heard.has(key) ? (t.named ?? nameOf(key)) : nameOf(key), key)),
      t.chat && h('hr'),
      t.chat && h('button', { type: 'button', role: 'menuitem', title: 'Make this tab yours: it stays when its chat ends', onclick: () => (menuEl.hidePopover(), keepTab(t)) }, 'Keep'),
      tabs.list.length > 1 && h('hr'),
      tabs.list.length > 1 && h('button', { type: 'button', role: 'menuitem', title: 'Into a window of its own: ⇲ there docks it back', onclick: () => (menuEl.hidePopover(), popOut(t.id)) }, 'Pop out'),
      tabs.list.length > 1 && h('div', { class: 'tab-menu-head', title: 'Put this tab’s panes beside those of another' }, 'Merge into'),
      ...tabs.list.filter((o) => o !== t).map((o) => h('button', { type: 'button', role: 'menuitem', onclick: () => (menuEl.hidePopover(), joinTab(t, o)) }, nameOfTab(o).name)),
    ].filter(Boolean),
  );
}

/** Keep a chat's tab: every pane in it is the owner's, so it stays as theirs when the chat ends (e_n7gpy3pt). */
function keepTab(t) {
  delete t.chat;
  delete t.ended;
  for (const g of t.groups) delete t.panes[g].by;
  keep();
  drawStrip();
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
hooks.drawStrip = () => drawStrip();
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
  // A look's page (the server's own, ui/look.js), and a frozen link's, draw the view they were asked for alone, in one pane, with no tabs.
  if (still) {
    tabs.list = [freshTab(location.hash || '#/')];
    tabs.front = tabs.list[0].id;
    return startPanes();
  }
  // The panes pack's part draws the tabs and the panes (packs/panes/parts/index.js), asked for with ?panes=part until a
  // press inside a dragged mark reaches its button (task e_rq9d73mg); the page's own draw them otherwise, and where
  // no part fills them.
  if (partAsked()) {
    byPart.on = true;
    void startPart().then((drawn) => drawn || ((byPart.on = false), startHost(), dispatchEvent(new HashChangeEvent('hashchange'))));
    return;
  }
  startHost();
}

/** Whether the panes part is asked for: ?panes=part, kept for this window's session and the windows it pops out. */
function partAsked() {
  try {
    if (new URLSearchParams(location.search).get('panes') === 'part') sessionStorage.setItem('pelago-panes-part', '1');
    return sessionStorage.getItem('pelago-panes-part') === '1';
  } catch {
    return new URLSearchParams(location.search).get('panes') === 'part';
  }
}

/**
 * Draw the tabs and the panes with the panes pack's part: the strip in the top bar, the panes in #canvas, one part mounted
 * twice, so one model. The query bar's back, forth and split go to it: a step of the browser's, and `split` told. True
 * when a part filled them.
 */
async function startPart() {
  const canvas = document.getElementById('canvas');
  if (!strip || !canvas) return false;
  // The strip lets presses through but for its tabs (ui/shell.css): the part's strip takes them.
  const top = h('div', { class: 'tabs-part', style: 'pointer-events: auto' });
  const filled = await drawSlot(top, { slot: 'tabs' }).catch((err) => (console.warn('The panes part did not draw:', err), false));
  if (!filled) return false;
  strip.replaceChildren(top);
  const panes = h('div', { class: 'panes-part' });
  canvas.replaceChildren(panes);
  await drawSlot(panes, { slot: 'tabs', piece: { slot: 'panes' } });
  document.body.dataset.panesBy = 'part';
  for (const hook of ['land', 'sessionEnded', 'sessionRested', 'sessionsOpen', 'settleTab', 'drawStrip', 'paneMoved', 'paneToTab', 'besidePane', 'watchTab']) delete hooks[hook];
  const button = (label, title, mark, onclick) => h('button', { type: 'button', class: 'q-save', title, 'aria-label': label, onclick }, mark);
  hooks.paneButtons = () => [
    button('Back', 'Back to what this pane drew before', '‹', () => history.back()),
    button('Forward', 'Forward again', '›', () => history.forward()),
    button('Split', 'Split: a new pane beside this one', '◫', () => hooks.tellSlot?.('tabs', { name: 'split' })),
    // In a popped window, its tab goes back into the main one as it closes.
    poppedTab && button('Dock back', 'Dock this window back into the main one, as a tab', '⇲', () => (hooks.tellSlot?.('tabs', { name: 'dock' }), setTimeout(() => window.close(), 300))),
  ].filter(Boolean);
  // The count beside the strip reads the sessions open, as it did beside the page's own strip.
  if (!poppedTab) (firstDrawn.then(readOpen), document.addEventListener('visibilitychange', () => document.visibilityState === 'visible' && readOpen()));
  return true;
}

/** Draw the tabs kept here and the panes of the one in sight, as this page has drawn them. */
function startHost() {
  // The page opened on an address: the page it names is open over the tab in sight (its lens goes to the pane in focus, ui/app.js).
  front().sheet = sheetOf(location.hash);
  keep();
  startPanes();
  drawStrip();
  if (!poppedTab) firstDrawn.then(readOpen);
  // Coming back to the page, what ended or began while it was out of sight is mirrored.
  document.addEventListener('visibilitychange', () => document.visibilityState === 'visible' && !poppedTab && readOpen());
}
