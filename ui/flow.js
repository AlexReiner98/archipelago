// A lens answer drawn as a process map, read from the top down: every item a step (work a box, a question a diamond,
// an occurrence a pill, a record a sheet with a wavy foot), wires at right angles from what is depended on to what
// depends on it, broken where one passes under another, and what follows an open question dashed, as a scenario.
// Many plain things before one step (a release's prerequisites) are checklists, one for each type, a row each.
// The layout is ui/flow-layout.js; this draws it as SVG, so every name is in the page and every step a link. Its
// colours are the lens's (a style may set them), in ui/flow.css.

import { h } from './base.js';
import { LIST_HEAD, LIST_ROW, layout } from './flow-layout.js';
import { lensTree, litCount, litSwitch } from './lens-base.js';
import { panZoom } from './pan-zoom.js';
import { typeTitle } from './words.js';

const NS = 'http://www.w3.org/2000/svg';
const FONT = "system-ui, -apple-system, 'Segoe UI', sans-serif";
const svg = (tag, attrs = {}, ...kids) => {
  const el = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) if (v !== undefined && v !== false) el.setAttribute(k, String(v));
  el.append(...kids.flat(Infinity).filter((kid) => kid !== undefined && kid !== false && kid !== null));
  return el;
};
const titled = (el, text) => (el.prepend(svg('title', {}, text)), el);

/** A step's outline, centred on x, y. */
function outline(shape, x, y, w, hgt) {
  const l = x - w / 2, r = x + w / 2, t = y - hgt / 2, b = y + hgt / 2;
  if (shape === 'diamond') return svg('path', { d: `M${x} ${t}L${r} ${y}L${x} ${b}L${l} ${y}Z`, class: 'lf-shape' });
  if (shape === 'list') return svg('rect', { x: l, y: t, width: w, height: hgt, rx: 6, class: 'lf-shape' });
  if (shape === 'pill' || shape === 'end') return svg('rect', { x: l, y: t, width: w, height: hgt, rx: hgt / 2, class: 'lf-shape' });
  // A document: a sheet whose foot is a wave.
  if (shape === 'sheet') return svg('path', { d: `M${l} ${t}H${r}V${b - 5}C${r - w / 4} ${b - 13} ${x + w / 8} ${b + 5} ${x} ${b - 3}C${x - w / 8} ${b - 11} ${l + w / 4} ${b + 5} ${l} ${b - 3}Z`, class: 'lf-shape' });
  return svg('rect', { x: l, y: t, width: w, height: hgt, rx: Math.min(6, hgt / 5), class: 'lf-shape' });
}

/** The flow: a process map of what a lens answers with. */
export function drawFlow(host, answer, style, keep) {
  const { me, byId } = lensTree(answer);
  const ctx = document.createElement('canvas').getContext('2d');
  const measure = (text, px) => ((ctx.font = `400 ${px}px ${FONT}`), ctx.measureText(text).width);
  const fit = (text, width, px) => {
    if (measure(text, px) <= width) return text;
    let t = text;
    while (t.length > 1 && measure(`${t}…`, px) > width) t = t.slice(0, -1);
    return `${t}…`;
  };
  const root = answer.items.find((i) => i.id === answer.lens.from);
  const g = layout({ items: answer.items, links: answer.links, rootId: root?.id, measure });
  const steps = g.all.filter((n) => !n.dummy);
  if (!steps.length) return host.replaceChildren(h('div', { class: 'empty' }, 'Nothing here depends on anything.'));

  const yours = (i) => Boolean(me && i.state.waits_on.includes(me));
  const dotOf = (i) => (!i.open ? 'done' : yours(i) ? 'you' : i.state.blocked ? 'blocked' : i.state.sessions ? 'session' : '');
  const words = (n) =>
    n.stub
      ? `${n.item.title}\nA choice nothing follows yet`
      : [n.item.title, n.item.status, n.item.state.blocked && 'Blocked', yours(n.item) ? 'Waits on you' : n.item.state.waits_on.length ? 'Waits on someone' : null, g.potential.has(n.id) && 'Only if that choice is made', ...(n.notes ?? []).map((i) => `On it: ${i.title}`)].filter(Boolean).join('\n');

  const wires = new Map();
  const stepEls = new Map();
  const light = (id) => {
    for (const [c, [path, head]] of wires) for (const el of [path, head]) el.classList.toggle('lit', Boolean(id) && (c.a === id || c.b === id));
  };

  // Wires, then the breaks cut across them, then the steps over both, then what each choice is.
  const wireLayer = g.chains.map((c) => {
    const path = svg('path', { d: `M${c.points.map((p) => p.join(' ')).join('L')}`, class: `lf-wire${c.dashed ? ' dashed' : ''}` });
    const [ex, ey] = c.points.at(-1);
    const head = svg('path', { d: `M${ex} ${ey}L${ex - 4.5} ${ey - 9}L${ex + 4.5} ${ey - 9}Z`, class: 'lf-head' });
    wires.set(c, [path, head]);
    return [path, head];
  });
  const breakLayer = g.breaks.map(([bx, by]) => svg('g', { class: 'lf-break' }, svg('rect', { x: bx - 3, y: by - 8, width: 6, height: 16 }), svg('path', { d: `M${bx - 6} ${by}H${bx + 6}` })));
  /** A checklist: its type and how many are left over a row for each thing, each row a link to its page. */
  const checklist = (n) => {
    const X = g.x.get(n.id), Y = g.y.get(n.id), top = Y - n.h / 2, left = X - n.w / 2;
    const open = n.list.filter((i) => i.open).length;
    const rows = n.list.map((i, k) => {
      const y = top + LIST_HEAD + k * LIST_ROW + LIST_ROW / 2;
      const row = titled(svg('a', { href: `#/e/${i.id}`, class: `lf-row${i.open ? '' : ' closed'}${yours(i) ? ' you' : ''}` }, svg('rect', { x: left + 2, y: y - LIST_ROW / 2, width: n.w - 4, height: LIST_ROW, class: 'lf-row-hit' }), svg('circle', { cx: left + 15, cy: y, r: 4, class: `lf-dot ${dotOf(i)}` }), svg('text', { x: left + 26, y: y + 0.5 }, fit(i.title, n.w - 36, 12))), [i.title, i.status, i.state.blocked && 'Blocked', yours(i) && 'Waits on you'].filter(Boolean).join('\n'));
      stepEls.set(i.id, row);
      return row;
    });
    const el = svg('g', { class: 'lf-step lf-list' }, outline('list', X, Y, n.w, n.h), svg('text', { x: left + 12, y: top + LIST_HEAD / 2 + 1, class: 'lf-list-head' }, `${typeTitle(n.type)} · ${open} of ${n.list.length} open`), svg('path', { d: `M${left} ${top + LIST_HEAD - 2}H${left + n.w}`, class: 'lf-list-rule' }), rows);
    el.addEventListener('mouseenter', () => light(n.id));
    el.addEventListener('mouseleave', () => light(null));
    return el;
  };
  const stepLayer = steps.map((n) => {
    if (n.shape === 'list') return checklist(n);
    const X = g.x.get(n.id), Y = g.y.get(n.id), i = n.item;
    const left = n.shape === 'diamond' ? X - n.w / 2 + 48 : X - n.w / 2 + (n.stub ? 15 : 27);
    const room = n.shape === 'diamond' ? n.w - 96 : n.w - (n.stub ? 30 : 38);
    const cls = ['lf-step', n.stub && 'stub', (n.stub || g.potential.has(n.id)) && 'scenario', !i.open && 'closed', !n.stub && yours(i) && 'you', i.id === style.here && !n.stub && 'here'].filter(Boolean).join(' ');
    const body = [
      outline(n.shape, X, Y, n.w, n.h),
      !n.stub && svg('circle', { cx: left - 12, cy: Y, r: 4.5, class: `lf-dot ${dotOf(i)}` }),
      svg('text', { x: left, y: Y - (n.shape === 'sheet' ? 2 : 0) + 0.5 }, fit(i.title, room, n.stub ? 12 : 13)),
      // Work on it that is not a step: a count on its corner, lit when some of it waits on you.
      n.notes && svg('g', { class: `lf-badge${n.notes.some(yours) ? ' you' : ''}` }, svg('circle', { cx: X + n.w / 2 - 4, cy: Y - n.h / 2, r: 8 }), svg('text', { x: X + n.w / 2 - 4, y: Y - n.h / 2 + 0.5 }, String(n.notes.length))),
    ];
    const el = titled(n.stub ? svg('g', { class: cls }, body) : svg('a', { href: `#/e/${i.id}`, class: cls }, body), words(n));
    el.addEventListener('mouseenter', () => light(i.id));
    el.addEventListener('mouseleave', () => light(null));
    if (!n.stub) stepEls.set(n.id, el);
    return el;
  });
  // What each choice is, written once beside the question's drop, halfway to its track; a pill already says it.
  const said = new Map();
  for (const c of g.chains) if (c.says && !g.nodes.get(c.b).stub) said.set(`${c.a} ${c.says}`, c);
  const saysLayer = [...said.values()].map((c) => {
    const d = g.nodes.get(c.a), text = fit(c.says, 200, 11.5), w = measure(text, 11.5) + 14;
    const lx = g.x.get(d.id) + w / 2 + 6, ly = (g.y.get(d.id) + d.h / 2 + c.points[1][1]) / 2;
    return titled(svg('g', { class: 'lf-says' }, svg('rect', { x: lx - w / 2, y: ly - 10, width: w, height: 20, rx: 10 }), svg('text', { x: lx, y: ly + 0.5 }, text)), c.says);
  });
  const picture = svg('svg', { viewBox: `0 0 ${g.width} ${g.height}`, role: 'img', 'aria-label': `A process of ${steps.length} steps` }, wireLayer, breakLayer, stepLayer, saysLayer);

  // The legend: only the marks this picture uses, one to a line, in a card over the picture's corner.
  const mark = (inner, label) => h('span', {}, svg('svg', { width: 22, height: 14, viewBox: '0 0 22 14' }, inner), label);
  const uses = (test) => steps.some(test);
  const legend = h(
    'div',
    { class: 'lf-legend' },
    [['box', 'Work'], ['list', 'Checklist'], ['diamond', 'Question'], ['pill', 'Event'], ['sheet', 'Record'], ['end', 'Possible end']].filter(([shape]) => uses((n) => n.shape === shape)).map(([shape, label]) => mark(svg('g', { class: `lf-step${shape === 'end' ? ' scenario' : ''}` }, outline(shape, 11, 7, 20, shape === 'diamond' ? 12 : 11)), label)),
    [['done', 'Done'], ['blocked', 'Blocked'], ['you', 'Waits on you'], ['session', 'Under way'], ['', 'Not started']].filter(([dot]) => uses((n) => !n.stub && (n.list ?? [n.item]).some((i) => dotOf(i) === dot))).map(([dot, label]) => mark(svg('circle', { cx: 11, cy: 7, r: 4, class: `lf-dot ${dot}` }), label)),
    uses((n) => n.notes) && mark(svg('g', { class: 'lf-badge' }, svg('circle', { cx: 11, cy: 7, r: 6 })), 'Work on it'),
    mark(svg('path', { d: 'M1 7H21', class: 'lf-wire' }), 'Leads to'),
    g.chains.some((c) => c.dashed) && mark(svg('path', { d: 'M1 7H21', class: 'lf-wire dashed' }), 'If chosen'),
    g.breaks.length > 0 && mark(svg('path', { d: 'M1 7H21M11 0V4M11 10V14', class: 'lf-wire' }), 'Passes under'),
  );

  const redraw = () => {
    for (const [id, el] of stepEls) byId.has(id) && el.classList.toggle('dim', !litCount(byId.get(id), style));
  };
  const lit = litSwitch(me, style, keep, redraw);
  const stage = h('div', { class: 'lf-stage', title: 'Scroll to zoom, drag to move' }, picture, legend);
  host.replaceChildren(stage);
  // Opened from an item's page, the picture is brought to that item; else to where the process starts.
  const start = g.nodes.has(style.here) ? style.here : steps.find((n) => !n.stub && n.layer === 0)?.id;
  // The key is open on a wide frame and folded on a narrow one, where it would hide too much of the picture.
  legend.hidden = stage.clientWidth > 0 && stage.clientWidth < 720;
  const moves = panZoom(stage, picture, { width: g.width, height: g.height, start: start ? [g.x.get(start), g.y.get(start)] : undefined, aside: legend.hidden ? 0 : legend.offsetWidth + 20 });
  const key = h('button', { class: legend.hidden ? '' : 'on', title: 'What the marks mean', onclick: (ev) => ((legend.hidden = !legend.hidden), ev.currentTarget.classList.toggle('on', !legend.hidden)) }, 'Key');
  const zoom = h(
    'span',
    { class: 'switch' },
    h('button', { title: 'Zoom out', onclick: () => moves.zoomBy(1 / 1.25) }, '−'),
    h('button', { title: 'All of it in sight', onclick: () => moves.fit() }, 'Fit'),
    h('button', { title: 'Zoom in', onclick: () => moves.zoomBy(1.25) }, '+'),
  );
  host.prepend(h('div', { class: 'toolbar fold-bar' }, h('span', { class: 'grow' }), lit, key, zoom));
  host.redraw = redraw;
  redraw();
}
