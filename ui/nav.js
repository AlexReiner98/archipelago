// The nav and the screens in it. The kernel's own pages (Home, Search, Changes, Workspace) are always there; between
// them come the screens the owner has given a place, each a page of its own drawn from its pieces. Packs offer
// screens as presets; the owner adds one, takes it out and puts it back on the Workspace page, where what each
// screen is (a page in the nav, or a part of every item of a kind) is listed with its switch.

import { api, ask, h, part, state, tell } from './base.js';
import { drawScreen } from './screens.js';
import { loadSchema, typeTitle } from './words.js';

const byPlace = (a, b) => a.nav - b.nav;
/** The screens in the nav, in their places. */
const inNav = () => (state.schema?.screens ?? []).filter((s) => typeof s.nav === 'number').sort(byPlace);

/** The screens' links, between Search and Changes, the one open marked. */
export function drawNav(open) {
  const host = document.getElementById('nav-screens');
  if (!host) return;
  host.replaceChildren(...inNav().map((s) => h('a', { href: `#/s/${s.id}`, 'data-route': `s/${s.id}`, class: open === s.id ? 'active' : '' }, s.title)));
}

/** The screen that draws one of the kernel's own pages, for an old address of it. */
export const screenOfPage = (page) => (state.schema?.screens ?? []).find((s) => s.pieces.some((p) => p.piece === 'page' && p.page === page));

/** A screen as a page of its own. */
export async function screenPage(id) {
  const main = part('screen');
  const screen = (state.schema?.screens ?? []).find((s) => s.id === id);
  if (!screen) return main.replaceChildren(h('div', { class: 'empty' }, 'There is no such screen here. ', h('a', { href: '#/workspace' }, 'Screens are on the Workspace page.')));
  const drawn = drawScreen(screen, () => screenPage(id));
  // A screen that holds one of the kernel's own pages has that page's head; any other is named by its title.
  const own = screen.pieces.some((p) => p.piece === 'page');
  main.replaceChildren(...[!own && h('div', { class: 'page-head' }, h('h1', {}, screen.title)), drawn.column].filter(Boolean));
  drawn.after();
}

/** Where a screen is: its place in the nav, or the kinds whose pages it is on. */
const where = (s) => [typeof s.nav === 'number' && 'in the nav', s.on.length > 0 && `on ${s.on.map(typeTitle).join(', ')}`].filter(Boolean).join(' · ') || (s.offered ? 'offered for the nav' : 'not shown');

/** The Workspace card: every screen, and the switch that puts one in the nav or takes it out. */
export function screensCard(then) {
  const screens = state.schema?.screens ?? [];
  const write = async (ops, reason) => {
    try {
      await api('change', { ops, reason });
      await loadSchema();
      drawNav();
      then();
    } catch (err) {
      tell('That was not changed', err.message);
    }
  };
  const last = Math.max(0, ...inNav().map((s) => s.nav));
  const add = (s) =>
    s.item
      ? write([{ op: 'update', id: s.item, props: { nav: last + 1 } }], `${s.title} put in the nav`)
      : write([{ op: 'create', type: 'screen', title: s.title, status: 'current', props: { preset: s.id, nav: last + 1 } }], `${s.title} added to the nav`);
  const remove = async (s) => (await ask({ title: `Take ${s.title} out of the nav?`, message: 'It stays here, to be put back.', action: 'Take out' })) && write([{ op: 'update', id: s.item, props: { nav: null } }], `${s.title} taken out of the nav`);
  // What could be a page in the nav: what is there, what a pack offers, and the owner's own.
  const navable = (s) => typeof s.nav === 'number' || Boolean(s.offered) || Boolean(s.item && !s.pack && !s.on.length);
  const row = (s) =>
    h(
      'li',
      {},
      h(
        'div',
        { class: 'row-top', style: 'flex-wrap: nowrap; align-items: center' },
        h('span', { class: 'grow gist', title: `${s.title}${s.pack ? `, from the ${s.pack} pack` : ''}: ${where(s)}` }, s.item ? h('a', { href: `#/e/${s.item}` }, h('strong', {}, s.title)) : h('strong', {}, s.title), ' ', h('span', { class: 'muted small' }, where(s))),
        navable(s) && (typeof s.nav === 'number' ? h('button', { style: 'white-space: nowrap', onclick: () => remove(s) }, 'Take out') : h('button', { style: 'white-space: nowrap', title: 'Give it a place in the nav, after the others', onclick: () => add(s) }, 'Add to nav')),
      ),
    );
  const sorted = [...screens].sort((a, b) => (typeof a.nav === 'number' ? a.nav : 1e9) - (typeof b.nav === 'number' ? b.nav : 1e9) || Number(navable(b)) - Number(navable(a)));
  return h('section', { class: 'card wide' }, h('header', {}, h('h2', { class: 'hinted', title: 'Pages drawn from pieces: in the nav, or on every item of a kind. Packs offer them; you choose what shows.' }, 'Screens')), h('ul', { class: 'rows' }, sorted.map(row)));
}
