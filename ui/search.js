// Search: the search box and what it finds.

import { api, h, part, state } from './base.js';
import { ago, chip, link, pill, typeChoice, typeTitle, workType } from './words.js';

// ---- Search --------------------------------------------------------------

export const mapState = { q: '', type: '', open: 'open' };
/** The system's own records that are looked for like work: the rest (sources, notifications) are found from what they are about. */
export const FOUND = ['sys.automation', 'sys.run', 'sys.connection'];

/** The search box alone, above an open item or a graph: what is typed is looked for on the Search screen. */
export function searchBar() {
  const go = (e) => {
    if (e.key !== 'Enter') return;
    mapState.q = e.target.value;
    location.hash = '#/map';
  };
  // Typing here is not an edit that a redraw would lose.
  part('map').replaceChildren(h('div', { class: 'toolbar' }, h('input', { type: 'search', placeholder: 'Search titles and text', style: 'flex: 1; min-width: 200px', onkeydown: go, oninput: (e) => e.stopPropagation() })));
}

export function map() {
  const main = part('map');
  const results = h('div');
  const list = h('section', { class: 'card', hidden: true }, results);
  const rest = h('div', { class: 'inbox' });
  const run = async () => {
    // With nothing asked for, the page shows what there is to ask about: each kind with its count, and what moved last.
    const resting = !mapState.q.trim() && !mapState.type;
    rest.hidden = !resting;
    list.hidden = resting;
    if (resting) return atRest();
    try {
      let rows = await api('search', {
        q: mapState.q || undefined,
        type: mapState.type || undefined,
        open: mapState.open === 'all' ? undefined : mapState.open === 'open',
        limit: 200,
      });
      // Sources are provenance, not work: list them only when asked for.
      if (!mapState.type) rows = rows.filter((e) => !e.type.startsWith('sys.') || e.type === 'sys.connection');
      results.replaceChildren(
        rows.length
          ? h(
              'table',
              { class: 'list' },
              h('thead', {}, h('tr', {}, h('th', {}, 'Type'), h('th', {}, 'Title'), h('th', {}, 'Status'), h('th', {}, 'Changed'))),
              h('tbody', {}, rows.map((e) => h('tr', {}, h('td', { class: 'nowrap' }, chip(e.type)), h('td', {}, link(e), e.confidence < 1 && h('span', { class: 'muted small' }, `  confidence ${e.confidence}`)), h('td', {}, pill(e.type, e.status)), h('td', { class: 'nowrap muted' }, ago(e.updated_at))))),
            )
          : h('div', { class: 'empty' }, 'Nothing matches.'),
      );
    } catch (err) {
      results.replaceChildren(h('div', { class: 'error' }, err.message));
    }
  };
  const set = (key) => (e) => {
    mapState[key] = e.target.value;
    run();
  };
  const atRest = async () => {
    try {
      const rows = (await api('search', { open: mapState.open === 'all' ? undefined : mapState.open === 'open', limit: 200 })).filter((e) => !e.type.startsWith('sys.') || FOUND.includes(e.type));
      const counts = new Map();
      for (const e of rows) counts.set(e.type, (counts.get(e.type) ?? 0) + 1);
      // Drawn once and kept while the kinds under it are counted again, so the list does not blink.
      const top = rest.querySelector('.projects-top') ?? h('div', { class: 'projects-top' });
      rest.replaceChildren(
        top,
        h(
          'div',
          { class: 'tiles kinds' },
          [...counts].sort((a, b) => b[1] - a[1]).map(([type, n]) => h('button', { class: 'tile kind', onclick: () => ((mapState.type = type), map()) }, h('strong', {}, n), h('span', {}, typeTitle(type)))),
        ),
      );
    } catch (err) {
      rest.replaceChildren(h('div', { class: 'error' }, err.message));
    }
  };
  main.replaceChildren(
    h('div', { class: 'page-head' }, h('h1', {}, 'Search')),
    h(
      'div',
      { class: 'toolbar', style: 'margin-bottom: 12px' },
      h('input', { type: 'search', placeholder: 'Search titles and text', value: mapState.q, oninput: set('q'), autofocus: true, style: 'flex: 1; min-width: 200px' }),
      h('select', { onchange: set('type') }, h('option', { value: '' }, 'All types'), state.schema.types.filter((t) => !t.dormant).map((t) => h('option', { value: t.id, selected: t.id === mapState.type }, typeChoice(t)))),
      h('button', { onclick: () => (location.hash = `#/new/${mapState.type || workType()}`) }, 'New'),
      h('button', { title: 'The whole map as a picture', onclick: () => (location.hash = '#/graph') }, 'Map'),
      h('select', { onchange: set('open') }, ['open', 'closed', 'all'].map((v) => h('option', { value: v, selected: v === mapState.open }, v === 'open' ? 'Unfinished' : v === 'closed' ? 'Finished' : 'Both'))),
    ),
    rest,
    list,
  );
  if (location.hash.startsWith('#/map')) main.querySelector('input[type=search]').focus();
  run();
}
