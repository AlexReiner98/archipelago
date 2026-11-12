// For you: the screens kept on Home, one after another, in the sheet over the canvas (the canvas is Home now). The
// map's start page comes first (what is held for your word, your move); each pack's follows in the order the packs load.

import { h, part, state } from './base.js';
import { drawScreen } from './screens.js';

export async function home() {
  const main = part('you');
  const screens = (state.schema?.screens ?? []).filter((s) => s.at === 'home').sort((a, b) => Number(Boolean(b.start)) - Number(Boolean(a.start)));
  // With no start page (the practice pack off) and nothing put here, Home says what would bring it.
  if (!screens.length) return main.replaceChildren(h('div', { class: 'empty' }, 'Nothing is on Home: For you comes with the Practice pack. ', h('a', { href: '#/workspace' }, 'Packs are in Settings.')));
  const drawn = screens.map((s) => drawScreen(s, home));
  main.replaceChildren(...drawn.map((d) => d.column));
  for (const d of drawn) d.after();
}
