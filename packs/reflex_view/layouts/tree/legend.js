// Layer: marks. The tree's legend is its filter (the owner, 19 Nov 2026): each entry says what a mark means and how
// many there are, and a click turns it off or on. What it names is an entry: a kind (kind:rule, kind:instruction), a
// pack (pack:<id>), a tier (tier:core, pack, owner, learned), a standing (status:trial, current, retired) or what
// happened (event:miss, held, failed, fired). The entries turned off are the view's own (style.hidden): a click asks
// the view's pack to change the view (sends.legend: the reflex_view pack's action), as the person, so a filtered tree
// is a view anyone opens the same. It looks and answers as an island's key does: an entry off is faint, its mark
// dashed; one that toggles is underlined under the pointer.

import { m } from './marks.js';
import { packClass } from './story.js';

const TIERS = ['core', 'pack', 'owner', 'learned'];
const STANDINGS = ['trial', 'current', 'retired'];
const EVENTS = ['miss', 'held', 'failed', 'fired'];

/** The entries a node falls under: its kind, pack, tier and standing. */
export const entriesOf = ({ rule, pack, tier, status }) => [`kind:${rule ? 'rule' : 'instruction'}`, `pack:${pack}`, `tier:${tier}`, `status:${status}`];

/** Whether a node stands in the tree: none of its entries is turned off. */
export const shownBy = (hidden) => (node) => !entriesOf(node).some((e) => hidden.has(e));

/** The entries turned off on the view, as a set. */
export const hiddenOf = (style) => new Set(Array.isArray(style.hidden) ? style.hidden.filter((e) => typeof e === 'string') : []);

/**
 * The legend beside the picture: a group for each of kind, pack, tier, standing and what happened, a row for each
 * entry with its mark, its name and its count. `nodes` are every node the view holds, filter or no ({ rule, pack,
 * tier, status }), `events` every event of the window by kind, `toggles` whether a click may change the view.
 */
export function legendOf({ nodes, events, hidden, hues, toggles, schematic }) {
  const count = (f) => nodes.filter(f).length;
  const row = (entry, glyph, label, n, title) =>
    m('div', { key: `lg:${entry}`, class: `rt-lg-row${hidden.has(entry) ? ' rt-off' : ''}${toggles ? ' toggles' : ''}`, ...(toggles && { on: ['click'], role: 'button' }), title: `${title}${toggles ? (hidden.has(entry) ? ' (off: click to show)' : ' (click to hide)') : ''}` },
      m('span', { class: 'rt-lg-mark' }, glyph), m('span', { class: 'rt-lg-name' }, label), m('span', { class: 'rt-lg-n' }, n.toLocaleString('en-US')));
  const dot = (cls) => m('svg', { viewBox: '0 0 2 2', class: 'rt-lg-glyph' }, m('circle', { cx: 1, cy: 1, r: 0.8, class: cls }));
  const square = (cls) => m('svg', { viewBox: '0 0 2 2', class: 'rt-lg-glyph' }, m('rect', { x: 0.2, y: 0.2, width: 1.6, height: 1.6, class: cls }));
  const group = (title, rows) => rows.length > 0 && m('div', { class: 'rt-lg-group' }, m('div', { class: 'rt-lg-title' }, title), rows);
  const packs = [...hues.keys()];
  return m(
    'div',
    { key: 'rt-legend', class: 'rt-legend' },
    group('Kind', [
      row('kind:rule', square('rt-k-node'), 'Rules', count((x) => x.rule), 'A rule guards a write'),
      row('kind:instruction', dot('rt-k-node'), 'Instructions', count((x) => !x.rule), 'An instruction is said to an agent'),
    ]),
    group('Pack', packs.map((p) => row(`pack:${p}`, dot(`rt-k-${packClass(p)}`), p === 'core' ? 'Core' : p === 'owner' ? 'Your own' : p === 'learned' ? 'Learned' : p, count((x) => x.pack === p), `From ${p}`))),
    group('Tier', TIERS.map((t) => row(`tier:${t}`, dot('rt-k-node'), t === 'core' ? 'Core, the trunk' : t === 'pack' ? 'Other packs' : t === 'owner' ? 'The owner’s' : 'Learned', count((x) => x.tier === t), `Whose: ${t}`)).filter((r, i) => count((x) => x.tier === TIERS[i]) > 0 || hidden.has(`tier:${TIERS[i]}`))),
    group('Standing', STANDINGS.map((s) => row(`status:${s}`, dot(`rt-k-node rt-k-${s}`), s === 'trial' ? 'On trial' : s === 'current' ? 'Current' : 'Retired', count((x) => x.status === s), `Standing: ${s}`)).filter((r, i) => count((x) => x.status === STANDINGS[i]) > 0 || hidden.has(`status:${STANDINGS[i]}`))),
    group(schematic ? 'What happened (schematic)' : 'What happened', [
      row('event:miss', dot('rt-k-write'), 'Misses', events.miss ?? 0, 'A miss no node covered'),
      row('event:held', dot('rt-k-say'), 'Held', events.held ?? 0, 'A node said, its miss did not come back'),
      row('event:failed', dot('rt-k-fail'), 'Came back', events.failed ?? 0, 'A node said, its miss came back anyway'),
      row('event:fired', dot('rt-k-fire'), 'Rule fired', events.fired ?? 0, 'A rule acted on a write, no model asked'),
    ]),
  );
}

/** The legend's look: an island key's (faint and dashed when off, underlined under the pointer where it toggles). */
export const legendCss = `
.rt-legend { display: flex; flex-direction: column; gap: var(--ln-reflex-legend-gap); padding: var(--ln-reflex-legend-gap); font-size: var(--ln-small-text); color: var(--ln-text); max-width: var(--ln-reflex-legend-width); overflow: hidden; }
.rt-lg-title { color: var(--ln-muted); white-space: nowrap; }
.rt-lg-row { display: flex; align-items: center; gap: var(--ln-reflex-legend-gap); white-space: nowrap; }
.rt-lg-row.toggles { cursor: pointer; }
.rt-lg-row.toggles:is(:hover, :focus-visible) .rt-lg-name { text-decoration: underline; }
.rt-lg-row.rt-off .rt-lg-name, .rt-lg-row.rt-off .rt-lg-n { opacity: var(--ln-flow-waiting); }
.rt-lg-row.rt-off .rt-lg-glyph :is(circle, rect) { fill: none; stroke: var(--ln-muted); stroke-dasharray: var(--ln-flow-dash-held); stroke-width: var(--ln-reflex-legend-line); }
.rt-lg-name { flex: 1 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; }
.rt-lg-n { color: var(--ln-muted); font-variant-numeric: tabular-nums; }
.rt-lg-glyph { width: var(--ln-reflex-key-glyph); height: var(--ln-reflex-key-glyph); flex: 0 0 auto; }
.rt-k-trial { fill: none; stroke: var(--ln-text); stroke-width: var(--ln-reflex-legend-line); }
.rt-k-retired { opacity: var(--ln-reflex-retired-ink); }
`;

export { EVENTS };
