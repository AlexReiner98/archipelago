// The menu and the screens in it. What waits for you and the Workspace page are always there; between them come
// the screens the owner has given a place, each a page of its own drawn from its pieces, opened in the sheet. Packs offer
// screens as presets; the owner adds one, takes it out and puts it back on the Workspace page, where what each
// screen is (a page in the nav, or a part of every item of a kind) is listed with its switch.

import { api, ask, h, part, state, tell } from './base.js';
import { drawScreen } from './screens.js';
import { loadSchema, menu, typeTitle } from './words.js';

const byPlace = (a, b) => a.nav - b.nav;
/** The screens in the nav, in their places. */
const inNav = () => (state.schema?.screens ?? []).filter((s) => typeof s.nav === 'number').sort(byPlace);

/** The menu's pages: the workspace, then the screens the owner has given a place, the one open marked. */
export function drawNav(open) {
  const host = document.getElementById('menu-pages');
  if (!host) return;
  const at = location.hash.split('?')[0];
  host.replaceChildren(
    h('a', { href: '#/you', class: at === '#/you' ? 'active' : '' }, 'For you'),
    ...inNav().map((s) => h('a', { href: `#/s/${s.id}`, class: open === s.id || at === `#/s/${s.id}` ? 'active' : '' }, s.title)),
    h('a', { href: '#/workspace', class: at === '#/workspace' ? 'active' : '' }, 'Workspace'),
  );
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

/** Where a screen is: on Home, its place in the nav, or the kinds whose pages it is on. */
const where = (s) =>
  [s.at === 'home' && 'on Home', typeof s.nav === 'number' && 'in the nav', s.on.length > 0 && `on ${s.on.map(typeTitle).join('\n')}`].filter(Boolean).join(' · ') ||
  (s.homeable ? 'taken off Home' : s.offered ? 'offered for the nav' : 'not shown');

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
  // On Home or off it: a preset for Home is on it unless the owner's version says false; their own screen only when it says true.
  const home = (s, on) =>
    s.item
      ? write([{ op: 'update', id: s.item, props: { home: s.homeable ? (on ? null : false) : on || null } }], `${s.title} ${on ? 'put on' : 'taken off'} Home`)
      : write([{ op: 'create', type: 'screen', title: s.title, status: 'current', props: { preset: s.id, home: on } }], `${s.title} ${on ? 'put on' : 'taken off'} Home`);
  // What could be a page in the nav: what is there, what a pack offers, and the owner's own.
  const navable = (s) => typeof s.nav === 'number' || Boolean(s.offered) || Boolean(s.item && !s.pack && !s.on.length);
  // Taking a screen off Home or out of the nav, in its menu: room kept where there is nothing to take away.
  const rare = (s) => {
    const items = [s.at === 'home' && ['Take off Home', () => home(s, false)], typeof s.nav === 'number' && ['Take out of the nav', () => remove(s)]].filter(Boolean);
    return items.length ? menu('⋯', items) : h('span', { class: 'menu-room' });
  };
  const row = (s) =>
    h(
      'li',
      { class: 'one' },
      h('span', { class: 'grow', title: `${s.title}${s.pack ? `, from the ${s.pack} pack` : ''}: ${where(s)}` }, s.item ? h('a', { href: `#/e/${s.item}` }, h('strong', {}, s.title)) : h('strong', {}, s.title), ' ', h('span', { class: 'muted small' }, where(s))),
      // Putting a screen somewhere is in sight; taking it away is rarer, and in its menu.
      s.homeable && s.at !== 'home' && h('button', { title: 'Draw it on Home again, where its pack put it', onclick: () => home(s, true) }, 'Put on Home'),
      navable(s) && typeof s.nav !== 'number' && h('button', { title: 'Give it a place in the nav, after the others', onclick: () => add(s) }, 'Add to nav'),
      rare(s),
    );
  // A screen on the pages of a kind has no switch here: those are one row, each named in its tooltip.
  const actionable = (s) => s.at === 'home' || Boolean(s.homeable) || navable(s);
  const onPages = screens.filter((s) => !actionable(s));
  const pagesRow =
    onPages.length > 0 &&
    h('li', { class: 'one' }, h('span', { class: 'grow muted small', title: onPages.map((s) => `${s.title}: ${where(s)}`).join('\n') }, `${onPages.length} more on item pages`));
  const sorted = [...screens].filter(actionable).sort((a, b) => Number(b.at === 'home' || Boolean(b.homeable)) - Number(a.at === 'home' || Boolean(a.homeable)) || (typeof a.nav === 'number' ? a.nav : 1e9) - (typeof b.nav === 'number' ? b.nav : 1e9) || Number(navable(b)) - Number(navable(a)));
  return h('section', { class: 'card wide' }, h('header', {}, h('h2', { class: 'hinted', title: 'Pages drawn from pieces: on Home, in the nav, or on every item of a kind. Packs offer them; you choose what shows.' }, 'Screens')), h('ul', { class: 'rows' }, sorted.map(row), pagesRow));
}
