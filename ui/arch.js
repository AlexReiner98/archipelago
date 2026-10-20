// A lens answer drawn as a system: every part a box (a store a cylinder, a client a pill), each place that holds
// parts (a host, a cloud, a machine) a box around them, and wires at right angles from a part down to what it calls,
// broken where one passes under another, as in the flow. It is for seeing how the system is as it is wired up and
// run: each part's dot says its health (up, degraded, down, being wired, on standby, planned), each wire whether it
// is wired, only planned, broken or to a part on standby, and the bar over the picture counts both. The layout is ui/arch-layout.js; this draws
// it as SVG, so every name is in the page and every part a link. Its colours are the lens's, in ui/arch.css.

import { h } from './base.js';
import { layout } from './arch-layout.js';
import { lensTree, litCount, litSwitch, numberOf, sizeOf } from './lens-base.js';
import { panZoom } from './pan-zoom.js';

const NS = 'http://www.w3.org/2000/svg';
const svg = (tag, attrs = {}, ...kids) => {
  const el = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) if (v !== undefined && v !== false) el.setAttribute(k, String(v));
  el.append(...kids.flat(Infinity).filter((kid) => kid !== undefined && kid !== false && kid !== null));
  return el;
};
const titled = (el, text) => (el.prepend(svg('title', {}, text)), el);

/** What each health and wire state is called, in the order the bar and the key give them. */
const HEALTHS = [['ok', 'Up'], ['warn', 'Degraded'], ['down', 'Down'], ['building', 'Being wired'], ['standby', 'On standby'], ['planned', 'Planned'], ['unknown', 'Not known'], ['gone', 'Retired']];
const WIRES = [['wired', 'Wired'], ['planned', 'Not yet wired'], ['broken', 'Broken'], ['standby', 'On standby']];
/** The pill each health is counted in. */
const PILL = { ok: 'ok', warn: 'warn', down: 'bad', building: '', standby: 'closed', planned: 'closed', unknown: 'closed', gone: 'closed' };
const said = (list, key) => list.find(([k]) => k === key)?.[1] ?? key;

/** A part's outline, centred on x, y, its corners as round as rx and a store's lid as deep as lid. */
function outline(shape, x, y, w, hgt, rx, lid) {
  const l = x - w / 2, r = x + w / 2, t = y - hgt / 2, b = y + hgt / 2;
  if (shape === 'diamond') return svg('path', { d: `M${x} ${t}L${r} ${y}L${x} ${b}L${l} ${y}Z`, class: 'ar-shape' });
  if (shape === 'pill') return svg('rect', { x: l, y: t, width: w, height: hgt, rx: hgt / 2, class: 'ar-shape' });
  // A store: a cylinder, its lid drawn over its body.
  if (shape === 'store') {
    const ry = lid;
    return svg('g', {}, svg('path', { d: `M${l} ${t + ry}A${w / 2} ${ry} 0 0 1 ${r} ${t + ry}V${b - ry}A${w / 2} ${ry} 0 0 1 ${l} ${b - ry}Z`, class: 'ar-shape' }), svg('path', { d: `M${l} ${t + ry}A${w / 2} ${ry} 0 0 0 ${r} ${t + ry}`, class: 'ar-lid' }));
  }
  return svg('rect', { x: l, y: t, width: w, height: hgt, rx: Math.min(rx, hgt / 5), class: 'ar-shape' });
}

/** The system: its parts, the places they run and the wires between them, with how each is. */
export function drawArch(host, answer, style, keep) {
  const { me, byId } = lensTree(answer);
  // Every length is the style's (sizes, arch_*), named by the house style; so is the typeface.
  const z = (name) => sizeOf(style, `arch_${name}`);
  const [TEXT, PLACE_TEXT, SAYS_TEXT, CORNER, LID] = ['text', 'place_text', 'says_text', 'corner', 'lid'].map(z);
  const ctx = document.createElement('canvas').getContext('2d');
  const measure = (text, px) => ((ctx.font = `400 ${px}px ${style.font}`), ctx.measureText(text).width);
  const fit = (text, width, px) => {
    if (measure(text, px) <= width) return text;
    let t = text;
    while (t.length > 1 && measure(`${t}…`, px) > width) t = t.slice(0, -1);
    return `${t}…`;
  };
  const g = layout({ items: answer.items, links: answer.links, rootId: answer.lens.from, measure, sizes: style.sizes });
  const parts = g.all.filter((n) => !n.dummy);
  if (!parts.length) return host.replaceChildren(h('div', { class: 'empty' }, 'Nothing here is part of a system.'));

  const yours = (i) => Boolean(me && i.state.waits_on.includes(me));
  const words = (n) => [n.item.title, `${said(HEALTHS, n.health)} (${n.item.status})`, n.item.host && `On ${n.item.host}`, n.item.role && `Role: ${n.item.role}`, n.item.state.blocked && 'Blocked', yours(n.item) ? 'Waits on you' : n.item.state.waits_on.length ? 'Waits on someone' : null, ...(n.notes ?? []).map((i) => `On it: ${i.title}`)].filter(Boolean).join('\n');

  const els = new Map(), wires = new Map();
  const light = (id) => {
    for (const [c, list] of wires) for (const el of list) el.classList.toggle('lit', Boolean(id) && (c.a === id || c.b === id));
  };

  // The places first, under everything: a box each. Its name and its own dot go over the wires, on its top edge.
  const boxLayer = g.boxes.map((b) => svg('rect', { x: b.x, y: b.y, width: b.w, height: b.h, rx: z('place_corner'), class: `ar-place-box ${b.health}` }));
  const nameLayer = g.boxes.map((b) => {
    const text = fit(b.item.title, b.w - z('place_name_room'), PLACE_TEXT);
    const el = titled(
      svg('a', { href: `#/e/${b.id}`, class: `ar-place ${b.health}` }, svg('rect', { x: b.x + z('place_name_inset'), y: b.y + z('place_name_inset'), width: measure(text, PLACE_TEXT) + z('place_name_room') - z('place_name_inset'), height: z('place_name_height'), rx: CORNER, class: 'ar-place-name' }), svg('circle', { cx: b.x + z('place_dot_x'), cy: b.y + z('place_name_inset') + z('place_name_height') / 2, r: z('dot_small'), class: `ar-dot ${b.health}` }), svg('text', { x: b.x + z('place_text_x'), y: b.y + z('place_name_inset') + z('place_name_height') / 2 }, text)),
      [b.item.title, `${said(HEALTHS, b.health)} (${b.item.status})`].join('\n'),
    );
    els.set(b.id, el);
    return el;
  });
  // Then the wires, each with a wider line under it to hover, an arrow at what is called, and what it carries.
  const labels = [];
  const wireLayer = g.chains.map((c) => {
    const d = `M${c.points.map((p) => p.join(' ')).join('L')}`;
    const path = svg('path', { d, class: `ar-wire ${c.state}` });
    // A wire drawn turned back (a loop) has its arrow at its start, pointing up at what is called.
    const [ex, ey] = c.back ? c.points[0] : c.points.at(-1);
    const head = svg('path', { d: c.back ? `M${ex} ${ey}L${ex - 4.5} ${ey + 9}L${ex + 4.5} ${ey + 9}Z` : `M${ex} ${ey}L${ex - 4.5} ${ey - 9}L${ex + 4.5} ${ey - 9}Z`, class: `ar-head ${c.state}` });
    const [from, to] = c.back ? [c.b, c.a] : [c.a, c.b];
    const hit = titled(svg('path', { d, class: 'ar-hit' }), [`${g.nodes.get(from).item.title} → ${g.nodes.get(to).item.title}`, c.says, said(WIRES, c.state)].filter(Boolean).join('\n'));
    hit.addEventListener('mouseenter', () => [path, head].forEach((el) => el.classList.add('lit')));
    hit.addEventListener('mouseleave', () => light(null));
    wires.set(c, [path, head]);
    if (c.says) labels.push({ c, text: fit(c.says, z('says_most'), SAYS_TEXT) });
    return [path, head, hit];
  });
  // What a wire carries is written on it where there is room: on its drop into what it calls when nothing else
  // drops there, else on its drop from the caller, else on its run across; otherwise only in its tooltip.
  const once = (list, v) => list.filter((p) => p === v).length === 1;
  const heads = g.chains.map((c) => c.points.at(-1)[0]), feet = g.chains.map((c) => c.points[0][0]);
  // A place's name is never written over.
  const placed = g.boxes.map((b) => [b.x + Math.min(b.w, measure(b.item.title, PLACE_TEXT) + z('place_name_room')) / 2, b.y + z('place_name_inset') + z('place_name_height') / 2, Math.min(b.w, measure(b.item.title, PLACE_TEXT) + z('place_name_room'))]);
  const labelLayer = labels.flatMap(({ c, text }) => {
    const w = measure(text, SAYS_TEXT) + 2 * z('says_pad'), p = c.points;
    const spots = [once(heads, p.at(-1)[0]) && [p.at(-1)[0], (p.at(-2)[1] + p.at(-1)[1]) / 2], once(feet, p[0][0]) && [p[0][0], (p[0][1] + p[1][1]) / 2], Math.abs(p[2][0] - p[1][0]) > w + 16 && [(p[1][0] + p[2][0]) / 2, p[1][1]]].filter(Boolean);
    const spot = spots.find(([lx, ly]) => !placed.some(([px, py, pw]) => Math.abs(px - lx) < (pw + w) / 2 + 4 && Math.abs(py - ly) < 16));
    if (!spot) return [];
    placed.push([...spot, w]);
    const [lx, ly] = spot;
    return [svg('g', { class: `ar-says ${c.state}` }, svg('rect', { x: lx - w / 2, y: ly - z('says_height') / 2, width: w, height: z('says_height'), rx: z('says_height') / 2 }), svg('text', { x: lx, y: ly }, text))];
  });
  const breakLayer = g.breaks.map(([bx, by]) => svg('g', { class: 'ar-break' }, svg('rect', { x: bx - 3, y: by - 8, width: 6, height: 16 }), svg('path', { d: `M${bx - 6} ${by}H${bx + 6}` })));
  // Last, the parts over all of it.
  const partLayer = parts.map((n) => {
    const X = g.x.get(n.id), Y = g.y.get(n.id), i = n.item;
    const left = n.shape === 'diamond' ? X - n.w / 2 + z('diamond_pad') / 2 : X - n.w / 2 + z('text_x');
    const room = n.shape === 'diamond' ? n.w - z('diamond_pad') : n.w - z('text_x') - z('text_after');
    const cls = ['ar-part', n.health, yours(i) && 'you', i.id === style.here && 'here'].filter(Boolean).join(' ');
    const el = titled(
      svg(
        'a',
        { href: `#/e/${i.id}`, class: cls },
        outline(n.shape, X, Y, n.w, n.h, CORNER, LID),
        svg('circle', { cx: left - z('dot_gap'), cy: Y + (n.shape === 'store' ? LID / 2 : 0), r: z('dot'), class: `ar-dot ${n.health}` }),
        svg('text', { x: left, y: Y + (n.shape === 'store' ? LID / 2 : 0) }, fit(i.title, room, TEXT)),
        n.notes && svg('g', { class: `ar-badge${n.notes.some(yours) ? ' you' : ''}` }, svg('circle', { cx: X + n.w / 2 - z('badge_in'), cy: Y - n.h / 2, r: z('badge') }), svg('text', { x: X + n.w / 2 - z('badge_in'), y: Y - n.h / 2 }, String(n.notes.length))),
      ),
      words(n),
    );
    el.addEventListener('mouseenter', () => light(i.id));
    el.addEventListener('mouseleave', () => light(null));
    els.set(i.id, el);
    return el;
  });
  const picture = svg('svg', { viewBox: `0 0 ${g.width} ${g.height}`, role: 'img', 'aria-label': `A system of ${parts.length} parts in ${g.boxes.length} places` }, boxLayer, wireLayer, breakLayer, labelLayer, nameLayer, partLayer);

  // The key: only the marks this picture uses, one to a line.
  const mark = (inner, label) => h('span', {}, svg('svg', { width: 22, height: 14, viewBox: '0 0 22 14' }, inner), label);
  const healths = new Set([...parts, ...g.boxes].map((n) => n.health)), states = new Set(g.chains.map((c) => c.state));
  const legend = h(
    'div',
    { class: 'lf-legend ar-legend' },
    [['box', 'Part'], ['store', 'Store'], ['pill', 'Client'], ['diamond', 'Question']].filter(([shape]) => parts.some((n) => n.shape === shape)).map(([shape, label]) => mark(svg('g', { class: 'ar-part' }, outline(shape, 11, 7, 20, shape === 'diamond' ? 12 : 13, CORNER, 3)), label)),
    g.boxes.length > 0 && mark(svg('rect', { x: 1, y: 1, width: 20, height: 12, rx: 3, class: 'ar-place-box' }), 'Where it runs'),
    HEALTHS.filter(([k]) => healths.has(k)).map(([k, label]) => mark(svg('circle', { cx: 11, cy: 7, r: 4, class: `ar-dot ${k}` }), label)),
    WIRES.filter(([k]) => states.has(k)).map(([k, label]) => mark(svg('path', { d: 'M1 7H21', class: `ar-wire ${k}` }), label)),
    g.breaks.length > 0 && mark(svg('path', { d: 'M1 7H21M11 0V4M11 10V14', class: 'ar-wire wired' }), 'Passes under'),
  );

  // The bar: how many parts are in each health, and how many wires are wired, as marks to be read at a glance.
  const count = (k) => parts.filter((n) => n.health === k).length;
  // A wire to a part on standby is neither owed nor wired: it is left out of the count.
  const running = g.chains.filter((c) => c.state !== 'standby');
  const tally = h(
    'span',
    { class: 'ar-tally' },
    HEALTHS.filter(([k]) => count(k)).map(([k, label]) => h('span', { class: `pill ${PILL[k]}`, title: `${label}: ${parts.filter((n) => n.health === k).map((n) => n.item.title).join(', ')}` }, `${count(k)} ${label.toLowerCase()}`)),
    running.length > 0 && h('span', { class: `pill ${running.some((c) => c.state === 'broken') ? 'bad' : running.every((c) => c.state === 'wired') ? 'ok' : 'closed'}`, title: WIRES.map(([k, label]) => `${label}: ${g.chains.filter((c) => c.state === k).length}`).join('\n') }, `${running.filter((c) => c.state === 'wired').length} of ${running.length} wired`),
  );

  const redraw = () => {
    for (const [id, el] of els) byId.has(id) && el.classList.toggle('dim', !litCount(byId.get(id), style));
  };
  const lit = litSwitch(me, style, keep, redraw);
  const stage = h('div', { class: 'lf-stage', title: 'Scroll to zoom, drag to move' }, picture, legend);
  host.replaceChildren(stage);
  const start = g.nodes.has(style.here) ? style.here : undefined;
  legend.hidden = stage.clientWidth > 0 && stage.clientWidth < sizeOf(style, 'flow_legend_from');
  const moves = panZoom(stage, picture, { width: g.width, height: g.height, start: start ? [g.x.get(start), g.y.get(start)] : undefined, aside: legend.hidden ? 0 : legend.offsetWidth + sizeOf(style, 'flow_legend_room') });
  const key = h('button', { class: legend.hidden ? '' : 'on', title: 'What the marks mean', onclick: (ev) => ((legend.hidden = !legend.hidden), ev.currentTarget.classList.toggle('on', !legend.hidden)) }, 'Key');
  const zoom = h(
    'span',
    { class: 'switch' },
    h('button', { title: 'Zoom out', onclick: () => moves.zoomBy(1 / numberOf(style, 'zoom_step')) }, '−'),
    h('button', { title: 'All of it in sight', onclick: () => moves.fit() }, 'Fit'),
    h('button', { title: 'Zoom in', onclick: () => moves.zoomBy(numberOf(style, 'zoom_step')) }, '+'),
  );
  host.prepend(h('div', { class: 'toolbar fold-bar' }, tally, h('span', { class: 'grow' }), lit, key, zoom));
  host.redraw = redraw;
  redraw();
}
