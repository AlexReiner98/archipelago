// The Workspace page's card for the theme, as the styles pack's part (slot workspace.card, in its Map section): the
// house colours and every theme a pack ships (a preset used only once it is chosen). Pressing one asks to keep it for
// the whole workspace, which keeps the owner's version of it and retires any other kept theme (styles.choose_theme);
// the house tile lets the kept one go (styles.use). It is handed the presets (the view style_presets) and answers with
// marks alone: a part paints no colour, so a tile is the theme's name.

import { keptOf, themeMarks } from './tiles.js';

/** The Workspace page's section this card stands in. */
const SECTION = 'map';

export default function themes(input, tools) {
  let now = input, picked, busy = false, failed;
  const styles = () => now?.views?.style_presets?.styles ?? [];
  const draw = () => {
    const section = now?.piece?.section;
    return section !== undefined && section !== SECTION ? ['box', {}] : themeMarks(styles(), { picked, busy, failed });
  };
  const send = async (action, params) => {
    busy = true;
    failed = undefined;
    tools.marks(draw());
    const said = await tools.act(action, params);
    busy = false;
    if (said?.error) failed = said.error;
    else picked = undefined;
    return draw();
  };
  return {
    marks: draw(),
    update(next) {
      now = next;
      return draw();
    },
    async on(event) {
      if (event?.name !== 'press' || busy) return undefined;
      const all = styles(), kept = keptOf(all);
      const key = event.key ?? '';
      if (key.startsWith('pick:')) return ((picked = key.slice(5)), (failed = undefined), draw());
      if (key === 'stop') return ((picked = undefined), draw());
      if (key === 'house' && kept) return send('styles.use', { item: kept.item, use: false });
      const s = key === 'keep' && all.find((t) => t.id === picked);
      if (!s) return undefined;
      const others = all.filter((o) => o.over === 'chosen' && o.id !== s.id && o.item && !o.retired).map((o) => o.item);
      return send('styles.choose_theme', { preset: s.id, title: s.title, props: s.props ?? {}, ...(s.retired && s.item && { item: s.item }), others });
    },
  };
}
