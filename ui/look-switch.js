// The layout up, in the view band beside the view up (decision e_47pjkbxb): how this pane is arranged, kept as its query
// changes. Its choices are the layouts the packs ship and those kept on the map; Default is what is drawn with neither. A
// saved view brings its own when it is opened, and Save keeps it. A style drawn here, by Use here on its page, is one
// more choice while it is.

import { api, ask, h, state, tell } from './base.js';
import { addressOf } from './query.js';
import { titles } from './words.js';

/** The layouts kept on the map (a style with code of its own), read once. */
let named = null;
const namedStyles = () =>
  (named ??= api('search', { type: 'style', open: true, limit: 100 })
    .then((rows) => rows.filter((s) => typeof s.props?.code === 'string' && !s.props?.preset && !s.props?.on?.length).sort((a, b) => a.title.localeCompare(b.title)))
    .catch(() => []));

/** A style's name, read when no page has named it yet: only layouts are listed. */
const titled = async (id) => {
  if (!titles.has(id)) {
    const got = await api('get', { id }).catch(() => null);
    if (got) titles.set(id, got.entity.title);
  }
  return titles.get(id);
};

/** Delete, in the band's menu while the pane is drawn with a layout or style kept on the map: it is archived (it leaves
 *  every choice and stays in the history), after saying which views use it, and the pane is drawn in the default. */
export function styleDelete(lens, style, open) {
  if (!style.style) return null;
  const act = async () => {
    const kept = (await namedStyles()).find((s) => s.id === style.style);
    const title = kept?.title ?? (await titled(style.style)) ?? 'this style';
    const views = (await api('search', { type: 'lens', open: true, limit: 200 }).catch(() => [])).filter((v) => v.props?.style?.style === style.style);
    const using = views.length ? `${views.length === 1 ? `“${views[0].title}” uses` : `${views.length} views use`} it and will go to the default. ` : '';
    if (!(await ask({ title: `Delete "${title}"?`, message: `${using}It stays in the history.`, action: 'Delete', danger: true }))) return;
    try {
      await api('change', { ops: [{ op: 'archive', id: style.style }], reason: `${title}: deleted from the view band` });
    } catch (err) {
      return tell('That was not deleted', err.message);
    }
    named = null;
    const { style: _k, ...rest } = style;
    open(`#/v?${addressOf(lens, rest)}`);
  };
  return { text: 'Delete layout', title: 'Delete the layout or style this view is drawn with', act, danger: true };
}

/** What is asked of a pane, as one choice: a layout a pack ships, one kept by its id, or the default. */
const chosenOf = (style) => (style.style ? `style:${style.style}` : style.shape ? `shape:${style.shape}` : '');

/** The switch: choosing goes to the same query with the layout chosen, the view and what is lit kept. */
export function lookSwitch(lens, style, open) {
  const pick = h('select', { class: 'q-pick q-look', 'aria-label': 'Layout' });
  const shapes = [{ shape: 'list', title: 'List' }, ...(state.schema?.shapes ?? [])];
  const fill = (listed) => {
    const now = chosenOf(style);
    const kept = style.style && !listed.some((s) => s.id === style.style) ? [...listed, { id: style.style, title: titles.get(style.style) ?? 'Style' }] : listed;
    // Cut short in a narrow pane, the style chosen is still named in its tooltip.
    const said = [...shapes.map((s) => [`shape:${s.shape}`, s.title]), ...kept.map((s) => [`style:${s.id}`, s.title])].find(([value]) => value === now)?.[1] ?? 'Default';
    pick.title = `Layout: ${said}`;
    pick.replaceChildren(
      h('option', { value: '', selected: !now }, 'Default'),
      ...shapes.map((s) => h('option', { value: `shape:${s.shape}`, selected: now === `shape:${s.shape}` }, s.title)),
      ...kept.map((s) => h('option', { value: `style:${s.id}`, selected: now === `style:${s.id}` }, s.title)),
    );
  };
  fill([]);
  namedStyles().then(async (listed) => {
    if (style.style && !listed.some((s) => s.id === style.style)) await titled(style.style);
    fill(listed);
  });
  pick.addEventListener('change', () => {
    const [kind, value] = pick.value ? [pick.value.slice(0, pick.value.indexOf(':')), pick.value.slice(pick.value.indexOf(':') + 1)] : [];
    const { shape: _s, style: _k, ...rest } = style;
    open(`#/v?${addressOf(lens, { ...rest, ...(kind && { [kind]: value }) })}`);
  });
  return pick;
}
