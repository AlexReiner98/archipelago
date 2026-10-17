// Home: the core pack's Home screen, as the owner keeps it. Its pieces are what every map has (what needs you, and
// a picture of your work); packs add theirs, and the owner may change any of it like any screen.

import { h, part, state } from './base.js';
import { drawScreen } from './screens.js';

export async function home() {
  const main = part('home');
  const screen = (state.schema?.screens ?? []).find((s) => s.at === 'home');
  if (!screen) return main.replaceChildren(h('div', { class: 'empty' }, 'No pack draws Home here.'));
  const drawn = drawScreen(screen, home);
  main.replaceChildren(drawn.column);
  drawn.after();
}
