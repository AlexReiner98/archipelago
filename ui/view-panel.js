// The view switcher (task e_xvz8g89r): one button on the bar naming the view up, opening a panel over the page, as
// every open list is (ui/menus.css): a field to find a view by its name or note, a row of scopes (Here: views about
// the item up or what it is part of, nearest first; Workspace: views about nothing; All), each with its count and the
// one holding the view up marked, then one row per view (its thumbnail, name and age; its note in the tooltip), the
// working ones folded at the end. The scopes are the owner's (7 Nov 2026): an island stays a term of a query.

import { api, h } from './base.js';
import { placeBy } from './menu-place.js';
import { thumbOf } from './thumbs.js';
import { ago } from './words.js';

const panel = h('div', { class: 'tab-menu view-panel', popover: 'auto', role: 'dialog', 'aria-label': 'Views' });
document.body.append(panel);

/** The scope the reader chose last, while the page is open: null, the nearest that holds something. */
let chosen = null;

/** The item up and what it is part of, nearest first: Here's order. */
const nearOf = async (id) => {
  if (!id) return [];
  const got = await api('get', { id }).catch(() => null);
  return [id, ...(got?.trail ?? []).map((t) => t.id).reverse()];
};

/** The views in each scope, in their order: Here by nearness, then by name; the others by name, the kept first. */
function scopesOf(all, near) {
  const at = (c) => near.indexOf(c.of?.id);
  const here = all.filter((c) => at(c) >= 0).sort((a, b) => at(a) - at(b));
  return { here, workspace: all.filter((c) => !c.ofItem), all };
}

const SCOPES = [
  ['here', 'Here', 'Views about what is up, or what it is part of'],
  ['workspace', 'Workspace', 'Views about nothing: the workspace’s own'],
  ['all', 'All', 'Every view kept'],
];

/**
 * The button and its panel. `all`: the views a person picks from (ui/canvases.js), each with `of`, `ofItem`,
 * its status, its note and when it was updated; `current`: the one up; `item`: the item up, if one is; `at(c)`: where a view
 * opens; `parts(c)`: its lens and style, for its thumbnail; `open(href)`: go there.
 */
export function viewPicker({ all, current, label, title, changed, item, isHome, at, parts, open }) {
  const button = h('button', { type: 'button', class: 'q-pick q-view-pick', title, 'aria-haspopup': 'dialog', 'data-title': current?.title ?? (isHome ? 'Home' : '') },
    // The name is cut short where the bar is short of room; the whole of it is the tooltip.
    h('span', { class: 'q-pick-text' }, `${label}${changed ? ' •' : ''}`), h('span', { 'aria-hidden': 'true' }, '▾'));
  const near = nearOf(item);
  button.addEventListener('click', async () => {
    if (panel.matches(':popover-open')) return panel.hidePopover();
    const scopes = scopesOf(all, await near);
    const holds = (key) => Boolean(current && scopes[key].includes(current));
    let scope = chosen ?? (scopes.here.length ? 'here' : 'workspace');
    const find = h('input', { type: 'search', class: 'view-find', placeholder: 'Find a view', 'aria-label': 'Find a view', title: 'Find a view by its name or its note' });
    const list = h('div', { class: 'view-list' });
    const row = (c) =>
      h('button', { type: 'button', class: `view-row${c === current ? ' up' : ''}`, 'data-title': c.title, title: c.note ? `${c.title}: ${c.note}` : c.title, onclick: () => (panel.hidePopover(), open(at(c))) },
        thumbOf({ id: c.id, ...parts(c) }),
        h('span', { class: 'gist' }, c.title),
        c.cannot ? h('span', { class: 'muted small', title: `It cannot draw here: ${c.cannot}` }, 'cannot draw') : c.updated_at && h('span', { class: 'muted small' }, ago(c.updated_at)),
      );
    const draw = () => {
      const words = find.value.trim().toLowerCase();
      const shown = scopes[scope].filter((c) => !words || `${c.title} ${c.note ?? ''}`.toLowerCase().includes(words));
      const working = shown.filter((c) => c.status === 'working');
      const rest = shown.filter((c) => c.status !== 'working');
      tabs.replaceChildren(
        ...SCOPES.map(([key, name, tip]) =>
          h('button', { type: 'button', class: holds(key) ? 'up' : '', 'aria-pressed': String(key === scope), title: holds(key) ? `${tip}: the view up is among them` : tip, onclick: () => ((scope = chosen = key), draw()) }, `${name} ${scopes[key].length}`),
        ),
      );
      list.replaceChildren(
        ...(!words && scope !== 'here' ? [h('a', { class: `view-row${isHome && !current ? ' up' : ''}`, href: '#/', 'data-title': 'Home', title: 'Home: the views of the workspace', onclick: () => panel.hidePopover() }, h('span', { class: 'gist' }, 'Home'))] : []),
        ...rest.map(row),
        ...(working.length ? [h('details', { class: 'view-working', ...(!rest.length && { open: true }) }, h('summary', { class: 'muted small', title: 'Agents’ views, retired with what they are about unless you keep them' }, `Working (${working.length})`), ...working.map(row))] : []),
        ...(!shown.length ? [h('div', { class: 'empty muted small' }, words ? 'No view by that name.' : 'None here.')] : []),
      );
    };
    const tabs = h('div', { class: 'view-scopes', role: 'group', 'aria-label': 'Which views' });
    find.addEventListener('input', draw);
    panel.replaceChildren(find, tabs, list);
    draw();
    panel.showPopover();
    placeBy(panel, button);
    find.focus();
  });
  return button;
}
