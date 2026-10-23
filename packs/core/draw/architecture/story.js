// A system as it came to be: the lens's steps, each laid out with the one before it as its prior (layout.js,
// steady), so what a step does not change stays where it was. Every part, place and wire that is ever drawn is one
// mark, shown or not; a step moves the marks from where they were to where they go (play.js runs the steps).
// The last step is the map as it is: what the steps leave in, with the titles, fields and status it has now, and gone
// if it is retired, so the picture always ends on what is true of what it shows. From a step
// with a look (`islands`) on, the story is drawn in that look (islands.js): a part's outline moves from its box to
// its island, and its wires are drawn again as routes; in `islands_3d` the same islands rise out of the sea, painted
// on a surface over the picture (deep.js).

import { board, css as boardsLook } from './boards.js';
import { LOOK as DEEP, css as deepLook, deep } from './deep.js';
import { boxPath, curveOf, islandPath, islands, css as islandsLook, routeSpots } from './islands.js';
import { finished, health, layout } from './layout.js';
import { css as base } from './look.js';
import { m, titled } from './marks.js';
import { play } from './play.js';
import { partBoxes, saysSpots } from './says.js';
import { css as storyLook } from './story-look.js';

const NAME = /^[a-z][a-z0-9_]*$/;

/** The looks a story may be drawn in, besides its own, each with the look it is one of (its dots and its key). */
const LOOKS = { islands: null, [DEEP]: 'islands', gantt: 'islands', kanban: 'islands' };
/** The looks that lay work out as a plan or a board (boards.js), and those that draw it as islands. */
const BOARDS = ['gantt', 'kanban'], SEAS = ['islands', DEEP];
/** A look and the one it is one of. */
const family = (look) => [look, LOOKS[look]].filter(Boolean);

/**
 * What each step shows: its items (with the titles, fields and status they had then), its links, its flags, its
 * chapter and its look. Work the steps leave in and the map has finished (done, not dropped) is shown at the end.
 */
export function statesOf(answer) {
  const steps = answer.steps, last = steps.length - 1, root = answer.lens.from;
  const byId = new Map(answer.items.map((i) => [i.id, i]));
  const moving = new Set(steps.flatMap((s) => [...(s.add ?? []), ...(s.remove ?? [])]));
  const present = new Set(), titles = new Map(), fields = new Map(), flags = new Map();
  let chapter = -1, look = null;
  const states = [];
  steps.forEach((s, k) => {
    for (const id of s.add ?? []) present.add(id);
    for (const id of s.remove ?? []) present.delete(id);
    for (const [id, t] of Object.entries(s.titles ?? {})) (t === null ? titles.delete(id) : titles.set(id, String(t)));
    for (const [id, f] of Object.entries(s.fields ?? {})) fields.set(id, Object.fromEntries(Object.entries({ ...fields.get(id), ...f }).filter(([, v]) => v !== null)));
    for (const [id, w] of Object.entries(s.flag ?? {})) (w === null ? flags.delete(id) : flags.set(id, String(w)));
    if (s.chapter) chapter++;
    if (s.look !== undefined) look = s.look in LOOKS ? s.look : null;
    // The last step is the map as it is: what the steps leave in, open or finished; what they took out stays out.
    const final = k === last;
    const done = (id) => present.has(id) && byId.has(id) && finished(byId.get(id));
    const shows = (id) => (final ? (byId.get(id)?.open !== false && present.has(id)) || done(id) : present.has(id));
    // A place is shown while it holds something shown; what no step moves is shown as it is.
    const holds = new Map();
    for (const i of answer.items) if (i.inside) holds.set(i.inside, [...(holds.get(i.inside) ?? []), i.id]);
    const kept = (id, depth = 0) => id === root || (moving.has(id) ? shows(id) : depth < 16 && (holds.get(id) ?? []).some((c) => kept(c, depth + 1)));
    const items = answer.items
      .filter((i) => kept(i.id))
      .map((i) => (final ? (done(i.id) ? { ...i, open: true } : i) : { ...i, open: true, status: String(fields.get(i.id)?.status ?? (i.open ? i.status : 'up')), title: titles.get(i.id) ?? i.title, fields: { ...i.fields, ...fields.get(i.id) } }));
    const ids = new Set(items.map((i) => i.id));
    states.push({ items, links: answer.links.filter((l) => ids.has(l.from) && ids.has(l.to)), flags: final ? new Map() : new Map(flags), chapter, look, step: s, ids });
  });
  return states;
}

/** The arrowhead at what a wire calls: at its end, or at its start where it is drawn turned back. */
function arrow(pts, back) {
  const list = back ? pts : [...pts].reverse();
  const tip = list[0], prev = list.find((p) => Math.hypot(p[0] - tip[0], p[1] - tip[1]) > 0.5) ?? [tip[0], tip[1] - 1];
  const d = Math.hypot(tip[0] - prev[0], tip[1] - prev[1]), ux = (tip[0] - prev[0]) / d, uy = (tip[1] - prev[1]) / d;
  const bx = tip[0] - ux * 9, by = tip[1] - uy * 9;
  return `M${tip[0]} ${tip[1]}L${bx - uy * 4.5} ${by + ux * 4.5}L${bx + uy * 4.5} ${by - ux * 4.5}Z`;
}
/** A wire's arrowheads: at what it calls, and at its other end too when it goes both ways. */
const heads = (pts, c) => arrow(pts, c.back) + (c.both ? arrow(pts, !c.back) : '');
const EPS = 0.01;
const same = (p, q) => Math.abs(p[0] - q[0]) < EPS && Math.abs(p[1] - q[1]) < EPS;
const down = (p, q) => Math.abs(p[0] - q[0]) < EPS;
/** A route as a run of turns: down, across, down, …, down, with no run of no length and no corner that is not one. */
function turns(pts) {
  let out = pts.filter((p, k) => !k || !same(p, pts[k - 1]));
  out = out.filter((p, k) => k === 0 || k === out.length - 1 || !((down(out[k - 1], p) && down(p, out[k + 1])) || (Math.abs(out[k - 1][1] - p[1]) < EPS && Math.abs(p[1] - out[k + 1][1]) < EPS)));
  if (out.length > 1 && !down(out[0], out[1])) out.unshift([...out[0]]);
  if (out.length > 1 && !down(out.at(-2), out.at(-1))) out.push([...out.at(-1)]);
  return out;
}
/**
 * Two routes as runs of turns of one length, the shorter padded with turns of no length. Moved point by point from
 * one to the other, a run that is down in both stays down and one across stays across: every corner stays square.
 */
export function squareMorph(from, to) {
  const A = turns(from), B = turns(to);
  while (A.length < B.length) A.push([...A.at(-1)], [...A.at(-1)]);
  while (B.length < A.length) B.push([...B.at(-1)], [...B.at(-1)]);
  return [A, B];
}
/**
 * Where a place's name sits along its top edge: in its left corner (`from`) when no wire crosses the band it is in
 * (`wires`, as lists of points), else in its right corner (ending at `end`); else moved right from the left corner past
 * every wire, while it still fits; at the left corner when it fits nowhere clear.
 */
export function nameLeft(from, width, end, top, bottom, wires, clear) {
  const blocked = [];
  for (const pts of wires)
    for (let k = 1; k < pts.length; k++) {
      const [[x1, y1], [x2, y2]] = [pts[k - 1], pts[k]];
      if (Math.max(y1, y2) >= top && Math.min(y1, y2) <= bottom) blocked.push([Math.min(x1, x2) - clear, Math.max(x1, x2) + clear]);
    }
  const clearAt = (x) => !blocked.some(([l, r]) => x < r && x + width > l);
  if (clearAt(from)) return from;
  if (end - width >= from && clearAt(end - width)) return end - width;
  let at = from;
  for (let moved = true; moved; ) {
    moved = false;
    for (const [l, r] of blocked) if (at < r && at + width > l) ((at = r), (moved = true));
  }
  return at + width <= end ? at : from;
}
const pathOf = (pts) => `M${pts.map((p) => p.map((v) => Math.round(v * 100) / 100).join(' ')).join('L')}`;

/** The story: its first scene, and what plays it. */
export function story({ answer, style, reduced }, tools) {
  const z = (name) => {
    const v = style.sizes?.[`arch_${name}`];
    if (typeof v !== 'number') throw new Error(`The style names no size "arch_${name}": the house style (packs/core/pack.json) names every one a drawing uses`);
    return v;
  };
  const num = (name) => {
    const v = style.numbers?.[name];
    if (typeof v !== 'number') throw new Error(`The style names no number "${name}": the house style (packs/core/pack.json) names every one a drawing uses`);
    return v;
  };
  const measure = (text, px) => tools.measure(text, px, style.font);
  const fit = (text, width, px) => {
    if (measure(text, px) <= width) return text;
    let t = text;
    while (t.length > 1 && measure(`${t}…`, px) > width) t = t.slice(0, -1);
    return `${t}…`;
  };
  // Each step laid out with the one before it as its prior, a flagged part made wider by its flag. A step that brings
  // in more than it keeps is a new scene: laid out afresh, what it keeps moving to where that puts it.
  const states = statesOf(answer);
  const flagRoom = (w) => measure(w, z('text')) + z('text_after') / 2;
  let prior, was = new Set();
  // What a part's dot says in a look: the value of the field the look's dots name (dots.islands, else dots), its
  // status where they name status; else its health.
  const dotsOf = (look) => family(look).map((l) => style.dots?.[l]).find(Boolean) || style.dots;
  /** The look whose key a frame shows: the one it is one of, unless it has dots of its own. */
  const keyLook = (look) => (look && !style.dots?.[look] && LOOKS[look]) || look;
  const valueOf = (n, look) => {
    const by = dotsOf(look)?.field, order = dotsOf(look)?.order;
    if (!NAME.test(by ?? '')) return null;
    // A part that holds work, coloured by status, is as far as that work: done once all of it is, under way once any
    // of it is begun, else not begun.
    if (by === 'status' && n.notes?.length && Array.isArray(order) && order.length > 1) {
      const all = n.notes.map((i) => i.status);
      return String(all.every((v) => v === order.at(-1)) ? order.at(-1) : all.some((v) => v !== order[0]) ? order[1] : order[0]);
    }
    const v = by === 'status' ? n.item.status : n.item.fields?.[by];
    return NAME.test(String(v ?? '')) ? String(v) : 'none';
  };
  // Done, for an island to rise: the last value its look's key gives (dots.order), else up.
  const isDone = (look) => {
    const last = dotsOf(look)?.order?.at?.(-1);
    return (n) => (last && valueOf(n, look) !== null ? valueOf(n, look) === last : n.health === 'ok');
  };
  // Whoever a step names as the owner of a piece of work sails between the islands as a boat, not an island itself:
  // to the island that holds the work it has under way, if it has any.
  const crew = new Set(states.flatMap((s) => s.items.map((i) => i.fields?.owner)).filter((v) => typeof v === 'string'));
  const underWay = (look, status) => {
    const order = dotsOf(look)?.order;
    return Array.isArray(order) && order.length > 2 ? order.slice(1, -1).includes(status) : health({ open: true, status }) === 'building';
  };
  const frames = states.map((s) => {
    const room = new Map([...s.flags].map(([id, w]) => [id, flagRoom(w)]));
    const kept = [...s.ids].filter((id) => was.has(id)).length;
    if (prior && s.ids.size - kept > kept) prior = undefined;
    was = s.ids;
    const sea = SEAS.includes(s.look);
    const boxes = layout({ items: sea ? s.items.filter((i) => !crew.has(i.id)) : s.items, links: s.links, rootId: answer.lens.from, measure, sizes: style.sizes, prior, steady: true, room });
    prior = boxes.memo;
    const g = sea ? islands(boxes, { z, n: num, done: isDone(s.look) }) : BOARDS.includes(s.look) ? board(s.look, boxes, { z, order: dotsOf(s.look)?.order ?? [], names: dotsOf(s.look)?.names ?? {} }) : boxes;
    const parts = new Map(g.all.filter((n) => !n.dummy).map((n) => [n.id, n]));
    const boats = sea ? s.items.filter((i) => crew.has(i.id)).map((i) => ({ id: i.id, title: i.title, at: s.items.find((t) => t.fields?.owner === i.id && underWay(s.look, t.status) && parts.has(t.inside))?.inside ?? null })) : [];
    return { ...s, g, parts, boats, boxes: new Map(g.boxes.map((b) => [b.id, b])), wires: new Map(g.chains.map((c) => [c.key, c])) };
  });
  // A story with nothing in it (what it names is not shown here) says so, as the still picture does.
  if (frames.every((f) => !f.parts.size)) return { scene: { message: 'Nothing here is part of a system.' } };
  // One frame of reference for all of them: from the leftmost step to the widest, the tallest.
  const left = Math.min(...frames.map((f) => f.g.left)), right = Math.max(...frames.map((f) => f.g.width)), tall = Math.max(...frames.map((f) => f.g.height));
  const shift = -left;
  // A published picture is framed step by step, as compact as each step, in one shape throughout.
  const span = (g) => g.width - g.left;
  const aspect = Math.max(style.numbers?.arch_story_aspect ?? 1.6, Math.min(...frames.map((f) => span(f.g) / f.g.height)));
  const least = z('story_least');
  // Islands sit in the middle of their frame, top to bottom too.
  const view = (g) => {
    const w = Math.max(span(g), least, g.height * aspect);
    return `${g.left + shift + (span(g) - w) / 2} ${g.radii ? (g.height - w / aspect) / 2 : 0} ${w} ${w / aspect}`;
  };
  const widest = Math.max(...frames.map((f) => Math.max(span(f.g), least, f.g.height * aspect)));

  // What a part, a place, a wire looks like in a frame: the attributes of each of its marks.
  const markOf = (n, f) => (valueOf(n, f.look) === null ? n.health : `k-${valueOf(n, f.look)}`);
  // A part's outline: its box, or its island once the story is drawn as islands.
  const outlineOf = (n, f, X, Y) => {
    const r = f.g.radii?.get(n.id);
    return r ? islandPath(X, Y, r.rx + r.rise, r.ry + r.rise, n.id, num('arch_island_wobble')) : boxPath(X - n.w / 2, Y - n.h / 2, n.w, n.h, Math.min(z('corner'), n.h / 5));
  };
  const partAt = (n, f) => {
    const X = n.x0 + shift, Y = n.y0, left = X - n.w / 2 + z('text_x');
    return {
      s: { d: outlineOf(n, f, X, Y), class: `ar-shape ${markOf(n, f)}` },
      d: { cx: left - z('dot_gap'), cy: Y, class: `ar-dot ${markOf(n, f)}` },
      t: { x: left, y: Y },
      f: { x: X + n.w / 2 - z('text_after') / 2, y: Y },
      title: n.item.title,
      // A flagged part's name is cut to leave its flag room.
      text: fit(n.item.title, n.w - z('text_x') - z('text_after') - (f.flags.has(n.id) ? flagRoom(f.flags.get(n.id)) : 0), z('text')),
      flag: f.flags.get(n.id) ?? '',
    };
  };
  // A place's name is on its top edge, where no wire of the step comes in across it.
  const placeAt = (b, f) => {
    const x = b.x + shift, inset = z('place_name_inset'), high = z('place_name_height'), mid = b.y + inset + high / 2;
    const text = fit(b.item.title, b.w - z('place_name_room'), z('place_text'));
    const width = measure(text, z('place_text')) + z('place_name_room') - inset;
    const dx = nameLeft(x + inset, width, x + b.w - inset, b.y, b.y + inset + high, [...f.wires.values()].map(wireAt), inset) - (x + inset);
    return { box: { x, y: b.y, width: b.w, height: b.h }, n: { x: x + inset + dx, y: b.y + inset, width }, d: { cx: x + z('place_dot_x') + dx, cy: mid }, t: { x: x + z('place_text_x') + dx, y: mid }, text, title: b.item.title, flag: f.flags.get(b.id) ?? '' };
  };
  const wireAt = (c) => c.points.map(([px, py]) => [px + shift, py]);
  /** A wire's path: a route's one curve, else its runs. */
  const wireD = (c) => (c.curve ? curveOf(wireAt(c)) : pathOf(wireAt(c)));
  for (const f of frames) for (const n of f.parts.values()) ((n.x0 = f.g.x.get(n.id)), (n.y0 = f.g.y.get(n.id)));
  // What a wire carries, written on it where the still picture would write it; and whether the step lights it.
  for (const f of frames) {
    const labels = [...f.wires.values()].filter((c) => c.says).map((c) => ({ c, text: fit(c.says, z('says_most'), z('says_text')) }));
    const spots = f.g.radii ? routeSpots({ labels, chains: [...f.wires.values()], radii: f.g.radii, x: f.g.x, y: f.g.y, measure, z }) : saysSpots({ labels, chains: [...f.wires.values()], boxes: f.g.boxes, parts: partBoxes(f.g), measure, z });
    f.says = new Map(spots.map((s) => [s.c.key, s]));
    const lit = new Set((f.step.lit ?? []).map((w) => [...w].sort().join(' ')));
    f.lit = new Set([...f.wires.values()].filter((c) => lit.has([c.a, c.b].sort().join(' '))).map((c) => c.key));
  }
  const saysAt = (key, f) => {
    const s = f.says.get(key);
    return s && { r: { x: s.x + shift - s.w / 2, y: s.y - z('says_height') / 2, width: s.w, height: z('says_height') }, t: { x: s.x + shift, y: s.y }, text: s.text };
  };

  // Every mark there will ever be, first as nothing at all.
  const everyPart = new Map(), everyPlace = new Map(), everyWire = new Map();
  for (const f of frames) {
    for (const [id, n] of f.parts) if (!everyPart.has(id)) everyPart.set(id, [n, f]);
    for (const [id, b] of f.boxes) if (!everyPlace.has(id)) everyPlace.set(id, [b, f]);
    for (const [key, c] of f.wires) if (!everyWire.has(key)) everyWire.set(key, c);
  }
  const keyOf = (key) => key.replace(' ', '>');
  const placeMarks = [...everyPlace].map(([id, [b, f]]) => {
    const at = placeAt(b, f);
    return { box: m('rect', { key: `b:${id}:box`, ...at.box, rx: z('place_corner'), class: 'ar-place-box sp-off', opacity: 0 }), name: titled(m('a', { key: `b:${id}`, on: ['enter', 'leave', 'click'], href: `#/e/${id}`, class: 'ar-place sp-off', opacity: 0 }, m('rect', { key: `b:${id}:n`, ...at.n, height: z('place_name_height'), rx: z('corner'), class: 'ar-place-name' }), m('circle', { key: `b:${id}:d`, ...at.d, r: z('dot_small'), class: 'ar-dot ok' }), m('text', { key: `b:${id}:t`, ...at.t }, at.text), m('text', { key: `b:${id}:f`, x: at.box.x + at.box.width - z('text_after'), y: at.t.y, class: 'sp-flag' }, '')), at.title) };
  });
  const partMarks = [...everyPart].map(([id, [n, f]]) => {
    const at = partAt(n, f);
    const part = m('a', { key: `p:${id}`, on: ['enter', 'leave', 'click'], href: `#/e/${id}`, class: 'ar-part sp-off', opacity: 0 }, m('path', { key: `p:${id}:r`, ...at.s }), m('circle', { key: `p:${id}:d`, ...at.d, r: z('dot') }), m('text', { key: `p:${id}:t`, ...at.t }, at.text), m('text', { key: `p:${id}:f`, ...at.f, class: 'sp-flag' }, ''));
    part.splice(2, 0, m('title', { key: `p:${id}:n` }, at.title));
    return part;
  });
  const wireMarks = [...everyWire].map(([key, c]) => {
    const pts = wireAt(c);
    return [m('path', { key: `w:${keyOf(key)}`, d: wireD(c), pathLength: 1, 'stroke-dasharray': 1, 'stroke-dashoffset': 0, class: 'ar-wire wired sp-off', opacity: 0 }), m('path', { key: `h:${keyOf(key)}`, d: heads(pts, c), class: 'ar-head wired sp-off', opacity: 0 })];
  });
  const saysMarks = [...everyWire.keys()].filter((key) => frames.some((f) => f.says.has(key))).map((key) => m('g', { key: `s:${keyOf(key)}`, class: 'ar-says sp-off', opacity: 0 }, m('rect', { key: `s:${keyOf(key)}:r`, rx: z('says_height') / 2 }), m('text', { key: `s:${keyOf(key)}:t` }, '')));
  // Each piece of work a plan or a board draws: a box (a bar, a card) with its name in it.
  const everyTask = new Map();
  for (const f of frames) for (const [id, t] of f.g.tasks ?? []) if (!everyTask.has(id)) everyTask.set(id, t.item);
  const taskAt = (id, f) => {
    const t = f.g.tasks?.get(id);
    if (!t) return null;
    const pad = z('board_pad'), [X, Y] = [t.x + shift, t.y];
    return { d: boxPath(X - t.w / 2, Y - t.h / 2, t.w, t.h, Math.min(z('corner'), t.h / 4)), cls: `ar-shape k-${NAME.test(String(t.item.status)) ? t.item.status : 'none'}`, t: { x: X - t.w / 2 + pad, y: Y }, text: fit(t.item.title, t.w - 2 * pad, z('says_text')), title: t.item.title };
  };
  const taskMarks = [...everyTask].map(([id, t]) => m('g', { key: `t:${id}`, class: 'sp-task sp-off', opacity: 0 }, m('title', { key: `t:${id}:n` }, t.title), m('path', { key: `t:${id}:r`, d: boxPath(0, 0, 1, 1, 0), class: 'ar-shape' }), m('text', { key: `t:${id}:t`, x: 0, y: 0 }, '')));
  // A plan's lines of time, a board's lines and its columns' names.
  const boardMark = (f) => m('g', { key: 'board', class: 'sp-board' }, (f.g.lines ?? []).map(([x1, y1, x2, y2]) => m('line', { x1: x1 + shift, y1, x2: x2 + shift, y2 })), (f.g.heads ?? []).map((h) => m('text', { x: h.x + shift, y: h.y }, h.text)));
  const svg = m('svg', { key: 'svg', viewBox: `0 0 ${right - left} ${tall}`, role: 'img', 'aria-label': `How the system came to be, in ${frames.length} steps` }, placeMarks.map((p) => p.box), m('g', { key: 'board' }), wireMarks, m('g', { key: 'breaks' }), saysMarks, placeMarks.map((p) => p.name), taskMarks, partMarks);

  // How a frame is reached: every mark set as that frame has it.
  const used = Object.keys(LOOKS).filter((l) => frames.some((f) => family(f.look).includes(l)));
  const shape = { frames, partAt, placeAt, wireAt, wireD, saysAt, keyOf, view, heads, pathOf, squareMorph, z, shift, looks: used, keyLooks: used.filter((l) => keyLook(l) === l), keyLook, family, dotsOf, valueOf, everyTask, taskAt, boardMark };
  // Islands in 3D, where a step asks for them: painted on a surface over the picture.
  const sea = used.includes(DEEP);
  if (sea) shape.deep = deep({ style, tools, z, num, shape });
  const player = play({ answer, style, reduced, tools, shape });
  // The colour of each value a dot is coloured by, in the story's own look and in each other; an island is tinted with it.
  const colours = [[null, style.dots], ...Object.keys(LOOKS).map((l) => [l, style.dots?.[l]])].flatMap(([look, dots]) => Object.entries(dots?.colours ?? {}).filter(([v, c]) => NAME.test(v) && NAME.test(String(c))).map(([v, c]) => [look ? `.sp-${look} ` : '', v, `var(--${String(c).replaceAll('_', '-')})`, look]));
  // The conversation sits beside the picture only where the picture keeps twice its width; in a narrow column it goes
  // below, the picture taking the whole width.
  const room = '.lf-beside > .lf-stage { min-width: calc(var(--side-least) * 2); }';
  const css = `${base}\n${storyLook}\n${room}\n${islandsLook}\n${sea ? deepLook : ''}\n${everyTask.size ? boardsLook : ''}\n${colours
    .map(([within, v, c, look]) => `${within}.ar-dot.k-${v}, ${within}.sp-swatch.k-${v} { fill: ${c}; background: ${c}; stroke: none; }${look ? `\n.ar-part.sp-${look} .ar-shape.k-${v}, .sp-task .ar-shape.k-${v} { stroke: ${c}; fill: color-mix(in srgb, ${c} var(--ln-arch-island-tint), var(--ln-land)); }` : ''}`)
    .join('\n')}`;
  // What a part or a place says of itself, in a tip beside it: its name as the step shows it, and its first line.
  const byId = new Map(answer.items.map((i) => [i.id, i]));
  const tipFor = (key) => {
    const id = key.slice(2), f = frames[Math.max(player.step(), 0)];
    const shown = (key[0] === 'p' ? f.parts.get(id) : f.boxes.get(id))?.item ?? byId.get(id);
    return shown && m('div', { class: 'sp-tip' }, m('b', {}, shown.title), byId.get(id)?.gist && m('span', {}, byId.get(id).gist));
  };
  return {
    scene: { css, svg, before: player.before, aside: player.after, ...(sea && { surface: { key: 'deep' } }), size: style.still ? { width: widest, height: widest / aspect } : { width: right - left, height: tall } },
    on(event) {
      if (!/^[pb]:e_[a-z0-9]{8}$/.test(event.key)) return player.on(event);
      if (event.name === 'leave') return [{ tip: null }];
      const mark = tipFor(event.key);
      return mark ? [{ tip: { key: event.key, mark } }] : [];
    },
    end: player.end,
  };
}
