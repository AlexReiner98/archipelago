// The canvas: a lens answer drawn in space. What holds others is land, with what it holds on it (the closure of
// part_of, drawn as regions within regions); each thing is a node in the outline its type or kind is given (outlines.js,
// named by the style's `outlines`); every link between two things is a wire, pointing at the one that waits, and what
// names another in its note a faint thread. Hovering a thing says the point of it in a tip and lights its wires;
// clicking opens its page. The layout is ./layout.js, the look ./look.js. This module is the template for a drawing:
// `picture` takes what the page gives every drawing and answers with a scene, what to do on an event, and on a restyle.

import { layout } from './layout.js';
import { css } from './look.js';
import { m, titled } from './marks.js';
import { OUTLINES, outline } from './outlines.js';

/** What a dot on a node says, the same as the flow's. */
const dotOf = (i) => (!i.open ? 'done' : i.state?.needs_you ? 'you' : i.state?.blocked ? 'blocked' : i.state?.sessions ? 'session' : '');
/** The wires drawn plain: the rest are another kind of tie, drawn dashed. */
const PLAIN = new Set(['depends_on', 'waits_on', 'needs', 'mentions']);

export function picture({ answer, style, types = {}, relations = {} }, tools) {
  const sizes = style.sizes ?? {};
  const z = (name) => {
    const v = sizes[`space_${name}`];
    if (typeof v !== 'number') throw new Error(`The style names no size "space_${name}": the canvas pack's preset names every one the canvas uses`);
    return v;
  };
  const measure = (text, px) => tools.measure(text, px, style.font);
  const g = layout({ items: answer.items, links: answer.links, measure, sizes, numbers: style.numbers, outlines: style.outlines });
  if (!g.nodes.size) return { scene: { message: 'Nothing here yet.' } };
  const [TEXT, HEAD_TEXT, TEXT_X, PAD, CORNER, REGION_CORNER, DOT, DOT_X, BADGE, COUNT, COUNT_TEXT] = ['text', 'head_text', 'text_x', 'pad', 'corner', 'region_corner', 'dot', 'dot_x', 'badge', 'count', 'count_text'].map(z);
  const fit = (text, width, px) => {
    if (measure(text, px) <= width) return text;
    let t = text;
    while (t.length > 1 && measure(`${t}…`, px) > width) t = t.slice(0, -1);
    return `${t}…`;
  };
  const me = answer.viewer;
  const you = (n) => (n.item.state?.needs_you ? 1 : 0) + (n.item.within?.needs_you ?? 0);
  const blocked = (n) => (n.item.state?.blocked ? 1 : 0) + (n.item.within?.blocked ?? 0);
  const lit = (n, now) => (Array.isArray(now.only) ? now.only.includes(n.id) : now.lit === 'you' ? you(n) > 0 : now.lit === 'blocked' ? blocked(n) > 0 : true);
  const key = (n) => `${n.region ? 'r' : 'n'}:${n.id}`;
  const words = (n) => [n.item.title, `${types[n.item.type] ?? n.item.type}, ${n.item.status}`].join('\n');

  // ---- Regions, deepest last, so land within land is drawn over the land it is on.
  const regions = [...g.nodes.values()].filter((n) => n.region).sort((a, b) => a.depth - b.depth);
  const counts = (n) => {
    const said = [[you(n), 'you', 'need you'], [blocked(n), 'blocked', 'blocked'], [n.item.within?.work ?? 0, '', 'open']].filter(([k]) => k > 0);
    let x = n.x + n.w - PAD;
    return said.map(([k, cls, what]) => {
      const w = Math.max(COUNT, measure(String(k), COUNT_TEXT) + COUNT / 2);
      x -= w;
      const mark = titled(m('g', { class: `sp-count ${cls}` }, m('rect', { x: x, y: n.y + (n.head - COUNT) / 2, width: w, height: COUNT, rx: COUNT / 2 }), m('text', { x: x + w / 2, y: n.y + n.head / 2 }, String(k))), `${k} ${what}`);
      x -= COUNT / 4;
      return mark;
    });
  };
  const regionLayer = regions.map((n) =>
    m(
      'g',
      { key: key(n), class: `sp-region d${n.depth % 4}${n.id === style.here ? ' here' : ''}${lit(n, style) ? '' : ' dim'}` },
      outline(n.outline, n.x, n.y, n.w, n.h, REGION_CORNER, 'sp-shore'),
      titled(m('a', { key: `h:${n.id}`, on: ['enter', 'leave'], href: `#/e/${n.id}`, class: 'sp-head' }, m('rect', { x: n.x, y: n.y, width: n.w, height: n.head, rx: REGION_CORNER, class: 'sp-hit' }), m('text', { x: n.x + PAD, y: n.y + n.head / 2 }, fit(n.item.title, n.w - 2 * PAD - 3 * COUNT, HEAD_TEXT))), words(n)),
      counts(n),
    ),
  );

  // ---- Wires, under the nodes and over the land.
  const wireLayer = g.wires.map((w, i) => {
    const kind = PLAIN.has(w.kind) ? w.kind : 'other';
    const cls = `sp-wire ${kind}${w.state === 'broken' ? ' broken' : ''}`;
    const [ex, ey] = w.end, [tx, ty] = w.toward, len = z('arrow_length'), half = z('arrow_half');
    const head = w.arrow && m('path', { key: `a:${i}`, class: `sp-arrow ${kind}`, d: `M${ex} ${ey}L${ex - tx * len - ty * half} ${ey - ty * len + tx * half}L${ex - tx * len + ty * half} ${ey - ty * len - tx * half}Z` });
    return [titled(m('path', { key: `w:${i}`, class: cls, d: w.d }), `${relations[w.kind] ?? w.kind}${w.n > 1 ? ` (${w.n})` : ''}${w.says ? `: ${w.says}` : ''}`), head];
  });

  // ---- Nodes: each an outline, a dot for its state, its title, and a count of what it holds that is not drawn.
  const nodes = [...g.nodes.values()].filter((n) => !n.region);
  const nodeLayer = nodes.map((n) => {
    const i = n.item, room = n.room;
    const cls = ['sp-node', !i.open && 'closed', i.state?.needs_you && 'you', i.state?.blocked && 'blocked', i.id === style.here && 'here', !lit(n, style) && 'dim'].filter(Boolean).join(' ');
    const top = n.y + room.top, mid = top + (n.h - room.top - room.bottom) / 2, left = n.x + room.left;
    return m(
      'a',
      { key: key(n), on: ['enter', 'leave'], href: `#/e/${i.id}`, class: cls },
      m('title', {}, words(n)),
      outline(n.outline, n.x, n.y, n.w, n.h, CORNER, 'sp-shape'),
      m('circle', { cx: left + DOT_X, cy: mid, r: DOT, class: `sp-dot ${dotOf(i)}` }),
      m('text', { x: left + TEXT_X, y: mid }, fit(i.title, n.w - room.left - room.right - TEXT_X - (n.hidden ? BADGE : 0), TEXT)),
      n.hidden > 0 && titled(m('g', { class: 'sp-badge' }, m('circle', { cx: n.x + n.w - room.right - BADGE, cy: mid, r: BADGE * 0.8 }), m('text', { x: n.x + n.w - room.right - BADGE, y: mid }, String(n.hidden))), `${n.hidden} inside`),
    );
  });

  const svg = m('svg', { viewBox: `0 0 ${g.width} ${g.height}`, role: 'img', 'aria-label': `${g.nodes.size} items in space` }, regionLayer, wireLayer, nodeLayer);

  // ---- The key: the outlines this view uses, each with the types drawn in it; the dots; the wires.
  const used = new Map();
  for (const n of nodes) used.set(n.outline, [...new Set([...(used.get(n.outline) ?? []), types[n.item.type] ?? n.item.type])]);
  const mark = (inner, label) => m('span', {}, m('svg', { width: 26, height: 18, viewBox: '0 0 26 18' }, inner), label);
  const legend = m(
    'div',
    { class: 'lf-legend' },
    [...used].filter(([name]) => OUTLINES[name]).map(([name, labels]) => mark(m('g', { class: 'sp-node' }, outline(name, 3, 4, 20, 10, 3, 'sp-shape')), labels.slice(0, 3).join(', '))),
    [['done', 'Done'], ['blocked', 'Blocked'], ['you', 'Waits on you'], ['session', 'Under way']].filter(([dot]) => nodes.some((n) => dotOf(n.item) === dot)).map(([dot, label]) => mark(m('circle', { cx: 13, cy: 9, r: 4, class: `sp-dot ${dot}` }), label)),
    [...new Set(g.wires.map((w) => (PLAIN.has(w.kind) ? w.kind : 'other')))].map((kind) => mark(m('path', { d: 'M2 9H24', class: `sp-wire ${kind}` }), kind === 'other' ? 'Tied otherwise' : (relations[kind] ?? (kind === 'mentions' ? 'Names it' : kind)))),
  );

  // ---- Hovering: the tip says the point of it; its wires light and the rest fade.
  const byKey = new Map([...g.nodes.values()].flatMap((n) => [[key(n), n], [`h:${n.id}`, n]]));
  const light = (id) => g.wires.flatMap((w, i) => {
    const on = Boolean(id) && (w.from === id || w.to === id);
    return [{ key: `w:${i}`, toggle: { lit: on, 'sp-faded': Boolean(id) && !on } }, ...(w.arrow ? [{ key: `a:${i}`, toggle: { lit: on } }] : [])];
  });
  const tip = (n) => {
    const i = n.item, w = i.within ?? {};
    const flags = [i.state?.needs_you && 'Needs you', i.state?.blocked && 'Blocked', i.state?.sessions && 'A session is on it', me && i.state?.waits_on?.includes(me) && 'Waits on you'].filter(Boolean);
    return m(
      'div',
      { class: 'sp-tip' },
      m('strong', {}, i.title),
      m('span', { class: 'sp-meta' }, `${types[i.type] ?? i.type} · ${i.status}${w.items ? ` · ${w.items} inside, ${w.work ?? 0} open` : ''}`),
      flags.length > 0 && m('p', { class: 'sp-flag' }, flags.join(' · ')),
      typeof i.note === 'string' && i.note && m('p', {}, i.note),
    );
  };
  const here = g.nodes.get(style.here);
  return {
    scene: { css, svg, legend, size: { width: g.width, height: g.height }, start: here ? [here.x + here.w / 2, here.y + (here.region ? here.head : here.h) / 2] : undefined },
    on({ name, key: k }) {
      const n = byKey.get(k);
      if (!n) return [];
      if (name === 'leave') return [{ tip: null }, ...light(null)];
      return [{ tip: { key: k, mark: tip(n) } }, ...light(n.id)];
    },
    restyle(now) {
      return [...g.nodes.values()].map((n) => ({ key: key(n), toggle: { here: n.id === now.here, dim: !lit(n, now) } }));
    },
  };
}
