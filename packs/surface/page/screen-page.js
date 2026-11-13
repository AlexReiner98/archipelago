// A screen as a page of its own, and the menu that leads to the screens (task e_pe3fjd75, from ui/nav.js). The menu's
// pages are the menu pack's part in the slot `nav`, handed the screens the owner has given a place in the nav, in their
// places, which page is open and whether Settings is offered; a screen's page is composed here, from its pieces.

import { drawSlot, h, hooks, may, part, state } from './base.js';
import { drawScreen } from './screens.js';

const byPlace = (a, b) => a.nav - b.nav;
/** The screens in the nav, in their places. */
const inNav = () => (state.schema?.screens ?? []).filter((s) => typeof s.nav === 'number').sort(byPlace);

/** Which page is open, as the menu's part names it: you, workspace, or screen:<id>. */
function openPage() {
  const [path, rest] = location.hash.split('?')[0].replace(/^#\/?/, '').split('/');
  if (path === 's' && rest) return `screen:${decodeURIComponent(rest)}`;
  return path === 'you' || path === 'workspace' ? path : '';
}

/** The menu's pages, drawn by the part that fills `nav`: the screens in the nav, the page open, and whether Settings is offered. */
export function drawNav() {
  const host = document.getElementById('menu-pages');
  if (!host) return;
  const screens = inNav().slice(0, 50);
  const piece = { screens: screens.map((s) => s.id), names: screens.map((s) => s.title), at: openPage(), writes: may('write') };
  drawSlot(host, { slot: 'nav', piece }).catch((err) => host.replaceChildren(h('div', { class: 'error', title: String(err?.message ?? err) }, 'The menu did not draw')));
}
hooks.drawNav = drawNav;

/** A screen as a page of its own. */
export async function screenPage(id) {
  const main = part('screen');
  const screen = (state.schema?.screens ?? []).find((s) => s.id === id);
  if (!screen) return main.replaceChildren(h('div', { class: 'empty' }, 'There is no such screen here. ', h('a', { href: '#/workspace' }, 'Screens are in Settings.')));
  const drawn = drawScreen(screen, () => screenPage(id));
  // A screen that holds one of the kernel's own pages has that page's head; any other is named by its title.
  const own = screen.pieces.some((p) => p.piece === 'page');
  main.replaceChildren(...[!own && h('div', { class: 'page-head' }, h('h1', {}, screen.title)), drawn.column].filter(Boolean));
  drawn.after();
}
