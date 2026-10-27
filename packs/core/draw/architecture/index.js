// A lens answer drawn as a system: every part a box (a store a cylinder, a client a pill), each place that holds
// parts (a host, a cloud, a machine) a box around them, and wires at right angles from a part down to what it calls,
// broken where one passes under another, as in the flow. It is for seeing how the system is as it is wired up and
// run: each part's dot says its health (up, degraded, down, being wired, on standby, planned), each wire whether it
// is wired, only planned, broken or to a part on standby, and the bar over the picture counts both. The layout is
// ./layout.js; this answers with the marks to draw (SVG and HTML as data), which the page checks and mounts, so
// every name is in the page and every part a link. Its look is ./look.js, in the lens's colours.

import { layout } from './layout.js';
import { partBoxes, saysSpots } from './says.js';
import { css } from './look.js';
import { addClass, m, titled } from './marks.js';
import { story } from './story.js';

/** What each health and wire state is called, in the order the bar and the key give them. */
const HEALTHS = [['ok', 'Up'], ['warn', 'Degraded'], ['down', 'Down'], ['building', 'Being wired'], ['standby', 'On standby'], ['planned', 'Planned'], ['unknown', 'Not known'], ['gone', 'Retired']];
const WIRES = [['wired', 'Wired'], ['planned', 'Not yet wired'], ['broken', 'Broken'], ['standby', 'On standby']];
/** The pill each health is counted in. */
const PILL = { ok: 'ok', warn: 'warn', down: 'bad', building: '', standby: 'closed', planned: 'closed', unknown: 'closed', gone: 'closed' };
const said = (list, key) => list.find(([k]) => k === key)?.[1] ?? key;

/** A lens answer as a tree, each thing with what it says of itself and of all that is inside it. */
function lensTree(answer) {
  const byId = new Map(answer.items.map((item) => [item.id, { ...item, kids: [] }]));
  const root = { kids: [] };
  for (const n of byId.values()) (byId.get(n.inside) ?? root).kids.push(n);
  for (const n of byId.values()) {
    n.you = (n.state.needs_you ? 1 : 0) + (n.within.needs_you ?? 0);
    n.blk = (n.state.blocked ? 1 : 0) + n.within.blocked;
  }
  return byId;
}
/** How much of a thing stays lit: what was asked for by name (style.only), else what the style's lit says. */
function litCount(n, style) {
  if (Array.isArray(style.only)) {
    const only = new Set(style.only);
    const any = (x) => only.has(x.id) || x.kids.some(any);
    return any(n) ? 1 : 0;
  }
  return style.lit === 'you' ? n.you : style.lit === 'blocked' ? n.blk : 1;
}

/** A part's outline, centred on x, y, its corners as round as rx and a store's lid as deep as lid. */
function outline(shape, x, y, w, hgt, rx, lid) {
  const l = x - w / 2, r = x + w / 2, t = y - hgt / 2, b = y + hgt / 2;
  if (shape === 'diamond') return m('path', { d: `M${x} ${t}L${r} ${y}L${x} ${b}L${l} ${y}Z`, class: 'ar-shape' });
  if (shape === 'pill') return m('rect', { x: l, y: t, width: w, height: hgt, rx: hgt / 2, class: 'ar-shape' });
  // A store: a cylinder, its lid drawn over its body.
  if (shape === 'store') {
    const ry = lid;
    return m('g', {}, m('path', { d: `M${l} ${t + ry}A${w / 2} ${ry} 0 0 1 ${r} ${t + ry}V${b - ry}A${w / 2} ${ry} 0 0 1 ${l} ${b - ry}Z`, class: 'ar-shape' }), m('path', { d: `M${l} ${t + ry}A${w / 2} ${ry} 0 0 0 ${r} ${t + ry}`, class: 'ar-lid' }));
  }
  return m('rect', { x: l, y: t, width: w, height: hgt, rx: Math.min(rx, hgt / 5), class: 'ar-shape' });
}

/**
 * The system: its parts, the places they run and the wires between them, with how each is. `input` is what the page
 * gives every drawing (the answer, the style); `tools.measure(text, px, font, role)` is how wide a text is drawn, as one of the style's text roles when one is given.
 */
export function picture({ answer, style, reduced }, tools) {
  // A picture with steps plays how it came to be, and ends on the map as it is.
  if (Array.isArray(answer.steps) && answer.steps.length) return story({ answer, style, reduced }, tools);
  const byId = lensTree(answer);
  // Every length is the style's (sizes, arch_*), named by the house style; so is the typeface.
  const z = (name) => {
    const v = style.sizes?.[`arch_${name}`];
    if (typeof v !== 'number') throw new Error(`The style names no size "arch_${name}": the house style (packs/core/pack.json) names every one a drawing uses`);
    return v;
  };
  const [TEXT, PLACE_TEXT, SAYS_TEXT, CORNER, LID] = ['text', 'place_text', 'says_text', 'corner', 'lid'].map(z);
  // A text is measured as it is drawn: in the plain face, or as one of the style's text roles (type): a place's name
  // as a region, what a link says as water.
  const measure = (text, px, role) => {
    const as = role && style.type?.[role];
    return tools.measure(text, px, (as && style.faces?.[as.face]) || style.font, as);
  };
  const fit = (text, width, px, role) => {
    if (measure(text, px, role) <= width) return text;
    let t = text;
    while (t.length > 1 && measure(`${t}…`, px, role) > width) t = t.slice(0, -1);
    return `${t}…`;
  };
  const g = layout({ items: answer.items, links: answer.links, rootId: answer.lens.from, measure, sizes: style.sizes });
  const parts = g.all.filter((n) => !n.dummy);
  if (!parts.length) return { scene: { message: 'Nothing here is part of a system.' } };

  const yours = (i) => Boolean(i.state.needs_you);
  const words = (n) => [n.item.title, `${said(HEALTHS, n.health)} (${n.item.status})`, n.item.host && `On ${n.item.host}`, n.item.role && `Role: ${n.item.role}`, n.item.state.blocked && 'Blocked', yours(n.item) ? 'Needs you' : n.item.state.waits_on.length ? 'Waits on someone' : null, ...(n.notes ?? []).map((i) => `On it: ${i.title}`)].filter(Boolean).join('\n');

  // What can be lit or dimmed, by the key the page knows it by.
  const dims = new Map(), wires = [];
  // The places first, under everything: a box each. Its name and its own dot go over the wires, on its top edge.
  const boxLayer = g.boxes.map((b) => m('rect', { x: b.x, y: b.y, width: b.w, height: b.h, rx: z('place_corner'), class: `ar-place-box ${b.health}` }));
  const nameLayer = g.boxes.map((b) => {
    const text = fit(b.item.title, b.w - z('place_name_room'), PLACE_TEXT, 'region');
    const mark = titled(
      m('a', { key: `b:${b.id}`, href: `#/e/${b.id}`, class: `ar-place ${b.health}` }, m('rect', { x: b.x + z('place_name_inset'), y: b.y + z('place_name_inset'), width: measure(text, PLACE_TEXT, 'region') + z('place_name_room') - z('place_name_inset'), height: z('place_name_height'), rx: CORNER, class: 'ar-place-name' }), m('circle', { cx: b.x + z('place_dot_x'), cy: b.y + z('place_name_inset') + z('place_name_height') / 2, r: z('dot_small'), class: `ar-dot ${b.health}` }), m('text', { x: b.x + z('place_text_x'), y: b.y + z('place_name_inset') + z('place_name_height') / 2 }, text)),
      [b.item.title, `${said(HEALTHS, b.health)} (${b.item.status})`].join('\n'),
    );
    dims.set(b.id, mark);
    return mark;
  });
  // Then the wires, each with a wider line under it to hover, an arrow at what is called, and what it carries.
  const labels = [];
  const wireLayer = g.chains.map((c, n) => {
    const d = `M${c.points.map((p) => p.join(' ')).join('L')}`;
    const path = m('path', { key: `w:${n}`, d, class: `ar-wire ${c.state}` });
    // A wire drawn turned back (a loop) has its arrow at its start, pointing up at what is called; one both ways has
    // an arrow at each end.
    const up = ([ex, ey]) => `M${ex} ${ey}L${ex - 4.5} ${ey + 9}L${ex + 4.5} ${ey + 9}Z`, down = ([ex, ey]) => `M${ex} ${ey}L${ex - 4.5} ${ey - 9}L${ex + 4.5} ${ey - 9}Z`;
    const ends = c.back ? [up(c.points[0]), down(c.points.at(-1))] : [down(c.points.at(-1)), up(c.points[0])];
    const head = m('path', { key: `h:${n}`, d: c.both ? ends.join('') : ends[0], class: `ar-head ${c.state}` });
    const [from, to] = c.back ? [c.b, c.a] : [c.a, c.b];
    const hit = titled(m('path', { key: `x:${n}`, on: ['enter', 'leave'], d, class: 'ar-hit' }), [`${g.nodes.get(from).item.title} ${c.both ? '↔' : '→'} ${g.nodes.get(to).item.title}`, c.says, said(WIRES, c.state)].filter(Boolean).join('\n'));
    wires.push(c);
    if (c.says) labels.push({ c, text: fit(c.says, z('says_most'), SAYS_TEXT) });
    return [path, head, hit];
  });
  const labelLayer = saysSpots({ labels, chains: g.chains, boxes: g.boxes, parts: partBoxes(g), measure, z }).map(({ c, text, x: lx, y: ly, w }) =>
    m('g', { class: `ar-says ${c.state}` }, m('rect', { x: lx - w / 2, y: ly - z('says_height') / 2, width: w, height: z('says_height'), rx: z('says_height') / 2 }), m('text', { x: lx, y: ly }, text)),
  );
  const breakLayer = g.breaks.map(([bx, by]) => m('g', { class: 'ar-break' }, m('rect', { x: bx - 3, y: by - 8, width: 6, height: 16 }), m('path', { d: `M${bx - 6} ${by}H${bx + 6}` })));
  // Last, the parts over all of it.
  const partLayer = parts.map((n) => {
    const X = g.x.get(n.id), Y = g.y.get(n.id), i = n.item;
    const left = n.shape === 'diamond' ? X - n.w / 2 + z('diamond_pad') / 2 : X - n.w / 2 + z('text_x');
    const room = n.shape === 'diamond' ? n.w - z('diamond_pad') : n.w - z('text_x') - z('text_after');
    const cls = ['ar-part', n.health, yours(i) && 'you', i.id === style.here && 'here'].filter(Boolean).join(' ');
    const mark = titled(
      m(
        'a',
        { key: `p:${i.id}`, on: ['enter', 'leave'], href: `#/e/${i.id}`, class: cls },
        outline(n.shape, X, Y, n.w, n.h, CORNER, LID),
        m('circle', { cx: left - z('dot_gap'), cy: Y + (n.shape === 'store' ? LID / 2 : 0), r: z('dot'), class: `ar-dot ${n.health}` }),
        m('text', { x: left, y: Y + (n.shape === 'store' ? LID / 2 : 0) }, fit(i.title, room, TEXT)),
        n.notes && m('g', { class: `ar-badge${n.notes.some(yours) ? ' you' : ''}` }, m('circle', { cx: X + n.w / 2 - z('badge_in'), cy: Y - n.h / 2, r: z('badge') }), m('text', { x: X + n.w / 2 - z('badge_in'), y: Y - n.h / 2 }, String(n.notes.length))),
      ),
      words(n),
    );
    dims.set(i.id, mark);
    return mark;
  });
  const svg = m('svg', { viewBox: `0 0 ${g.width} ${g.height}`, role: 'img', 'aria-label': `A system of ${parts.length} parts in ${g.boxes.length} places` }, boxLayer, wireLayer, breakLayer, labelLayer, nameLayer, partLayer);

  // The key: what each mark this picture uses means, one to a row (the page draws it, docs/drawings.md).
  const key = (inner, label) => ({ glyph: m('svg', { width: 22, height: 14, viewBox: '0 0 22 14' }, inner), label });
  const healths = new Set([...parts, ...g.boxes].map((n) => n.health)), states = new Set(g.chains.map((c) => c.state));
  const entries = [
    [['box', 'Part'], ['store', 'Store'], ['pill', 'Client'], ['diamond', 'Question']].filter(([shape]) => parts.some((n) => n.shape === shape)).map(([shape, label]) => key(m('g', { class: 'ar-part' }, outline(shape, 11, 7, 20, shape === 'diamond' ? 12 : 13, CORNER, 3)), label)),
    g.boxes.length > 0 && key(m('rect', { x: 1, y: 1, width: 20, height: 12, rx: 3, class: 'ar-place-box' }), 'Where it runs'),
    HEALTHS.filter(([k]) => healths.has(k)).map(([k, label]) => key(m('circle', { cx: 11, cy: 7, r: 4, class: `ar-dot ${k}` }), label)),
    WIRES.filter(([k]) => states.has(k)).map(([k, label]) => key(m('path', { d: 'M1 7H21', class: `ar-wire ${k}` }), label)),
    g.breaks.length > 0 && key(m('path', { d: 'M1 7H21M11 0V4M11 10V14', class: 'ar-wire wired' }), 'Passes under'),
  ].flat().filter(Boolean);

  // The bar: how many parts are in each health, and how many wires are wired, as marks to be read at a glance.
  const count = (k) => parts.filter((n) => n.health === k).length;
  // A wire to a part on standby is neither owed nor wired: it is left out of the count.
  const running = g.chains.filter((c) => c.state !== 'standby');
  const bar = m(
    'span',
    { class: 'ar-tally' },
    HEALTHS.filter(([k]) => count(k)).map(([k, label]) => m('span', { class: `pill ${PILL[k]}`, title: `${label}: ${parts.filter((n) => n.health === k).map((n) => n.item.title).join(', ')}` }, `${count(k)} ${label.toLowerCase()}`)),
    running.length > 0 && m('span', { class: `pill ${running.some((c) => c.state === 'broken') ? 'bad' : running.every((c) => c.state === 'wired') ? 'ok' : 'closed'}`, title: WIRES.map(([k, label]) => `${label}: ${g.chains.filter((c) => c.state === k).length}`).join('\n') }, `${running.filter((c) => c.state === 'wired').length} of ${running.length} wired`),
  );

  // What stays lit, as the style says: the rest dimmed.
  const dimmed = (now) => [...dims.keys()].filter((id) => byId.has(id) && !litCount(byId.get(id), now));
  for (const id of dimmed(style)) addClass(dims.get(id), 'dim');
  /** Light the wires of a part, or of none. */
  const light = (id) => wires.map((c, n) => [`w:${n}`, `h:${n}`].map((key) => ({ key, toggle: { lit: Boolean(id) && (c.a === id || c.b === id) } }))).flat();
  const here = g.nodes.has(style.here) ? [g.x.get(style.here), g.y.get(style.here)] : undefined;
  return {
    scene: { css, svg, key: entries, bar, size: { width: g.width, height: g.height }, start: here },
    on({ name, key }) {
      const [kind, rest] = [key.slice(0, 1), key.slice(2)];
      if (name === 'leave') return light(null);
      if (kind === 'p') return light(rest);
      if (kind === 'x') return [`w:${rest}`, `h:${rest}`].map((k) => ({ key: k, toggle: { lit: true } }));
      return [];
    },
    restyle(now) {
      const off = new Set(dimmed(now));
      return [...dims.keys()].filter((id) => byId.has(id)).map((id) => ({ key: dims.get(id)[1].key, toggle: { dim: off.has(id) } }));
    },
  };
}
