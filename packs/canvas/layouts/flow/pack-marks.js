// An island's declarations in its header (feature e_knepxwmn, decision e_cy9dfsna): a mark for the pack it speaks, then
// one for each pack that pack requires, beside its name. Each mark is the pack's glyph (from its style preset, decision
// e_e3ss8nqm; its initial where it has none) in a ring, in the colour the style gives its state on this island
// (pack_marks: active, waiting, off), its tip the pack, its state, what it gives and takes, and why. A pack whose parts
// the answer names (feature e_4r82mvf3) opens them on a click, as a row after its own: the switch for the whole pack,
// then one mark per kind of part with how many it has (Build: 4 types, 1 link type, 22 rules). A click on a kind lists
// its parts below, a row each, named; a click on a row turns that part off or on for that island alone. A pack the answer
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

/** How wide a pack's open row stands after its mark: the switch, then each kind's mark and its count. */
export const rowWidth = (p, z, measure = () => 0) => {
  const kinds = kindsOf(p);
  if (!kinds.length) return 0;
  const [d, gap, apart] = ['island_part_mark', 'island_part_gap', 'island_pack_gap'].map(z);
  return apart + d + kinds.reduce((w, [, parts]) => w + apart + d + gap + measure(countText(parts), z('island_part_text')), 0);
};

/** Which pack is open and which of its kinds is listed, from what the drawing keeps: a pack's id, or { pack, kind }. */
const openOf = (open) => (typeof open === 'string' ? { pack: open, kind: null } : { pack: open?.pack ?? null, kind: open?.kind ?? null });

/**
 * The marks of an island's packs, in a row from `[x, y]` (the middle of the first): `z` the style's sizes, `on(key)`
 * the gestures the session may make on a mark (['toggle'] where it may write), `open` the pack whose parts are open,
 * `partsOff` the island's parts_off. Answers { marks, tips, width }: one group, keyed `ph:<island>`, that a click
 * replaces whole; `tips` the tip of each mark, by its key, open or not, for the drawing to show on hover.
 */
export function packMarks({ island, pack, off = [], partsOff = [], open = null, style, at: [x, y], z, m, titled, on = () => [], cap, measure = () => 0 }) {
  // A part's sizes are asked of the style only where the answer names parts.
  const [D, GAP] = ['island_pack_mark', 'island_pack_gap'].map(z), [d, gap] = packsOf(pack).some((p) => partsOf(p).length) ? ['island_part_mark', 'island_part_gap'].map(z) : [0, 0];
  const tips = new Map(), marks = [], { pack: openPack, kind: openKind } = openOf(open);
  const tip = (key, lines) => tips.set(key, m('div', { class: 'lf-tip' }, m('b', {}, lines[0]), ...lines.slice(1).map((l) => m('span', { class: 'lf-tip-row' }, l))));
  const ring = (cx, r, glyph) => [m('circle', { cx, cy: y, r }), m('text', { x: cx, y }, glyph)];
  let cx = x + D / 2;
  for (const p of packsOf(pack)) {
    const key = `pk:${island}:${p.id}`, kinds = kindsOf(p), opens = kinds.length > 0, isOpen = opens && openPack === p.id;
    const sw = `pw:${island}:${p.id}`, switches = togglesHere(p, off) && on(opens ? sw : key).includes('toggle');
    const lines = tipOf(p, switches, { opens, open: isOpen });
    tip(key, lines);
    const cls = `lf-pack st-${stateOf(p)}${p.own ? ' own' : ''}${!opens && switches ? ' toggles' : ''}${opens ? ' opens' : ''}${isOpen ? ' open' : ''}`;
    const events = ['enter', 'leave', ...(opens ? ['click'] : switches ? ['toggle'] : [])];
    marks.push(titled(m('g', { key, on: events, ...(!opens && switches && { item: island, pack: p.id }), class: cls }, ...ring(cx, D / 2, glyphOf(p))), lines.join('\n')));
    // Each part's tip whether listed or not, so a hover after a click has it.
    for (const part of partsOf(p)) { const pk = `pt:${island}:${part.id}`; tip(pk, partTipOf(p, part, partTogglesHere(p, part, partsOff) && on(pk).includes('toggle'))); }
    if (!opens) { cx += D + GAP; continue; }
    if (isOpen) {
      let px = cx + D / 2 + GAP + d / 2;
      const swLines = switchTipOf(p, switches);
      tip(sw, swLines);
      marks.push(titled(m('g', { key: sw, on: ['enter', 'leave', ...(switches ? ['toggle'] : [])], ...(switches && { item: island, pack: p.id }), class: `lf-part whole st-${stateOf(p)}${switches ? ' toggles' : ''}` }, ...ring(px, d / 2, kindGlyph(style, 'pack'))), swLines.join('\n')));
      for (const [kind, parts] of kinds) {
        px += d / 2 + GAP + d / 2;
        const gk = `pg:${island}:${p.id}:${kind}`, listed = openKind === kind, kl = kindTipOf(kind, parts, listed), count = countText(parts);
        tip(gk, kl);
        marks.push(titled(m('g', { key: gk, on: ['enter', 'leave', 'click'], class: `lf-part lf-kind k-${kind} st-${kindState(parts)}${listed ? ' open' : ''}` }, ...ring(px, d / 2, kindGlyph(style, kind)), m('text', { x: px + d / 2 + gap, y, class: 'lf-part-count' }, count)), kl.join('\n')));
        if (listed) marks.push(partList({ island, pack: p, parts, partsOff, at: [px - d / 2, y + D / 2], z, m, titled, on, measure, style }));
        px += gap + measure(count, z('island_part_text'));
      }
    }
    cx += D + GAP + (isOpen ? rowWidth(p, z, measure) : 0);
  }
  // Over its cap, how many it holds against how many its look reads well at, after its packs.
  const over = capText(cap), edge = x + packsWidth(pack, z, null, measure, open);
  if (over) marks.push(titled(m('text', { x: edge, y, class: 'lf-cap' }, over), `${cap.count} items: more than the ${cap.most} its look reads well at`));
  return { marks: marks.length ? [m('g', { key: `ph:${island}`, class: 'lf-packs' }, ...marks)] : [], tips, width: packsWidth(pack, z, cap, measure, open) - GAP };
}

/** A kind's parts listed below its mark from `[x, y]` (its left edge, the header's foot): a row each, its kind's ring in its state and its id, on a card of land; a row the session may turn is a toggle. */
function partList({ island, pack, parts, partsOff, at: [x, y], z, m, titled, on, measure, style }) {
  const [d, gap, row, text, pad] = ['island_part_mark', 'island_part_gap', 'island_part_row', 'island_part_list_text', 'island_part_list_pad'].map(z);
  const wide = Math.max(...parts.map((r) => measure(r.id, text)));
  const card = m('rect', { x: x - pad, y: y + pad / 2, width: pad * 2 + d + gap * 2 + wide, height: pad + row * parts.length, rx: pad, class: 'lf-part-card' });
  const rows = parts.map((part, k) => {
    const pk = `pt:${island}:${part.id}`, flips = partTogglesHere(pack, part, partsOff) && on(pk).includes('toggle'), cy = y + pad + row * (k + 0.5);
    return titled(m('g', { key: pk, on: ['enter', 'leave', ...(flips ? ['toggle'] : [])], ...(flips && { item: island, pack: part.id }), class: `lf-part lf-part-row k-${part.kind} st-${stateOf(part)}${flips ? ' toggles' : ''}` },
      m('circle', { cx: x + d / 2, cy, r: d / 2 }), m('text', { x: x + d / 2, y: cy }, kindGlyph(style, part.kind)), m('text', { x: x + d + gap * 2, y: cy, class: 'lf-part-name' }, part.id)), partTipOf(pack, part, flips).join('\n'));
  });
  return m('g', { key: `pl:${island}`, class: 'lf-part-list' }, card, ...rows);
}

/** How wide an island's packs stand after its name: each mark with its gap, the open one's row, then what over its cap says. */
export const packsWidth = (pack, z, cap, measure = () => 0, open = null) => packsOf(pack).reduce((w, p) => w + z('island_pack_mark') + z('island_pack_gap') + (openOf(open).pack === p.id ? rowWidth(p, z, measure) : 0), 0) + ((t) => (t ? measure(t, z('island_pack_text')) + z('island_pack_gap') : 0))(capText(cap));

/**
 * What a click on a pack's mark does: opens its parts, or closes them, by drawing the island's header again with
 * `header(island, open)` (the drawing's, which knows where it stands). Answers the patches, or null for another mark.
 */
export function packOpener(header) {
  const open = new Map();
  return ({ name, key }) => {
    const [, island, pack] = /^pk:(e_[a-z\d]+):(.+)$/.exec(String(key)) ?? [], [, isle, of, kind] = /^pg:(e_[a-z\d]+):(.+):([a-z]+)$/.exec(String(key)) ?? [];
    if (name !== 'click' || !(island || isle)) return null;
    // A pack's mark opens or closes its row; a kind's mark lists its parts, or closes the list.
    if (island) open.set(island, openOf(open.get(island)).pack === pack ? null : { pack, kind: null });
    else open.set(isle, { pack: of, kind: openOf(open.get(isle)).kind === kind ? null : kind });
    const at = island || isle, head = header(at, open.get(at));
    return head?.marks?.length ? [{ key: `ph:${at}`, mark: head.marks[0] }, { tip: null }] : [];
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
