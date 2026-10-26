// For you: the screens kept on Home, one after another, in the sheet over the canvas (the canvas is Home now). The
// core pack's comes first (what is held for your word, your move); each pack's follows in the order the packs load.

import { h, part, state } from './base.js';
import { drawScreen } from './screens.js';

export async function home() {
  const main = part('you');
  const screens = (state.schema?.screens ?? []).filter((s) => s.at === 'home');
  if (!screens.length) return main.replaceChildren(h('div', { class: 'empty' }, 'Nothing is on Home. ', h('a', { href: '#/workspace' }, 'Screens are on the Workspace page.')));
  const drawn = screens.map((s) => drawScreen(s, home));
  main.replaceChildren(...drawn.map((d) => d.column));
  for (const d of drawn) d.after();
}
