// A lens answer drawn as a flat graph on one plane, where depth is never drawn (e_ktdensts): every item a step (work
// a box, a question a diamond, an occurrence a pill, a record a sheet with a wavy foot) showing its name, the order
// (depends_on) read from the top down in wires at right angles from what is depended on to what depends on it, broken
// where one passes under another, and every other link (part_of first) a quiet tie between the two it ties, with a
// head where it points unless the style draws its type headless (core's house style: part_of).
// What follows an open question is dashed, as a scenario. Hovering a step lights its wires and ties and shows a tip:
// its title and the start of its note. Drawn from the flat lens's answer (items and links); the older lens's still
// draws, what each item is `inside` read as part_of. The layout is ./layout.js; this answers with the marks to draw
// (SVG and HTML as data), which the page checks and mounts, so every name is in the page and every step a link. Its
// look is ./look.js, in the lens's colours. A lens with steps tells the process as it happens (./story.js), the
// conversation beside it. What is `pending` is a ghost: a change held for the owner, drawn where it would land (an
// item faint, a link dashed, an edit marked on its step), each with a badge keyed `held:<proposal>` that the page
// answers a click on by putting the change to the person; a link the person just drew (`mine`) is dashed until it is.

import { placesOf, route, tieRoute } from './free.js';
import { layout } from './layout.js';
import { css } from './look.js';
import { addClass, m, titled } from './marks.js';
import { play } from './play.js';
import { css as storyCss, everyNamed, reveal, statesOf } from './story.js';

/** Whether an item stays lit: what was asked for by name (style.only), else what the style's lit says. */
/** A colour a style may name. */
const HEX = /^#[0-9a-f]{3,8}$/i;
/** The link type the order's wires are, for their colour. */
const ORDER_TYPE = 'depends_on';
/** A link type as the key says it: its name without its pack, in words ("funding.could_fund" is "Could fund"). */
const linkName = (type) => {
  const words = type.split('.').pop().replaceAll('_', ' ');
  return words.charAt(0).toUpperCase() + words.slice(1);
};

function lit(i, style) {
  if (Array.isArray(style.only)) return style.only.includes(i.id);
  return style.lit === 'you' ? Boolean(i.state.needs_you) : style.lit === 'blocked' ? Boolean(i.state.blocked) : true;
}

/** A step's outline, centred on x, y, its corners as round as rx. */
function outline(shape, x, y, w, hgt, rx) {
  const l = x - w / 2, r = x + w / 2, t = y - hgt / 2, b = y + hgt / 2;
  if (shape === 'diamond') return m('path', { d: `M${x} ${t}L${r} ${y}L${x} ${b}L${l} ${y}Z`, class: 'lf-shape' });
  if (shape === 'pill' || shape === 'end') return m('rect', { x: l, y: t, width: w, height: hgt, rx: hgt / 2, class: 'lf-shape' });
  // A document: a sheet whose foot is a wave.
  if (shape === 'sheet') return m('path', { d: `M${l} ${t}H${r}V${b - 5}C${r - w / 4} ${b - 13} ${x + w / 8} ${b + 5} ${x} ${b - 3}C${x - w / 8} ${b - 11} ${l + w / 4} ${b + 5} ${l} ${b - 3}Z`, class: 'lf-shape' });
  return m('rect', { x: l, y: t, width: w, height: hgt, rx: Math.min(rx, hgt / 5), class: 'lf-shape' });
}

/**
 * The graph: its steps, the wires and ties between them and what each choice is. `input` is what the page gives every
 * drawing (the answer, the style); `tools.measure(text, px, font)` is how wide a text is drawn.
 */
export function picture({ answer, style, reduced }, tools) {
  // A story lays out what its steps bring in, all of it, each mark hidden until a step shows it.
  const story = Array.isArray(answer.steps) && answer.steps.length > 0;
  if (story) {
    const named = everyNamed(answer.steps);
    answer = { ...answer, items: answer.items.filter((i) => named.has(i.id) || i.id === answer.lens?.from) };
  }
  const hidden = story ? { opacity: 0 } : {};
  // Every length is the style's (sizes, flow_*), named by the house style; so is the typeface.
  const z = (name) => {
    const v = style.sizes?.[`flow_${name}`];
    if (typeof v !== 'number') throw new Error(`The style names no size "flow_${name}": the house style (packs/core/pack.json) names every one a drawing uses`);
    return v;
  };
  const NOTE = style.numbers?.note_opening_cut;
  if (typeof NOTE !== 'number') throw new Error('The style names no number "note_opening_cut": the house style (packs/core/pack.json) names every one a drawing uses');
  const measure = (text, px) => tools.measure(text, px, style.font);
  const [TEXT, STUB_TEXT, CORNER] = ['text', 'stub_text', 'corner'].map(z);
  const fit = (text, width, px) => {
    if (measure(text, px) <= width) return text;
    let t = text;
    while (t.length > 1 && measure(`${t}…`, px) > width) t = t.slice(0, -1);
    return `${t}…`;
  };
  // Steps put where a person put them stay there, and the rest is laid out round them (./layout.js, ./free.js). The
  // link types the style draws no wire for (undrawn: core's house style, tagged) tie nothing here either.
  const placed = story ? {} : placesOf(answer, style);
  const g = layout({ items: answer.items, links: answer.links ?? [], undrawn: Array.isArray(style.undrawn) ? style.undrawn : [], placed, measure, sizes: style.sizes });
  const steps = g.all.filter((n) => !n.dummy);
  if (!steps.length) return { scene: { message: 'Nothing here yet.' } };
  const boxOf = (id) => ({ x: g.x.get(id), y: g.y.get(id), w: g.nodes.get(id).w, h: g.nodes.get(id).h });
  // Round the other steps where it can: the wire takes the track through the fewest of them.
  const solve = (c) => (c.points = route(boxOf(c.a), boxOf(c.b), z('lead_out'), steps.filter((n) => n.id !== c.a && n.id !== c.b).map((n) => boxOf(n.id))));
  const size = { width: g.width, height: g.height };

  const yours = (i) => Boolean(i.state.needs_you);
  const dotOf = (i) => (!i.open ? 'done' : yours(i) ? 'you' : i.state.blocked ? 'blocked' : i.state.sessions ? 'session' : '');
  // The start of a note: its first paragraph, cut where the style says a note's opening is cut.
  const opening = (i) => {
    const text = String(i.body ?? i.gist ?? '').split(/\n\s*\n/)[0].replace(/\s+/g, ' ').trim();
    return text.length > NOTE ? `${text.slice(0, NOTE - 1).trimEnd()}…` : text;
  };
  const head = (x, y, up = false) => {
    const back = up ? y + z('head_length') : y - z('head_length');
    return `M${x} ${y}L${x - z('head_half')} ${back}L${x + z('head_half')} ${back}Z`;
  };
  // A tie runs from the higher of its ends down into the lower (free.js, tieRoute): its head is on the end its link
  // points to, into that step's head from above, or into its foot from below.
  const headless = new Set(Array.isArray(style.headless) ? style.headless : []);
  const tieHead = (t) => (g.y.get(t.a) <= g.y.get(t.b) ? head(...t.points.at(-1)) : head(...t.points[0], true));
  const line = (points) => `M${points.map((p) => p.join(' ')).join('L')}`;
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
  // Ties under everything, then wires, then the breaks cut across them, then the steps over all, then what each choice is.
  const drawIn = story ? { pathLength: 1, 'stroke-dasharray': 1, 'stroke-dashoffset': 1 } : {};
  const pend = (p) => (p ? ` held${p.mine ? ' mine' : ''}` : '');
  // A tie of a link type the style draws only on hover (hover_only: the canvas pack's, part_of) shows while one of its
  // ends is hovered, lit as every tie is; one held for a person shows always.
  const onHover = new Set(Array.isArray(style.hover_only) ? style.hover_only : []);
  // Each link type its colour: the one the style names for it (link_colours), else one of link_hues, the same for the
  // same type every time unless another type in this picture has it. A colour is a class with a rule of its own: a drawing sets no style on a mark.
  const named = style.link_colours && typeof style.link_colours === 'object' ? style.link_colours : {};
  const hues = Array.isArray(style.link_hues) && style.link_hues.length ? style.link_hues : Array.isArray(style.hues) ? style.hues : [];
  // A type not named starts at the hue its name picks, and steps past those another type in this picture has.
  const present = [...new Set([...(g.chains.length ? [ORDER_TYPE] : []), ...g.ties.map((t) => t.type)])].sort();
  const taken = new Set(present.filter((type) => HEX.test(String(named[type]))).map((type) => named[type].toLowerCase()));
  const given = new Map();
  for (const type of present.filter((t) => !HEX.test(String(named[t])) && hues.length)) {
    let k = [...type].reduce((s, ch) => (s * 31 + ch.charCodeAt(0)) >>> 0, 7) % hues.length;
    for (let tries = 0; tries < hues.length && taken.has(String(hues[k]).toLowerCase()); tries++) k = (k + 1) % hues.length;
    taken.add(String(hues[k]).toLowerCase());
    given.set(type, hues[k]);
  }
  const colourOf = (type) => (HEX.test(String(named[type])) ? named[type] : given.get(type) ?? null);
  const colourRules = new Set();
  const kind = (type) => {
    const hex = colourOf(type);
    if (typeof hex !== 'string' || !HEX.test(hex)) return '';
    const cls = `lf-k-${hex.slice(1).toLowerCase()}`;
    colourRules.add(`.${cls} { --lf-link: ${hex}; }`);
    return ` ${cls}`;
  };
  const tieLayer = g.ties.map((t, n) => {
    const cls = `${kind(t.type)}${onHover.has(t.type) && !t.pending ? ' on-hover' : ''}${pend(t.pending)}`;
    const path = m('path', { key: `n:${n}`, d: line(t.points), class: `lf-tie${t.type === 'part_of' ? ' near' : ''}${headless.has(t.type) ? '' : ' headed'}${cls}`, ...drawIn, ...hidden });
    return headless.has(t.type) ? path : [path, m('path', { key: `nh:${n}`, d: tieHead(t), class: `lf-head${cls}`, ...hidden })];
  });
  const wireLayer = g.chains.map((c, n) => {
    const [ex, ey] = c.points.at(-1);
    return [m('path', { key: `w:${n}`, d: line(c.points), class: `lf-wire${kind(ORDER_TYPE)}${c.dashed ? ' dashed' : ''}${pend(c.pending)}`, ...drawIn, ...hidden }), m('path', { key: `h:${n}`, d: head(ex, ey), class: `lf-head${kind(ORDER_TYPE)}${pend(c.pending)}`, ...hidden })];
  });
  // The badges of held links, with the wire or tie each sits on, so a step moved takes them with its wires. A link of a
  // new item held in the same change is decided with it: the item's badge is the one.
  const madeBy = (id, p) => g.nodes.get(id)?.item?.pending?.op === 'create' && g.nodes.get(id).item.pending.proposal === p.proposal;
  const linkBadges = [...g.chains, ...g.ties].filter((l) => held(l.pending) && !madeBy(l.a, l.pending) && !madeBy(l.b, l.pending)).map((l) => ({ l, mark: badge(l.pending, middleOf(l.points)) }));
  const breakLayer = g.breaks.map(([bx, by]) => m('g', { class: 'lf-break' }, m('rect', { x: bx - z('break_half'), y: by - z('break_reach'), width: 2 * z('break_half'), height: 2 * z('break_reach') }), m('path', { d: `M${bx - z('break_track')} ${by}H${bx + z('break_track')}` })));
  const stepLayer = steps.map((n) => {
    const X = g.x.get(n.id), Y = g.y.get(n.id), i = n.item;
    const left = n.shape === 'diamond' ? X - n.w / 2 + z('diamond_pad') / 2 : X - n.w / 2 + (n.stub ? z('stub_text_x') : z('text_x'));
    const room = n.shape === 'diamond' ? n.w - z('diamond_pad') : n.w - (n.stub ? 2 * z('stub_text_x') : z('text_x') + z('text_after'));
    const ghost = !n.stub && i.pending?.op === 'create';
    const cls = ['lf-step', n.stub && 'stub', (n.stub || g.potential.has(n.id)) && 'scenario', !i.open && 'closed', !n.stub && yours(i) && 'you', i.id === style.here && !n.stub && 'here', ghost ? 'ghost' : !n.stub && held(i.pending) && 'held'].filter(Boolean).join(' ');
    const body = [
      outline(n.shape, X, Y, n.w, n.h, CORNER),
      !n.stub && m('circle', { cx: left - z('dot_gap'), cy: Y, r: z('dot'), class: `lf-dot ${dotOf(i)}` }),
      m('text', { x: left, y: Y - (n.shape === 'sheet' ? z('sheet_lift') : 0) }, fit(i.title, room, n.stub ? STUB_TEXT : TEXT)),
    ];
    const key = `s:${n.id}`;
    keyed.set(key, i.id);
    if (n.stub) return titled(m('g', { key, on: ['enter', 'leave'], class: cls, ...hidden }, body), `${i.title}\nA choice nothing follows yet`);
    // Held for the owner: a new item is a faint step that opens nothing; an edit is marked on its step. Either way a badge on its corner.
    if (held(i.pending)) stepBadges.set(n.id, badge(i.pending, [X + n.w / 2, Y - n.h / 2]));
    tipped.add(key);
    if (ghost) return titled(m('g', { key, on: ['enter', 'leave'], class: cls, ...hidden }, body), `${i.title}\nHeld for you`);
    const el = titled(m('a', { key, on: story ? ['enter', 'leave'] : ['enter', 'leave', 'drag'], href: `#/e/${i.id}`, class: cls, ...hidden }, body), i.title);
    dims.set(n.id, el);
    return el;
  });
  // What each choice is, written once beside the question's drop, halfway to its track; a pill already says it.
  const said = new Map();
  for (const c of g.chains) if (c.says && !g.nodes.get(c.b).stub) said.set(`${c.a} ${c.says}`, c);
  const saysLayer = [...said.values()].map((c) => {
    const d = g.nodes.get(c.a), text = fit(c.says, z('says_most'), z('says_text')), w = measure(text, z('says_text')) + 2 * z('says_pad');
    const lx = g.x.get(d.id) + w / 2 + z('says_aside'), ly = (g.y.get(d.id) + d.h / 2 + c.points[1][1]) / 2, sh = z('says_height');
    return titled(m('g', { key: `t:${g.chains.indexOf(c)}`, class: 'lf-says', ...hidden }, m('rect', { x: lx - w / 2, y: ly - sh / 2, width: w, height: sh, rx: sh / 2 }), m('text', { x: lx, y: ly }, text)), c.says);
  });
  const svg = m('svg', { viewBox: `0 0 ${size.width} ${size.height}`, role: 'img', 'aria-label': `A graph of ${steps.length} steps` }, tieLayer, wireLayer, breakLayer, stepLayer, saysLayer, [...stepBadges.values()], linkBadges.map((b) => b.mark));

  // The key: what each mark this picture uses means, one to a row (the page draws it, docs/drawings.md). An open step
  // with no other mark is said by its own status ("Up", "Open"), each one its steps have, never a word of the drawing's.
  const restWords = () => {
    const said = [...new Set(steps.filter((n) => !n.stub && dotOf(n.item) === '').map((n) => String(n.item.status ?? 'open').replaceAll('_', ' ')))];
    const words = said.join(', ');
    return words.charAt(0).toUpperCase() + words.slice(1);
  };
  const mark = (inner, label) => ({ glyph: m('svg', { width: 22, height: 14, viewBox: '0 0 22 14' }, inner), label });
  const uses = (test) => steps.some(test);
  const key = [
    [['box', 'Work'], ['diamond', 'Question'], ['pill', 'Event'], ['sheet', 'Record'], ['end', 'Possible end']].filter(([shape]) => uses((n) => n.shape === shape)).map(([shape, label]) => mark(m('g', { class: `lf-step${shape === 'end' ? ' scenario' : ''}` }, outline(shape, 11, 7, 20, shape === 'diamond' ? 12 : 11, CORNER)), label)),
    [['done', 'Done'], ['blocked', 'Blocked'], ['you', 'Waits on you'], ['session', 'Under way'], ['', restWords()]].filter(([dot]) => uses((n) => !n.stub && dotOf(n.item) === dot)).map(([dot, label]) => mark(m('circle', { cx: 11, cy: 7, r: 4, class: `lf-dot ${dot}` }), label)),
    g.chains.length > 0 && mark(m('path', { d: 'M1 7H21', class: `lf-wire${kind(ORDER_TYPE)}` }), 'Leads to'),
    g.chains.some((c) => c.dashed) && mark(m('path', { d: 'M1 7H21', class: 'lf-wire dashed' }), 'If chosen'),
    g.breaks.length > 0 && mark(m('path', { d: 'M1 7H21M11 0V4M11 10V14', class: 'lf-wire' }), 'Passes under'),
    [...new Set(g.ties.map((t) => t.type))].sort().map((type) => mark(headless.has(type) ? m('path', { d: 'M1 7H21', class: `lf-tie${type === 'part_of' ? ' near' : ''}${kind(type)}` }) : m('g', {}, m('path', { d: 'M1 7H17', class: `lf-tie headed${kind(type)}` }), m('path', { d: 'M21 7L13 3V11Z', class: `lf-head${kind(type)}` })), linkName(type))),
    (stepBadges.size > 0 || linkBadges.length > 0) && mark(m('path', { d: 'M1 7H21', class: 'lf-wire held' }), 'Held for you'),
  ].flat().filter(Boolean);

  // What stays lit, as the style says: the rest dimmed.
  const dimmed = (now) => [...dims.keys()].filter((id) => !lit(g.nodes.get(id).item, now));
  for (const id of dimmed(style)) addClass(dims.get(id), 'dim');
  /** Light the wires and ties of a step, or of none. */
  const light = (id) => [
    ...g.chains.flatMap((c, n) => [`w:${n}`, `h:${n}`].map((key) => ({ key, toggle: { lit: Boolean(id) && (c.a === id || c.b === id) } }))),
    ...g.ties.flatMap((t, n) => (headless.has(t.type) ? [`n:${n}`] : [`n:${n}`, `nh:${n}`]).map((key) => ({ key, toggle: { lit: Boolean(id) && (t.a === id || t.b === id) } }))),
  ];
  /** A step's tip: its title, and the start of its note. */
  const tipFor = (key) => {
    const i = g.nodes.get(key.slice(2)).item, note = held(i.pending) ? `Held for you${i.pending.reason ? `: ${i.pending.reason}` : ''}` : opening(i);
    return m('div', { class: 'lf-tip' }, m('b', {}, i.title), note && m('span', {}, note));
  };
  // Opened from an item's page, the picture is brought to that item; else to the step nearest its top left.
  const start = g.nodes.has(style.here) ? style.here : steps.filter((n) => !n.stub).reduce((p, q) => (g.y.get(q.id) - q.h / 2 < g.y.get(p.id) - p.h / 2 || (g.y.get(q.id) - q.h / 2 === g.y.get(p.id) - p.h / 2 && g.x.get(q.id) < g.x.get(p.id)) ? q : p), steps[0])?.id;
  // Told as a story: each step of the graph shown as the story's steps bring it, on the stage of story.js.
  let player = null;
  if (story) {
    const marks = {
      steps: new Map(steps.map((n) => [`s:${n.id}`, [n.item.id]])),
      wires: [...g.chains.map((c, n) => ({ keys: [`w:${n}`, `h:${n}`], from: [c.a], to: [g.nodes.get(c.b).item.id], item: { from: c.a, to: c.b } })), ...g.ties.map((t, n) => ({ keys: headless.has(t.type) ? [`n:${n}`] : [`n:${n}`, `nh:${n}`], from: [t.a], to: [t.b], item: { from: t.a, to: t.b } }))],
      says: new Map([...said.values()].map((c) => [g.chains.indexOf(c), `t:${g.chains.indexOf(c)}`])),
    };
    const frames = statesOf(answer.steps);
    player = play({ answer, style, reduced, tools, shape: { frames, stage: (ctx) => reveal({ frames, marks, ...ctx }) } });
  }
  // A step moved by hand (the page follows the drag: ui/drag.js): it goes where it is put, and its wires are solved
  // again at right angles as it moves, its ties too. Let go, that is where it is, for the next drag.
  const drawnAt = new Map(steps.map((n) => [n.id, [g.x.get(n.id), g.y.get(n.id)]]));
  const at = new Map(drawnAt);
  const move = (key, { dx = 0, dy = 0 }, done) => {
    const id = keyed.get(key);
    if (!id || !at.has(id)) return [];
    const [x0, y0] = at.get(id), [x, y] = [x0 + Number(dx), y0 + Number(dy)];
    g.x.set(id, x);
    g.y.set(id, y);
    if (done) at.set(id, [x, y]);
    const [ox, oy] = drawnAt.get(id);
    const patches = [{ key, set: { transform: `translate(${x - ox} ${y - oy})` } }, { tip: null }];
    const was = g.nodes.get(id);
    if (stepBadges.has(id)) patches.push({ key: stepBadges.get(id)[1].key, set: { transform: `translate(${x + was.w / 2} ${y - was.h / 2})` } });
    g.chains.forEach((c, n) => {
      if (c.a !== id && c.b !== id) return;
      const [[ex, ey]] = solve(c).slice(-1);
      patches.push({ key: `w:${n}`, set: { d: line(c.points) } }, { key: `h:${n}`, set: { d: head(ex, ey) } });
    });
    g.ties.forEach((t, n) => {
      if (t.a !== id && t.b !== id) return;
      patches.push({ key: `n:${n}`, set: { d: line((t.points = tieRoute(boxOf(t.a), boxOf(t.b), z('lead_out'), steps.filter((s) => s.id !== t.a && s.id !== t.b).map((s) => boxOf(s.id))))) } });
      if (!headless.has(t.type)) patches.push({ key: `nh:${n}`, set: { d: tieHead(t) } });
    });
    for (const b of linkBadges) if (b.l.a === id || b.l.b === id) patches.push({ key: b.mark[1].key, set: { transform: `translate(${middleOf(b.l.points).join(' ')})` } });
    return patches;
  };
  return {
    scene: { css: [css, ...colourRules, ...(story ? [storyCss] : [])].join('\n'), svg, key, ...(player && { before: player.before, aside: player.after }), size, start: start ? [g.x.get(start), g.y.get(start)] : undefined },
    end: player?.end,
    on(event) {
      const { name, key } = event;
      if (player && (key === 'play' || key === 'chat' || key.startsWith('c:'))) return player.on(event);
      if (name === 'drag' || name === 'drop') return move(key, event, name === 'drop');
      if (name === 'leave') return [...light(null), ...(story ? [] : [{ tip: null }])];
      if (!keyed.has(key)) return [];
      return [...light(keyed.get(key)), ...(!story && tipped.has(key) ? [{ tip: { key, mark: tipFor(key) } }] : [])];
    },
    restyle(now) {
      const off = new Set(dimmed(now));
      return [...dims.keys()].map((id) => ({ key: dims.get(id)[1].key, toggle: { dim: off.has(id) } }));
    },
  };
}
