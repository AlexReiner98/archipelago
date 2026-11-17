// An island's declarations in its header (feature e_knepxwmn, decision e_cy9dfsna): a mark for the pack it speaks, then
// one for each pack that pack requires, beside its name. Each mark is the pack's glyph (from its style preset, decision
// e_e3ss8nqm; its initial where it has none) in a ring, in the colour the style gives its state on this island
// (pack_marks: active, waiting, off), its tip the pack, its state and why. Where the session may write, a click turns
// the pack off or on for that island alone: a button the page answers itself (packs/walls/page/marks-toggle.js), as
// the island's add row is. Layer: marks. Pure: the answer's island and the style in, marks and colour rules out.

/** The states a pack may be in on an island, and how its tip says each. */
export const PACK_STATES = { active: 'On here', waiting: 'Waiting', off: 'Off here' };
const NAMED = /^[a-z]+$/;

/** A pack's glyph: the one its preset gives, a few characters at most, else its title's initial. */
export const glyphOf = (p) => {
  const g = typeof p?.glyph === 'string' ? [...p.glyph.trim()].slice(0, 2).join('') : '';
  return g || [...String(p?.title || p?.id || '?').trim()][0]?.toUpperCase() || '?';
};

/** What a pack's state is, as the answer gives it: active where it says nothing else. */
const stateOf = (p) => (Object.hasOwn(PACK_STATES, p?.state) ? p.state : 'active');

/** The packs an island's header shows: its own, then those it requires, each once. */
export function packsOf(pack) {
  if (!pack?.id) return [];
  const seen = new Set([pack.id]);
  const required = (Array.isArray(pack.requires) ? pack.requires : []).filter((r) => r?.id && !seen.has(r.id) && seen.add(r.id));
  return [{ ...pack, own: true }, ...required];
}

/**
 * Whether a click may turn a pack off or on here: never the kernel's own (`kernel`, on every island), and on again only
 * one this island turned off (in `off`, its packs_off): a pack off for another reason (not on this server) is not this
 * island's to turn on.
 */
export const togglesHere = (p, off = []) => p.kernel !== true && (stateOf(p) !== 'off' || off.includes(p.id));

/** A pack's tip: its name, its state on this island and why, and what a click would do where it may (`writes`). */
export function tipOf(p, writes) {
  const state = stateOf(p), n = Number.isInteger(p.off_would_wait) ? p.off_would_wait : 0;
  return [
    `${p.title ?? p.id}${p.own ? '' : ' (required)'}`,
    p.kernel === true ? "Always on: the kernel's own" : `${PACK_STATES[state]}${p.why ? `: ${p.why}` : ''}`,
    writes && (state === 'off' ? 'Click to turn it on here' : `Click to turn it off here${n ? `; ${n} item${n === 1 ? '' : 's'} would wait` : ''}`),
  ].filter(Boolean);
}

/** The colour rule of each state, from the style's pack_marks (by state, { hue }: one of the theme's colours by name). */
export function packRules(style) {
  const given = style?.pack_marks && typeof style.pack_marks === 'object' ? style.pack_marks : {};
  return Object.keys(PACK_STATES).map((state) => {
    const hue = String(given[state]?.hue ?? '');
    return `.lf-pack.st-${state} { --lf-pack: var(--ln-${NAMED.test(hue) ? hue : 'muted'}); }`;
  });
}

/**
 * The marks of an island's packs, in a row from `[x, y]` (the middle of the first): `z` the style's sizes, `on(key)`
 * the gestures the session may make on a mark (['toggle'] where it may write). Answers { marks, tips, width }: `tips`
 * the tip of each mark, by its key, for the drawing to show on hover.
 */
/** What an island over its cap says after its packs (islands[].cap: { count, most }, most null for none): count/most, else nothing. */
export const capText = (cap) => (Number.isInteger(cap?.count) && typeof cap?.most === 'number' && cap.count > cap.most ? `${cap.count}/${cap.most}` : '');

export function packMarks({ island, pack, off = [], at: [x, y], z, m, titled, on = () => [], cap, measure = () => 0 }) {
  const [D, GAP] = ['island_pack_mark', 'island_pack_gap'].map(z);
  const tips = new Map();
  const marks = packsOf(pack).map((p, k) => {
    const cx = x + D / 2 + k * (D + GAP), key = `pk:${island}:${p.id}`, toggle = on(key).includes('toggle') && togglesHere(p, off);
    const lines = tipOf(p, toggle);
    tips.set(key, m('div', { class: 'lf-tip' }, m('b', {}, lines[0]), ...lines.slice(1).map((l) => m('span', {}, l))));
    const ring = m('circle', { cx, cy: y, r: D / 2 }), glyph = m('text', { x: cx, y }, glyphOf(p));
    const cls = `lf-pack st-${stateOf(p)}${p.own ? ' own' : ''}${toggle ? ' toggles' : ''}`;
    return titled(m('g', { key, on: ['enter', 'leave', ...(toggle ? ['toggle'] : [])], ...(toggle && { item: island, pack: p.id }), class: cls }, ring, glyph), lines.join('\n'));
  });
  // Over its cap, how many it holds against how many its look reads well at, after its packs.
  const over = capText(cap);
  if (over) marks.push(titled(m('text', { x: x + packsWidth(pack, z), y, class: 'lf-cap' }, over), `${cap.count} items: more than the ${cap.most} its look reads well at`));
  return { marks, tips, width: packsWidth(pack, z, cap, measure) - GAP };
}

/** How wide an island's packs stand after its name: the gap before them and each mark with its gap. */
export const packsWidth = (pack, z, cap, measure = () => 0) => ((n) => (n ? n * (z('island_pack_mark') + z('island_pack_gap')) : 0))(packsOf(pack).length) + ((t) => (t ? measure(t, z('island_pack_text')) + z('island_pack_gap') : 0))(capText(cap));

export const css = `
/* An island's packs: each a ring with its glyph, in its state's colour (pack_marks); off, the ring dashed. */
.lf-pack { pointer-events: auto; }
.lf-pack circle { fill: var(--ln-land); stroke: var(--lf-pack, var(--ln-muted)); stroke-width: var(--ln-flow-island-pack-stroke); }
.lf-pack.st-off circle { stroke-dasharray: var(--ln-flow-dash-held); }
.lf-pack text { fill: var(--lf-pack, var(--ln-muted)); font-size: var(--ln-flow-island-pack-text); font-family: var(--ln-font); text-anchor: middle; dominant-baseline: central; }
.lf-pack.toggles { cursor: pointer; outline: none; }
.lf-pack.toggles:is(:hover, :focus-visible) circle { stroke-width: var(--ln-flow-stroke-lit); }
/* Over its cap: the count against the cap, in the colour of what is in trouble. */
.lf-cap { fill: var(--ln-blocked); font-size: var(--ln-flow-island-pack-text); font-family: var(--ln-font); dominant-baseline: central; }
[data-text=none] .lf-pack, [data-text=none] .lf-cap { display: none; }
`;
