// A system as it came to be: the lens's steps, each laid out with the one before it as its prior (layout.js,
// steady), so what a step does not change stays where it was. Every part, place and wire that is ever drawn is one
// mark, shown or not; a step moves the marks from where they were to where they go (play.js runs the steps).
// The last step is the map as it is, whatever the steps say, so the picture always ends on what is true.

import { layout } from './layout.js';
import { css as base } from './look.js';
import { m, titled } from './marks.js';
import { play } from './play.js';
import { css as storyLook } from './story-look.js';

const NAME = /^[a-z][a-z0-9_]*$/;

/** What each step shows: its items (with the titles and fields they had then), its links, its flags, its chapter. */
export function statesOf(answer) {
  const steps = answer.steps, last = steps.length - 1, root = answer.lens.from;
  const byId = new Map(answer.items.map((i) => [i.id, i]));
  const moving = new Set(steps.flatMap((s) => [...(s.add ?? []), ...(s.remove ?? [])]));
  const present = new Set(), titles = new Map(), fields = new Map(), flags = new Map();
  let chapter = -1;
  const states = [];
  steps.forEach((s, k) => {
    for (const id of s.add ?? []) present.add(id);
    for (const id of s.remove ?? []) present.delete(id);
    for (const [id, t] of Object.entries(s.titles ?? {})) (t === null ? titles.delete(id) : titles.set(id, String(t)));
    for (const [id, f] of Object.entries(s.fields ?? {})) fields.set(id, Object.fromEntries(Object.entries({ ...fields.get(id), ...f }).filter(([, v]) => v !== null)));
    for (const [id, w] of Object.entries(s.flag ?? {})) (w === null ? flags.delete(id) : flags.set(id, String(w)));
    if (s.chapter) chapter++;
    // The last step is the map as it is.
    const final = k === last;
    const shows = (id) => (final ? byId.get(id)?.open !== false : present.has(id));
    // A place is shown while it holds something shown; what no step moves is shown as it is.
    const holds = new Map();
    for (const i of answer.items) if (i.inside) holds.set(i.inside, [...(holds.get(i.inside) ?? []), i.id]);
    const kept = (id, depth = 0) => id === root || (moving.has(id) ? shows(id) : final ? byId.get(id)?.open !== false || (holds.get(id) ?? []).some((c) => kept(c, depth + 1)) : depth < 16 && (holds.get(id) ?? []).some((c) => kept(c, depth + 1)));
    const items = answer.items
      .filter((i) => kept(i.id))
      .map((i) => (final ? i : { ...i, open: true, status: i.open ? i.status : 'up', title: titles.get(i.id) ?? i.title, fields: { ...i.fields, ...fields.get(i.id) } }));
    const ids = new Set(items.map((i) => i.id));
    states.push({ items, links: answer.links.filter((l) => ids.has(l.from) && ids.has(l.to)), flags: final ? new Map() : new Map(flags), chapter, step: s, ids });
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
  const measure = (text, px) => tools.measure(text, px, style.font);
  const fit = (text, width, px) => {
    if (measure(text, px) <= width) return text;
    let t = text;
    while (t.length > 1 && measure(`${t}…`, px) > width) t = t.slice(0, -1);
    return `${t}…`;
  };
  // Each step laid out with the one before it as its prior.
  const states = statesOf(answer);
  let prior;
  const frames = states.map((s) => {
    const g = layout({ items: s.items, links: s.links, rootId: answer.lens.from, measure, sizes: style.sizes, prior, steady: true });
    prior = g.memo;
    return { ...s, g, parts: new Map(g.all.filter((n) => !n.dummy).map((n) => [n.id, n])), boxes: new Map(g.boxes.map((b) => [b.id, b])), wires: new Map(g.chains.map((c) => [c.key, c])) };
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
  const view = (g) => {
    const w = Math.max(span(g), least, g.height * aspect);
    return `${g.left + shift + (span(g) - w) / 2} 0 ${w} ${w / aspect}`;
  };
  const widest = Math.max(...frames.map((f) => Math.max(span(f.g), least, f.g.height * aspect)));

  // What a part, a place, a wire looks like in a frame: the attributes of each of its marks.
  const dotsBy = style.dots && NAME.test(style.dots.field ?? '') ? style.dots.field : null;
  const dotClass = (n) => `ar-dot ${dotsBy ? `k-${n.item.fields?.[dotsBy] ?? 'none'}` : n.health}`;
  const partAt = (n, f) => {
    const X = n.x0 + shift, Y = n.y0, left = X - n.w / 2 + z('text_x');
    return {
      r: { x: X - n.w / 2, y: Y - n.h / 2, width: n.w, height: n.h },
      d: { cx: left - z('dot_gap'), cy: Y, class: dotClass(n) },
      t: { x: left, y: Y },
      f: { x: X + n.w / 2 - z('text_after') / 2, y: Y },
      title: n.item.title,
      // A flagged part's name is cut to leave its flag room.
      text: fit(n.item.title, n.w - z('text_x') - z('text_after') - (f.flags.has(n.id) ? measure(f.flags.get(n.id), z('text')) + z('text_after') / 2 : 0), z('text')),
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
  for (const f of frames) for (const n of f.parts.values()) ((n.x0 = f.g.x.get(n.id)), (n.y0 = f.g.y.get(n.id)));

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
    return { box: m('rect', { key: `b:${id}:box`, ...at.box, rx: z('place_corner'), class: 'ar-place-box sp-off', opacity: 0 }), name: titled(m('a', { key: `b:${id}`, href: `#/e/${id}`, class: 'ar-place sp-off', opacity: 0 }, m('rect', { key: `b:${id}:n`, ...at.n, height: z('place_name_height'), rx: z('corner'), class: 'ar-place-name' }), m('circle', { key: `b:${id}:d`, ...at.d, r: z('dot_small'), class: 'ar-dot ok' }), m('text', { key: `b:${id}:t`, ...at.t }, at.text), m('text', { key: `b:${id}:f`, x: at.box.x + at.box.width - z('text_after'), y: at.t.y, class: 'sp-flag' }, '')), at.title) };
  });
  const partMarks = [...everyPart].map(([id, [n, f]]) => {
    const at = partAt(n, f);
    const mark = m('a', { key: `p:${id}`, href: `#/e/${id}`, class: 'ar-part sp-off', opacity: 0 }, m('rect', { key: `p:${id}:r`, ...at.r, rx: Math.min(z('corner'), n.h / 5), class: 'ar-shape' }), m('circle', { key: `p:${id}:d`, ...at.d, r: z('dot') }), m('text', { key: `p:${id}:t`, ...at.t }, at.text), m('text', { key: `p:${id}:f`, ...at.f, class: 'sp-flag' }, ''));
    mark.splice(2, 0, m('title', { key: `p:${id}:n` }, at.title));
    return mark;
  });
  const wireMarks = [...everyWire].map(([key, c]) => {
    const pts = wireAt(c);
    return [m('path', { key: `w:${keyOf(key)}`, d: pathOf(pts), pathLength: 1, 'stroke-dasharray': 1, 'stroke-dashoffset': 0, class: 'ar-wire wired sp-off', opacity: 0 }), m('path', { key: `h:${keyOf(key)}`, d: arrow(pts, c.back), class: 'ar-head wired sp-off', opacity: 0 })];
  });
  const svg = m('svg', { key: 'svg', viewBox: `0 0 ${right - left} ${tall}`, role: 'img', 'aria-label': `How the system came to be, in ${frames.length} steps` }, placeMarks.map((p) => p.box), wireMarks, m('g', { key: 'breaks' }), placeMarks.map((p) => p.name), partMarks);

  // How a frame is reached: every mark set as that frame has it.
  const shape = { frames, partAt, placeAt, wireAt, keyOf, view, arrow, pathOf, squareMorph, z, shift };
  const player = play({ answer, style, reduced, tools, shape });
  const css = `${base}\n${storyLook}\n${(Object.entries(style.dots?.colours ?? {}))
    .filter(([v, c]) => NAME.test(v) && NAME.test(String(c)))
    .map(([v, c]) => `.ar-dot.k-${v}, .sp-swatch.k-${v} { fill: var(--${String(c).replaceAll('_', '-')}); background: var(--${String(c).replaceAll('_', '-')}); stroke: none; }`)
    .join('\n')}`;
  return {
    scene: { css, svg, before: player.before, after: player.after, size: style.still ? { width: widest, height: widest / aspect } : { width: right - left, height: tall } },
    on: player.on,
    end: player.end,
  };
}
