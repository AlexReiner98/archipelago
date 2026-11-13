// The theme card's marks: the house colours and every theme a pack ships, a tile each, the one the workspace keeps
// marked; under them, the one picked, with Keep (or, for the house, Use the house colours) and Stop.

/** A preset is a theme when it is used only once chosen. */
export const isTheme = (s) => s?.over === 'chosen';

/** The theme the workspace keeps, if any. */
export const keptOf = (styles) => styles.find((s) => isTheme(s) && s.item && !s.retired);

/** The house colours: the preset on the whole workspace that holds a theme and is not one to choose. */
export const houseOf = (styles) => styles.find((s) => !isTheme(s) && !s.on?.length && s.props?.theme);

const tile = (key, title, { on, tip }) => ['button', { key, look: 'quiet', tip, ...(on && { tone: 'accent' }) }, on ? `${title} ✓` : title];

/** The card for `styles` (every preset), with `picked` the tile pressed ('house' or a theme's id) and `busy` while a change goes out. */
export function themeMarks(styles, { picked, busy, failed, writes = true } = {}) {
  const themes = styles.filter(isTheme);
  if (!themes.length) return ['box', {}];
  const kept = keptOf(styles), house = houseOf(styles);
  const tiles = [
    ...(house ? [tile('pick:house', 'House', { on: !kept, tip: kept ? 'The house colours: let the kept theme go' : 'The house colours, which the workspace uses' })] : []),
    ...themes.map((s) => tile(`pick:${s.id}`, String(s.title).slice(0, 40), { on: s === kept, tip: s === kept ? `${s.title}: the workspace's theme` : `${s.title}: choose it for the whole workspace` })),
  ];
  const chosen = picked && picked !== 'house' && themes.find((s) => s.id === picked && s !== kept);
  const back = picked === 'house' && kept;
  const ask = busy
    ? [['text', { look: 'muted', size: 2 }, 'Going out…']]
    : chosen && writes
      ? [['box', { flow: 'row', gap: 4, align: 'between' }, ['text', { look: 'muted', size: 2 }, `${chosen.title} for the whole workspace?`], ['box', { flow: 'row', gap: 2 }, ['button', { key: 'keep', look: 'main', tip: 'Use this theme for the whole workspace' }, 'Keep'], ['button', { key: 'stop', look: 'quiet', tip: 'Leave the theme as it is' }, 'Stop']]]]
      : back && writes
        ? [['box', { flow: 'row', gap: 4, align: 'between' }, ['text', { look: 'muted', size: 2, tip: `${kept.title} stops being the workspace's theme. It stays here, to be kept again.` }, 'Back to the house colours?'], ['box', { flow: 'row', gap: 2 }, ['button', { key: 'house', look: 'main' }, 'Use the house colours'], ['button', { key: 'stop', look: 'quiet' }, 'Stop']]]]
        : [];
  return ['box', { look: 'band', flow: 'column', gap: 4, pad: 6 },
    ['text', { look: 'title', tip: 'The colours of the whole workspace' }, 'Theme'],
    ['box', { flow: 'row', gap: 3, wrap: true }, ...tiles],
    ...(failed ? [['text', { tone: 'bad', tip: String(failed).slice(0, 200) }, 'That was not changed']] : []),
    ...ask,
  ];
}
