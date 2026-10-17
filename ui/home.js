// Home: the screens on Home, as the owner keeps them, one after another. The core pack's comes first (what needs
// you, and a picture of your work); each pack's follows in the order the packs load, until the owner takes it off.

import { h, part, state } from './base.js';
import { drawScreen } from './screens.js';

export async function home() {
  const main = part('home');
  const screens = (state.schema?.screens ?? []).filter((s) => s.at === 'home');
  if (!screens.length) return main.replaceChildren(h('div', { class: 'empty' }, 'Nothing is on Home. ', h('a', { href: '#/workspace' }, 'Screens are on the Workspace page.')));
  const drawn = screens.map((s) => drawScreen(s, home));
  main.replaceChildren(...drawn.map((d) => d.column));
  for (const d of drawn) d.after();
}
