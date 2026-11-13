// How things look, as the styles pack's card on the Workspace page (slot workspace.card, in its Packs section): every
// style a pack ships as a preset, under the pack that ships it, and the owner's version of each. A preset is used as
// the pack ships it until the owner changes it; Change keeps a style on the map with the preset's id, which the owner
// edits like any item, and a press on its name opens it. Retired, the preset is not used. Themes are chosen apart
// (../themes). It is handed the presets (the view style_presets) and answers with marks alone.

import { isTheme, presetRow } from './rows.js';

/** The Workspace page's section this card stands in. */
const SECTION = 'packs';

function marks(input, busy, failed) {
  const section = input?.piece?.section;
  if (section !== undefined && section !== SECTION) return ['box', {}];
  const styles = (input?.views?.style_presets?.styles ?? []).filter((s) => !isTheme(s));
  if (!styles.length) return ['box', {}];
  const packs = [...new Set(styles.map((s) => s.pack))];
  return ['box', { look: 'band', flow: 'column', gap: 4, pad: 6 },
    ['text', { look: 'title', tip: 'How each pack draws what it holds: a preset is used as it ships until you change it' }, 'Styles'],
    ...(failed ? [['text', { tone: 'bad', tip: failed.slice(0, 200) }, 'That was not changed']] : []),
    ...packs.flatMap((pack) => [
      ['text', { look: 'muted', size: 2 }, pack],
      ['list', { look: 'rows' }, ...styles.filter((s) => s.pack === pack).map((s) => presetRow(s, input.words, busy))],
    ]),
  ];
}

export default function presets(input, tools) {
  let now = input, busy, failed;
  const draw = () => marks(now, busy, failed);
  return {
    marks: draw(),
    update(next) {
      now = next;
      busy = undefined;
      return draw();
    },
    async on(event) {
      if (event?.name !== 'press') return undefined;
      const [, what, id] = /^(change|again):(.+)$/.exec(event.key ?? '') ?? [];
      const s = id && (now?.views?.style_presets?.styles ?? []).find((p) => p.id === id);
      if (!s) return undefined;
      busy = s.id;
      failed = undefined;
      tools.marks(draw());
      const said = what === 'change'
        ? await tools.act('styles.keep', { preset: s.id, title: s.title, props: s.props ?? {}, ...(s.on?.length && { on: s.on }) })
        : await tools.act('styles.use', { item: s.item, use: true });
      if (said?.error) (busy = undefined), (failed = said.error);
      return draw();
    },
  };
}
