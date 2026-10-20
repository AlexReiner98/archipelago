// Search: the search box and what it finds, grouped by how high each thing sits (docs/ui-strategy.md): the pictures
// first, then projects, streams and steps, so a search for "kernel" shows the feature before its tasks.

import { api, h, part, state } from './base.js';
import { ago, chip, link, pill, typeChoice, typeTitle, workType } from './words.js';
import { seekTokens } from './token-piece.js';
import { pictureHref } from './atlas.js';

// ---- Search --------------------------------------------------------------

/** What is asked for. It is kept in the address (#/map?q=…&type=…&open=…), so a reload, Back or a link keeps it. */
export const mapState = { q: '', type: '', open: 'open' };

/** The address of a search: what is asked for, leaving out what is as it opens. */
export function searchHref({ q = '', type = '', open = 'open' } = {}) {
  const query = new URLSearchParams({ ...(q.trim() && { q }), ...(type && { type }), ...(open !== 'open' && { open }) }).toString();
  return `#/map${query ? `?${query}` : ''}`;
}

/** What the address asks for: what follows the ? of #/map. */
function readState(query) {
  const p = new URLSearchParams(query);
  mapState.q = p.get('q') ?? '';
  mapState.type = state.schema.types.some((t) => t.id === p.get('type')) ? p.get('type') : '';
  mapState.open = ['closed', 'all'].includes(p.get('open')) ? p.get('open') : 'open';
}

/** The search box alone, above an open item or a graph: what is typed is looked for on the Search screen. */
export function searchBar() {
  const go = (e) => {
    if (e.key !== 'Enter') return;
    location.hash = searchHref({ q: e.target.value });
  };
  // Typing here is not an edit that a redraw would lose.
  part('map').replaceChildren(h('div', { class: 'toolbar' }, h('input', { type: 'search', placeholder: 'Search titles and text', style: 'flex: 1; min-width: 200px', onkeydown: go, oninput: (e) => e.stopPropagation() })));
}

/** The levels results are grouped by, highest first; what no pack puts on a level comes last. */
const LEVELS = [
  ['workspace', 'Workspace'],
  ['project', 'Projects'],
  ['stream', 'Streams'],
  ['step', 'Steps'],
  [undefined, 'Other'],
];
const altitudeOf = (typeId) => state.schema.types.find((t) => t.id === typeId)?.altitude;

/** Each cell on one line: what does not fit is cut, and the whole of it is in the tooltip. */
const cell = (attrs, ...children) => h('td', { class: 'nowrap', ...attrs }, ...children);
// It spans three columns and keeps a cell of its own in the fourth, which a narrow screen hides with the column.
const groupHead = (title, n) => h('tr', { class: 'group-head' }, cell({ colspan: 3 }, title, h('span', { class: 'muted', style: 'font-weight: 400' }, `  ${n}`)), cell({ class: 'nowrap when' }));

const itemRow = (e) =>
  h('tr', {}, cell({}, chip(e.type)), cell({ title: e.title }, link(e), e.confidence < 1 && h('span', { class: 'muted small' }, `  confidence ${e.confidence}`)), cell({}, pill(e.type, e.status)), cell({ class: 'nowrap muted when' }, ago(e.updated_at)));

/** A picture found by its name or by what it is of: it opens the picture itself. */
const pictureRow = (p) => {
  const of = p.of ? `of ${p.of.title}` : 'of the whole map';
  return h(
    'tr',
    {},
    cell({}, h('span', { class: 'chip' }, 'Picture')),
    cell({ title: `${p.title}\n${of}` }, h('a', { href: pictureHref(p) }, p.title), h('span', { class: 'muted small' }, `  ${of}`)),
    cell({}, p.pinned && h('span', { class: 'pill' }, 'pinned')),
    cell({ class: 'nowrap muted when' }),
  );
};

/** A token found by name: it leads to the item it is within, whose Tokens for this lists it, or to the Workspace screen. */
const tokenRow = (t) => {
  const where = t.within?.length ? `#/e/${t.within[0]}` : '#/workspace';
  const on = t.within?.length ? `Under Tokens for this on ${(t.within_titles ?? t.within).join(', ')}` : 'On the Workspace screen';
  return h(
    'tr',
    {},
    cell({}, h('span', { class: 'chip' }, 'Token')),
    cell({ title: on }, h('a', { href: where, onclick: t.within?.length ? seekTokens(t.within[0]) : undefined }, t.name), t.within?.length > 0 && h('span', { class: 'muted small' }, `  ${t.within_titles?.[0] ?? t.within[0]}${t.within.length > 1 ? ` +${t.within.length - 1}` : ''}`)),
    cell({}, h('span', { class: `pill${t.revoked_at ? ' closed' : ''}` }, t.revoked_at ? 'revoked' : t.may === 'report' ? 'reports' : t.may === 'propose' ? 'proposes' : t.kind)),
    cell({ class: 'nowrap muted when' }, t.last_used ? ago(t.last_used) : 'never used'),
  );
};

/** What was found, as one table with a heading for each group that has something in it. */
function table(pictures, rows, tokens) {
  const groups = [['Pictures', pictures.map(pictureRow)], ...LEVELS.map(([level, title]) => [title, rows.filter((e) => altitudeOf(e.type) === level).map(itemRow)]), ['Tokens', tokens.map(tokenRow)]].filter(([, r]) => r.length);
  return h(
    'table',
    { class: 'list found' },
    // The heading's widths are the columns' (a fixed table): the title takes what is left.
    h('thead', {}, h('tr', {}, h('th', { style: 'width: 120px' }, 'Type'), h('th', {}, 'Title'), h('th', { style: 'width: 110px' }, 'Status'), h('th', { class: 'when', style: 'width: 90px' }, 'Changed'))),
    h('tbody', {}, groups.map(([title, r]) => [groupHead(title, r.length), r])),
  );
}

/** Each search asked for is numbered: a reply to one that has since been replaced is dropped, so a slow answer never covers a newer one. */
let asked = 0;
/** Typing is looked for once it pauses, not at every key. */
let typing;
const PAUSE = 150;

export function map(query = '') {
  readState(query);
  const main = part('map');
  const results = h('div');
  const list = h('section', { class: 'card', hidden: true }, results);
  const rest = h('div', { class: 'inbox' });
  const open = () => (mapState.open === 'all' ? undefined : mapState.open === 'open');
  const run = async () => {
    const mine = ++asked;
    const current = () => mine === asked && main.contains(list);
    // With nothing asked for, the page shows what there is to ask about: each kind with its count.
    const resting = !mapState.q.trim() && !mapState.type;
    rest.hidden = !resting;
    list.hidden = resting;
    if (resting) return atRest(current);
    try {
      const q = mapState.q.trim();
      const [rows, tokens, atlas] = await Promise.all([
        // Sources and notifications are provenance, not work: listed only when their type is asked for.
        api('search', { q: q || undefined, type: mapState.type || undefined, open: open(), system: mapState.type ? undefined : false, limit: 200 }),
        // Tokens are not items: found by name, each leading to the page that lists it.
        q && !mapState.type ? api('token_list', { q }).catch(() => []) : [],
        q && !mapState.type ? api('view', { name: 'atlas', params: { q, limit: 12 } }).catch(() => null) : null,
      ]);
      if (!current()) return;
      const pictures = atlas?.pictures ?? [];
      // A picture's lens is listed once, as the picture.
      const lenses = new Set(pictures.map((p) => p.lens));
      const found = rows.filter((e) => !lenses.has(e.id));
      const keys = tokens.filter((t) => (mapState.open === 'closed') === Boolean(t.revoked_at) || mapState.open === 'all');
      results.replaceChildren(pictures.length || found.length || keys.length ? table(pictures, found, keys) : h('div', { class: 'empty' }, 'Nothing matches.'));
    } catch (err) {
      if (current()) results.replaceChildren(h('div', { class: 'error' }, err.message));
    }
  };
  const ask = (changes, wait = 0) => {
    Object.assign(mapState, changes);
    history.replaceState(history.state, '', searchHref(mapState));
    clearTimeout(typing);
    if (wait) typing = setTimeout(run, wait);
    else run();
  };
  const atRest = async (current) => {
    try {
      const counts = await api('view', { name: 'kinds', params: { open: open(), system: false } });
      if (!current()) return;
      // Drawn once and kept while the kinds under it are counted again, so the list does not blink.
      const top = rest.querySelector('.projects-top') ?? h('div', { class: 'projects-top' });
      rest.replaceChildren(
        top,
        h(
          'div',
          { class: 'tiles kinds' },
          counts.map(({ type, count }) => h('button', { class: 'tile kind', onclick: () => ((typeSelect.value = type), ask({ type })) }, h('strong', {}, count), h('span', {}, typeTitle(type)))),
        ),
      );
    } catch (err) {
      if (current()) rest.replaceChildren(h('div', { class: 'error' }, err.message));
    }
  };
  const typeSelect = h('select', { onchange: (e) => ask({ type: e.target.value }) }, h('option', { value: '' }, 'All types'), state.schema.types.filter((t) => !t.dormant).map((t) => h('option', { value: t.id, selected: t.id === mapState.type }, typeChoice(t))));
  main.replaceChildren(
    h('div', { class: 'page-head' }, h('h1', {}, 'Search')),
    h(
      'div',
      { class: 'toolbar', style: 'margin-bottom: 12px' },
      h('input', { type: 'search', placeholder: 'Search titles and text', value: mapState.q, oninput: (e) => ask({ q: e.target.value }, PAUSE), autofocus: true, style: 'flex: 1 1 200px; min-width: 0' }),
      typeSelect,
      h('select', { onchange: (e) => ask({ open: e.target.value }) }, ['open', 'closed', 'all'].map((v) => h('option', { value: v, selected: v === mapState.open }, v === 'open' ? 'Unfinished' : v === 'closed' ? 'Finished' : 'Both'))),
      h('button', { onclick: () => (location.hash = `#/new/${mapState.type || workType()}`) }, 'New'),
      h('button', { title: 'The whole map as a picture', onclick: () => (location.hash = '#/graph') }, 'Map'),
    ),
    rest,
    list,
  );
  if (location.hash.startsWith('#/map')) main.querySelector('input[type=search]').focus();
  run();
}
