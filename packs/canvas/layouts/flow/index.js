// A lens answer drawn as a flat graph on one plane, where depth is never drawn (e_ktdensts): every item a step showing its name
// in its type's outline (the style's type_shapes, read through what the type is a flavour of: in the house style work a box, a
// question a diamond, an occurrence a pill, a record a sheet with a wavy foot, the system's own a box with cut corners, an actor
// a hexagon, an aim a flag, a place a box with a tab), where it stands in its course a dot (hollow, half or full, none for what
// only stands: ./state.js), and colour only for what waits on you and what is in trouble (e_rnyqarfe), the order (depends_on)
// read from the top down in wires at right angles from what is depended on to what depends on it, broken where one passes under
// another, and every other link (part_of first) a quiet tie between the two it ties, with a head where it points: every wire has
// one. A session on a step rings it in the session's hue (./session-ring.js). A type the style lists headless (core's house
// style: part_of) is laid out from what it ties to, the whole over its part, so its head points up into the whole. What follows
// an open question is dashed, as a scenario. Hovering a step lights its wires and ties and shows a tip: its title and the start
// of its note. Every wire is drawn all the time: the layout places them all, so a wire left out of the picture hides what placed
// it. Drawn from the flat lens's answer (items and links); the older lens's still draws, what each item is `inside` read as
// part_of. The layout is ./layout.js, its model; this turns a model into the marks to draw (SVG and HTML as data), which the page
// checks and mounts, so every name is in the page and every step a link, and two models into the patches between them. Its look
// is ./look.js, in the lens's colours; the key's rows ./compose-key.js. A lens with steps tells the process as it happens (./story.js), the conversation beside
// it. A place that holds parts may be a colour on them instead of a step (./places.js), as the style says (place_hues). What is
// `pending` is a ghost: a change held for the owner, drawn where it would land (an item faint, a link dashed, an edit marked on
// its step), each with a badge keyed `held:<proposal>` that the page answers a click on by putting the change to the person; a
// link the person just drew (`mine`) is dashed until it is.

import { lineageOf, shownOnly } from './graph.js';
import { layout } from './layout.js';
import { effortOf } from './effort.js';
import { css } from './look.js';
import { landMarks, landRules, landShades } from './land-look.js';
import { boxHeight, listOf, ROLES, STATUS_WORDS } from './cut-item.js';
import { outlineOf } from './type-outline.js';
import { rangeKeyPath } from './aim-range.js';
import { TYPE_WORDS } from './cut-item.js';
import { holdersOf } from './waymark.js';
import { wireNames, wireRules } from './wire-names.js';
import { boardKeyRows, glyphOf, grammar, itemMarks, itemRules, statusOf, swatchRows } from './item-look.js';
import { css as islandCss, islandHue, islandMarks, nameOf, saidOf } from './islands.js';
import { css as packCss, packMarks, packRules, packsWidth, partInKey, partsIslandMarks } from './pack-marks.js'; import { isParts, openParts, partsIslands, partsRoom, withPartsIslands } from './parts-islands.js'; import { ghostSize } from './ghost-parts.js';
import { compose, islandModels, islandsOf } from './archipelago.js';
import { addClass, HEX, m, titled } from './marks.js';
import { looks as kept } from './island-looks.js';
import { placesAsColours } from './places.js';
import { arrowHead, drawn, middleOf } from './polyline.js';
import { carried } from './carried.js';
import { SHAPES } from './steps.js';
import { keyOf, ORDER_TYPE, PHASE_WORDS, words } from './compose-key.js';
import { focusOf } from './focus.js';
import { css as paintedCss, paintedBody, paintIslands, placer, shoreOnly } from './painted.js';
import { play } from './play.js';
import { css as storyCss, everyNamed, reveal, statesOf } from './story.js';
import { statesOf as standing } from './state.js';
import { css as sessionCss, hueRules, litStates, sessionItems, sessionMarks, sessionOf, stateMark, STATE_WORDS } from './session.js';
import { css as ringCss, ringLines, ringRules, sessionRings } from './session-ring.js';
import { cut, longest } from './lines.js';
import { reasonLines } from './reasons.js';

function lit(i, style, words, state) {
  if (Array.isArray(style.only)) return style.only.includes(i.id);
  // What the lens's words found among the rest it draws stays lit, the rest dimmed (Find's hits, e_d9q8b5zr).
  if (words) return Boolean(i.found?.includes('text'));
  return style.lit === 'you' ? Boolean(state.you) : style.lit === 'blocked' ? Boolean(state.blocked) : true;
}

/** A step's outline, centred on x, y, its corners as round as rx, cut into by `cut` (a bevel, a point, a tab). */
function outlineMark(shape, x, y, w, hgt, rx, cut = 0, own = {}) {
  const l = x - w / 2, r = x + w / 2, t = y - hgt / 2, b = y + hgt / 2;
  // A chamfer, a fold or a summit (./type-outline.js): the pieces of a type's outline that are not a mountain.
  const piece = outlineOf(shape, l, t, r, b, cut || Math.min(w, hgt) / 4, own);
  if (piece) return m('path', { d: piece, class: 'lf-shape' });
  if (shape === 'cut') return m('path', { d: `M${l + cut} ${t}H${r - cut}L${r} ${t + cut}V${b - cut}L${r - cut} ${b}H${l + cut}L${l} ${b - cut}V${t + cut}Z`, class: 'lf-shape' });
  if (shape === 'hexagon' || shape === 'lozenge') return m('path', { d: `M${l + cut} ${t}H${r - cut}L${r} ${y}L${r - cut} ${b}H${l + cut}L${l} ${y}Z`, class: 'lf-shape' });
  if (shape === 'flag') return m('path', { d: `M${l} ${t}H${r - cut}L${r} ${y}L${r - cut} ${b}H${l}Z`, class: 'lf-shape' });
  // A place: a tab over the left third of its top.
  if (shape === 'tab') return m('path', { d: `M${l} ${t}H${l + w / 3}L${l + w / 3 + cut} ${t + cut}H${r}V${b}H${l}Z`, class: 'lf-shape' });
  // A mountain's step has no box: its ground line through the middle, where wires land, and a clear area to hover.
  if (shape === 'ridge') return m('g', {}, m('rect', { x: l, y: t, width: w, height: hgt, class: 'lf-hit' }), m('path', { d: `M${l} ${y}H${r}`, class: 'lf-shape' }));
  if (shape === 'diamond') return m('path', { d: `M${x} ${t}L${r} ${y}L${x} ${b}L${l} ${y}Z`, class: 'lf-shape' });
  // A finding: a ticket, a notch in each end, what is handed from one island to another.
  if (shape === 'ticket') return m('path', { d: `M${l} ${t}H${r}V${y - cut}A${cut} ${cut} 0 0 0 ${r} ${y + cut}V${b}H${l}V${y + cut}A${cut} ${cut} 0 0 0 ${l} ${y - cut}Z`, class: 'lf-shape' });
  if (shape === 'pill' || shape === 'end') return m('rect', { x: l, y: t, width: w, height: hgt, rx: hgt / 2, class: 'lf-shape' });
  // A document: a sheet whose foot is a wave.
  if (shape === 'sheet') return m('path', { d: `M${l} ${t}H${r}V${b - 5}C${r - w / 4} ${b - 13} ${x + w / 8} ${b + 5} ${x} ${b - 3}C${x - w / 8} ${b - 11} ${l + w / 4} ${b + 5} ${l} ${b - 3}Z`, class: 'lf-shape' });
  return m('rect', { x: l, y: t, width: w, height: hgt, rx: Math.min(rx, hgt / 5), class: 'lf-shape' });
}

/**
 * The graph: its steps, the wires and ties between them and what each choice is. `input` is what the page gives every
 * drawing (the answer, the style); `tools.measure(text, px, font, role)` is how wide a text is drawn, as one of the style's text roles when one is given.
 */
export function draw({ answer: given, style, reduced, width, height }, tools) {
  let answer = shownOnly(given);
  // A story lays out what its steps bring in, all of it, each mark hidden until a step shows it.
  const story = Array.isArray(answer.steps) && answer.steps.length > 0;
  if (story) {
    const named = everyNamed(answer.steps);
    answer = { ...answer, items: answer.items.filter((i) => named.has(i.id) || i.id === answer.lens?.from) };
  }
  const hidden = story ? { opacity: 0 } : {};
  // A place that holds parts is a colour on them, not a step, where the style gives places colours (place_hues).
  const placeHues = !story && Array.isArray(style.place_hues) ? style.place_hues.filter((h) => HEX.test(String(h))) : [];
  const shownAs = placesAsColours(answer, placeHues, new Set([style.here, answer.lens?.from].filter(Boolean)));
  answer = { ...answer, items: shownAs.items };
  const hexOf = new Map(shownAs.places.map((p) => [p.id, p.hex]));
  // Every length is the style's (sizes, flow_*), named by the house style; so is the typeface.
  const z = (name) => {
    const v = style.sizes?.[`flow_${name}`];
    if (typeof v !== 'number') throw new Error(`The style names no size "flow_${name}": the house style (packs/canvas/pack.json) names every one a drawing uses`);
    return v;
  };
  const NOTE = style.numbers?.note_opening_cut;
  if (typeof NOTE !== 'number') throw new Error('The style names no number "note_opening_cut": the house style (packs/canvas/pack.json) names every one a drawing uses');
  // A text is measured as it is drawn: in the plain face, or as one of the style's text roles (type), such as water.
  const measure = (text, px, role) => {
    const as = role && style.type?.[role];
    return tools.measure(text, px, (as && style.faces?.[as.face]) || style.font, as);
  };
  const [TEXT, STUB_TEXT, CORNER] = ['text', 'stub_text', 'corner'].map(z);
  const fit = (text, width, px, role) => {
    if (measure(text, px, role) <= width) return text;
    return `${longest(text, (t) => measure(t, px, role) <= width)}…`;
  };
  // The link types the style draws no wire for (undrawn, as a style says) tie nothing here either.
  // The shape it is laid out toward: the pane's, as far as the style says to follow it (flow_aspect_follow, 0 not at
  // all, 1 wholly, more to lean further), from the shape it takes when the pane's is not known (flow_aspect).
  const [ASPECT, FOLLOW] = ['flow_aspect', 'flow_aspect_follow'].map((name) => {
    const v = style.numbers?.[name];
    if (typeof v !== 'number') throw new Error(`The style names no number "${name}": the house style (packs/canvas/pack.json) names every one a drawing uses`);
    return v;
  });
  const pane = width > 0 && height > 0 ? width / height : ASPECT;
  const aspect = ASPECT * (pane / ASPECT) ** FOLLOW;
  const record = (v) => (v && typeof v === 'object' && !Array.isArray(v) ? v : {});
  // Each island's own layer, from the packs active on it (decision e_gqmavsb7): outlines and dots for its items.
  // A view that says its islands are plain (island_looks) draws each by its own look alone: no island's look or layer.
  const shown = style.island_looks === 'plain' ? (answer.islands ?? []).map(({ look: _l, style: _s, ...i }) => i) : answer.islands ?? [];
  const isleStyle = (id) => record(shown.find((i) => i.id === id)?.style), focus = focusOf(shown, style, SHAPES), shapes = { type: record(style.type_shapes), ids: focus.shapes, scales: focus.scales, board: ((board) => (board ? { h: z('board_height'), room: z('sign') + z('sign_gap') + z('sign_margin') - z('box_pad') / 2, ...(board.who && { plate: (i) => (holdersOf(i, statusOf(i, i.phase ?? 'not_started'), answer.viewer).length ? z('who') + z('who_gap') : 0) }) } : undefined))(grammar(style).board), carve: ((cut) => (cut ? (i, textH) => boxHeight(Object.keys(cut.status).length ? [{ d: cut.most }] : listOf(cut, i, lineageOf(i)), textH, z('cut_pad'), cut.clear) : undefined))(grammar(style).cut), islands: Object.fromEntries(shown.map((i) => [i.id, record(record(i.style).type_shapes)])) };
  // A run's session (./session.js): its state a mark, its line its one line, what the style lights laid out first.
  const sessions = sessionMarks(style);
  // A focus is its island (decisions e_mqex8wrf, e_53tcvjbv): a box with a mark of its own, placed like any, what other islands read.
  const foci = new Set((answer.islands ?? []).filter((i) => i.focus).map((i) => i.id));
  answer = withPartsIslands({ ...answer, items: sessionItems(answer.items, sessions, (t) => cut(t, z('max_text'), (s) => measure(s, z('text')))) }); // a pack's parts as an island of the query (./parts-islands.js)
  // One budget for the whole picture (./effort.js): what it spends on looking better, at every level, it spends from this.
  const effort = effortOf(z('picture_work'));
  // An island with a look of its own is asked how what it holds stands and looks (../map/looks.js), by the code the frame hands over.
  const onIsle = (id) => new Set(answer.items.filter((i) => i.island === id).map((i) => i.id)), looks = new Map(shown.filter((i) => i.look && (tools.looks ?? kept).get(i.id)).map((i) => ((own) => [i.id, { look: (tools.looks ?? kept).get(i.id), island: { id: i.id, title: i.title, pack: i.pack?.id ?? i.pack ?? null }, links: (answer.links ?? []).filter((l) => own.has(l.from) && own.has(l.to)), numbers: style.numbers, m }])(onIsle(i.id))));
  const run = (part) => layout({ effort, items: part.items, links: part.links, ...Object.fromEntries(['ports', 'extras', 'combed', 'held', 'rewire', 'apart'].filter((k) => part[k] !== undefined).map((k) => [k, part[k]])), undrawn: Array.isArray(style.undrawn) ? style.undrawn : [], headless: Array.isArray(style.headless) ? style.headless : [], measure, sizes: style.sizes, aspect, across: width > 0 ? width : 0, shapes, ...(style.placed && typeof style.placed === 'object' && { placed: style.placed }), ...(looks.size && { looks }), ...(focus.at.size && { focusAt: focus.at }) });
  // A picture of items on islands is an archipelago (./archipelago.js): each island laid out alone, a sea between. One
  // island is framed too, with its own legend in place of the key (task e_5rh5ysut).
  const parts = !story && islandsOf(answer.items).length > 0 ? islandModels({ items: answer.items, links: answer.links ?? [], run }) : null;
  let g = parts ? null : run({ items: answer.items, links: answer.links ?? [] });

  // Where each step stands, read from what is drawn (./state.js): its phase, whether it waits on you, whether it is held up.
  const states = standing({ items: answer.items, links: answer.links ?? [], viewer: answer.viewer, lit: litStates(sessions) });
  const stateOf = (i) => states.get(i.id) ?? { phase: i.open === false ? 'finished' : 'not_started' };
  const yours = (i) => Boolean(stateOf(i).you);
  // How each phase's dot is drawn (the style's phase_marks): hollow, half, full or none.
  const MARKS = ['hollow', 'half', 'full', 'none'], marks = record(style.phase_marks);
  const markOf = (phase, island) => ((own) => (MARKS.includes(own[phase]) ? own[phase] : 'hollow'))({ ...marks, ...record(isleStyle(island).phase_marks) });
  // Whether a step held up by an open step it depends on is marked in the trouble colour (the style's held_up): the
  // house style does not, since the order's wire already says it and red is kept for trouble (the owner, 3 Nov 2026).
  const heldUp = (i) => style.held_up === 'trouble' && Boolean(stateOf(i).blocked);
  /** A step's dot: its phase's mark, in the trouble colour when it is in trouble or, as the style says, held up. */
  const dotClass = (i, phase = stateOf(i).phase) => `ph-${phase} ${markOf(phase, i.island)}${phase === 'trouble' || heldUp(i) ? ' trouble' : ''}`;
  /** The dot itself, as its mark says: a ring, a ring half filled, a disc, or nothing. */
  /** The status a board is painted in: blocked is trouble unless nothing is left to block (./item-look.js statusOf). */
  const boardWord = (i) => statusOf(i, stateOf(i).blocked && !/^(finished|ended)$/.test(stateOf(i).phase) ? 'trouble' : stateOf(i).phase);
  const itemState = String(style.item_state ?? '').split(' '), look = grammar(style);
  const outline = (shape, x, y, w, hgt, rx, cut) => outlineMark(shape, x, y, w, hgt, rx, cut, { span: z('summit_span'), tension: look.cut?.tension });
  const dot = (cls, mark, cx, cy, r) => (mark === 'none' ? null : itemState.includes('check') && mark === 'full' && /ph-(finished|ended)/.test(cls)
    ? m('g', {}, m('circle', { cx, cy, r, class: `lf-dot ${cls}` }), m('path', { d: `M${cx - r * 0.5} ${cy + r * 0.05}L${cx - r * 0.12} ${cy + r * 0.42}L${cx + r * 0.52} ${cy - r * 0.4}`, class: 'lf-dot-check' }))
    : mark === 'half'
    ? m('g', { class: `lf-dot ${cls}` }, m('circle', { cx, cy, r }), m('path', { d: `M${cx} ${cy - r}A${r} ${r} 0 0 0 ${cx} ${cy + r}Z`, class: 'lf-dot-fill' }))
    : m('circle', { cx, cy, r, class: `lf-dot ${cls}` }));
  // The start of a note: its first paragraph, cut where the style says a note's opening is cut.
  const opening = (i) => {
    const text = String(i.body ?? i.gist ?? '').split(/\n\s*\n/)[0].replace(/\s+/g, ' ').trim();
    return text.length > NOTE ? `${text.slice(0, NOTE - 1).trimEnd()}…` : text;
  };
  /** Why an item waits: its pack is not active on its island (decision e_57bjxy2x), and the pack's why. */
  const waitWords = (i) => `Waiting on ${i.waiting.pack ?? 'its pack'}${i.waiting.why ? `: ${i.waiting.why}` : ''}`;
  const head = (points) => arrowHead(points, z('head_length'), z('head_half'));
  // A tie's head is on the end its link points to (`headAt`, the end or the start of its line), the way the line comes into it.
  const headless = new Set(Array.isArray(style.headless) ? style.headless : []);
  // Which ends of a type's wire carry a head (the style's `ends`): where it points, where it leaves, or both.
  const endsOf = (type) => (['start', 'end', 'both'].includes(style.ends?.[type]) ? style.ends[type] : 'end');
  // A wire's heads, as one shape: at its end unless that end is on a trunk, at its start unless it starts at a junction.
  const heads = (w, type) => {
    const ends = endsOf(type), toEnd = w.headAt === 'start' ? [...w.points].reverse() : w.points;
    const atEnd = ends !== 'start' && !w.toPort, atStart = ends !== 'end' && !w.stop && !w.fromPort;
    return [atEnd && head(toEnd), atStart && head([...toEnd].reverse())].filter(Boolean).join('') || null;
  };
  // A wire is broken where it passes under another; one that is drawn in as a story plays stays whole.
  const line = (w) => drawn(w.points, story ? [] : w.gaps, z('break_half'));
  // A held change's badge: where the person decides it, on the step's corner or a wire's middle. One per mark.
  // What is held is of the grammar every island shares: the badge says so in a tip of its own, not in a legend.
  let badges = 0;
  const heldTips = new Map();
  const badge = (pending, [bx, by]) => {
    const key = `held:${pending.proposal}:${++badges}`;
    heldTips.set(key, m('div', { class: 'lf-tip' }, m('b', {}, 'Held for you'), pending.reason && m('span', {}, pending.reason)));
    return titled(m('g', { key, on: ['click', 'enter', 'leave'], class: 'lf-held', transform: `translate(${bx} ${by})` }, m('circle', { cx: 0, cy: 0, r: z('held_badge') }), m('text', { x: 0, y: 0 }, '?')), `Held for you${pending.reason ? `: ${pending.reason}` : ''}`);
  };
  const held = (pending) => Boolean(pending?.proposal);

  // What can be dimmed, by the item it is of; each step's key, for hovering; the badge of each step a held change is on.
  const dims = new Map(), keyed = new Map(), tipped = new Set(), stepBadges = new Map();
  // The gesture of the drawing tools (packs/walls/page/draw-marks.js), where the session may write: a button in an island's legend
  // that adds an item there (./islands.js), answered by the page. Not while a story plays.
  const gestures = !story && tools.gestures ? tools.gestures({ island: (key) => (/^i:e_/.test(key) ? key.slice(2) : null), pack: (key) => /^p[ktw]:/.test(key) }) : { on: () => [] };
  // Ties under everything, then wires, each broken where it passes under, then the steps over all, then what each choice is.
  const drawIn = story ? { pathLength: 1, 'stroke-dasharray': 1, 'stroke-dashoffset': 1 } : {};
  const pend = (p) => (p ? ` held${p.mine ? ' mine' : ''}` : '');
  // Each link type its colour: the one the style names for it (link_colours), else one of link_hues, the same for the
  // same type every time unless another type in this picture has it. A colour is a class with a rule of its own: a drawing sets no style on a mark.
  const named = style.link_colours && typeof style.link_colours === 'object' && style.ink_wires !== true ? style.link_colours : {};
  const hues = style.ink_wires === true ? [] : Array.isArray(style.link_hues) && style.link_hues.length ? style.link_hues : Array.isArray(style.hues) ? style.hues : [];
  /** The colour of each name: the one `given` names, else the hue its name picks, stepping past those another in this picture has. */
  const coloursOf = (present, given, from) => {
    const taken = new Set(present.filter((name) => HEX.test(String(given[name]))).map((name) => given[name].toLowerCase()));
    const out = new Map(present.filter((name) => HEX.test(String(given[name]))).map((name) => [name, given[name]]));
    for (const name of present.filter((t) => !HEX.test(String(given[t])) && from.length)) {
      let k = [...name].reduce((s, ch) => (s * 31 + ch.charCodeAt(0)) >>> 0, 7) % from.length;
      for (let tries = 0; tries < from.length && taken.has(String(from[k]).toLowerCase()); tries++) k = (k + 1) % from.length;
      taken.add(String(from[k]).toLowerCase());
      out.set(name, from[k]);
    }
    return out;
  };
  const models = parts ? parts.groups.map((p) => p.model) : [g];
  const linkColours = coloursOf([...new Set([...(models.some((k) => k.chains.length) ? [ORDER_TYPE] : []), ...models.flatMap((k) => k.ties.map((t) => t.type)), ...(parts?.cross ?? []).map((l) => l.type ?? l.kind)])].sort(), named, hues);
  const colourRules = new Set();
  /** A colour is a class with a rule of its own: a drawing sets no style on a mark. */
  const colourClass = (hex, prefix, variable) => {
    if (typeof hex !== 'string' || !HEX.test(hex)) return '';
    const cls = `lf-${prefix}-${hex.slice(1).toLowerCase()}`;
    colourRules.add(`.${cls} { --lf-${variable}: ${hex}; }`);
    return ` ${cls}`;
  };
  const kind = (type) => colourClass(linkColours.get(type), 'k', 'link');
  // A wait on the person looking is drawn in the colour of what waits on you, whatever its link type's colour.
  const waits = new Set((answer.links ?? []).filter((l) => (l.type ?? l.kind) === 'waits_on' || l.is?.includes('waits_on')).map((l) => l.type ?? l.kind));
  const onYou = (t) => (waits.has(t.type) && answer.viewer && (t.flipped ? t.a : t.b) === answer.viewer ? ' you' : '');
  // A part in its place's colour: a class with a rule of its own, as a link's colour is.
  const placeClass = (hex) => {
    const cls = `lf-p-${hex.slice(1).toLowerCase()}`;
    colourRules.add(`.${cls} { --lf-place: ${hex}; }`);
    return cls;
  };
  const partOf = (id) => (hexOf.has(shownAs.of.get(id)) ? placeClass(hexOf.get(shownAs.of.get(id))) : '');
  /** A run's session drawn in its dot's place: its state's mark, as the style says (./session.js). */
  const marked = (i) => sessions.get(sessionOf(i)?.state);

  // The key: what each mark this picture uses means, one to a row (./compose-key.js). A row's mark is drawn in a box of
  // its own: G is where its middle is, how wide and tall a step is in it, and a dot's size.
  const G = { x: z('key_width') / 2, y: z('key_height') / 2, w: z('key_width') - 2 * z('key_margin'), h: z('key_height') - 2 * z('key_margin'), r: 4 };
  // The key draws the aim whole, its range over its box, in the swatch's own box.
  const keyOutline = (shape, x, y, w, hgt, rx, cut) => (shape === 'summit' && look.cut ? m('g', {}, outline('box', x, y + hgt * 0.2, w, hgt * 0.6, rx), m('path', { class: 'lf-range-ink', d: rangeKeyPath(x - w / 2, x + w / 2, y + hgt * 0.5 - hgt * 0.8, y - hgt * 0.3, z('ridge_cols')) })) : outline(shape, x, y, w, hgt, rx, cut));
  const { keyRows, packRows } = keyOf({ z, G, corner: CORNER, story, steps: answer.steps, shapes, sessions, shownAs, model: () => g, stateOf, sessionOf, marked, markOf, heldUp, yours, kind, onYou, placeClass, headless, endsOf, dot, outline: keyOutline });
  const packOf = (id) => (answer.islands ?? []).find((i) => i.id === id)?.pack, capOf = (id) => (answer.islands ?? []).find((i) => i.id === id)?.cap;
  // An island's findings are items, drawn as any item is where its query holds them; its shore lists none (the owner, 10 Nov 2026).
  const [KW, KH] = ['key_width', 'key_height'].map(z);
  // Its last row, where the session may add to it: a button that adds an item on it (./islands.js).
  const addRow = (id) => (gestures.on(`i:${id}`).includes('add') ? [{ glyph: m('svg', { width: KW, height: KH, viewBox: `0 0 ${KW} ${KH}` }, m('path', { d: `M${KW / 2 - KH / 3} ${KH / 2}H${KW / 2 + KH / 3}M${KW / 2} ${KH / 6}V${KH * 5 / 6}`, class: 'lf-add-mark' })), label: 'Add', tip: 'Add an item on this island', add: id, group: 'add' }] : []);
  // A cut's palette, whole: each run of it a row of swatches in every island's key, labelled with the role it plays.
  const swatches = look.cut ? swatchRows(look.cut, { m, w: KW, h: KH, roles: ROLES, words: STATUS_WORDS, sw: z('key_swatch') }) : { rows: [], rules: [] };
  for (const rule of swatches.rules) colourRules.add(rule);
  // A fingerpost board's key: the boards with their plates, and the statuses as small plates (pass 8).
  const boardOn = (p) => [...new Set((p?.model?.all ?? []).filter((n) => !n.dummy && !n.stub).map((n) => n.item.type))];
  const boardKey = (p) => (look.board ? boardKeyRows(look.board, { types: boardOn(p), m, outline, w: KW, h: KH, margin: z('key_margin'), shapes: record(style.type_shapes), words: TYPE_WORDS, statusWords: STATUS_WORDS }) : null);
  const legends = new Map((parts?.groups ?? []).filter((p) => p.id !== null && !isParts(p.id)).map((p) => [p.id, [...(look.board ? boardKey(p) : looks.has(p.id) ? [] : packOf(p.id) ? packRows(packOf(p.id), p) : keyRows({ st: p.model.all.filter((n) => !n.dummy), model: p.model, chains: p.model.chains, ties: p.model.ties, breaks: p.model.breaks.length > 0, local: true })), ...swatches.rows, ...addRow(p.id)]]));
  const entryWidth = (row) => z('key_width') + z('island_legend_mark_gap') + measure(row.label, z('island_legend_text'));
  const nameWidth = (id) => z('island_name_x') + measure(nameOf((answer.islands ?? []).find((i) => i.id === id)), z('island_text')) + packsWidth(packOf(id), z, capOf(id), (t, px) => measure(t, px), openParts(answer, id)); // an open pack's switch is counted
  // What a link across names takes room at sea like a box: as wide as its words, cut to what the style lets it take.
  if (parts) g = compose(parts, { legends: new Map([...legends].map(([id, rows]) => [id, rows.map((row) => ({ w: entryWidth(row), group: row.group ?? null }))])), names: new Map([...legends.keys()].map((id) => [id, nameWidth(id)])), sizes: style.sizes, numbers: style.numbers ?? {}, effort, rooms: partsRoom(answer, (pack) => ghostSize(pack, z, (t, px) => measure(t, px))), follows: new Map(partsIslands(answer).map((p) => [p.id, p.of])) });
  // Islands whose look paints (./painted.js): their items and the links among them painted by it; the map marks each item, and ends the wires from other islands, where the look hands its place.
  const canvases = (g.islands ?? []).filter((i) => i.canvas), inPainted = new Set(answer.items.filter((i) => canvases.some((c) => c.id === i.island)).map((i) => i.id)), unplaced = (w) => (inPainted.has(w.a) || inPainted.has(w.b) ? ' unplaced' : '');
  g = shoreOnly(g, (id) => g.nodes.get(id)?.item?.island, inPainted);
  g = { ...g, all: g.all.filter((n) => !n.item?.ghost) }; // a parts island's placeholder (./parts-islands.js) is never drawn
  const steps = g.all.filter((n) => !n.dummy);
  if (!steps.length && !canvases.length) return { scene: { message: 'Nothing here yet.' } };
  const size = { width: g.width, height: g.height };
  const painting = canvases.length ? paintIslands({ tools, placed: placer({ g, painted: inPainted, gap: z('session_gap'), draw: line, heads, order: ORDER_TYPE, over: style.numbers?.motion_move }), islands: canvases.map((c) => ((own) => ({ id: c.id, at: c.canvas.at, size: c.canvas.size, look: looks.get(c.id).look, hue: islandHue(style, (h) => HEX.test(String(h)), g.islands.findIndex((i) => i.id === c.id)), tint: parseFloat(style.sizes?.flow_island_tint) / 100, ground: parseFloat(style.sizes?.flow_island_ground) / 100, answer: { items: answer.items.filter((i) => own.has(i.id)), links: (answer.links ?? []).filter((l) => own.has(l.from) && own.has(l.to)), islands: shown.filter((i) => i.id === c.id) } }))(new Set(answer.items.filter((i) => i.island === c.id).map((i) => i.id)))) }) : null;

  // A read that ends on a finding's name has no head there: the wire from the name to the finding carries it.
  const tieHeads = g.ties.map((t) => heads(t, t.type)), chainHeads = g.chains.map((c) => heads(c, ORDER_TYPE));
  const tieKeys = (n) => (tieHeads[n] ? [`n:${n}`, `nh:${n}`] : [`n:${n}`]);
  const tieLayer = g.ties.map((t, n) => {
    const cls = `${kind(t.type)}${onYou(t)}${pend(t.pending)}${unplaced(t)}`;
    const path = m('path', { key: `n:${n}`, d: line(t), class: `lf-tie${t.type === 'part_of' ? ' near' : ''}${headless.has(t.type) ? '' : ' headed'}${t.dashed ? ' dashed' : ''}${cls}`, ...drawIn, ...hidden });
    return tieHeads[n] ? [path, m('path', { key: `nh:${n}`, d: tieHeads[n], class: `lf-head${cls}`, ...hidden })] : path;
  });
  const wireLayer = g.chains.map((c, n) => {
    // A wire that ends on a trunk (a bundle's, ./bundle.js) has no head of its own: the trunk's wire carries it.
    const wire = m('path', { key: `w:${n}`, d: line(c), class: `lf-wire${kind(ORDER_TYPE)}${c.dashed ? ' dashed' : ''}${pend(c.pending)}${unplaced(c)}`, ...drawIn, ...hidden });
    return chainHeads[n] ? [wire, m('path', { key: `h:${n}`, d: chainHeads[n], class: `lf-head${kind(ORDER_TYPE)}${pend(c.pending)}${unplaced(c)}`, ...hidden })] : [wire];
  });
  // A wire cut onto a trunk goes on along it (./carried.js): that stretch drawn over the trunk, seen only while lit, so a
  // step hovered lights its way all the way to what it shares and not the other branches of the trunk.
  const C = g.chains.length, wired = [...g.chains, ...g.ties], carry = story ? wired.map(() => []) : carried(wired);
  // Each wire's link name, riding on its longest run and giving way where it is in the way (./wire-names.js); its words also in the wire's tooltip.
  const corners = (n) => ((x, y) => [[x - n.w / 2, y - n.h / 2], [x + n.w / 2, y - n.h / 2], [x + n.w / 2, y + n.h / 2], [x - n.w / 2, y + n.h / 2]])(g.x.get(n.id), g.y.get(n.id));
  const wn = story ? null : wireNames({ style, wired, C, boxes: steps.map(corners), ends: (j) => [wired[j].a, wired[j].b].map((id) => steps.find((n) => n.id === id)).filter(Boolean).map(corners), size, z, measure: (t, px) => measure(t, px), m, order: ORDER_TYPE });
  if (wn) wired.forEach((w, j) => ((own) => (Array.isArray(own[0]) ? own[0] : own).splice(2, 0, m('title', {}, wn.text(j))))(j < C ? wireLayer[j] : tieLayer[j - C]));
  const keysOf = (j) => (j < C ? { line: `w:${j}`, head: `h:${j}`, on: `wx:${j}` } : { line: `n:${j - C}`, head: `nh:${j - C}`, on: `nx:${j - C}` });
  const trunkLayer = wired.flatMap((w, j) => (carry[j].length ? [m('path', {
    key: keysOf(j).on, d: carry[j].map((c) => drawn(c.points, wired[c.k].gaps, z('break_half'))).join(''),
    class: j < C ? `lf-wire trunk${kind(ORDER_TYPE)}${w.dashed ? ' dashed' : ''}` : `lf-tie trunk${w.type === 'part_of' ? ' near' : ''}${headless.has(w.type) ? '' : ' headed'}${kind(w.type)}${onYou(w)}`,
  })] : []));
  // The badges of held links, with the wire or tie each sits on, so a step moved takes them with its wires. A link of a
  // new item held in the same change is decided with it: the item's badge is the one.
  const madeBy = (id, p) => g.nodes.get(id)?.item?.pending?.op === 'create' && g.nodes.get(id).item.pending.proposal === p.proposal;
  const wiresIn = (model) => [...model.chains, ...model.ties];
  const linkBadges = wiresIn(g).map((l, n) => [l, n]).filter(([l]) => held(l.pending) && !madeBy(l.a, l.pending) && !madeBy(l.b, l.pending)).map(([l, n]) => ({ n, mark: badge(l.pending, middleOf(l.points)) }));
  /** A step's dot where it is drawn: of its own phase, or of the phase a story's step gives it then. */
  const dotPlace = (n) => {
    const X = g.x.get(n.id), point = n.shape === 'hexagon' || n.shape === 'lozenge' || n.shape === 'ticket' ? n.bevel : 0;
    const left = n.shape === 'diamond' ? X - n.w / 2 + z('diamond_pad') / 2 : X - n.w / 2 + point + z('text_x');
    return [left - z('dot_gap'), g.y.get(n.id)];
  };
  const dotAt = (n, phase = stateOf(n.item).phase) => look.dot && dot(dotClass(n.item, phase), markOf(phase, n.item.island), ...dotPlace(n), z('dot'));
  const sessionDot = (n) => marked(n.item) && stateMark(m, sessionOf(n.item).state, marked(n.item), ...dotPlace(n), z('dot'));
  // Where a step stands is of the grammar every island shares: its dot says so in a tip of its own, over a ring wider
  // than the dot to hover (`p:<id>`), so an island's legend need not.
  const dotTips = new Map();
  const dotWords = (i) => {
    if (marked(i)) return STATE_WORDS[sessionOf(i).state];
    const phase = stateOf(i).phase;
    return [PHASE_WORDS[phase] ?? words(phase), heldUp(i) && 'Held up'].filter(Boolean).join(', ');
  };
  const hoverDot = (n) => {
    const mark = sessionDot(n) || dotAt(n);
    if (!mark) return null;
    const key = `p:${n.id}`;
    dotTips.set(key, m('div', { class: 'lf-tip' }, m('b', {}, dotWords(n.item)), m('span', {}, n.item.said ?? n.item.title)));
    return m('g', { key, on: ['enter', 'leave'], class: 'lf-mark' }, m('circle', { cx: dotPlace(n)[0], cy: dotPlace(n)[1], r: 2 * z('dot'), class: 'lf-hit' }), mark);
  };
  // On an archipelago each island a region round what lives on it, under everything, and a gate where a link crosses its
  // shore; a finding read across outlined in its island's colour (./islands.js).
  // Its header after its name: its pack and what that pack requires, each a mark (./pack-marks.js).
  // The packs (parts) this island turned off, as the answer's island says (packs_off, parts_off), else its item where the answer holds it.
  const offOn = (id, f = 'packs_off') => ((v) => (Array.isArray(v) ? v : []))(answer.islands?.find((i) => i.id === id)?.[f] ?? answer.items.find((i) => i.id === id)?.fields?.[f]);
  // A parts island draws its pack's parts from its land's top left (./parts-islands.js, ./pack-marks.js partsIslandMarks).
  const headAt = new Map(), header = (id, [x, y], title, open = null, frame) => (headAt.set(id, [[x, y], title, open, frame]), isParts(id) ? ((g) => g && partsIslandMarks({ of: g.of, pack: g.pack, partsOff: offOn(g.of, 'parts_off'), at: [frame.left, frame.top], style, z, m, titled, on: gestures.on, measure: (t, px) => measure(t, px) }))(partsIslands(answer).find((p) => p.id === id)) : packOf(id) && packMarks({ island: id, pack: packOf(id), off: offOn(id), partsOff: offOn(id, 'parts_off'), open: open ?? openParts(answer, id), style, at: [x + measure(title, z('island_text')) + z('island_pack_gap'), y], frame, z, m, titled, on: gestures.on, cap: capOf(id), measure: (t, px) => measure(t, px) }));
  const isles = islandMarks({ g, legends, islands: answer.islands, style, z, m, titled, isHex: (h) => HEX.test(String(h)), header, part: (id, part) => packOf(id) && partInKey({ island: id, pack: packOf(id), id: part, partsOff: offOn(id, 'parts_off'), on: gestures.on }) });
  const lands = landMarks({ style, g, islands: g.islands, size: { width: g.width, height: g.height }, z, m, isHex: (h) => HEX.test(String(h)) }), snap = (y) => (lands.grammar.snap ? Math.round(y / lands.grammar.row) * lands.grammar.row : y);
  const drawnBy = new Map((g.islands ?? []).flatMap((isle) => [...(isle.look?.items ?? [])]));
  const stepLayer = steps.map((n) => {
    const X = g.x.get(n.id), Y = snap(g.y.get(n.id)), i = n.item;
    // A hexagon's name starts past its left point; a flag's and a hexagon's room ends before the point on the right.
    const point = /^(hexagon|lozenge|ticket|forward|roundstart)$/.test(n.shape) ? n.bevel : 0, ends = /^(hexagon|lozenge|ticket|forward)$/.test(n.shape) ? 2 * n.bevel : /^(flag|tallarrow|swallow|pennant|roundend|roundstart)$/.test(n.shape) ? n.bevel : 0;
    // No dot before the name (the style says its state on the shape): the room it had is shared, the name set in the middle.
    const bare = !look.dot && !look.tick && !n.stub, glyph = !n.stub && glyphOf(look, i) ? z('glyph_room') : 0;
    const ridged = n.shape === 'ridge' && look.ridge && !n.stub;
    const boarded = look.board && !n.stub, board = boarded ? z('sign') + z('sign_gap') + z('sign_margin') : 0;
    const left = ridged ? X : boarded ? X - n.w / 2 + point + board : n.shape === 'diamond' ? X - n.w / 2 + z('diamond_pad') / 2 : X - n.w / 2 + point + (n.stub ? z('stub_text_x') : bare ? z('box_pad') / 2 : z('text_x'));
    const room = ridged ? n.w : boarded ? n.w - ends - board - z('text_after') : (n.shape === 'diamond' ? n.w - z('diamond_pad') : n.w - ends - (n.stub ? 2 * z('stub_text_x') : bare ? z('box_pad') : z('text_x') + z('text_after'))) - glyph;
    const ghost = !n.stub && i.pending?.op === 'create';
    const cls = ['lf-step', !n.stub && partOf(n.id) && `placed ${partOf(n.id)}`, n.stub && 'stub', n.shape === 'ridge' && look.ridge && 'ridged', look.board && !n.stub && `boarded bs-${boardWord(i)}`, !n.stub && i.island && lands.classOf(i.island), (n.stub || g.potential.has(n.id)) && 'scenario', !i.open && 'closed', !n.stub && `ph-${stateOf(i).phase}`, !n.stub && yours(i) && 'you', i.id === style.here && !n.stub && 'here', ghost ? 'ghost' : !n.stub && held(i.pending) && 'held', !n.stub && i.waiting && 'waiting', !n.stub && isles.found.get(n.id), foci.has(i.id) && 'focus', inPainted.has(n.id) && 'painted unplaced'].filter(Boolean).join(' ');
    // An item its island's look draws is drawn as it says, about its middle; the link, tip and badges stay the map's. Either way under the rings of the sessions on it.
    const hb = n.h - 2 * (n.plate ?? 0);
    const ring = !n.stub && !story && sessionRings({ item: i, shape: n.shape, x: X, y: Y, w: n.w, h: hb, corner: CORNER, bevel: n.bevel, z, outline, m, style, noTag: (n.plate ?? 0) > 0 });
    // A ridge's name stands under its mountain, on the land; a sheet's lifts off its wave.
    const CARVE = ['carved', 'chamfer', 'fold', 'summit', 'hut', 'hexagon', 'flag', 'pill', 'tab'], RISES = ['summit'];
    const nameY = (s, y) => (CARVE.includes(s.shape) && look.cut ? (Object.keys(look.cut.status).length ? y + ((s.h - (RISES.includes(s.shape) ? 2 * s.bevel : 0)) * look.cut.most) / 2 : y + s.h / 2 - z('cut_pad') / 2 - (s.lines.length * s.line) / 2) : s.shape === 'ridge' && look.ridge ? y + z('ridge_name_gap') + (s.lines.length * s.line) / 2 : y - (s.shape === 'sheet' ? z('sheet_lift') : 0));
    const extra = n.stub || inPainted.has(n.id) || drawnBy.get(n.id)?.length ? { under: [], over: [] } : itemMarks({ g: look, n: n.plate ? { ...n, h: hb } : n, smarks: sessions, at: [X, Y], phase: stateOf(i).blocked && !/^(finished|ended)$/.test(stateOf(i).phase) ? 'trouble' : stateOf(i).phase, item: i, z, outline, m, corner: CORNER, dotAt: dotPlace(n), viewer: answer.viewer });
    for (const rule of extra.rules ?? []) colourRules.add(rule);
    const body = inPainted.has(n.id) ? [paintedBody({ item: i, x: X, y: Y, gap: z('session_gap'), style, m })] : drawnBy.get(n.id)?.length ? [ring, m('g', { class: 'lf-look-item', transform: `translate(${X} ${Y})` }, ...drawnBy.get(n.id))] : [
      ring, ...extra.under, outline(n.shape, X, Y, n.w, hb, CORNER, n.bevel), ...extra.over,
      // In a story, the dot is in a group of its own, for each step to give the dot of where it stood then.
      !n.stub && (story ? m('g', { key: `d:${n.id}` }, dotAt(n)) : hoverDot(n)),
      // Its name in the lines the layout gave it (./lines.js): a second line under the first, the two about the middle.
      n.lines?.length > 1
        ? m('text', { x: left, y: nameY(n, Y) }, ...n.lines.map((line, k) => m('tspan', { x: left, dy: k ? n.line : (-(n.lines.length - 1) * n.line) / 2 }, fit(line, room, n.stub ? STUB_TEXT : TEXT))))
        : m('text', { x: left, y: nameY(n, Y) }, fit(i.title, room, n.stub ? STUB_TEXT : TEXT)),
      // In a story, the word a step flags on it then, over its top right corner.
      story && !n.stub && m('text', { key: `f:${n.id}`, x: X + n.w / 2, y: Y - n.h / 2 - z('flag_lift'), class: 'lf-flag' }, ''),
    ];
    const key = `s:${n.id}`;
    keyed.set(key, i.id);
    if (n.stub) return titled(m('g', { key, on: ['enter', 'leave'], class: cls, ...hidden }, body), `${i.title}\nA choice nothing follows yet`);
    // Held for the owner: a new item is a faint step that opens its change; an edit is marked on its step, with a badge on its corner. A run asking you to decide one (./session.js, askedOf) is where it is decided: its click puts it to you (packs/write/page/canvas-wires.js).
    if (held(i.pending)) stepBadges.set(n.id, badge(i.pending, [X + n.w / 2, Y - n.h / 2]));
    if (!inPainted.has(n.id)) tipped.add(key); // one a look paints says what it is in its look's own tip (./painted.js)
    const decides = ghost ? i.pending.proposal : i.asks, step = m(decides ? 'g' : 'a', { key, on: ['enter', 'leave'], ...(!decides && { href: `#/e/${i.id}` }), class: cls, ...hidden }, body);
    if (!ghost) dims.set(n.id, step);
    titled(step, ghost ? `${i.title}\nHeld for you` : [i.said ?? i.title, i.asks && 'Yours to decide', i.waiting && waitWords(i)].filter(Boolean).join('\n'));
    return decides ? m('g', { key: `held:${decides}:${n.id}`, on: ['click'] }, step) : step;
  });
  // What each choice is, written once beside the question's drop, halfway to its track; a pill already says it.
  const said = new Map();
  for (const c of g.chains) if (c.says && !g.nodes.get(c.b).stub) said.set(`${c.a} ${c.says}`, c);
  const saysText = (c) => fit(c.says, z('says_most'), z('says_text'), 'water'), saysWide = (c) => measure(saysText(c), z('says_text'), 'water') + 2 * z('says_pad');
  /** Where a choice's words stand in a model: beside the drop of its chain. */
  const saysAt = (model, c) => {
    const d = g.nodes.get(c.a);
    return [model.x.get(d.id) + saysWide(c) / 2 + z('says_aside'), (model.y.get(d.id) + d.h / 2 + model.chains[g.chains.indexOf(c)].points[1][1]) / 2];
  };
  const saysLayer = [...said.values()].map((c) => {
    const text = saysText(c), w = saysWide(c), [lx, ly] = saysAt(g, c), sh = z('says_height');
    return titled(m('g', { key: `t:${g.chains.indexOf(c)}`, class: 'lf-says', ...hidden }, m('rect', { x: lx - w / 2, y: ly - sh / 2, width: w, height: sh, rx: sh / 2 }), m('text', { x: lx, y: ly }, text)), c.says);
  });
  const svg = m('svg', { key: 'flow', viewBox: `0 0 ${size.width} ${size.height}`, role: 'img', 'aria-label': `A graph of ${steps.length} steps` }, lands.sea, lands.land, isles.layer, tieLayer, wireLayer, trunkLayer, wn?.hits(line), stepLayer, saysLayer, isles.gates, [...stepBadges.values()], linkBadges.map((b) => b.mark), wn?.layer);
  // The picture's key; on an archipelago none, each island carrying its own.
  const key = [
    ...(parts ? [] : keyRows({ st: steps, chains: g.chains, ties: g.ties, breaks: g.breaks.length > 0, heldHere: stepBadges.size > 0 || linkBadges.length > 0 })),
  ];

  // What stays lit, as the style says: the rest dimmed. Where the lens's words found some of what is drawn and not all, what they found is lit.
  const hits = answer.items.filter((i) => i.found?.includes('text')).length;
  const found = hits > 0 && hits < answer.items.length;
  const dimmed = (now) => [...dims.keys()].filter((id) => !lit(g.nodes.get(id).item, now, found, stateOf(g.nodes.get(id).item)));
  for (const id of dimmed(style)) addClass(dims.get(id), 'dim');
  /** Light the wires and ties of a step, or of none: while one is lit, the rest fade. One on a trunk is lit along it, to its head. */
  const wireKeys = wired.map((w, j) => [...(j < C ? [`w:${j}`, `h:${j}`] : tieKeys(j - C)), ...(carry[j].length ? [keysOf(j).on] : [])]);
  const light = (id, only = null) => {
    const on = new Set(only !== null ? [...wireKeys[only], ...carry[only].filter((c) => c.end).map((c) => keysOf(c.k).head)] : id ? wired.flatMap((w, j) => (w.a === id || w.b === id ? [...wireKeys[j], ...carry[j].filter((c) => c.end).map((c) => keysOf(c.k).head)] : [])) : []);
    return [{ key: 'flow', toggle: { lighting: Boolean(id) || only !== null } }, ...wireKeys.flat().map((key) => ({ key, toggle: { lit: on.has(key) } })), ...(wn?.force(new Set(only !== null ? [only] : wired.flatMap((w, j) => (id && (w.a === id || w.b === id) ? [j] : [])))) ?? [])];
  };
  /** A step's tip: its title, that it waits on you where it does (a colour no legend explains), and the start of its note. */
  const tipFor = (key) => {
    const i = g.nodes.get(key.slice(2)).item, note = held(i.pending) ? `Held for you${i.pending.reason ? `: ${i.pending.reason}` : ''}` : opening(i);
    return m('div', { class: 'lf-tip' }, m('b', {}, i.said ?? i.title), i.waiting && m('span', { class: 'lf-tip-waiting' }, waitWords(i)), yours(i) && m('span', { class: 'lf-tip-you' }, 'Waits on you'), ...reasonLines(i).map((r) => m('span', {}, r)), ...ringLines(i, words).map((r) => m('span', {}, r)), (i.named ?? note) && m('span', {}, i.named ?? note));
  };
  /** The tip of a shared mark (a dot, a held badge, a gate), by its key; none for any other. */
  const markTips = [dotTips, heldTips, isles.tips];
  const markTip = (key) => markTips.find((tips) => tips.has(key))?.get(key);
  // Opened from an item's page, the picture is brought to that item; else to the step nearest its top left.
  const start = g.nodes.has(style.here) ? style.here : steps.filter((n) => !n.stub).reduce((p, q) => (g.y.get(q.id) - q.h / 2 < g.y.get(p.id) - p.h / 2 || (g.y.get(q.id) - q.h / 2 === g.y.get(p.id) - p.h / 2 && g.x.get(q.id) < g.x.get(p.id)) ? q : p), steps[0])?.id;
  // Told as a story: each step of the graph shown as the story's steps bring it, on the stage of story.js.
  let player = null;
  if (story) {
    const marks = {
      steps: new Map(steps.map((n) => [`s:${n.id}`, [n.item.id]])),
      wires: [...g.chains.map((c, n) => ({ keys: [`w:${n}`, `h:${n}`], from: [c.a], to: [g.nodes.get(c.b)?.item.id ?? c.b], pair: [c.a, c.b].sort().join(' ') })), ...g.ties.map((t, n) => ({ keys: tieKeys(n), from: [t.a], to: [t.b], pair: [t.a, t.b].sort().join(' ') }))],
      says: new Map([...said.values()].map((c) => [g.chains.indexOf(c), `t:${g.chains.indexOf(c)}`])),
      flags: new Map(steps.filter((n) => !n.stub).map((n) => [n.item.id, `f:${n.id}`])),
      dots: new Map(steps.filter((n) => !n.stub).map((n) => [n.item.id, `d:${n.id}`])),
      dot: (id, phase) => m('g', { key: `d:${id}` }, dotAt(g.nodes.get(id), phase)),
    };
    const frames = statesOf(answer.steps);
    player = play({ answer, style, reduced, tools, shape: { frames, stage: (ctx) => reveal({ frames, marks, ...ctx }) } });
  }
  // Still on a page, a picture stands at its own size in the middle of the frame it is given, which would stretch it.
  if (style.still && width > size.width && Array.isArray(svg)) {
    svg[1].viewBox = `${(size.width - width) / 2} 0 ${width} ${size.height}`;
    size.width = width;
  }
  return {
    scene: { ...(painting && { surface: { key: 'islands-painted' } }), css: [css, itemRules(style), wireRules(style), landRules(style), landShades(style), ...(parts ? [islandCss, packCss, ...packRules(style), ...isles.rules] : []), sessionCss, ...hueRules(sessions), ringCss, ...(painting ? [paintedCss] : []), ...ringRules(answer.items), ...colourRules, ...(story ? [storyCss] : [])].join('\n'), svg, key, ...(player && { before: player.before, aside: player.after }), size, places: steps.filter((n) => !n.stub).map((n) => ({ id: n.item.id, x: g.x.get(n.id), y: g.y.get(n.id), w: n.w, h: n.h })), start: start ? [g.x.get(start), g.y.get(start)] : undefined, shaped: !story && FOLLOW !== 0 },
    end: () => (player?.end?.(), painting?.end()),
    viewport: (v) => (painting?.view(v), wn?.viewport(v) ?? []),
    on(event) {
      const { name, key } = event;
      if (player?.hears(key)) return player.on(event);
      if (String(key).startsWith('paint:')) return painting?.pointer(String(key).replace(/^paint:/, ''), name, event.at) ?? [];
      // A shared mark's tip, over the step's while the pointer is on the mark; off it, back to the step it is on, if any.
      if (!story && markTip(String(key))) {
        if (name === 'enter') return [{ tip: { key, mark: markTip(String(key)) } }];
        if (name !== 'leave') return [];
        const on = String(key).startsWith('p:') ? `s:${String(key).slice(2)}` : null;
        return on && tipped.has(on) ? [{ tip: { key: on, mark: tipFor(on) } }] : [{ tip: null }];
      }
      // A wire hovered lights as a board does and shows its name, whatever the give-way rule said (its name is drawn last, above the boards).
      if (String(key).startsWith('wh:')) {
        const j = Number(String(key).split(':')[1]);
        return name === 'enter' ? light(null, j) : name === 'leave' ? [...light(null), ...wn.rest(j)] : name === 'move' && event.at ? wn.near(j, event.at) : [];
      }
      if (inPainted.has(keyed.get(key))) painting?.item(keyed.get(key), name === 'enter');
      if (name === 'leave') return [...light(null), { tip: null }];
      if (!keyed.has(key)) return [];
      // A step says what it is in a tip, while a story plays too.
      return [...light(keyed.get(key)), ...(tipped.has(key) ? [{ tip: { key, mark: tipFor(key) } }] : [])];
    },
    restyle(now) {
      const off = new Set(dimmed(now));
      // The step whose page is open is lit, and only it: the page says which (here) as it opens and shuts one.
      const lit = steps.filter((n) => !n.stub).map((n) => ({ key: `s:${n.id}`, toggle: { here: n.item.id === now.here } }));
      return [...[...dims.keys()].map((id) => ({ key: dims.get(id)[1].key, toggle: { dim: off.has(id) } })), ...lit];
    },
  };
}

export const picture = draw;
