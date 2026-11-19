// An island's declarations in its header (feature e_knepxwmn, decision e_cy9dfsna): a mark for the pack it speaks, then
// one for each pack that pack requires, beside its name. Each mark is the pack's glyph (from its style preset, decision
// e_e3ss8nqm; its initial where it has none) in a ring, in the colour the style gives its state on this island
// (pack_marks: active, waiting, off), its tip the pack, its state, what it gives and takes, and why. A pack whose parts
// the answer names (feature e_4r82mvf3) opens them on a click: the switch for the whole pack after its mark, and its parts
// as an island of their own (./ghost-parts.js), what acts wired to what it names; a click on a part there turns
// it off or on for that island alone. Opening them is a find: the pack's mark asks the page to add the term
// `parts <pack> <island>` to the canvas query, and the layout places the parts island it gives (./parts-islands.js).
// The island's key toggles its types and links too (partInKey), and says each
// pack's other parts as a count (countRows: study e_a4zcgpda, round three). A pack the answer
// names no parts of is its own switch. Either switch is a button the page answers itself (packs/walls/page/marks-toggle.js),
// as the island's add row is. Layer: marks. Pure: the answer's island and the style in, marks and colour rules out.

import { css as ghostCss, ghostParts } from './ghost-parts.js';

/** The states a pack may be in on an island, and how its tip says each. */
export const PACK_STATES = { active: 'On here', waiting: 'Waiting', off: 'Off here' };
/** The kinds of part a pack has, in the order its row groups them, and how a tip names each. */
export const PART_KINDS = { type: 'Type', link: 'Link type', rule: 'Rule', view: 'View', instruction: 'Instruction', lens: 'Lens', style: 'Style' };
const NAMED = /^[a-z]+$/;
/** A pack or part id as the page takes one on a mark (packs/walls/page/marks.js, which also holds it to 64 characters): a part with another is drawn, never a switch. */
const SWITCHABLE = /^[a-z][a-z\d_.-]*$/;

/** A pack as the header names it: its title, else its id. */
export const nameOf = (p) => String(p?.title || p?.id || '?');

/** A pack's glyph: the one its preset gives, a few characters at most, else its title's initial. */
export const glyphOf = (p) => {
  const g = typeof p?.glyph === 'string' ? [...p.glyph.trim()].slice(0, 2).join('') : '';
  return g || [...String(p?.title || p?.id || '?').trim()][0]?.toUpperCase() || '?';
};

/** What a pack's or a part's state is, as the answer gives it: active where it says nothing else. */
const stateOf = (p) => (Object.hasOwn(PACK_STATES, p?.state) ? p.state : 'active');
const list = (v) => (Array.isArray(v) ? v : []);
const words = (v) => list(v).filter((s) => typeof s === 'string');

/** The packs an island's header shows: its own, then those it requires, each once. */
export function packsOf(pack) {
  if (!pack?.id) return [];
  const seen = new Set([pack.id]);
  const required = list(pack.requires).filter((r) => r?.id && !seen.has(r.id) && seen.add(r.id));
  return [{ ...pack, own: true }, ...required];
}

/** A pack's parts as its row shows them: grouped by kind in PART_KINDS's order, each kind in the answer's order. */
export const partsOf = (p) => (p?.kernel === true ? [] : list(p?.parts).filter((r) => typeof r?.id === 'string' && Object.hasOwn(PART_KINDS, r.kind)))
  .map((r, k) => [r, k]).sort(([a, i], [b, j]) => Object.keys(PART_KINDS).indexOf(a.kind) - Object.keys(PART_KINDS).indexOf(b.kind) || i - j).map(([r]) => r);

/**
 * Whether a click may turn a pack off or on here: never the kernel's own (`kernel`, on every island), and on again only
 * one this island turned off (in `off`, its packs_off): a pack off for another reason (not on this server) is not this
 * island's to turn on.
 */
export const togglesHere = (p, off = []) => p.kernel !== true && (stateOf(p) !== 'off' || off.includes(p.id));

/**
 * Whether a click may turn a part off or on here: only in a pack on here, never one waiting (it waits on what it
 * lacks), and on again only one this island turned off (in `off`, its parts_off).
 */
export const partTogglesHere = (pack, part, off = []) => stateOf(pack) === 'active' && SWITCHABLE.test(part.id) && (stateOf(part) === 'active' || (stateOf(part) === 'off' && off.includes(part.id)));

/** What a pack takes, with the pack that gives each where the answer says: "type:task (core)". */
const takes = (p) => list(p.consumes).filter((c) => typeof c?.name === 'string').map((c) => (c.by ? `${c.name} (${c.by})` : c.name));
/** The rows a tip adds for names: what it gives, takes and lacks, each one row, none where it has none. */
const nameRows = (gives, took, lacks) => [gives.length && `Gives ${gives.join(', ')}`, took.length && `Takes ${took.join(', ')}`, lacks.length && `Lacks ${lacks.join(', ')}`].filter(Boolean);

/** What a pack holds besides its types and links, in words ("21/22 rules · 1 instruction"): a row of its tip, where the header once counted it. */
const countsOf = (p) => ((kinds) => kinds.map(([kind, parts]) => `${countText(parts)} ${PART_KINDS[kind].toLowerCase()}${parts.length === 1 ? '' : 's'}`).join(' · '))(kindsOf(p).filter(([kind]) => kind !== 'type' && kind !== 'link'));

/** A pack's tip: its name, its state on this island and why, what it gives, takes and lacks, and what a click does. */
export function tipOf(p, writes, { opens = false, open = false } = {}) {
  const state = stateOf(p), n = Number.isInteger(p.off_would_wait) ? p.off_would_wait : 0;
  const would = n ? `; ${n} item${n === 1 ? '' : 's'} would wait` : '';
  return [
    `${p.title ?? p.id}${p.own ? '' : ' (required)'}`,
    p.kernel === true ? "Always on: the kernel's own" : `${PACK_STATES[state]}${p.why ? `: ${p.why}` : ''}`,
    ...nameRows(words(p.provides), takes(p), state === 'waiting' ? words(p.lacks) : []),
    countsOf(p),
    opens && (open ? 'Click to close its parts' : 'Click to open its parts'),
    writes && (opens ? (state === 'off' ? 'Turn it on here from its first part' : `Turn it off here from its first part${would}`) : state === 'off' ? 'Click to turn it on here' : `Click to turn it off here${would}`),
  ].filter(Boolean);
}

/** The tip of the switch that leads a pack's open row: the whole pack, and what a click does. */
export const switchTipOf = (p, writes) => [
  `All of ${p.title ?? p.id}`,
  writes ? (stateOf(p) === 'off' ? 'Click to turn the whole pack on here' : `Click to turn the whole pack off here${Number.isInteger(p.off_would_wait) && p.off_would_wait ? `; ${p.off_would_wait} item${p.off_would_wait === 1 ? '' : 's'} would wait` : ''}`) : PACK_STATES[stateOf(p)],
];

/** A part's tip: its id, its kind and state, the names it gives (the pack's, of it), what it lacks, and what a click does. */
export function partTipOf(pack, part, writes) {
  const state = stateOf(part), gives = words(pack.provides).filter((n) => n.endsWith(`:${part.id}`));
  return [
    part.id,
    `${PART_KINDS[part.kind]}: ${PACK_STATES[state].toLowerCase()}`,
    ...nameRows(gives, [], state === 'waiting' ? words(part.lacks) : []),
    writes && (state === 'off' ? 'Click to turn it on here' : 'Click to turn it off here'),
  ].filter(Boolean);
}

/** The colour rule of each state, from the style's pack_marks (by state, { hue }: one of the theme's colours by name). */
export function packRules(style) {
  const given = style?.pack_marks && typeof style.pack_marks === 'object' ? style.pack_marks : {};
  return Object.keys(PACK_STATES).flatMap((state) => {
    const hue = String(given[state]?.hue ?? ''), colour = `{ --lf-pack: var(--ln-${NAMED.test(hue) ? hue : 'muted'}); }`;
    return [`.lf-pack.st-${state} ${colour}`, `.lf-part.st-${state} ${colour}`];
  });
}

/** The glyph of a part's kind, and of the switch that leads a row, as the style's pack_marks.kinds gives it; else its kind's initial. */
const kindGlyph = (style, kind) => glyphOf({ glyph: style?.pack_marks?.kinds?.[kind], title: PART_KINDS[kind] ?? kind });

/** What an island over its cap says after its packs (islands[].cap: { count, most }, most null for none): count/most, else nothing. */
export const capText = (cap) => (Number.isInteger(cap?.count) && typeof cap?.most === 'number' && cap.count > cap.most ? `${cap.count}/${cap.most}` : '');

/** A pack's parts by kind, in PART_KINDS's order: [kind, parts]. */
export const kindsOf = (p) => [...partsOf(p).reduce((by, r) => by.set(r.kind, [...(by.get(r.kind) ?? []), r]), new Map())];

/** What a kind's mark says after its glyph: how many there are, and how many of them are on where not all are. */
export const countText = (parts) => ((on) => (on === parts.length ? String(parts.length) : `${on}/${parts.length}`))(parts.filter((r) => stateOf(r) === 'active').length);

/** A kind's state as its mark shows it: waiting where any waits, off where any is off, else on. */
const kindState = (parts) => (parts.some((r) => stateOf(r) === 'waiting') ? 'waiting' : parts.some((r) => stateOf(r) === 'off') ? 'off' : 'active');

/** A kind's tip: how many of it, how many are off or wait, and what a click does. */
export function kindTipOf(kind, parts, open) {
  const n = (state) => parts.filter((r) => stateOf(r) === state).length, off = n('off'), waiting = n('waiting');
  return [
    `${parts.length} ${PART_KINDS[kind].toLowerCase()}${parts.length === 1 ? '' : 's'}`,
    (off || waiting) && [off && `${off} off here`, waiting && `${waiting} waiting`].filter(Boolean).join(', '),
    open ? 'Click to close the list' : 'Click to list them',
  ].filter(Boolean);
}

/** How wide a pack's open row stands after its mark: its switch alone (its parts stand beside the island). */
export const rowWidth = (p, z) => (kindsOf(p).length ? z('island_pack_gap') + z('island_part_mark') : 0);

/** A part of an island's packs as its key shows it: its state, whether a click may turn it, and its tip; none where no pack here names it. */
export function partInKey({ island, pack, id, partsOff = [], on = () => [] }) {
  for (const p of packsOf(pack)) {
    const part = partsOf(p).find((r) => r.id === id);
    if (!part) continue;
    const toggles = partTogglesHere(p, part, partsOff) && on(`pt:${island}:${id}`).includes('toggle');
    return { state: stateOf(part), toggles, lines: partTipOf(p, part, toggles) };
  }
  return null;
}

/** The key's rows for what of each pack is not a type or link: one row a pack, its kinds counted in words ("21/22 rules · 1 instruction"). */
export function countRows({ pack, style, m, z }) {
  const [W, H] = ['key_width', 'key_height'].map(z);
  return packsOf(pack).flatMap((p) => {
    const kinds = kindsOf(p).filter(([kind]) => kind !== 'type' && kind !== 'link');
    if (!kinds.length) return [];
    // Each kind in words, its count first ("10 rules · 1 view"): a glyph per kind read as soup (study e_unru8ftt).
    const said = kinds.map(([kind, parts]) => `${countText(parts)} ${PART_KINDS[kind].toLowerCase()}${parts.length === 1 ? '' : 's'}`).join(' · ');
    // The row's mark is the pack's own glyph, so its words are the counts alone; the pack's name is in its tip.
    return [{ group: 'count', glyph: m('svg', { width: W, height: H, viewBox: `0 0 ${W} ${H}` }, m('text', { x: W / 2, y: H / 2, class: `lf-key-count st-${kinds.some(([, ps]) => ps.some((r) => stateOf(r) !== 'active')) ? 'some' : 'active'}` }, glyphOf(p))), label: said, tip: `${p.title ?? p.id}: ${kinds.map(([kind, parts]) => kindTipOf(kind, parts, false)[0]).join(', ')}` }];
  });
}

/** Which packs are open: those whose parts island the answer holds for this island (a set), or an older drawing's one id. */
const openSet = (open) => (open instanceof Set ? open : new Set(typeof open === 'string' ? [open] : open?.pack ? [open.pack] : []));

/**
 * The marks of an island's packs, in a row from `[x, y]` (the middle of the first): `z` the style's sizes, `on(key)`
 * the gestures the session may make on a mark (['toggle'] where it may write), `open` the packs whose parts are open as
 * an island of the answer (./parts-islands.js), `partsOff` the island's parts_off. A pack with parts is a find: its
 * click asks the page to add its term to the canvas query, or take it away (verdict e_xqmtjtpw). Answers
 * { marks, tips, width }; `tips` the tip of each mark, by its key, for the drawing to show on hover.
 */
export function packMarks({ island, pack, off = [], partsOff = [], open = null, style, at: [x, y], z, m, titled, on = () => [], cap, measure = () => 0 }) {
  const [D, GAP] = ['island_pack_mark', 'island_pack_gap'].map(z), d = packsOf(pack).some((p) => partsOf(p).length) ? z('island_part_mark') : 0;
  const tips = new Map(), marks = [], opened = openSet(open);
  const tip = (key, lines) => tips.set(key, m('div', { class: 'lf-tip' }, m('b', {}, lines[0]), ...lines.slice(1).map((l) => m('span', { class: 'lf-tip-row' }, l))));
  const ring = (cx, r, glyph) => [m('circle', { cx, cy: y, r }), m('text', { x: cx, y }, glyph)];
  // A pack is named in words, not a letter in a ring: its title, quiet, in its state's colour (study e_unru8ftt, round 4).
  const word = (p, cx) => [m('rect', { x: cx - GAP / 2, y: y - D / 2, width: measure(nameOf(p), z('island_pack_text')) + GAP, height: D, class: 'lf-hit' }), m('text', { x: cx, y, class: 'lf-pack-name' }, nameOf(p))];
  let cx = x;
  for (const p of packsOf(pack)) {
    const key = `pk:${island}:${p.id}`, opens = partsOf(p).length > 0, isOpen = opens && opened.has(p.id);
    const sw = `pw:${island}:${p.id}`, switches = togglesHere(p, off) && on(opens ? sw : key).includes('toggle');
    const lines = tipOf(p, switches, { opens, open: isOpen });
    tip(key, lines);
    const cls = `lf-pack st-${stateOf(p)}${p.own ? ' own' : ''}${!opens && switches ? ' toggles' : ''}${opens ? ' opens' : ''}${isOpen ? ' open' : ''}`;
    const events = ['enter', 'leave', ...(opens ? ['find'] : switches ? ['toggle'] : [])];
    marks.push(titled(m('g', { key, on: events, ...(opens && { find: `parts ${p.id} ${island}` }), ...(!opens && switches && { item: island, pack: p.id }), class: cls }, ...word(p, cx)), lines.join('\n')));
    // Open, the switch for the whole pack stands after its mark; its parts are an island of their own.
    if (isOpen) {
      const swLines = switchTipOf(p, switches);
      tip(sw, swLines);
      marks.push(titled(m('g', { key: sw, on: ['enter', 'leave', ...(switches ? ['toggle'] : [])], ...(switches && { item: island, pack: p.id }), class: `lf-part whole st-${stateOf(p)}${switches ? ' toggles' : ''}` }, ...ring(cx + measure(nameOf(p), z('island_pack_text')) + GAP + d / 2, d / 2, kindGlyph(style, 'pack'))), swLines.join('\n')));
    }
    cx += measure(nameOf(p), z('island_pack_text')) + GAP + (isOpen ? rowWidth(p, z) : 0);
  }
  // Over its cap, how many it holds against how many its look reads well at, after its packs.
  const over = capText(cap), edge = x + packsWidth(pack, z, null, measure, open);
  if (over) marks.push(titled(m('text', { x: edge, y, class: 'lf-cap' }, over), `${cap.count} items: more than the ${cap.most} its look reads well at`));
  return { marks: marks.length ? [m('g', { key: `ph:${island}`, class: 'lf-packs' }, ...marks)] : [], tips, width: packsWidth(pack, z, cap, measure, open) - GAP };
}

/** How wide an island's packs stand after its name: each mark with its gap, an open one's switch, then what over its cap says. */
export const packsWidth = (pack, z, cap, measure = () => 0, open = null) => packsOf(pack).reduce((w, p) => w + measure(nameOf(p), z('island_pack_text')) + z('island_pack_gap') + (openSet(open).has(p.id) ? rowWidth(p, z) : 0), 0) + ((t) => (t ? measure(t, z('island_pack_text')) + z('island_pack_gap') : 0))(capText(cap));

/**
 * A parts island's marks (./parts-islands.js): its pack's parts drawn by ./ghost-parts.js from its land's top left,
 * each a toggle in the parts_off of the island it is of, where the session may write.
 */
export function partsIslandMarks({ of, pack, partsOff = [], at, style, z, m, titled, on = () => [], measure }) {
  return ghostParts({ island: of, pack, at, z, m, titled, measure, glyph: (kind) => kindGlyph(style, kind), state: stateOf, toggles: (part) => partTogglesHere(pack, part, partsOff) && on(`pt:${of}:${part.id}`).includes('toggle'), tip: (part, flips) => partTipOf(pack, part, flips) });
}

export const css = ghostCss + `
/* A key row counting a pack's other parts. */
.lf-key-count { fill: var(--ln-muted); font-size: var(--ln-flow-island-legend-text); text-anchor: middle; dominant-baseline: central; }
.lf-key-count.st-some { fill: var(--ln-warn); }
/* A key row that is a part: off, its mark dashed and its words muted; waiting, faded. */
.lf-island-key.lf-key-part.toggles { cursor: pointer; pointer-events: auto; }
.lf-island-key.lf-key-part.st-off :is(rect, path) { stroke-dasharray: var(--ln-flow-dash-held); }
.lf-island-key.lf-key-part.st-off text, .lf-island-key.lf-key-part.st-waiting { opacity: var(--ln-flow-waiting); }
.lf-island-key.lf-key-part.toggles:is(:hover, :focus-visible) text { text-decoration: underline; }
/* An island's packs: each a ring with its glyph, in its state's colour (pack_marks); off, the ring dashed. */
.lf-pack, .lf-part { pointer-events: auto; }
.lf-pack circle, .lf-part circle { fill: var(--ln-land); stroke: var(--lf-pack, var(--ln-muted)); stroke-width: var(--ln-flow-island-pack-stroke); }
.lf-pack.st-off circle, .lf-part.st-off circle { stroke-dasharray: var(--ln-flow-dash-held); }
.lf-pack text, .lf-part text { fill: var(--lf-pack, var(--ln-muted)); font-size: var(--ln-flow-island-pack-text); font-family: var(--ln-font); text-anchor: middle; dominant-baseline: central; }
/* A pack's name: plain words, set left, quiet; a required pack fainter than the island's own, off crossed out, open lit. */
.lf-pack .lf-hit { fill: transparent; stroke: none; }
.lf-pack text.lf-pack-name { text-anchor: start; }
.lf-pack text.lf-pack-name { fill: var(--ln-muted); }
.lf-pack:not(.own) text { opacity: var(--ln-flow-waiting); }
.lf-pack.st-off text { text-decoration: line-through; }
.lf-pack.open text { fill: var(--ln-text); }
.lf-pack:is(.toggles, .opens):is(:hover, :focus-visible) text { text-decoration: underline; }
/* A part: smaller; waiting, faded and dashed, as a waiting step is. */
.lf-part text { font-size: var(--ln-flow-island-part-text); }
.lf-part.st-waiting { opacity: var(--ln-flow-waiting); }
.lf-part.st-waiting circle { stroke-dasharray: var(--ln-flow-dash-held); }
.lf-pack.open circle, .lf-kind.open circle { stroke-width: var(--ln-flow-stroke-lit); }
/* A kind's count after its glyph; the list of its parts on a card of land, each row its ring and its id, one line. */
.lf-part .lf-part-count { text-anchor: start; }
.lf-kind { cursor: pointer; outline: none; }
.lf-part-card { fill: var(--ln-land); stroke: var(--ln-line); stroke-width: var(--ln-rule); pointer-events: auto; }
.lf-part-row .lf-part-name { text-anchor: start; font-size: var(--ln-flow-island-part-list-text); fill: var(--ln-text); }
.lf-part-row.st-off .lf-part-name { fill: var(--ln-muted); }
.lf-pack:is(.toggles, .opens), .lf-part.toggles { cursor: pointer; outline: none; }
.lf-part-row.toggles:is(:hover, :focus-visible) .lf-part-name { text-decoration: underline; }
.lf-pack:is(.toggles, .opens):is(:hover, :focus-visible) circle, .lf-part.toggles:is(:hover, :focus-visible) circle { stroke-width: var(--ln-flow-stroke-lit); }
.lf-tip .lf-tip-row { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
/* Over its cap: the count against the cap, in the colour of what is in trouble. */
.lf-cap { fill: var(--ln-blocked); font-size: var(--ln-flow-island-pack-text); font-family: var(--ln-font); dominant-baseline: central; }
[data-text=none] .lf-pack, [data-text=none] .lf-part, [data-text=none] .lf-cap { display: none; }
`;
