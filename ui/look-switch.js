// The style up, in the view band beside the canvas up (decision e_tqr9cxdc): a style is the pane's, kept as its lens
// changes, so it is switched here on its own. Its choices are the shapes the drawings draw and the styles kept on the
// map by name (not a version of a pack's, not on a kind or type); the house's is what is drawn with neither. A saved
// canvas brings its own when it is opened, and Save keeps it with the lens.

import { api, ask, h, state, tell } from './base.js';
import { flatQuery } from './lens.js';

/** The styles kept on the map by name, read once. */
let named = null;
const namedStyles = () =>
  (named ??= api('search', { type: 'style', open: true, limit: 100 })
    .then((rows) => rows.filter((s) => !s.props?.preset && !s.props?.on?.length).sort((a, b) => a.title.localeCompare(b.title)))
    .catch(() => []));

/** Delete, in the band's menu while the pane is drawn with a style kept on the map: the style is archived (it leaves
 *  the switch and stays in the history), and the pane is drawn as the house's. None for a shape or the house's. */
export function styleDelete(lens, style, open) {
  if (!style.style) return null;
  const act = async () => {
    const kept = (await namedStyles()).find((s) => s.id === style.style);
    const title = kept?.title ?? 'this style';
    if (!(await ask({ title: `Delete "${title}"?`, message: 'It leaves the styles to choose from but stays in the history.', action: 'Delete', danger: true }))) return;
    try {
      await api('change', { ops: [{ op: 'archive', id: style.style }], reason: `${title}: style deleted from the view band` });
    } catch (err) {
      return tell('That was not deleted', err.message);
    }
    named = null;
    const { style: _k, ...rest } = style;
    open(`#/v?${flatQuery(lens, rest)}`);
  };
  return { text: 'Delete style', title: 'Delete the style this canvas is drawn with', act, danger: true };
}

/** The style asked of a pane, as one choice: a shape, a style kept by its id, or the house's. */
const chosenOf = (style) => (style.style ? `style:${style.style}` : style.shape ? `shape:${style.shape}` : '');

/** The switch: choosing goes to the same lens with the style chosen, the canvas and what is lit kept. */
export function lookSwitch(lens, style, open) {
  const pick = h('select', { class: 'q-pick q-look', 'aria-label': 'Style' });
  const shapes = [{ shape: 'list', title: 'List' }, ...(state.schema?.shapes ?? [])];
  const fill = (kept) => {
    const now = chosenOf(style);
    // Cut short in a narrow pane, the style chosen is still named in its tooltip.
    const said = [...shapes.map((s) => [`shape:${s.shape}`, s.title]), ...kept.map((s) => [`style:${s.id}`, s.title])].find(([value]) => value === now)?.[1] ?? 'House';
    pick.title = `Style: ${said}`;
    pick.replaceChildren(
      h('option', { value: '', selected: !now }, 'House'),
      ...shapes.map((s) => h('option', { value: `shape:${s.shape}`, selected: now === `shape:${s.shape}` }, s.title)),
      ...kept.map((s) => h('option', { value: `style:${s.id}`, selected: now === `style:${s.id}` }, s.title)),
    );
  };
  fill([]);
  namedStyles().then(fill);
  pick.addEventListener('change', () => {
    const [kind, value] = pick.value ? [pick.value.slice(0, pick.value.indexOf(':')), pick.value.slice(pick.value.indexOf(':') + 1)] : [];
    const { shape: _s, style: _k, ...rest } = style;
    open(`#/v?${flatQuery(lens, { ...rest, ...(kind && { [kind]: value }) })}`);
  });
  return pick;
}
