// The tabs and their panes as data, for the panes pack's parts (task e_d5ewsvgf, decision e_bn76z5fu): what the host
// modules in packs/panes/page/ keep in tabs.js and change in panes.js and tab-bar.js, with no page, no storage and no
// clock of its own. A tab is a set of panes side by side (decision e_mzer5m4t); each pane keeps its address and its
// own back and forth. Every change here is a function of the model and what was asked, answering the model changed in
// place; the part keeps it (tools.keep) and draws it. Ids come from `newId`, handed in, so a test can name them.

/** What a new tab or pane draws: no query, and so nothing, until the reader finds something or a show lands there. */
export const BLANK = 'v?nothing=';
/** The sides a pane is docked on, beside the pane it is put by: along a row, or down a column. */
export const SIDES = { left: ['row', 0], right: ['row', 1], above: ['column', 0], below: ['column', 1] };

/** An address of the page (#/v?…, #/) as a pane's own. */
export const asPane = (href) => String(href ?? '').replace(/^#\//, '') || 'v';
/** A pane's address as the page's: Home is #/. */
export const hrefOf = (at) => (!at || at === 'v' ? '#/' : `#/${at}`);
/** Whether an address can be drawn in a pane: a canvas, an item's or a web page (`w?url=…`). */
export const drawable = (at) => /^(v\b|e\/e_|w\?)/.test(at ?? '');
/** The web address a pane's address frames, or nothing when it draws the map. */
export const webOf = (at) => (/^(#\/)?w\?/.test(at ?? '') ? (new URLSearchParams(at.split('?')[1]).get('url') ?? undefined) : undefined);
/** The saved canvas or item an address names first: two panes on it draw the same. */
export const named = (at) => {
  const bare = (at ?? '').replace(/^#\//, '');
  return /canvas=(e_[a-z0-9]{8})/.exec(bare)?.[1] ?? /^e\/(e_[a-z0-9]{8})/.exec(bare)?.[1] ?? bare;
};
/** What an address of the page draws in a pane (`v`, `v?…`, `w?…`), or undefined where it names a page and no lens. */
export function atOf(hash, hasLens = (q) => /(^|&)(f|find|lens|canvas|view)=/.test(q)) {
  const [where, query = ''] = (hash || '#/').split('?');
  const [, name = '', arg] = where.split('/');
  if (name === '') return 'v';
  if (name === 'v') return query ? `v?${query}` : 'v';
  if (name === 'w') return query ? `w?${query}` : 'v';
  if (name === 'e' && arg && hasLens(query)) return `v?${query}`;
  return undefined;
}

/** What an item's own canvas draws: the item and what it is part of, depends on and waits on (packs/surface/page/query.js FOCUS). */
const FOCUS = 'over=part_of%2Cdepends_on%2Cwaits_on&steps=1';
/**
 * A pane's address for an address of the page: an item's page draws the lens beside it, else the item's own canvas,
 * so a pane never stands at an item's page.
 */
export function paneAt(href) {
  const bare = asPane(href);
  const [where, query = ''] = bare.split('?');
  const item = /^e\/(e_[a-z0-9]{8})$/.exec(where)?.[1];
  if (!item) return bare;
  return /(^|&)(find|only|view|canvas)=/.test(query) ? `v?${query}` : `v?find=id+${item}&${FOCUS}`;
}

/** A pane: the address it draws, its back and forth, and whose it is (slot, held, by). */
export const freshPane = (at, more = {}) => ({ at: asPane(at || '#/'), back: [], forth: [], ...more });
/** A tab: its panes, each its share, whom it follows, and the pane last touched in it. */
export function freshTab(newId, at = BLANK, { slot, held, by, ...more } = {}) {
  const p = newId('p');
  return { id: newId('t'), follows: 'none', dir: 'row', groups: [p], sizes: [1], panes: { [p]: freshPane(at, { ...(slot && { slot }), ...(held && { held }), ...(by && { by }) }) }, focus: p, ...more };
}
/** Whether a tab kept is whole: an id, panes, a share for each. */
export const sound = (t) => typeof t?.id === 'string' && t.groups?.length > 0 && t.sizes?.length === t.groups.length && t.groups.every((g) => t.panes?.[g]);

/** The model: the tabs in order and the one in sight. */
export const model = (list = [], front = null) => ({ list, front: front ?? list[0]?.id ?? null });
/** The tab in sight. */
export const frontOf = (m) => m.list.find((t) => t.id === m.front) ?? m.list[0];
export const tabOf = (m, id) => m.list.find((t) => t.id === id);
/** The pane of tab `t` last touched, else its first. */
export const focusOf = (t) => (t.groups.includes(t.focus) ? t.focus : t.groups[0]);
/** The address a tab stands at: its pane in focus, under the page open over it. */
export function tabHref(t) {
  const href = hrefOf(t.panes[focusOf(t)]?.at);
  if (!t.sheet) return href;
  if (!/^e\/e_[a-z0-9]{8}$/.test(t.sheet)) return `#/${t.sheet}`;
  const query = href.split('?')[1];
  return `#/${t.sheet}${query ? `?${query}` : ''}`;
}
/** The sessions whose next show lands in tab `t`: the one it follows or is the tab of, and one holding a pane in it no other tab follows. */
export function landsIn(m, t) {
  if (!t) return [];
  const runs = new Set([t.follows, t.chat].filter((r) => r && r !== 'none'));
  for (const g of t.groups) for (const r of [t.panes[g]?.held, t.panes[g]?.by]) if (r && !m.list.some((o) => o !== t && o.follows === r)) runs.add(r);
  return [...runs].slice(0, 24);
}

const even = (t) => (t.sizes = t.groups.map(() => 1 / t.groups.length));

/** Put pane `id` on this side of pane `by` in tab `t`: a side across the tab's direction turns it. */
export function place(t, id, side, by) {
  const [dir, after] = SIDES[side] ?? SIDES.right;
  t.groups = t.groups.filter((g) => g !== id);
  if (t.groups.length === 1 || dir !== t.dir) t.dir = dir;
  t.groups.splice(Math.max(0, t.groups.indexOf(by)) + after, 0, id);
  even(t);
  return t;
}
/**
 * Open this address in a pane on this side of pane `by` in tab `t`; one already on it is moved there. A pane opened for
 * a session (slot, held, by), or `anew`, is its own. Answers the pane's id, or null for an address no pane draws.
 */
export function openPane(t, newId, at, side = 'right', by = undefined, { anew = false, ...own } = {}) {
  if (!drawable(at)) return null;
  const same = !anew && !own.slot && !own.held && !own.by && Object.entries(t.panes).find(([id, p]) => t.groups.includes(id) && !p.slot && !p.held && named(p.at) === named(at));
  const id = same?.[0] ?? newId('p');
  t.panes[id] = { ...freshPane(at), ...t.panes[id], at, ...own };
  place(t, id, side, by ?? focusOf(t));
  return id;
}
/** Close pane `id` of tab `t`; the last one stays. Whether it closed. */
export function closePane(t, id) {
  if (t.groups.length < 2 || !t.groups.includes(id)) return false;
  const n = t.groups.indexOf(id);
  t.groups = t.groups.filter((g) => g !== id);
  delete t.panes[id];
  if (t.focus === id) t.focus = t.groups[Math.max(0, n - 1)];
  even(t);
  return true;
}
/** Only pane `id` in tab `t`, the others closed. */
export function only(t, id) {
  if (t.groups.includes(id)) Object.assign(t, { dir: 'row', groups: [id], sizes: [1], panes: { [id]: t.panes[id] }, focus: id });
  return t;
}
/** Give pane `id` another address: a step in its history unless `step` is false. Whether it moved. */
export function goPane(t, id, at, step = true, most = 50) {
  const p = t.panes[id];
  if (!p || at === p.at) return false;
  if (step) ((p.back = [...(p.back ?? []), p.at].slice(-most)), (p.forth = []));
  p.at = at;
  return true;
}
/** Back (-1) or forth (1) in pane `id`'s history; whether it moved. */
export function travel(t, id, by, most = 50) {
  const p = t.panes[id];
  const [there, here] = by < 0 ? ['back', 'forth'] : ['forth', 'back'];
  if (!p?.[there]?.length) return false;
  const next = p[there].pop();
  p[here] = [...(p[here] ?? []), p.at].slice(-most);
  p.at = next;
  return true;
}
/** Share the room between panes `n` and `n + 1` of tab `t`, the line between them at `at` (a share of the page). */
export function share(t, n, at) {
  if (n < 0 || n + 1 >= t.sizes.length) return t;
  const pair = t.sizes[n] + t.sizes[n + 1];
  const least = pair * 0.15;
  t.sizes[n] = Math.min(pair - least, Math.max(least, at - t.sizes.slice(0, n).reduce((a, b) => a + b, 0)));
  t.sizes[n + 1] = pair - t.sizes[n];
  return t;
}
/** A pane dragged in tab `t` let go: on a side of another, docked there; in its middle, the two swap. Tabs and out are the strip's. */
export function dropPane(t, id, target, zone) {
  if (!t.groups.includes(id) || !t.groups.includes(target) || id === target) return false;
  if (zone !== 'center') return (place(t, id, zone, target), true);
  const [a, b] = [t.groups.indexOf(id), t.groups.indexOf(target)];
  [t.groups[a], t.groups[b]] = [target, id];
  return true;
}

/** The session a tab follows, if it follows one. */
export const sessionOfTab = (t, watch = 'watch') => (t.follows && !['all', 'none', watch].includes(t.follows) ? t.follows : null);
/** Whether tab `t` can be closed: any chat's, and the owner's while they have another. */
export const closable = (m, t) => Boolean(t.chat) || m.list.filter((o) => !o.chat).length > 1;

/**
 * Move panes of tab `from` (all unless named) into tab `to`, beside its own, and bring `to` into sight. A tab left with
 * no pane goes; panes from a tab following a session are held for it again.
 */
export function joinTab(m, from, to, ids = from.groups) {
  const session = from.follows === to.follows ? null : sessionOfTab(from);
  for (const id of ids) {
    to.panes[id] = { ...from.panes[id], ...(session && { held: session }) };
    delete from.panes[id];
  }
  to.groups = [...to.groups, ...ids];
  even(to);
  from.groups = from.groups.filter((g) => !ids.includes(g));
  even(from);
  if (!from.groups.length) m.list = m.list.filter((t) => t !== from);
  m.front = to.id;
  return m;
}
/** Move pane `id` of the tab in sight into a tab of its own beside it, in sight; a pane held for a session takes it along. */
export function paneToTab(m, newId, id, session) {
  const from = frontOf(m);
  const pane = from?.panes[id];
  if (!pane || from.groups.length < 2) return null;
  const { held, ...kept } = pane;
  const follows = held ?? session;
  const t = { ...freshTab(newId), ...(follows && { follows }) };
  Object.assign(t, { groups: [id], focus: id, sizes: [1], panes: { [id]: kept } });
  closePane(from, id);
  m.list.splice(m.list.indexOf(from) + 1, 0, t);
  m.front = t.id;
  return t.id;
}
/** Close tab `id`, bringing its neighbour into sight when it was; whether it closed. */
export function closeTab(m, id) {
  const n = m.list.findIndex((t) => t.id === id);
  if (n < 0 || !closable(m, m.list[n])) return false;
  m.list.splice(n, 1);
  if (id === m.front) m.front = m.list[Math.max(0, n - 1)].id;
  return true;
}
/** Open a tab on this address, in sight or marked as having something new. Answers its id. */
export function openTab(m, newId, at, own = {}, inSight = true) {
  const t = freshTab(newId, at, own);
  m.list.push(t);
  if (inSight) m.front = t.id;
  else t.unseen = true;
  return t.id;
}
/** Bring tab `id` into sight; whether it moved. */
export function toFront(m, id) {
  const t = tabOf(m, id);
  if (!t || id === m.front) return false;
  m.front = id;
  t.unseen = false;
  return true;
}
/** Keep a chat's tab: every pane in it is the owner's, so it stays when the chat ends. */
export function keepTab(t) {
  delete t.chat;
  delete t.ended;
  for (const g of t.groups) delete t.panes[g].by;
  return t;
}
