// The theme card's marks: the house colours and every theme a pack ships, a swatch each (the host paints it from the
// preset: a part paints no colour), the one the workspace keeps and the one tried on this screen marked; under them,
// the one picked, with Try here (on this screen alone, nothing kept), Keep and Stop, or for the house, Use the house
// colours.

/** A preset is a theme when it is used only once chosen. */
export const isTheme = (s) => s?.over === 'chosen';

/** The theme the workspace keeps, if any. */
export const keptOf = (styles) => styles.find((s) => isTheme(s) && s.item && !s.retired);

/** The house colours: the preset on the whole workspace that holds a theme and is not one to choose. */
export const houseOf = (styles) => styles.find((s) => !isTheme(s) && !s.on?.length && s.props?.theme);

const tile = (key, preset, label, { on, tip }) => ['swatch', { key, preset, label, tip, ...(on && { on }) }];

/**
 * The card for `styles` (every preset): `picked` the tile pressed ('house' or a theme's id), `trying` the theme tried on
 * this screen (the host's, handed to every part), `busy` while a change goes out.
 */
export function themeMarks(styles, { picked, trying, busy, failed, writes = true } = {}) {
  const themes = styles.filter(isTheme);
  if (!themes.length) return ['box', {}];
  const kept = keptOf(styles), house = houseOf(styles);
  const tiles = [
    ...(house ? [tile('pick:house', house.id, 'House', { on: !kept && !trying && 'kept', tip: kept ? 'The house colours: let the kept theme go' : 'The house colours, which the workspace uses' })] : []),
    ...themes.map((s) => tile(`pick:${s.id}`, s.id, String(s.title).slice(0, 40), {
      on: trying === s.id ? 'trying' : s === kept && !trying ? 'kept' : undefined,
      tip: s === kept ? `${s.title}: the workspace's theme` : `${s.title}: try it on your screen only, then keep it`,
    })),
  ];
  const chosen = picked && picked !== 'house' && themes.find((s) => s.id === picked && s !== kept);
  const back = picked === 'house' && kept;
  const stop = ['button', { key: 'stop', look: 'quiet', try: null, tip: 'Back to the workspace’s own colours' }, 'Stop'];
  const row = (said, tip, ...buttons) => ['box', { flow: 'row', gap: 4, align: 'between' }, ['text', { look: 'muted', size: 2, ...(tip && { tip }) }, said], ['box', { flow: 'row', gap: 2 }, ...buttons]];
  const ask = busy
    ? [['text', { look: 'muted', size: 2 }, 'Going out…']]
    : chosen
      ? [row(trying === chosen.id ? `${chosen.title} on your screen only` : `${chosen.title}: try it, or keep it for the whole workspace`, undefined,
          ...(trying === chosen.id ? [] : [['button', { key: 'try', look: 'quiet', try: chosen.id, tip: 'On your screen only: nothing is kept' }, 'Try here']]),
          ...(writes ? [['button', { key: 'keep', look: 'main', tip: 'Use this theme for the whole workspace' }, 'Keep']] : []),
          stop)]
      : back && writes
        ? [row('Back to the house colours?', `${kept.title} stops being the workspace's theme. It stays here, to be kept again.`, ['button', { key: 'house', look: 'main' }, 'Use the house colours'], stop)]
        : trying
          ? [row(`${themes.find((s) => s.id === trying)?.title ?? 'A theme'} on your screen only`, undefined, stop)]
          : [];
  return ['box', { look: 'band', flow: 'column', gap: 4, pad: 6 },
    ['text', { look: 'title', tip: 'The colours of the whole workspace. Try one on your screen only, then keep it.' }, 'Theme'],
    ['box', { flow: 'row', gap: 3, wrap: true }, ...tiles],
    ...(failed ? [['text', { tone: 'bad', tip: String(failed).slice(0, 200) }, 'That was not changed']] : []),
    ...ask,
  ];
}
