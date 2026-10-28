// The reader's tabs (ui/tab-bar.js): each a set of panes side by side (ui/panes.js), all of one kind, which stay
// together in it (decision e_mzer5m4t). Each pane keeps its own address and its own back and forth, here, so a reload
// draws every pane as it was. Where they stand is the reader's, kept in this browser for each workspace, as
// the canvas's settings are: never on the map, and meaning nothing. A tab follows everyone, nobody or one session
// (ui/pane-route.js). One popped out into a window of its own (e_ezb7s3a7) is kept apart, under its own key, by that
// window, so the two pages never write over each other; the main page reads it there, and takes it back when docked.

import { known, store } from './base.js';

/** In a window popped out of the main one, the tab it draws. */
export const poppedTab = window.name.startsWith('pelago-tab:') ? window.name.slice('pelago-tab:'.length) : null;
const ws = () => Object.entries(known.all()).find(([, w]) => w.token && w.token === store.token)?.[0] ?? 'here';
export const listKey = () => `pelago-tabs:${ws()}`;
/** Where the window a tab is popped out into keeps it. */
export const outKey = (id) => `pelago-tab:${ws()}:${id}`;
export const isOutKey = (key) => key?.startsWith(`pelago-tab:${ws()}:`);
export const newId = (prefix) => `${prefix}${Math.random().toString(36).slice(2, 10)}`;
/** A pane: the address it draws, its back and forth, and whose it is (`slot`, a name a session gave it; `held`, the session it is for). */
export const freshPane = (at, more = {}) => ({ at: asPane(at || '#/'), back: [], forth: [], ...more });
/** A tab: its panes, each its share, whom it follows, and the pane last touched in it; `sheet`, the page open over it when it was last in sight. */
export function freshTab(at = '#/', { slot, held, ...more } = {}) {
  const p = newId('p');
  return { id: newId('t'), follows: 'all', dir: 'row', groups: [p], sizes: [1], panes: { [p]: freshPane(at, { ...(slot && { slot }), ...(held && { held }) }) }, focus: p, ...more };
}
/** A tab kept before every pane was equal (its canvas `main`, its address `at`): the canvas becomes a pane like the others. */
function upgrade(t) {
  if (!t?.groups?.includes('main')) return t;
  const p = newId('p');
  const { at, slot, ...rest } = t;
  rest.panes = { ...(t.panes ?? {}), [p]: freshPane(at, slot ? { slot } : {}) };
  rest.groups = t.groups.map((g) => (g === 'main' ? p : g));
  if (!t.focus || t.focus === 'main') rest.focus = p;
  for (const [key, l] of landed) if (key === `${t.id}:main`) (landed.delete(key), landed.set(`${t.id}:${p}`, l));
  return rest;
}
const sound = (t) => typeof t?.id === 'string' && t.groups?.length > 0 && t.sizes?.length === t.groups.length && t.groups.every((g) => t.panes?.[g]);

const load = (key, from = localStorage) => {
  try {
    return JSON.parse(from.getItem(key) ?? 'null');
  } catch {
    return null;
  }
};
export const save = (key, value, to = localStorage) => {
  try {
    if (value === null) to.removeItem(key);
    else to.setItem(key, JSON.stringify(value));
  } catch {
    // Without storage, kept until the page is reloaded.
  }
};

/** When each pane last drew a session's step, by tab and pane (`<tab>:<pane>`): a tab that follows everyone is that session's while it is at work. */
export const landed = new Map();
/** The tabs of this page, in order, and the one in sight. */
export const tabs = { list: [], front: null };
export const front = () => tabs.list.find((t) => t.id === tabs.front) ?? tabs.list[0];
export const tabOf = (id) => tabs.list.find((t) => t.id === id);

/** The tabs in windows of their own, as each window keeps it; one docked back is taken into this page's tabs. */
export function outTabs() {
  const out = [];
  try {
    for (let n = 0; n < localStorage.length; n++) {
      const key = localStorage.key(n);
      if (!isOutKey(key)) continue;
      const t = upgrade(load(key));
      if (!sound(t)) continue;
      if (t.docked && !poppedTab) {
        const { docked: _, ...back } = t;
        tabs.list = [...tabs.list.filter((o) => o.id !== t.id), back];
        save(key, null);
      } else if (!t.docked) out.push(t);
    }
  } catch {
    // Without storage there are no windows to read.
  }
  return out;
}

/** Read the tabs kept: in a popped window its one tab (kept for a reload in the window's own session), else the page's. */
export function read() {
  if (poppedTab) {
    const t = upgrade(load(outKey(poppedTab)) ?? load('pelago-tab', sessionStorage));
    tabs.list = [sound(t) ? t : freshTab(location.hash, { id: poppedTab })];
    tabs.front = poppedTab;
    return;
  }
  const got = load(listKey());
  // Which session holds which tab outlives a reload, as long as it is recent.
  landed.clear();
  for (const [key, l] of Object.entries(got?.landed ?? {})) if (Date.now() - l.at < 600_000) landed.set(key, l);
  tabs.list = (got?.tabs ?? []).map(upgrade).filter(sound);
  outTabs();
  if (!tabs.list.length) tabs.list = [freshTab(location.hash || '#/')];
  tabs.front = tabs.list.some((t) => t.id === got?.front) ? got.front : tabs.list[0].id;
}
export function keep() {
  if (poppedTab) return save(outKey(poppedTab), front());
  save(listKey(), { tabs: tabs.list, front: tabs.front, landed: Object.fromEntries(landed) });
}

/** Whether an address can be drawn in a pane: a canvas or an item's, not the workspace's sheet. */
export const drawable = (at) => /^(v\b|e\/e_)/.test(at ?? '');
/** The saved canvas or item an address names first: two panes on it draw the same. */
export const named = (at) => {
  const bare = (at ?? '').replace(/^#\//, '');
  return /canvas=(e_[a-z0-9]{8})/.exec(bare)?.[1] ?? /^e\/(e_[a-z0-9]{8})/.exec(bare)?.[1] ?? bare;
};
/** An address of the page (#/v?…, #/) as a pane's own. */
export const asPane = (href) => href.replace(/^#\//, '') || 'v';
/** A pane's address as the page's: Home is #/. */
export const hrefOf = (at) => (!at || at === 'v' ? '#/' : `#/${at}`);
/** The pane of tab `t` last touched, else its first. */
export const focusOf = (t) => (t.groups.includes(t.focus) ? t.focus : t.groups[0]);
/**
 * The address a tab stands at: its pane in focus, under the page open over it (an item's page keeps the pane's lens
 * beside it, as a click on a node writes it).
 */
export function tabHref(t) {
  const href = hrefOf(t.panes[focusOf(t)]?.at);
  if (!t.sheet) return href;
  if (!/^e\/e_[a-z0-9]{8}$/.test(t.sheet)) return `#/${t.sheet}`;
  const query = href.split('?')[1];
  return `#/${t.sheet}${query ? `?${query}` : ''}`;
}
