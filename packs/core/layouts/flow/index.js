// A lens answer drawn as a flat graph on one plane, where depth is never drawn (e_ktdensts): every item a step showing its
// name in its kind's outline (the style's kind_shapes: in the house style work a box, a question a diamond, an
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

import { shownOnly } from './graph.js';
import { layout } from './layout.js';
import { css } from './look.js';
import { addClass, m, titled } from './marks.js';
import { placesAsColours } from './places.js';
import { drawn } from './polyline.js';
import { play } from './play.js';
import { css as storyCss, everyNamed, reveal, statesOf } from './story.js';
import { statesOf as standing } from './state.js';
import { css as sessionCss, hueRules, litStates, sessionItems, sessionMarks, sessionOf, stateMark, STATES, STATE_WORDS } from './session.js';
import { cut } from './lines.js';

/** Whether an item stays lit: what was asked for by name (style.only), else what the style's lit says. */
/** A colour a style may name. */
const HEX = /^#[0-9a-f]{3,8}$/i;
/** The link type the order's wires are, for their colour. */
const ORDER_TYPE = 'depends_on';
/** What the key calls each kind's outline, and the order its rows go in. */
const KIND_WORDS = { work: 'Work', question: 'Question', occurrence: 'Event', record: 'Record', system: 'System', actor: 'Person', aim: 'Aim', place: 'Place' };
const KEY_ORDER = ['box', 'diamond', 'pill', 'sheet', 'cut', 'hexagon', 'flag', 'tab', 'end'];
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
  // Steps put where a person put them are pins (./pins.js). The link types the style draws no wire for (undrawn: core's
  // house style, tagged) tie nothing here either.
  const placed = story ? {} : { ...style.placed, ...style.moved };
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
  const shapes = { kind: record(style.kind_shapes), type: record(style.type_shapes) };
  // A run's session (./session.js): its state a mark, its line its one line, what the style lights laid out first.
  const sessions = sessionMarks(style);
  answer = { ...answer, items: sessionItems(answer.items, sessions, (t) => cut(t, z('max_text'), (s) => measure(s, z('text')))) };
  const g = layout({ items: answer.items, links: answer.links ?? [], undrawn: Array.isArray(style.undrawn) ? style.undrawn : [], headless: Array.isArray(style.headless) ? style.headless : [], measure, sizes: style.sizes, aspect, placed, shapes });
  const steps = g.all.filter((n) => !n.dummy);
  if (!steps.length) return { scene: { message: 'Nothing here yet.' } };
  const size = { width: g.width, height: g.height };

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
  let badges = 0;
  const badge = (pending, [bx, by]) => titled(m('g', { key: `held:${pending.proposal}:${++badges}`, on: ['click'], class: 'lf-held', transform: `translate(${bx} ${by})` }, m('circle', { cx: 0, cy: 0, r: z('held_badge') }), m('text', { x: 0, y: 0 }, '?')), `Held for you${pending.reason ? `: ${pending.reason}` : ''}`);
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
  const linkColours = coloursOf([...new Set([...(g.chains.length ? [ORDER_TYPE] : []), ...g.ties.map((t) => t.type)])].sort(), named, hues);
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
  const waits = new Set((answer.links ?? []).filter((l) => l.type === 'waits_on' || l.is?.includes('waits_on')).map((l) => l.type));
  const onYou = (t) => (waits.has(t.type) && answer.viewer && t.b === answer.viewer ? ' you' : '');
  // A part in its place's colour: a class with a rule of its own, as a link's colour is.
  const placeClass = (hex) => {
    const cls = `lf-p-${hex.slice(1).toLowerCase()}`;
    colourRules.add(`.${cls} { --lf-place: ${hex}; }`);
    return cls;
  };
  const partOf = (id) => (hexOf.has(shownAs.of.get(id)) ? placeClass(hexOf.get(shownAs.of.get(id))) : '');
  const tieLayer = g.ties.map((t, n) => {
    const cls = `${kind(t.type)}${onYou(t)}${pend(t.pending)}`;
    const path = m('path', { key: `n:${n}`, d: line(t), class: `lf-tie${t.type === 'part_of' ? ' near' : ''}${headless.has(t.type) ? '' : ' headed'}${cls}`, ...drawIn, ...hidden });
    return headless.has(t.type) ? path : [path, m('path', { key: `nh:${n}`, d: tieHead(t), class: `lf-head${cls}`, ...hidden })];
  });
  const wireLayer = g.chains.map((c, n) => {
    return [m('path', { key: `w:${n}`, d: line(c), class: `lf-wire${kind(ORDER_TYPE)}${c.dashed ? ' dashed' : ''}${pend(c.pending)}`, ...drawIn, ...hidden }), m('path', { key: `h:${n}`, d: head(c.points), class: `lf-head${kind(ORDER_TYPE)}${pend(c.pending)}`, ...hidden })];
  });
  // The badges of held links, with the wire or tie each sits on, so a step moved takes them with its wires. A link of a
  // new item held in the same change is decided with it: the item's badge is the one.
  const madeBy = (id, p) => g.nodes.get(id)?.item?.pending?.op === 'create' && g.nodes.get(id).item.pending.proposal === p.proposal;
  const wiresIn = (model) => [...model.chains, ...model.ties];
  const linkBadges = wiresIn(g).map((l, n) => [l, n]).filter(([l]) => held(l.pending) && !madeBy(l.a, l.pending) && !madeBy(l.b, l.pending)).map(([l, n]) => ({ n, mark: badge(l.pending, middleOf(l.points)) }));
  /** A step's dot where it is drawn: of its own phase, or of the phase a story's step gives it then. */
  const dotPlace = (n) => {
    const X = g.x.get(n.id), point = n.shape === 'hexagon' ? n.bevel : 0;
    const left = n.shape === 'diamond' ? X - n.w / 2 + z('diamond_pad') / 2 : X - n.w / 2 + point + z('text_x');
    return [left - z('dot_gap'), g.y.get(n.id)];
  };
  const dotAt = (n, phase = stateOf(n.item).phase) => dot(dotClass(n.item, phase), markOf(phase), ...dotPlace(n), z('dot'));
  /** A run's session drawn in its dot's place: its state's mark, as the style says (./session.js). */
  const marked = (i) => sessions.get(sessionOf(i)?.state);
  const sessionDot = (n) => marked(n.item) && stateMark(m, sessionOf(n.item).state, marked(n.item), ...dotPlace(n), z('dot'));
  const stepLayer = steps.map((n) => {
    const X = g.x.get(n.id), Y = g.y.get(n.id), i = n.item;
    // A hexagon's name starts past its left point; a flag's and a hexagon's room ends before the point on the right.
    const point = n.shape === 'hexagon' ? n.bevel : 0, ends = n.shape === 'hexagon' ? 2 * n.bevel : n.shape === 'flag' ? n.bevel : 0;
    const left = n.shape === 'diamond' ? X - n.w / 2 + z('diamond_pad') / 2 : X - n.w / 2 + point + (n.stub ? z('stub_text_x') : z('text_x'));
    const room = n.shape === 'diamond' ? n.w - z('diamond_pad') : n.w - ends - (n.stub ? 2 * z('stub_text_x') : z('text_x') + z('text_after'));
    const ghost = !n.stub && i.pending?.op === 'create';
    const cls = ['lf-step', !n.stub && partOf(n.id) && `placed ${partOf(n.id)}`, n.stub && 'stub', (n.stub || g.potential.has(n.id)) && 'scenario', !i.open && 'closed', !n.stub && yours(i) && 'you', i.id === style.here && !n.stub && 'here', ghost ? 'ghost' : !n.stub && held(i.pending) && 'held'].filter(Boolean).join(' ');
    const body = [
      outline(n.shape, X, Y, n.w, n.h, CORNER, n.bevel),
      // A sheet's wave stops short of its box: this says where the box is, so the page reads its middle (ui/drag.js) as drawn here.
      n.shape === 'sheet' && m('rect', { x: X - n.w / 2, y: Y - n.h / 2, width: n.w, height: n.h, class: 'lf-room' }),
      // In a story, the dot is in a group of its own, for each step to give the dot of where it stood then.
      !n.stub && (story ? m('g', { key: `d:${n.id}` }, dotAt(n)) : sessionDot(n) || dotAt(n)),
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
    const el = titled(m('a', { key, on: story ? ['enter', 'leave'] : ['enter', 'leave', 'drag'], href: `#/e/${i.id}`, class: cls, ...hidden }, body), i.said ?? i.title);
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
  const svg = m('svg', { key: 'flow', viewBox: `0 0 ${size.width} ${size.height}`, role: 'img', 'aria-label': `A graph of ${steps.length} steps` }, tieLayer, wireLayer, stepLayer, saysLayer, [...stepBadges.values()], linkBadges.map((b) => b.mark));

  // The key: what each mark this picture uses means, one to a row (the page draws it, docs/layouts.md): each outline by
  // the kinds (or types) drawn in it, each phase's dot, and the two colours, where the picture has them.
  const words = (name) => ((w) => w.charAt(0).toUpperCase() + w.slice(1))(String(name).replaceAll('_', ' '));
  const kindWord = (i) => (shapes.type[i.type] ? words(i.type) : KIND_WORDS[i.kind] ?? words(i.kind ?? 'item'));
  const drawnAs = new Map();
  for (const n of steps) (drawnAs.get(n.shape) ?? drawnAs.set(n.shape, new Set()).get(n.shape)).add(n.stub ? 'Possible end' : kindWord(n.item));
  // A row's mark is drawn in a box of its own: G is where its middle is, how wide and tall a step is in it, and a dot's size.
  const G = { x: 11, y: 7, w: 20, h: 11, r: 4 };
  const mark = (inner, label) => ({ glyph: m('svg', { width: z('key_width'), height: z('key_height'), viewBox: '0 0 22 14' }, inner), label });
  const uses = (test) => steps.some(test);
  // A story's key has the phases its steps give too.
  const stepPhases = story ? answer.steps.flatMap((s) => Object.values(s.fields ?? {}).map((f) => f?.phase).filter((p) => typeof p === 'string')) : [];
  const phases = new Set([...steps.filter((n) => !n.stub && (story || !marked(n.item))).map((n) => stateOf(n.item).phase), ...stepPhases].filter((p) => markOf(p) !== 'none'));
  const key = [
    [...drawnAs.keys()].sort((a, b) => KEY_ORDER.indexOf(a) - KEY_ORDER.indexOf(b)).map((shape) => mark(m('g', { class: `lf-step${shape === 'end' ? ' scenario' : ''}` }, outline(shape, G.x, G.y, G.w, shape === 'diamond' ? G.h + 1 : G.h, CORNER, G.h / 3)), [...drawnAs.get(shape)].join(', '))),
    Object.keys(PHASE_WORDS).filter((p) => phases.has(p)).map((p) => mark(dot(`ph-${p} ${markOf(p)}${p === 'trouble' ? ' trouble' : ''}`, markOf(p), G.x, G.y, G.r), PHASE_WORDS[p])),
    !story && STATES.filter((s) => uses((n) => !n.stub && marked(n.item) && sessionOf(n.item).state === s)).map((s) => mark(stateMark(m, s, sessions.get(s), G.x, G.y, G.r), STATE_WORDS[s])),
    uses((n) => !n.stub && heldUp(n.item)) && mark(dot('trouble hollow', 'hollow', G.x, G.y, G.r), 'Held up'),
    uses((n) => !n.stub && yours(n.item)) && mark(m('g', { class: 'lf-step you' }, outline('box', G.x, G.y, G.w, G.h, CORNER)), 'Waits on you'),
    shownAs.places.filter((p) => steps.some((n) => !n.stub && shownAs.of.get(n.id) === p.id)).map((p) => mark(m('g', { class: `lf-step placed ${placeClass(p.hex)}` }, outline('box', G.x, G.y, G.w, G.h, CORNER)), p.within ? `${p.title}, in ${p.within}` : p.title)),
    g.chains.length > 0 && mark(m('path', { d: 'M1 7H21', class: `lf-wire${kind(ORDER_TYPE)}` }), 'Leads to'),
    g.chains.some((c) => c.dashed) && mark(m('path', { d: 'M1 7H21', class: 'lf-wire dashed' }), 'If chosen'),
    g.breaks.length > 0 && mark(m('path', { d: 'M1 7H21M11 0V4M11 10V14', class: 'lf-wire' }), 'Passes under'),
    [...new Set(g.ties.map((t) => t.type))].sort().map((type) => mark(headless.has(type) ? m('path', { d: 'M1 7H21', class: `lf-tie${type === 'part_of' ? ' near' : ''}${kind(type)}` }) : m('g', {}, m('path', { d: 'M1 7H17', class: `lf-tie headed${kind(type)}` }), m('path', { d: 'M21 7L13 3V11Z', class: `lf-head${kind(type)}` })), linkName(type))),
    (stepBadges.size > 0 || linkBadges.length > 0) && mark(m('path', { d: 'M1 7H21', class: 'lf-wire held' }), 'Held for you'),
  ].flat().filter(Boolean);

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
  /** A step's tip: its title, and the start of its note. */
  const tipFor = (key) => {
    const i = g.nodes.get(key.slice(2)).item, note = held(i.pending) ? `Held for you${i.pending.reason ? `: ${i.pending.reason}` : ''}` : opening(i);
    return m('div', { class: 'lf-tip' }, m('b', {}, i.said ?? i.title), (i.named ?? note) && m('span', {}, i.named ?? note));
  };
  // Opened from an item's page, the picture is brought to that item; else to the step nearest its top left.
  const start = g.nodes.has(style.here) ? style.here : steps.filter((n) => !n.stub).reduce((p, q) => (g.y.get(q.id) - q.h / 2 < g.y.get(p.id) - p.h / 2 || (g.y.get(q.id) - q.h / 2 === g.y.get(p.id) - p.h / 2 && g.x.get(q.id) < g.x.get(p.id)) ? q : p), steps[0])?.id;
  // Told as a story: each step of the graph shown as the story's steps bring it, on the stage of story.js.
  let player = null;
  if (story) {
    const marks = {
      steps: new Map(steps.map((n) => [`s:${n.id}`, [n.item.id]])),
      wires: [...g.chains.map((c, n) => ({ keys: [`w:${n}`, `h:${n}`], from: [c.a], to: [g.nodes.get(c.b).item.id], pair: [c.a, c.b].sort().join(' ') })), ...g.ties.map((t, n) => ({ keys: headless.has(t.type) ? [`n:${n}`] : [`n:${n}`, `nh:${n}`], from: [t.a], to: [t.b], pair: [t.a, t.b].sort().join(' ') }))],
      says: new Map([...said.values()].map((c) => [g.chains.indexOf(c), `t:${g.chains.indexOf(c)}`])),
      flags: new Map(steps.filter((n) => !n.stub).map((n) => [n.item.id, `f:${n.id}`])),
      dots: new Map(steps.filter((n) => !n.stub).map((n) => [n.item.id, `d:${n.id}`])),
      dot: (id, phase) => m('g', { key: `d:${id}` }, dotAt(g.nodes.get(id), phase)),
    };
    const frames = statesOf(answer.steps);
    player = play({ answer, style, reduced, tools, shape: { frames, stage: (ctx) => reveal({ frames, marks, ...ctx }) } });
  }
  // A step moved by hand (the page follows the drag: ui/drag.js) is a pin: each frame is the model with it there, and what
  // is drawn takes the difference. Let go, it stays a pin, for the next drag; the page keeps it.
  const pins = { ...placed }, at = new Map(steps.map((n) => [n.id, [g.x.get(n.id), g.y.get(n.id)]]));
  let now = g;
  /** What changes on the page from one model to another. */
  const between = (was, next) => {
    const patches = [];
    for (const [key, id] of keyed) {
      if (next.x.get(id) === was.x.get(id) && next.y.get(id) === was.y.get(id)) continue;
      const [x, y] = [next.x.get(id), next.y.get(id)], n = g.nodes.get(id);
      patches.push({ key, set: { transform: `translate(${x - g.x.get(id)} ${y - g.y.get(id)})` } });
      if (stepBadges.has(id)) patches.push({ key: stepBadges.get(id)[1].key, set: { transform: `translate(${x + n.w / 2} ${y - n.h / 2})` } });
    }
    next.chains.forEach((c, n) => (c.points !== was.chains[n].points || c.gaps !== was.chains[n].gaps) && patches.push({ key: `w:${n}`, set: { d: line(c) } }, { key: `h:${n}`, set: { d: head(c.points) } }));
    next.ties.forEach((t, n) => {
      if (t.points === was.ties[n].points) return;
      patches.push({ key: `n:${n}`, set: { d: line(t) } });
      if (!headless.has(t.type)) patches.push({ key: `nh:${n}`, set: { d: tieHead(t) } });
    });
    const wires = wiresIn(next), before = wiresIn(was);
    for (const b of linkBadges) if (wires[b.n].points !== before[b.n].points) patches.push({ key: b.mark[1].key, set: { transform: `translate(${middleOf(wires[b.n].points).join(' ')})` } });
    for (const c of said.values()) {
      const [x, y] = saysAt(next, c), [x0, y0] = saysAt(g, c);
      patches.push({ key: `t:${g.chains.indexOf(c)}`, set: { transform: `translate(${x - x0} ${y - y0})` } });
    }
    return patches;
  };
  const move = (key, { dx = 0, dy = 0 }, done) => {
    const id = keyed.get(key);
    if (!id || !at.has(id)) return [];
    // On whole units, as the page keeps it, so the last frame is what is let go and what comes back.
    const [x0, y0] = at.get(id), put = [Math.round(x0 + Number(dx)), Math.round(y0 + Number(dy))];
    const next = g.place({ ...pins, [id]: put }), patches = [{ tip: null }, ...between(now, next)];
    now = next;
    if (done) (at.set(id, put), (pins[id] = put));
    return patches;
  };
  // Still on a page, a picture stands at its own size in the middle of the frame it is given, which would stretch it.
  if (style.still && width > size.width && Array.isArray(svg)) {
    svg[1].viewBox = `${(size.width - width) / 2} 0 ${width} ${size.height}`;
    size.width = width;
  }
  return {
    scene: { css: [css, sessionCss, ...hueRules(sessions), ...colourRules, ...(story ? [storyCss] : [])].join('\n'), svg, key, ...(player && { before: player.before, aside: player.after }), size, start: start ? [g.x.get(start), g.y.get(start)] : undefined, shaped: !story && FOLLOW !== 0 },
    end: player?.end,
    on(event) {
      const { name, key } = event;
      if (player?.hears(key)) return player.on(event);
      if (name === 'drag' || name === 'drop') return move(key, event, name === 'drop');
      if (name === 'leave') return [...light(null), ...(story ? [] : [{ tip: null }])];
      if (!keyed.has(key)) return [];
      return [...light(keyed.get(key)), ...(!story && tipped.has(key) ? [{ tip: { key, mark: tipFor(key) } }] : [])];
    },
    restyle(now) {
      const off = new Set(dimmed(now));
      // The step whose page is open is lit, and only it: the page says which (here) as it opens and shuts one.
      const lit = steps.filter((n) => !n.stub).map((n) => ({ key: `s:${n.id}`, toggle: { here: n.item.id === now.here } }));
      return [...[...dims.keys()].map((id) => ({ key: dims.get(id)[1].key, toggle: { dim: off.has(id) } })), ...lit];
    },
  };
}
