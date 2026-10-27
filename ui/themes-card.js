// The Workspace card for the theme: the house colours and every theme a pack ships (a preset used only once it is
// chosen), each a swatch painted in its own paper, ink and sea for the scheme the screen is in. A click tries one on
// this screen alone; Keep makes it the workspace's and retires any other kept theme; the house swatch lets the kept
// one go. Nothing here is a colour of the page's own: each swatch is painted from its preset.

import { api, ask, h, state, tell } from './base.js';
import { loadSchema } from './words.js';

const dark = matchMedia('(prefers-color-scheme: dark)');
const HEX = /^#[0-9a-f]{3,8}$/i;

/** A preset is a theme when it is used only once chosen. */
export const isTheme = (s) => s.over === 'chosen';
/** The theme the workspace keeps, if any. */
const keptOf = (styles) => styles.find((s) => isTheme(s) && s.item && !s.retired);

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

/** Paper, ink and sea of a preset's colours for the scheme the screen is in: a theme's own, or the house's names. */
function colours(s) {
  const c = s.props?.theme?.[dark.matches ? 'dark' : 'light'] ?? {};
  const pick = (...names) => names.map((n) => c[n]).find((v) => HEX.test(String(v ?? '')));
  return { paper: pick('paper', 'bg'), ink: pick('ink', 'text'), sea: pick('sea', 'accent') };
}

export function themesCard(then) {
  const styles = state.schema?.styles ?? [];
  const themes = styles.filter(isTheme);
  if (!themes.length) return null;
  const house = styles.find((s) => !isTheme(s) && !s.on?.length && s.props?.theme);
  const kept = keptOf(styles);
  const write = async (ops, reason) => {
    try {
      await api('change', { ops, reason });
      state.trying = null;
      await loadSchema();
      then();
    } catch (err) {
      tell('That was not changed', err.message);
    }
  };
  // Keeping the theme tried: the owner's version of it, and any other theme they kept retired, so one is chosen.
  const keep = (s) => {
    const others = themes.filter((o) => o.id !== s.id && o.item && !o.retired);
    write([...others.map((o) => ({ op: 'update', id: o.item, status: 'retired' })), s.retired ? { op: 'update', id: s.item, status: 'current' } : { op: 'create', ref: 'mine', type: 'style', title: s.title, status: 'current', props: { ...s.props, preset: s.id } }], `${s.title} chosen as the workspace's theme`);
  };
  const letGo = async () =>
    (await ask({ title: `Back to the house colours?`, message: `${kept.title} stops being the workspace's theme. It stays here, to be kept again.`, action: 'Use the house colours' })) &&
    write([{ op: 'update', id: kept.item, status: 'retired' }], `${kept.title} let go: the house colours again`);

  const swatch = (s, { title, on, pick }) => {
    const { paper, ink, sea } = colours(s);
    const paint = h('span', { class: 'paint' }, 'Aa', h('span', { class: 'sea' }));
    if (paper) paint.style.background = paper;
    if (ink) paint.style.color = ink;
    if (sea) paint.lastChild.style.background = sea;
    return h('button', { class: `theme-tile${on ? ` ${on}` : ''}`, title, onclick: pick }, paint, h('span', { class: 'name' }, s.title));
  };
  const tile = (s) =>
    swatch(s, {
      on: state.trying === s.id ? 'trying' : s === kept && !state.trying ? 'kept' : '',
      title: s === kept ? `${s.title}: the workspace's theme` : `${s.title}: try it on your screen only`,
      pick: () => (s === kept ? state.trying && tryTheme(null, then) : tryTheme(s.id, then)),
    });
  const houseTile =
    house &&
    swatch(
      { ...house, title: 'House' },
      {
        on: !kept && !state.trying ? 'kept' : '',
        title: kept ? 'The house colours: let the kept theme go' : 'The house colours, which the workspace uses',
        pick: () => (state.trying ? tryTheme(null, then) : kept && letGo()),
      },
    );
  const tried = themes.find((s) => s.id === state.trying);
  return h(
    'section',
    { class: 'card wide' },
    h('header', {}, h('h2', { class: 'hinted', title: 'The colours of the whole workspace. Try one on your screen only, then keep it.' }, 'Theme')),
    h('div', { class: 'themes' }, houseTile, themes.map(tile)),
    tried &&
      h(
        'ul',
        { class: 'rows' },
        h(
          'li',
          { class: 'one' },
          h('span', { class: 'grow muted small' }, `${tried.title} on your screen only`),
          h('button', { class: 'primary', title: 'Use this theme for the whole workspace', onclick: () => keep(tried) }, 'Keep'),
          h('button', { title: 'Back to the workspace’s own colours', onclick: () => tryTheme(null, then) }, 'Stop'),
        ),
      ),
  );
}
