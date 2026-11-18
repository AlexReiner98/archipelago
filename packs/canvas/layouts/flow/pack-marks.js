// An island's declarations in its header (feature e_knepxwmn, decision e_cy9dfsna): a mark for the pack it speaks, then
// one for each pack that pack requires, beside its name. Each mark is the pack's glyph (from its style preset, decision
// e_e3ss8nqm; its initial where it has none) in a ring, in the colour the style gives its state on this island
// (pack_marks: active, waiting, off), its tip the pack, its state, what it gives and takes, and why. A pack whose parts
// the answer names (feature e_4r82mvf3) opens them on a click, as a row of smaller marks after its own, grouped by kind,
// the first the switch for the whole pack; a click on a part turns it off or on for that island alone. A pack the answer
// names no parts of is its own switch. Either switch is a button the page answers itself (packs/walls/page/marks-toggle.js),
// as the island's add row is. Layer: marks. Pure: the answer's island and the style in, marks and colour rules out.

/** The states a pack may be in on an island, and how its tip says each. */
export const PACK_STATES = { active: 'On here', waiting: 'Waiting', off: 'Off here' };
/** The kinds of part a pack has, in the order its row groups them, and how a tip names each. */
export const PART_KINDS = { type: 'Type', link: 'Link type', rule: 'Rule', view: 'View', instruction: 'Instruction', lens: 'Lens', style: 'Style' };
const NAMED = /^[a-z]+$/;
/** A pack or part id as the page takes one on a mark (packs/walls/page/marks.js, which also holds it to 64 characters): a part with another is drawn, never a switch. */
const SWITCHABLE = /^[a-z][a-z\d_.-]*$/;

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

/** A pack's tip: its name, its state on this island and why, what it gives, takes and lacks, and what a click does. */
export function tipOf(p, writes, { opens = false, open = false } = {}) {
  const state = stateOf(p), n = Number.isInteger(p.off_would_wait) ? p.off_would_wait : 0;
  const would = n ? `; ${n} item${n === 1 ? '' : 's'} would wait` : '';
  return [
    `${p.title ?? p.id}${p.own ? '' : ' (required)'}`,
    p.kernel === true ? "Always on: the kernel's own" : `${PACK_STATES[state]}${p.why ? `: ${p.why}` : ''}`,
    ...nameRows(words(p.provides), takes(p), state === 'waiting' ? words(p.lacks) : []),
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

/** How wide a pack's open row stands after its mark: the switch, then each part, an extra gap between kinds. */
export const rowWidth = (p, z) => {
  const parts = partsOf(p);
  if (!parts.length) return 0;
  const [d, gap, apart] = ['island_part_mark', 'island_part_gap', 'island_pack_gap'].map(z);
  const kinds = new Set(parts.map((r) => r.kind)).size;
  return apart + (parts.length + 1) * (d + gap) + kinds * (apart - gap);
};

/**
 * The marks of an island's packs, in a row from `[x, y]` (the middle of the first): `z` the style's sizes, `on(key)`
 * the gestures the session may make on a mark (['toggle'] where it may write), `open` the pack whose parts are open,
 * `partsOff` the island's parts_off. Answers { marks, tips, width }: one group, keyed `ph:<island>`, that a click
 * replaces whole; `tips` the tip of each mark, by its key, open or not, for the drawing to show on hover.
 */
export function packMarks({ island, pack, off = [], partsOff = [], open = null, style, at: [x, y], z, m, titled, on = () => [], cap, measure = () => 0 }) {
  // A part's sizes are asked of the style only where the answer names parts.
  const [D, GAP] = ['island_pack_mark', 'island_pack_gap'].map(z), [d, gap] = packsOf(pack).some((p) => partsOf(p).length) ? ['island_part_mark', 'island_part_gap'].map(z) : [0, 0];
  const tips = new Map(), marks = [];
  const tip = (key, lines) => tips.set(key, m('div', { class: 'lf-tip' }, m('b', {}, lines[0]), ...lines.slice(1).map((l) => m('span', { class: 'lf-tip-row' }, l))));
  const ring = (cx, r, glyph) => [m('circle', { cx, cy: y, r }), m('text', { x: cx, y }, glyph)];
  let cx = x + D / 2;
  for (const p of packsOf(pack)) {
    const key = `pk:${island}:${p.id}`, parts = partsOf(p), opens = parts.length > 0, isOpen = opens && open === p.id;
    const sw = `pw:${island}:${p.id}`, switches = togglesHere(p, off) && on(opens ? sw : key).includes('toggle');
    const lines = tipOf(p, switches, { opens, open: isOpen });
    tip(key, lines);
    const cls = `lf-pack st-${stateOf(p)}${p.own ? ' own' : ''}${!opens && switches ? ' toggles' : ''}${opens ? ' opens' : ''}${isOpen ? ' open' : ''}`;
    const events = ['enter', 'leave', ...(opens ? ['click'] : switches ? ['toggle'] : [])];
    marks.push(titled(m('g', { key, on: events, ...(!opens && switches && { item: island, pack: p.id }), class: cls }, ...ring(cx, D / 2, glyphOf(p))), lines.join('\n')));
    // Its parts, each with its tip whether open or not, so a click that opens them has them to show.
    if (!opens) { cx += D + GAP; continue; }
    let px = cx + D / 2 + GAP + d / 2, kind = null;
    const row = [];
    const swLines = switchTipOf(p, switches);
    tip(sw, swLines);
    row.push(titled(m('g', { key: sw, on: ['enter', 'leave', ...(switches ? ['toggle'] : [])], ...(switches && { item: island, pack: p.id }), class: `lf-part whole st-${stateOf(p)}${switches ? ' toggles' : ''}` }, ...ring(px, d / 2, kindGlyph(style, 'pack'))), swLines.join('\n')));
    for (const part of parts) {
      px += d + gap + (part.kind !== kind ? GAP - gap : 0);
      kind = part.kind;
      const pk = `pt:${island}:${part.id}`, flips = partTogglesHere(p, part, partsOff) && on(pk).includes('toggle'), pl = partTipOf(p, part, flips);
      tip(pk, pl);
      row.push(titled(m('g', { key: pk, on: ['enter', 'leave', ...(flips ? ['toggle'] : [])], ...(flips && { item: island, pack: part.id }), class: `lf-part k-${part.kind} st-${stateOf(part)}${flips ? ' toggles' : ''}` }, ...ring(px, d / 2, kindGlyph(style, part.kind))), pl.join('\n')));
    }
    if (isOpen) marks.push(...row);
    cx += D + GAP + (isOpen ? rowWidth(p, z) : 0);
  }
  // Over its cap, how many it holds against how many its look reads well at, after its packs.
  const over = capText(cap), edge = x + packsWidth(pack, z, null, measure, open);
  if (over) marks.push(titled(m('text', { x: edge, y, class: 'lf-cap' }, over), `${cap.count} items: more than the ${cap.most} its look reads well at`));
  return { marks: marks.length ? [m('g', { key: `ph:${island}`, class: 'lf-packs' }, ...marks)] : [], tips, width: packsWidth(pack, z, cap, measure, open) - GAP };
}

/** How wide an island's packs stand after its name: each mark with its gap, the open one's row, then what over its cap says. */
export const packsWidth = (pack, z, cap, measure = () => 0, open = null) => packsOf(pack).reduce((w, p) => w + z('island_pack_mark') + z('island_pack_gap') + (open === p.id ? rowWidth(p, z) : 0), 0) + ((t) => (t ? measure(t, z('island_pack_text')) + z('island_pack_gap') : 0))(capText(cap));

/**
 * What a click on a pack's mark does: opens its parts, or closes them, by drawing the island's header again with
 * `header(island, open)` (the drawing's, which knows where it stands). Answers the patches, or null for another mark.
 */
export function packOpener(header) {
  const open = new Map();
  return ({ name, key }) => {
    const [, island, pack] = /^pk:(e_[a-z\d]+):(.+)$/.exec(String(key)) ?? [];
    if (name !== 'click' || !island) return null;
    open.set(island, open.get(island) === pack ? null : pack);
    const head = header(island, open.get(island));
    return head?.marks?.length ? [{ key: `ph:${island}`, mark: head.marks[0] }, { tip: null }] : [];
  };
}

export const css = `
/* An island's packs: each a ring with its glyph, in its state's colour (pack_marks); off, the ring dashed. */
.lf-pack, .lf-part { pointer-events: auto; }
.lf-pack circle, .lf-part circle { fill: var(--ln-land); stroke: var(--lf-pack, var(--ln-muted)); stroke-width: var(--ln-flow-island-pack-stroke); }
.lf-pack.st-off circle, .lf-part.st-off circle { stroke-dasharray: var(--ln-flow-dash-held); }
.lf-pack text, .lf-part text { fill: var(--lf-pack, var(--ln-muted)); font-size: var(--ln-flow-island-pack-text); font-family: var(--ln-font); text-anchor: middle; dominant-baseline: central; }
/* A part: smaller; waiting, faded and dashed, as a waiting step is. */
.lf-part text { font-size: var(--ln-flow-island-part-text); }
.lf-part.st-waiting { opacity: var(--ln-flow-waiting); }
.lf-part.st-waiting circle { stroke-dasharray: var(--ln-flow-dash-held); }
.lf-pack.open circle { stroke-width: var(--ln-flow-stroke-lit); }
.lf-pack:is(.toggles, .opens), .lf-part.toggles { cursor: pointer; outline: none; }
.lf-pack:is(.toggles, .opens):is(:hover, :focus-visible) circle, .lf-part.toggles:is(:hover, :focus-visible) circle { stroke-width: var(--ln-flow-stroke-lit); }
.lf-tip .lf-tip-row { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
/* Over its cap: the count against the cap, in the colour of what is in trouble. */
.lf-cap { fill: var(--ln-blocked); font-size: var(--ln-flow-island-pack-text); font-family: var(--ln-font); dominant-baseline: central; }
[data-text=none] .lf-pack, [data-text=none] .lf-part, [data-text=none] .lf-cap { display: none; }
`;
