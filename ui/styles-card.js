// The Workspace card for how things look: every style the packs ship as a preset, and the owner's version of it.
// A preset is used as the pack ships it until the owner changes it; changing it keeps a style on the map with the
// preset's id, which the owner edits like any item. Retired, the preset is not used. Themes are chosen on their own
// card (ui/themes-card.js), not here.

import { api, h, state, tell } from './base.js';
import { isTheme } from './themes-card.js';
import { loadSchema, typeTitle } from './words.js';

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
  const row = (s) =>
    h(
      'li',
      { class: 'one' },
      h('span', { class: 'grow', title: `${s.title}, from the ${s.pack} pack: ${where(s)}` }, s.item ? h('a', { href: `#/e/${s.item}` }, h('strong', {}, s.title)) : h('strong', {}, s.title), ' ', h('span', { class: 'muted small' }, s.retired ? 'not used' : where(s))),
      s.retired
        ? h('button', { onclick: () => useAgain(s) }, 'Use again')
        : s.item
          ? h('span', { class: 'pill', title: 'You changed this preset: open it to change it again' }, 'yours')
          : h('button', { title: 'Keep your own version of it on the map, to change', onclick: () => change(s) }, 'Change'),
    );
  const styles = (state.schema?.styles ?? []).filter((s) => !isTheme(s));
  return h('section', { class: 'card wide' }, h('header', {}, h('h2', { class: 'hinted', title: 'How things look. Packs ship these; change one to keep your own version on the map.' }, 'Styles')), h('ul', { class: 'rows' }, styles.map(row)));
}
