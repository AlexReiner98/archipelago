// Layer: marks. How the reflex tree looks: its stylesheet, its key and the counts over it. Its colours are the
// style's (colors reflex_write, the amber of a miss; reflex_say, the blue of a node that held; reflex_fail, a node
// said whose miss came back anyway); the ground,
// the nodes and the words are the page's own, so it reads on light and dark alike. Each branch level is a rule:
// thick and strong at the root, fine and faint at the edge (reflex_branch, reflex_branch_step, reflex_branch_least;
// reflex_branch_ink, reflex_branch_fade, reflex_branch_faint).

import { HEX, m } from './marks.js';

/** The two colours, each checked as a hex colour; the page's accent and warn where the style names none. */
export const coloursOf = (style) => {
  const hex = (name, or) => (typeof style.colors?.[name] === 'string' && HEX.test(style.colors[name]) ? style.colors[name] : or);
  return { write: hex('reflex_write', 'var(--warn, var(--accent))'), say: hex('reflex_say', 'var(--accent)'), fail: hex('reflex_fail', 'var(--bad, var(--warn))') };
};

export function cssOf(style, z, n) {
  const { write, say, fail } = coloursOf(style);
  const levels = n('reflex_branch_levels');
  // A branch's weight by its level, times its tier's (reflex_tier_core, _pack, _owner, _learned): core's the trunk.
  const width = (d) => Math.max(z('reflex_branch_least'), z('reflex_branch') - d * z('reflex_branch_step'));
  const level = Array.from({ length: levels + 1 }, (_, d) => [
    `.rt-b${d} { stroke-width: ${width(d)}; stroke-opacity: ${Math.max(n('reflex_branch_faint'), n('reflex_branch_ink') - d * n('reflex_branch_fade'))}; }`,
    ...['core', 'pack', 'owner', 'learned'].map((tier) => `.rt-b${d}.rt-t-${tier} { stroke-width: ${Math.round(width(d) * n(`reflex_tier_${tier}`) * 100) / 100}; }`),
  ]).flat();
  return `
.rt { overflow: visible; }
.rt-frame { fill: none; stroke: none; pointer-events: none; }
.rt-branch { fill: none; stroke: ${say}; stroke-linecap: round; transition: stroke-dashoffset ${n('reflex_grow')}ms ease-out; }
${level.join('\n')}
.rt-node { opacity: 0; transition: opacity ${n('reflex_grow')}ms ease-out; }
.rt-node.on { opacity: 1; }
.rt-node[role=link] { cursor: pointer; }
.rt-hit { fill: transparent; }
.rt-dot { fill: var(--ln-text); fill-opacity: ${n('reflex_node_ink')}; }
.rt-bough .rt-dot { fill-opacity: ${n('reflex_bough_ink')}; }
.rt-trial .rt-dot { fill: none; stroke: var(--ln-text); stroke-width: ${z('reflex_trial_ring')}; }
.rt-node.rt-retired.on { opacity: ${n('reflex_retired_ink')}; }
.rt-gap .rt-dot { stroke: ${write}; stroke-width: ${z('reflex_gap_ring')}; stroke-opacity: ${n('reflex_gap_ink')}; }
.rt-light.rt-failed circle { fill: ${fail}; }
.rt-trail.rt-failed { stroke: ${fail}; }
.rt-head.rt-failed { fill: ${fail}; }
.rt-k-fail { fill: ${fail}; }
.rt-fail i { color: ${fail}; }
.rt-root { fill: var(--ln-text); }
.rt-name { fill: var(--ln-text); font-size: var(--ln-reflex-name-text); font-weight: 600; pointer-events: none; }
.rt-bough .rt-name { fill: var(--ln-muted); }
.rt-name.rt-quiet { opacity: 0; transition: opacity ${n('reflex_grow')}ms ease-out; }
.rt-node.rt-lit .rt-name.rt-quiet { opacity: 1; }
.rt-glow { pointer-events: none; }
.rt-spark circle { fill: ${write}; }
.rt-light circle { fill: ${say}; }
.rt-g1 { fill-opacity: ${n('reflex_glow') / 2}; }
.rt-g2 { fill-opacity: ${n('reflex_glow')}; }
.rt-g3 { fill-opacity: ${Math.min(1, n('reflex_glow') * 2)}; }
.rt-trail { fill: none; stroke: ${say}; stroke-width: ${z('reflex_trail')}; stroke-opacity: ${n('reflex_trail_ink')}; stroke-linecap: round; stroke-linejoin: round; pointer-events: none; }
.rt-head { fill: ${say}; pointer-events: none; }
.rt-tip { max-width: var(--ln-reflex-tip-width); }
.rt-tip strong { display: block; }
.rt-tip small { color: var(--ln-muted); }
.rt-bar { display: flex; align-items: baseline; gap: var(--ln-reflex-bar-gap); font-size: var(--ln-small-text); color: var(--ln-text); white-space: nowrap; overflow: hidden; }
.rt-count { font-variant-numeric: tabular-nums; }
.rt-count i { font-style: normal; margin-right: var(--ln-reflex-bar-dot); }
.rt-say i { color: ${say}; }
.rt-write i { color: ${write}; }
.rt-schematic, .rt-week { color: var(--ln-muted); }
.rt-control { background: none; border: 0; padding: 0; font: inherit; color: var(--ln-muted); cursor: pointer; }
.rt-control:hover, .rt-control.on { color: var(--ln-text); }
.rt-k-write { fill: ${write}; }
.rt-k-say { fill: ${say}; }
.rt-k-node { fill: var(--ln-text); }
`;
}

const glyph = (kind, z) => ['svg', { width: String(z('reflex_key_glyph')), height: String(z('reflex_key_glyph')), viewBox: '0 0 2 2' }, ['circle', { cx: '1', cy: '1', r: '1', class: `rt-k-${kind}` }]];

/** What each mark means, a row each. */
export const keyOf = (z, schematic) => [
  { glyph: glyph('write', z), label: 'A miss: something no node covered (a trial node grows from it, else a gap stays)' },
  { glyph: glyph('say', z), label: schematic ? 'Held: a node said, its miss did not come back (schematic until counted)' : 'Held: a node said, its miss did not come back' },
  { glyph: glyph('fail', z), label: 'Came back: a node said, its miss came back anyway' },
  { glyph: glyph('node', z), label: 'A node: hollow on trial, solid current, faint retired; the trunk is core’s' },
];

/** The counts over the picture, the week to the film's day: misses against held; and its controls. */
export function barOf({ misses, held, day, schematic, speed, speeds }) {
  const word = (key, text, on, title) => m('button', { key, on: ['click'], class: `rt-control${on ? ' on' : ''}`, title }, text);
  return m(
    'div',
    { key: 'rt-bar', class: 'rt-bar' },
    m('span', { class: 'rt-count rt-write', title: 'Misses no node covered, in the week to this day' }, m('i', {}, '●'), m('span', { key: 'rt-miss-n' }, misses.toLocaleString('en-US')), ' misses'),
    m('span', { class: 'rt-count rt-say', title: 'Sayings that held, in the week to this day' }, m('i', {}, '●'), m('span', { key: 'rt-held-n' }, held.toLocaleString('en-US')), ' held'),
    m('span', { class: 'rt-week', title: 'The film runs over real days: the week to this one' }, 'week to ', m('span', { key: 'rt-day' }, day)),
    schematic && m('span', { key: 'rt-schematic', class: 'rt-schematic', title: 'Until the reflex pack tells misses and verdicts, they are made from its counts' }, 'schematic'),
    word('rt:replay', 'Replay', false, 'Grow the tree again from its root'),
    ...speeds.map((s) => word(`rt:speed:${s}`, `${s}×`, s === speed, `Play at ${s} times`)),
  );
}
