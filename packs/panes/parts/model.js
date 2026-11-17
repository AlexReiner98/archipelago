// The tabs and their panes as data, for the panes pack's parts (task e_d5ewsvgf, decision e_bn76z5fu): what the host
// modules in packs/panes/page/ keep in tabs.js and change in panes.js and tab-bar.js, with no page, no storage and no
// clock of its own. A tab keeps one pane, its address and its
// own back and forth. A tab is one canvas (Alex, 17 Nov 2026: no split panes); a tab kept with more is cut to its pane in
// focus as it is read (`alone`). Every change here is a function of the model and what was asked, answering the model changed in
// place; the part keeps it (tools.keep) and draws it. Ids come from `newId`, handed in, so a test can name them.

/** What a new tab or pane draws: no query, and so nothing, until the reader finds something or a show lands there. */
export const BLANK = 'v?nothing=';
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
export function atOf(hash, hasLens = (q) => /(^|&)(f|find|lens|canvas|view|islands)=/.test(q)) {
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
  return /(^|&)(find|only|view|canvas|islands)=/.test(query) ? `v?${query}` : `v?find=id+${item}&${FOCUS}`;
}

/** A pane: the address it draws, its back and forth, and the chat it was made for (by). */
export const freshPane = (at, more = {}) => ({ at: asPane(at || '#/'), back: [], forth: [], ...more });
/** A tab: its one pane, and whom it follows. */
export function freshTab(newId, at = BLANK, { by, ...more } = {}) {
  const p = newId('p');
  return { id: newId('t'), follows: 'none', dir: 'row', groups: [p], sizes: [1], panes: { [p]: freshPane(at, { ...(by && { by }) }) }, focus: p, ...more };
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
/** The sessions whose next show lands in tab `t`: the one it follows or is the tab of. */
export const landsIn = (m, t) => (t ? [...new Set([t.follows, t.chat].filter((r) => r && r !== 'none'))] : []);

/** Tab `t` cut to its pane in focus: a tab kept from when a tab held several. */
export function alone(t) {
  const id = focusOf(t);
  return Object.assign(t, { dir: 'row', groups: [id], sizes: [1], panes: { [id]: t.panes[id] }, focus: id });
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
/** The session a tab follows, if it follows one. */
export const sessionOfTab = (t) => (t.follows && t.follows !== 'none' ? t.follows : null);
/** Whether tab `t` can be closed: any chat's, and the owner's while they have another. */
export const closable = (m, t) => Boolean(t.chat) || m.list.filter((o) => !o.chat).length > 1;

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
