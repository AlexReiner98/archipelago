// The reader's tabs (ui/tab-bar.js): each a whole canvas and the panes split beside it (ui/panes.js), which stay
// together in it (decision e_mzer5m4t). Where they stand is the reader's, kept in this browser for each workspace, as
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
/** A tab: the address its canvas draws, whom it follows, and the panes split beside it, each its share. */
export const freshTab = (more = {}) => ({ id: newId('t'), at: '#/', follows: 'all', dir: 'row', groups: ['main'], sizes: [1], panes: {}, ...more });
const sound = (t) => typeof t?.id === 'string' && t.groups?.includes('main') && t.sizes?.length === t.groups.length;

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
      const t = load(key);
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
    const t = load(outKey(poppedTab)) ?? load('pelago-tab', sessionStorage);
    tabs.list = [sound(t) ? t : freshTab({ id: poppedTab, at: location.hash })];
    tabs.front = poppedTab;
    return;
  }
  const got = load(listKey());
  tabs.list = (got?.tabs ?? []).filter(sound);
  outTabs();
  if (!tabs.list.length) tabs.list = [freshTab({ at: location.hash || '#/' })];
  tabs.front = tabs.list.some((t) => t.id === got?.front) ? got.front : tabs.list[0].id;
  // Which session holds which tab outlives a reload, as long as it is recent.
  landed.clear();
  for (const [key, l] of Object.entries(got?.landed ?? {})) if (Date.now() - l.at < 600_000) landed.set(key, l);
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
