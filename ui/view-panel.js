// The view switcher (task e_xvz8g89r): one button on the bar naming the view up, opening a panel over the page, as
// every open list is (ui/menus.css): a field to find a view by its name or note, then one list (the owner, 9 Nov
// 2026: no scopes; a person looking for a view is not looking near what is up). Home, then the views kept, the newest
// first, each its thumbnail, name and age (its note in the tooltip); agents' working views folded at the end. What
// the packs ship is found by its name, not listed.

import { api, h } from './base.js';
import { placeBy } from './menu-place.js';
import { thumbOf } from './thumbs.js';
import { ago } from './words.js';

const panel = h('div', { class: 'tab-menu view-panel', popover: 'auto', role: 'dialog', 'aria-label': 'Views' });
document.body.append(panel);

/** Newest first: a view changed or kept lately is the one most likely looked for. */
const newest = (a, b) => String(b.updated_at ?? '').localeCompare(String(a.updated_at ?? ''));

/**
 * The button and its panel. `all`: the views a person picks from (ui/canvases.js), each with its status, its note,
 * whether a pack ships it (`preset`) and when it was updated; `current`: the one up; `at(c)`: where a view opens;
 * `parts(c)`: its lens and style, for its thumbnail; `open(href)`: go there.
 */
export function viewPicker({ all, current, label, title, changed, isHome, at, parts, open }) {
  const button = h('button', { type: 'button', class: 'q-pick q-view-pick', title, 'aria-haspopup': 'dialog', 'data-title': current?.title ?? (isHome ? 'Home' : '') },
    // The name is cut short where the bar is short of room; the whole of it is the tooltip.
    h('span', { class: 'q-pick-text' }, `${label}${changed ? ' •' : ''}`), h('span', { 'aria-hidden': 'true' }, '▾'));
  button.addEventListener('click', () => {
    if (panel.matches(':popover-open')) return panel.hidePopover();
    const find = h('input', { type: 'search', class: 'view-find', placeholder: 'Find a view', 'aria-label': 'Find a view', title: 'Find a view by its name or its note, those the packs ship among them' });
    const list = h('div', { class: 'view-list' });
    const row = (c) =>
      h('button', { type: 'button', class: `view-row${c === current ? ' up' : ''}`, 'data-title': c.title, title: c.note ? `${c.title}: ${c.note}` : c.title, onclick: () => (panel.hidePopover(), open(at(c))) },
        thumbOf({ id: c.id, ...parts(c) }),
        h('span', { class: 'gist' }, c.title),
        c.cannot ? h('span', { class: 'muted small', title: `It cannot draw here: ${c.cannot}` }, 'cannot draw') : c.updated_at && h('span', { class: 'muted small' }, ago(c.updated_at)),
      );
    const draw = () => {
      const words = find.value.trim().toLowerCase();
      // Found by words, every view is a choice; else what a pack ships is left to be found, unless it is up.
      const shown = all.filter((c) => (words ? `${c.title} ${c.note ?? ''}`.toLowerCase().includes(words) : !c.preset || c === current));
      const working = shown.filter((c) => c.status === 'working').sort(newest);
      const rest = shown.filter((c) => c.status !== 'working').sort(newest);
      list.replaceChildren(
        ...(!words ? [h('a', { class: `view-row${isHome && !current ? ' up' : ''}`, href: '#/', 'data-title': 'Home', title: 'Home: the views kept', onclick: () => panel.hidePopover() }, h('span', { class: 'gist' }, 'Home'))] : []),
        ...rest.map(row),
        ...(working.length ? [h('details', { class: 'view-working', ...((words || !rest.length || working.includes(current)) && { open: true }) }, h('summary', { class: 'muted small', title: 'Agents’ views: each retires with what it is about, or after two weeks untouched, unless you keep it' }, `Agents’ (${working.length})`), ...working.map(row))] : []),
        ...(!shown.length ? [h('div', { class: 'empty muted small' }, words ? 'No view by that name.' : 'None kept yet.')] : []),
      );
    };
    find.addEventListener('input', draw);
    panel.replaceChildren(find, list);
    draw();
    panel.showPopover();
    placeBy(panel, button);
    find.focus();
  });
  return button;
}
