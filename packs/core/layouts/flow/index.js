// A lens answer drawn as a flat graph on one plane, where depth is never drawn (e_ktdensts): every item a step showing its
// name in its type's outline (the style's type_shapes, read through what the type is a flavour of: in the house style work a box, a question a diamond, an
// occurrence a pill, a record a sheet with a wavy foot, the system's own a box with cut corners, an actor a hexagon, an
// aim a flag, a place a box with a tab), where it stands in its course a dot (hollow, half or full, none for what only
// stands: ./state.js), and colour only for what waits on you and what is in trouble (e_rnyqarfe), the order
// (depends_on) read from the top down in wires at right angles from what is depended on to what depends on it, broken
// where one passes under another, and every other link (part_of first) a quiet tie between the two it ties, with a
// head where it points unless the style draws its type headless (core's house style: part_of).
// What follows an open question is dashed, as a scenario. Hovering a step lights its wires and ties and shows a tip:
// its title and the start of its note. Every wire is drawn all the time: the layout places them all, so a wire left out of
// the picture hides what placed it. Drawn from the
// flat lens's answer (items and links); the older lens's still draws, what each item is `inside` read as part_of. The
// layout is ./layout.js, its model; this turns a model into the marks to draw (SVG and HTML as data), which the page checks
// and mounts, so every name is in the page and every step a link, and two models into the patches between them. Its
// look is ./look.js, in the lens's colours. A lens with steps tells the process as it happens (./story.js), the
// conversation beside it. A place that holds parts may be a colour on them instead of a step (./places.js), as the
// style says (place_hues). What is `pending` is a ghost: a change held for the owner, drawn where it would land (an
// item faint, a link dashed, an edit marked on its step), each with a badge keyed `held:<proposal>` that the page
// answers a click on by putting the change to the person; a link the person just drew (`mine`) is dashed until it is.

import { lineageOf, shownOnly } from './graph.js';
import { layout } from './layout.js';
import { effortOf } from './effort.js';
import { css } from './look.js';
import { css as islandCss, islandMarks, nameOf, saidOf } from './islands.js';
import { compose, islandModels, islandsOf } from './archipelago.js';
import { addClass, HEX, m, titled } from './marks.js';
import { placesAsColours } from './places.js';
import { drawn } from './polyline.js';
import { shapedBy } from './steps.js';
import { play } from './play.js';
import { css as storyCss, everyNamed, reveal, statesOf } from './story.js';
import { statesOf as standing } from './state.js';
import { css as sessionCss, hueRules, litStates, sessionItems, sessionMarks, sessionOf, stateMark, STATES, STATE_WORDS } from './session.js';
import { cut } from './lines.js';

/** The link type the order's wires are, for their colour. */
const ORDER_TYPE = 'depends_on';
/** What the key calls the outline of each of core's starter types, and the order its rows go in. */
const KIND_WORDS = { work: 'Work', question: 'Question', occurrence: 'Event', record: 'Record', system: 'System', actor: 'Person', aim: 'Aim', place: 'Place' };
const KEY_ORDER = ['box', 'diamond', 'pill', 'sheet', 'ticket', 'cut', 'hexagon', 'flag', 'tab', 'end'];
/** What the key calls each phase, in its order; what only stands has no dot and no row. */
const PHASE_WORDS = { not_started: 'Not started', under_way: 'Under way', finished: 'Finished', ended: 'Ended', trouble: 'Trouble' };
/** A link type as the key says it: its name without its pack, in words ("could_fund" is "Could fund"). */
const linkName = (type) => {
  const words = type.split('.').pop().replaceAll('_', ' ');
  return words.charAt(0).toUpperCase() + words.slice(1);
};

function lit(i, style, words, state) {
  if (Array.isArray(style.only)) return style.only.includes(i.id);
  // What the lens's words found among the rest it draws stays lit, the rest dimmed (Find's hits, e_d9q8b5zr).
  if (words) return Boolean(i.found?.includes('text'));
  return style.lit === 'you' ? Boolean(state.you) : style.lit === 'blocked' ? Boolean(state.blocked) : true;
}

/** A step's outline, centred on x, y, its corners as round as rx, cut into by `cut` (a bevel, a point, a tab). */
function outline(shape, x, y, w, hgt, rx, cut = 0) {
  const l = x - w / 2, r = x + w / 2, t = y - hgt / 2, b = y + hgt / 2;
  if (shape === 'cut') return m('path', { d: `M${l + cut} ${t}H${r - cut}L${r} ${t + cut}V${b - cut}L${r - cut} ${b}H${l + cut}L${l} ${b - cut}V${t + cut}Z`, class: 'lf-shape' });
  if (shape === 'hexagon') return m('path', { d: `M${l + cut} ${t}H${r - cut}L${r} ${y}L${r - cut} ${b}H${l + cut}L${l} ${y}Z`, class: 'lf-shape' });
  if (shape === 'flag') return m('path', { d: `M${l} ${t}H${r - cut}L${r} ${y}L${r - cut} ${b}H${l}Z`, class: 'lf-shape' });
  // A place: a tab over the left third of its top.
  if (shape === 'tab') return m('path', { d: `M${l} ${t}H${l + w / 3}L${l + w / 3 + cut} ${t + cut}H${r}V${b}H${l}Z`, class: 'lf-shape' });
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
export function picture({ answer: given, style, reduced, width, height }, tools) {
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
    if (typeof v !== 'number') throw new Error(`The style names no size "flow_${name}": the house style (packs/core/pack.json) names every one a drawing uses`);
    return v;
  };
  const NOTE = style.numbers?.note_opening_cut;
  if (typeof NOTE !== 'number') throw new Error('The style names no number "note_opening_cut": the house style (packs/core/pack.json) names every one a drawing uses');
  // A text is measured as it is drawn: in the plain face, or as one of the style's text roles (type), such as water.
  const measure = (text, px, role) => {
    const as = role && style.type?.[role];
    return tools.measure(text, px, (as && style.faces?.[as.face]) || style.font, as);
  };
  const [TEXT, STUB_TEXT, CORNER] = ['text', 'stub_text', 'corner'].map(z);
  const fit = (text, width, px, role) => {
    if (measure(text, px, role) <= width) return text;
    let t = text;
    while (t.length > 1 && measure(`${t}…`, px, role) > width) t = t.slice(0, -1);
    return `${t}…`;
  };
  // The link types the style draws no wire for (undrawn, as a style says) tie nothing here either.
  // The shape it is laid out toward: the pane's, as far as the style says to follow it (flow_aspect_follow, 0 not at
  // all, 1 wholly, more to lean further), from the shape it takes when the pane's is not known (flow_aspect).
  const [ASPECT, FOLLOW] = ['flow_aspect', 'flow_aspect_follow'].map((name) => {
    const v = style.numbers?.[name];
    if (typeof v !== 'number') throw new Error(`The style names no number "${name}": the house style (packs/core/pack.json) names every one a drawing uses`);
    return v;
  });
  const pane = width > 0 && height > 0 ? width / height : ASPECT;
  const aspect = ASPECT * (pane / ASPECT) ** FOLLOW;
  const record = (v) => (v && typeof v === 'object' && !Array.isArray(v) ? v : {});
  const shapes = { type: record(style.type_shapes) };
  // A run's session (./session.js): its state a mark, its line its one line, what the style lights laid out first.
  const sessions = sessionMarks(style);
  answer = { ...answer, items: sessionItems(answer.items, sessions, (t) => cut(t, z('max_text'), (s) => measure(s, z('text')))) };
  // One budget for the whole picture (./effort.js): what it spends on looking better, at every level, it spends from this.
  const effort = effortOf(z('picture_work'));
  const run = (part) => layout({ effort, items: part.items, links: part.links, ...Object.fromEntries(['ports', 'extras', 'combed', 'held', 'rewire', 'apart'].filter((k) => part[k] !== undefined).map((k) => [k, part[k]])), undrawn: Array.isArray(style.undrawn) ? style.undrawn : [], headless: Array.isArray(style.headless) ? style.headless : [], measure, sizes: style.sizes, aspect, shapes });
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
  const markOf = (phase) => (MARKS.includes(marks[phase]) ? marks[phase] : 'hollow');
  // Whether a step held up by an open step it depends on is marked in the trouble colour (the style's held_up): the
  // house style does not, since the order's wire already says it and red is kept for trouble (the owner, 3 Nov 2026).
  const heldUp = (i) => style.held_up === 'trouble' && Boolean(stateOf(i).blocked);
  /** A step's dot: its phase's mark, in the trouble colour when it is in trouble or, as the style says, held up. */
  const dotClass = (i, phase = stateOf(i).phase) => `ph-${phase} ${markOf(phase)}${phase === 'trouble' || heldUp(i) ? ' trouble' : ''}`;
  /** The dot itself, as its mark says: a ring, a ring half filled, a disc, or nothing. */
  const dot = (cls, mark, cx, cy, r) => (mark === 'none' ? null : mark === 'half'
    ? m('g', { class: `lf-dot ${cls}` }, m('circle', { cx, cy, r }), m('path', { d: `M${cx} ${cy - r}A${r} ${r} 0 0 0 ${cx} ${cy + r}Z`, class: 'lf-dot-fill' }))
    : m('circle', { cx, cy, r, class: `lf-dot ${cls}` }));
  // The start of a note: its first paragraph, cut where the style says a note's opening is cut.
  const opening = (i) => {
    const text = String(i.body ?? i.gist ?? '').split(/\n\s*\n/)[0].replace(/\s+/g, ' ').trim();
    return text.length > NOTE ? `${text.slice(0, NOTE - 1).trimEnd()}…` : text;
  };
  // A head points along the way its line comes in: from the last point before the tip that is not the tip.
  const head = (points, tip = points.at(-1), rest = points.slice(0, -1).reverse()) => {
    const from = rest.find((p) => p[0] !== tip[0] || p[1] !== tip[1]) ?? [tip[0], tip[1] - 1];
    const dx = tip[0] - from[0], dy = tip[1] - from[1], l = Math.hypot(dx, dy), ux = dx / l, uy = dy / l;
    const bx = tip[0] - ux * z('head_length'), by = tip[1] - uy * z('head_length'), [nx, ny] = dx ? [-uy, ux] : [-1, 0], half = z('head_half');
    return `M${tip[0]} ${tip[1]}L${bx + nx * half} ${by + ny * half}L${bx - nx * half} ${by - ny * half}Z`;
  };
  // A tie's head is on the end its link points to (`headAt`, the end or the start of its line), the way the line comes into it.
  const headless = new Set(Array.isArray(style.headless) ? style.headless : []);
  const tieHead = (t) => head(t.headAt === 'start' ? [...t.points].reverse() : t.points);
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
  /** Where a wire's badge goes: the middle of its middle stretch. */
  const middleOf = (points) => {
    const k = Math.max(0, Math.floor((points.length - 2) / 2)), [a, b] = [points[k], points[k + 1] ?? points[k]];
    return [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
  };

  // What can be dimmed, by the item it is of; each step's key, for hovering; the badge of each step a held change is on.
  const dims = new Map(), keyed = new Map(), tipped = new Set(), stepBadges = new Map();
  // Ties under everything, then wires, each broken where it passes under, then the steps over all, then what each choice is.
  const drawIn = story ? { pathLength: 1, 'stroke-dasharray': 1, 'stroke-dashoffset': 1 } : {};
  const pend = (p) => (p ? ` held${p.mine ? ' mine' : ''}` : '');
  // Each link type its colour: the one the style names for it (link_colours), else one of link_hues, the same for the
  // same type every time unless another type in this picture has it. A colour is a class with a rule of its own: a drawing sets no style on a mark.
  const named = style.link_colours && typeof style.link_colours === 'object' ? style.link_colours : {};
  const hues = Array.isArray(style.link_hues) && style.link_hues.length ? style.link_hues : Array.isArray(style.hues) ? style.hues : [];
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

  // The key: what each mark this picture uses means, one to a row (the page draws it, docs/layouts.md): each outline by
  // the types drawn in it (core's starter types by their words), each phase's dot, and the two colours, where the picture has them.
  // A row's mark is drawn in a box of its own: G is where its middle is, how wide and tall a step is in it, and a dot's size.
  const G = { x: 11, y: 7, w: 20, h: 11, r: 4 };
  const mark = (inner, label) => ({ glyph: m('svg', { width: z('key_width'), height: z('key_height'), viewBox: '0 0 22 14' }, inner), label });
  const words = (name) => ((w) => w.charAt(0).toUpperCase() + w.slice(1))(String(name).replaceAll('_', ' '));
  const kindWord = (i) => ((t) => KIND_WORDS[t] ?? words(t))(shapedBy(i, shapes) ?? lineageOf(i).at(-1) ?? 'item');
  // A story's key has the phases its steps give too.
  const stepPhases = story ? answer.steps.flatMap((s) => Object.values(s.fields ?? {}).map((f) => f?.phase).filter((p) => typeof p === 'string')) : [];
  /**
   * The rows for what these steps and wires use: of the whole picture, or of one island (`local`). An island's legend
   * holds only its vocabulary, its types and link types (principle e_jxtawgq7: capabilities are a grammar every island
   * shares, so no legend explains them): the phase dot, a session's state, held up, waits on you, a finding crossing and
   * what is held for you leave it, each told in a tip on the mark itself.
   */
  const keyRows = ({ st, chains, ties, breaks, heldHere, local = false }) => {
    const drawnAs = new Map();
    for (const n of st) (drawnAs.get(n.shape) ?? drawnAs.set(n.shape, new Set()).get(n.shape)).add(n.stub ? 'Possible end' : kindWord(n.item));
    const uses = (test) => !local && st.some(test);
    const phases = new Set(local ? [] : [...st.filter((n) => !n.stub && (story || !marked(n.item))).map((n) => stateOf(n.item).phase), ...stepPhases].filter((p) => markOf(p) !== 'none'));
    return [
      [...drawnAs.keys()].sort((a, b) => KEY_ORDER.indexOf(a) - KEY_ORDER.indexOf(b)).map((shape) => mark(m('g', { class: `lf-step${shape === 'end' ? ' scenario' : ''}` }, outline(shape, G.x, G.y, G.w, shape === 'diamond' ? G.h + 1 : G.h, CORNER, G.h / 3)), [...drawnAs.get(shape)].join(', '))),
      Object.keys(PHASE_WORDS).filter((p) => phases.has(p)).map((p) => mark(dot(`ph-${p} ${markOf(p)}${p === 'trouble' ? ' trouble' : ''}`, markOf(p), G.x, G.y, G.r), PHASE_WORDS[p])),
      !story && STATES.filter((s) => uses((n) => !n.stub && marked(n.item) && sessionOf(n.item).state === s)).map((s) => mark(stateMark(m, s, sessions.get(s), G.x, G.y, G.r), STATE_WORDS[s])),
      uses((n) => !n.stub && heldUp(n.item)) && mark(dot('trouble hollow', 'hollow', G.x, G.y, G.r), 'Held up'),
      uses((n) => !n.stub && yours(n.item)) && mark(m('g', { class: 'lf-step you' }, outline('box', G.x, G.y, G.w, G.h, CORNER)), 'Waits on you'),
      shownAs.places.filter((p) => st.some((n) => !n.stub && shownAs.of.get(n.id) === p.id)).map((p) => mark(m('g', { class: `lf-step placed ${placeClass(p.hex)}` }, outline('box', G.x, G.y, G.w, G.h, CORNER)), p.within ? `${p.title}, in ${p.within}` : p.title)),
      chains.length > 0 && mark(m('path', { d: 'M1 7H21', class: `lf-wire${kind(ORDER_TYPE)}` }), 'Leads to'),
      chains.some((c) => c.dashed) && mark(m('path', { d: 'M1 7H21', class: 'lf-wire dashed' }), 'If chosen'),
      breaks && mark(m('path', { d: 'M1 7H21M11 0V4M11 10V14', class: 'lf-wire' }), 'Passes under'),
      // A tie of each type in the colour it is drawn in: its own, or that of what waits on you; "you" said only where both are drawn.
      ((rows) => rows.map((row) => {
        const [type, you] = row.split('\n'), cls = `${kind(type)}${you}`, both = rows.includes(`${type}\n`) && rows.includes(`${type}\n you`);
        return mark(headless.has(type) ? m('path', { d: 'M1 7H21', class: `lf-tie${type === 'part_of' ? ' near' : ''}${cls}` }) : m('g', {}, m('path', { d: 'M1 7H17', class: `lf-tie headed${cls}` }), m('path', { d: 'M21 7L13 3V11Z', class: `lf-head${cls}` })), you && both ? `${linkName(type)} you` : linkName(type));
      }))([...new Set(ties.map((t) => `${t.type}\n${local ? '' : onYou(t)}`))].sort()),
      !local && heldHere && mark(m('path', { d: 'M1 7H21', class: 'lf-wire held' }), 'Held for you'),
    ].flat().filter(Boolean);
  };
  // On an archipelago each island carries its own legend, inside it (the owner, 5 Nov 2026): its types and the link
  // types of its own wires. A link that leaves it is a finding crossing, of the shared grammar, told at its gates.
  // An island that says its pack (the answer's `islands`) names it in the pack's words and order, but only what is in
  // use on it (the owner, 6 Nov 2026): the types of its items and the link types of its own links.
  const packRows = (pack, group) => [
    ...pack.types.filter((t) => group.items.some((i) => i.type === t.id)).map((t) => ((shape) => mark(m('g', { class: 'lf-step' }, outline(shape, G.x, G.y, G.w, shape === 'diamond' ? G.h + 1 : G.h, CORNER, G.h / 3)), t.title))(shapes.type?.[shapedBy({ type: t.id, is: t.is }, shapes)] ?? 'box')),
    ...pack.links.filter((r) => group.links.some((l) => (l.type ?? l.kind) === r.id)).map((r) => mark(r.id === ORDER_TYPE ? m('path', { d: 'M1 7H21', class: `lf-wire${kind(r.id)}` }) : headless.has(r.id) ? m('path', { d: 'M1 7H21', class: `lf-tie${r.id === 'part_of' ? ' near' : ''}${kind(r.id)}` }) : m('g', {}, m('path', { d: 'M1 7H17', class: `lf-tie headed${kind(r.id)}` }), m('path', { d: 'M21 7L13 3V11Z', class: `lf-head${kind(r.id)}` })), r.title)),
  ];
  const packOf = (id) => (answer.islands ?? []).find((i) => i.id === id)?.pack;
  const legends = new Map((parts?.groups ?? []).filter((p) => p.id !== null).map((p) => [p.id, packOf(p.id) ? packRows(packOf(p.id), p) : keyRows({ st: p.model.all.filter((n) => !n.dummy), chains: p.model.chains, ties: p.model.ties, breaks: p.model.breaks.length > 0, local: true })]));
  const entryWidth = (row) => z('key_width') + z('island_legend_mark_gap') + measure(row.label, z('island_legend_text'));
  const nameWidth = (id) => z('island_name_x') + measure(nameOf((answer.islands ?? []).find((i) => i.id === id)), z('island_text'), 'region');
  // What a link across names takes room at sea like a box: as wide as its words, cut to what the style lets it take.
  if (parts) g = compose(parts, { legends: new Map([...legends].map(([id, rows]) => [id, rows.map(entryWidth)])), names: new Map([...legends.keys()].map((id) => [id, nameWidth(id)])), sizes: style.sizes, effort });
  const steps = g.all.filter((n) => !n.dummy);
  if (!steps.length) return { scene: { message: 'Nothing here yet.' } };
  const size = { width: g.width, height: g.height };

  const tieLayer = g.ties.map((t, n) => {
    const cls = `${kind(t.type)}${onYou(t)}${pend(t.pending)}`;
    const path = m('path', { key: `n:${n}`, d: line(t), class: `lf-tie${t.type === 'part_of' ? ' near' : ''}${headless.has(t.type) ? '' : ' headed'}${t.dashed ? ' dashed' : ''}${cls}`, ...drawIn, ...hidden });
    // A read that ends on a finding's name has no head of its own: the wire from the name to the finding carries it.
    return headless.has(t.type) || t.toPort ? path : [path, m('path', { key: `nh:${n}`, d: tieHead(t), class: `lf-head${cls}`, ...hidden })];
  });
  const wireLayer = g.chains.map((c, n) => {
    // A wire that ends on a trunk (a bundle's, ./bundle.js) has no head of its own: the trunk's wire carries it.
    const wire = m('path', { key: `w:${n}`, d: line(c), class: `lf-wire${kind(ORDER_TYPE)}${c.dashed ? ' dashed' : ''}${pend(c.pending)}`, ...drawIn, ...hidden });
    return c.toPort ? [wire] : [wire, m('path', { key: `h:${n}`, d: head(c.points), class: `lf-head${kind(ORDER_TYPE)}${pend(c.pending)}`, ...hidden })];
  });
  // The badges of held links, with the wire or tie each sits on, so a step moved takes them with its wires. A link of a
  // new item held in the same change is decided with it: the item's badge is the one.
  const madeBy = (id, p) => g.nodes.get(id)?.item?.pending?.op === 'create' && g.nodes.get(id).item.pending.proposal === p.proposal;
  const wiresIn = (model) => [...model.chains, ...model.ties];
  const linkBadges = wiresIn(g).map((l, n) => [l, n]).filter(([l]) => held(l.pending) && !madeBy(l.a, l.pending) && !madeBy(l.b, l.pending)).map(([l, n]) => ({ n, mark: badge(l.pending, middleOf(l.points)) }));
  /** A step's dot where it is drawn: of its own phase, or of the phase a story's step gives it then. */
  const dotPlace = (n) => {
    const X = g.x.get(n.id), point = n.shape === 'hexagon' || n.shape === 'ticket' ? n.bevel : 0;
    const left = n.shape === 'diamond' ? X - n.w / 2 + z('diamond_pad') / 2 : X - n.w / 2 + point + z('text_x');
    return [left - z('dot_gap'), g.y.get(n.id)];
  };
  const dotAt = (n, phase = stateOf(n.item).phase) => dot(dotClass(n.item, phase), markOf(phase), ...dotPlace(n), z('dot'));
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
  const isles = islandMarks({ g, legends, islands: answer.islands, style, z, m, titled, isHex: (h) => HEX.test(String(h)) });
  const stepLayer = steps.map((n) => {
    const X = g.x.get(n.id), Y = g.y.get(n.id), i = n.item;
    // A hexagon's name starts past its left point; a flag's and a hexagon's room ends before the point on the right.
    const point = n.shape === 'hexagon' || n.shape === 'ticket' ? n.bevel : 0, ends = n.shape === 'hexagon' || n.shape === 'ticket' ? 2 * n.bevel : n.shape === 'flag' ? n.bevel : 0;
    const left = n.shape === 'diamond' ? X - n.w / 2 + z('diamond_pad') / 2 : X - n.w / 2 + point + (n.stub ? z('stub_text_x') : z('text_x'));
    const room = n.shape === 'diamond' ? n.w - z('diamond_pad') : n.w - ends - (n.stub ? 2 * z('stub_text_x') : z('text_x') + z('text_after'));
    const ghost = !n.stub && i.pending?.op === 'create';
    const cls = ['lf-step', !n.stub && partOf(n.id) && `placed ${partOf(n.id)}`, n.stub && 'stub', (n.stub || g.potential.has(n.id)) && 'scenario', !i.open && 'closed', !n.stub && yours(i) && 'you', i.id === style.here && !n.stub && 'here', ghost ? 'ghost' : !n.stub && held(i.pending) && 'held', !n.stub && isles.found.get(n.id)].filter(Boolean).join(' ');
    const body = [
      outline(n.shape, X, Y, n.w, n.h, CORNER, n.bevel),
      // In a story, the dot is in a group of its own, for each step to give the dot of where it stood then.
      !n.stub && (story ? m('g', { key: `d:${n.id}` }, dotAt(n)) : hoverDot(n)),
      // Its name in the lines the layout gave it (./lines.js): a second line under the first, the two about the middle.
      n.lines?.length > 1
        ? m('text', { x: left, y: Y - (n.shape === 'sheet' ? z('sheet_lift') : 0) }, ...n.lines.map((line, k) => m('tspan', { x: left, dy: k ? n.line : (-(n.lines.length - 1) * n.line) / 2 }, fit(line, room, n.stub ? STUB_TEXT : TEXT))))
        : m('text', { x: left, y: Y - (n.shape === 'sheet' ? z('sheet_lift') : 0) }, fit(i.title, room, n.stub ? STUB_TEXT : TEXT)),
      // In a story, the word a step flags on it then, over its top right corner.
      story && !n.stub && m('text', { key: `f:${n.id}`, x: X + n.w / 2, y: Y - n.h / 2 - z('flag_lift'), class: 'lf-flag' }, ''),
    ];
    const key = `s:${n.id}`;
    keyed.set(key, i.id);
    if (n.stub) return titled(m('g', { key, on: ['enter', 'leave'], class: cls, ...hidden }, body), `${i.title}\nA choice nothing follows yet`);
    // Held for the owner: a new item is a faint step that opens its change; an edit is marked on its step. Either way a badge on its corner.
    if (held(i.pending)) stepBadges.set(n.id, badge(i.pending, [X + n.w / 2, Y - n.h / 2]));
    tipped.add(key);
    if (ghost) return m('g', { key: `held:${i.pending.proposal}:${n.id}`, on: ['click'] }, titled(m('g', { key, on: ['enter', 'leave'], class: cls, ...hidden }, body), `${i.title}\nHeld for you`));
    const el = titled(m('a', { key, on: ['enter', 'leave'], href: `#/e/${i.id}`, class: cls, ...hidden }, body), i.said ?? i.title);
    dims.set(n.id, el);
    return el;
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
  const svg = m('svg', { key: 'flow', viewBox: `0 0 ${size.width} ${size.height}`, role: 'img', 'aria-label': `A graph of ${steps.length} steps` }, isles.layer, tieLayer, wireLayer, stepLayer, saysLayer, isles.gates, [...stepBadges.values()], linkBadges.map((b) => b.mark));
  // The picture's key; on an archipelago none, each island carrying its own.
  const key = parts ? [] : keyRows({ st: steps, chains: g.chains, ties: g.ties, breaks: g.breaks.length > 0, heldHere: stepBadges.size > 0 || linkBadges.length > 0 });

  // What stays lit, as the style says: the rest dimmed. Where the lens's words found some of what is drawn and not all,
  // what they found is lit.
  const hits = answer.items.filter((i) => i.found?.includes('text')).length;
  const found = hits > 0 && hits < answer.items.length;
  const dimmed = (now) => [...dims.keys()].filter((id) => !lit(g.nodes.get(id).item, now, found, stateOf(g.nodes.get(id).item)));
  for (const id of dimmed(style)) addClass(dims.get(id), 'dim');
  /** Light the wires and ties of a step, or of none: while one is lit, the rest fade. */
  const light = (id) => [
    { key: 'flow', toggle: { lighting: Boolean(id) } },
    ...g.chains.flatMap((c, n) => [`w:${n}`, `h:${n}`].map((key) => ({ key, toggle: { lit: Boolean(id) && (c.a === id || c.b === id) } }))),
    ...g.ties.flatMap((t, n) => (headless.has(t.type) ? [`n:${n}`] : [`n:${n}`, `nh:${n}`]).map((key) => ({ key, toggle: { lit: Boolean(id) && (t.a === id || t.b === id) } }))),
  ];
  /** A step's tip: its title, that it waits on you where it does (a colour no legend explains), and the start of its note. */
  const tipFor = (key) => {
    const i = g.nodes.get(key.slice(2)).item, note = held(i.pending) ? `Held for you${i.pending.reason ? `: ${i.pending.reason}` : ''}` : opening(i);
    return m('div', { class: 'lf-tip' }, m('b', {}, i.said ?? i.title), yours(i) && m('span', { class: 'lf-tip-you' }, 'Waits on you'), (i.named ?? note) && m('span', {}, i.named ?? note));
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
      wires: [...g.chains.map((c, n) => ({ keys: [`w:${n}`, `h:${n}`], from: [c.a], to: [g.nodes.get(c.b)?.item.id ?? c.b], pair: [c.a, c.b].sort().join(' ') })), ...g.ties.map((t, n) => ({ keys: headless.has(t.type) ? [`n:${n}`] : [`n:${n}`, `nh:${n}`], from: [t.a], to: [t.b], pair: [t.a, t.b].sort().join(' ') }))],
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
    scene: { css: [css, ...(parts ? [islandCss, ...isles.rules] : []), sessionCss, ...hueRules(sessions), ...colourRules, ...(story ? [storyCss] : [])].join('\n'), svg, key, ...(player && { before: player.before, aside: player.after }), size, start: start ? [g.x.get(start), g.y.get(start)] : undefined, shaped: !story && FOLLOW !== 0 },
    end: player?.end,
    on(event) {
      const { name, key } = event;
      if (player?.hears(key)) return player.on(event);
      // A shared mark's tip, over the step's while the pointer is on the mark; off it, back to the step it is on, if any.
      if (!story && markTip(String(key))) {
        if (name === 'enter') return [{ tip: { key, mark: markTip(String(key)) } }];
        if (name !== 'leave') return [];
        const on = String(key).startsWith('p:') ? `s:${String(key).slice(2)}` : null;
        return on && tipped.has(on) ? [{ tip: { key: on, mark: tipFor(on) } }] : [{ tip: null }];
      }
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
