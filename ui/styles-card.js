// The Workspace card for how things look: every style the packs ship as a preset, and the owner's version of it.
// A preset is used as the pack ships it until the owner changes it; changing it keeps a style on the map with the
// preset's id, which the owner edits like any item. Retired, the preset is not used. A theme (a preset used only once
// it is chosen) can be tried first: the page is painted in it on this screen alone until it is kept or let go.

import { api, h, state, tell } from './base.js';
import { loadSchema, typeTitle } from './words.js';

/** Paint this screen in a theme, or in the workspace's own again (null): a read, nothing kept. */
async function tryTheme(id, then) {
  state.trying = id;
  try {
    await loadSchema();
  } catch (err) {
    state.trying = null;
    tell('That theme could not be tried', err.message);
  }
  then();
}

/** What a preset is for: the whole workspace, or the kinds and types it is on. */
const where = (s) => (s.on?.length ? `on ${s.on.map(typeTitle).join(', ')}` : 'the whole workspace');

export function stylesCard(then) {
  const write = async (ops, reason, open) => {
    try {
      const done = await api('change', { ops, reason });
      await loadSchema();
      if (open) location.hash = `#/e/${done.created?.mine ?? open}`;
      else then();
    } catch (err) {
      tell('That was not changed', err.message);
    }
  };
  // The owner's version starts as the preset, so the change they make is the only difference.
  const change = (s) => write([{ op: 'create', ref: 'mine', type: 'style', title: s.title, status: 'current', props: { ...s.props, ...(s.on && { on: s.on }), preset: s.id } }], `${s.title}: the owner's version of the ${s.pack} pack's style`, true);
  const useAgain = (s) => write([{ op: 'update', id: s.item, status: 'current' }], `${s.title} used again`);
  // Keeping the theme tried: the owner's version of it, and any other theme they kept retired, so one is chosen.
  const theme = (s) => s.over === 'chosen';
  const keep = (s) => {
    state.trying = null;
    const others = (state.schema?.styles ?? []).filter((o) => theme(o) && o.id !== s.id && o.item && !o.retired);
    write([...others.map((o) => ({ op: 'update', id: o.item, status: 'retired' })), s.retired ? { op: 'update', id: s.item, status: 'current' } : { op: 'create', ref: 'mine', type: 'style', title: s.title, status: 'current', props: { ...s.props, preset: s.id } }], `${s.title} chosen as the workspace's theme`);
  };
  // A theme not in use is tried, then kept or let go; the one being tried says so.
  const trial = (s) =>
    state.trying === s.id
      ? [h('button', { class: 'primary', style: 'white-space: nowrap', title: 'Use this theme for the whole workspace', onclick: () => keep(s) }, 'Keep'), h('button', { style: 'white-space: nowrap', title: 'Back to the workspace’s own colours', onclick: () => tryTheme(null, then) }, 'Stop')]
      : h('button', { style: 'white-space: nowrap', title: 'See it on your screen only: nothing is kept', onclick: () => tryTheme(s.id, then) }, 'Try');
  const row = (s) =>
    h(
      'li',
      {},
      h(
        'div',
        { class: 'row-top', style: 'flex-wrap: nowrap; align-items: center' },
        h('span', { class: 'grow gist', title: `${s.title}, from the ${s.pack} pack: ${where(s)}` }, s.item ? h('a', { href: `#/e/${s.item}` }, h('strong', {}, s.title)) : h('strong', {}, s.title), ' ', h('span', { class: 'muted small' }, state.trying === s.id ? 'on your screen only' : s.retired || (theme(s) && !s.item) ? 'not used' : where(s))),
        theme(s) && (!s.item || s.retired)
          ? trial(s)
          : s.retired
          ? h('button', { style: 'white-space: nowrap', onclick: () => useAgain(s) }, 'Use again')
          : s.item
            ? h('span', { class: 'pill', title: 'You changed this preset: open it to change it again' }, 'yours')
            : h('button', { style: 'white-space: nowrap', title: 'Keep your own version of it on the map, to change', onclick: () => change(s) }, 'Change'),
      ),
    );
  return h('section', { class: 'card wide' }, h('header', {}, h('h2', { class: 'hinted', title: 'How things look. Packs ship these; change one to keep your own version on the map.' }, 'Styles')), h('ul', { class: 'rows' }, (state.schema?.styles ?? []).map(row)));
}
