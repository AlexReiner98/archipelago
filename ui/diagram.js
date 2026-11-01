// A diagram made from the code, drawn on its item's page from the data the item keeps (props.diagram: boxes where
// they sit on the page, the areas they sit in, and the wires between them), in the frame the other pictures move in.
// How it looks is the workspace's style, as every lens's is (ui/diagram.css reads it): the data says only what each
// box is.

import { h, state } from './base.js';
import { dress, numberOf } from './query-base.js';
import { panZoom } from './pan-zoom.js';

const NS = 'http://www.w3.org/2000/svg';
const svg = (tag, attrs = {}, ...kids) => {
  const el = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) if (v !== undefined && v !== false) el.setAttribute(k, String(v));
  el.append(...kids.flat(Infinity).filter((kid) => kid !== undefined && kid !== false && kid !== null));
  return el;
};

/** Where the line from a box's middle towards a point leaves the box. */
function edge(b, [tx, ty]) {
  const [cx, cy] = [b.x + b.w / 2, b.y + b.h / 2];
  const [dx, dy] = [tx - cx, ty - cy];
  if (!dx && !dy) return [cx, cy];
  const t = Math.min(dx ? b.w / 2 / Math.abs(dx) : Infinity, dy ? b.h / 2 / Math.abs(dy) : Infinity);
  return [cx + dx * t, cy + dy * t];
}

/** The words of a box, one line under another, from its middle (an area's, along its heading). */
function label(b) {
  const left = b.kind === 'area' || b.kind === 'text';
  const x = left ? b.x + 8 : b.x + b.w / 2;
  // An area's words sit in its heading; a box's are centred in it, the lines spaced by a line and a quarter.
  const y = b.kind === 'area' ? b.y + (b.head ?? 0) / 2 : b.y + b.h / 2;
  const lines = b.kind === 'area' ? b.lines.slice(0, 1) : b.lines;
  return svg(
    'text',
    { x, y, class: `dg-words${left ? ' left' : ''}${b.bold ? ' bold' : ''}` },
    lines.map((line, i) => svg('tspan', { x, dy: `${i ? 1.25 : (-(lines.length - 1) * 1.25) / 2}em` }, line)),
  );
}

/** One diagram page, drawn: areas first, then the wires, then the boxes over them. */
export function drawDiagram(host, data, { download } = {}) {
  if (!data?.boxes?.length) return host.replaceChildren(h('div', { class: 'empty' }, 'Nothing drawn yet: the diagram is made on the next push.'));
  const byId = new Map(data.boxes.map((b) => [b.id, b]));
  const areas = data.boxes.filter((b) => b.kind === 'area');
  const boxes = data.boxes.filter((b) => b.kind !== 'area');
  const marker = svg('marker', { id: `dg-arrow-${data.id}`, viewBox: '0 0 10 10', refX: 9, refY: 5, markerWidth: 7, markerHeight: 7, orient: 'auto-start-reverse' }, svg('path', { d: 'M0 0L10 5L0 10Z', class: 'dg-arrow' }));
  const wires = data.wires.flatMap((w) => {
    const [a, b] = [byId.get(w.from), byId.get(w.to)];
    if (!a || !b) return [];
    const [x1, y1] = edge(a, [b.x + b.w / 2, b.y + b.h / 2]);
    const [x2, y2] = edge(b, [a.x + a.w / 2, a.y + a.h / 2]);
    return [
      svg('g', {}, svg('title', {}, `${a.lines[0] ?? a.id} → ${b.lines[0] ?? b.id}${w.label ? `: ${w.label}` : ''}`), svg('line', { x1, y1, x2, y2, class: `dg-wire${w.dashed ? ' dashed' : ''}${w.faint ? ' faint' : ''}`, 'marker-end': `url(#dg-arrow-${data.id})` })),
      w.label && svg('text', { x: (x1 + x2) / 2, y: (y1 + y2) / 2, class: 'dg-wire-label' }, w.label),
    ];
  });
  const shape = (b) => {
    const drawn = svg('g', { class: `dg-${b.kind}${b.tone ? ` ${b.tone}` : ''}${b.dashed ? ' dashed' : ''}` }, b.tooltip && svg('title', {}, b.tooltip), b.kind !== 'text' && svg('rect', { x: b.x, y: b.y, width: b.w, height: b.h, rx: b.kind === 'area' ? 0 : 6 }), label(b));
    return b.link ? svg('a', { href: b.link, target: '_blank', rel: 'noopener' }, drawn) : drawn;
  };
  const picture = svg('svg', { viewBox: `0 0 ${data.width} ${data.height}`, role: 'img', 'aria-label': data.name }, svg('defs', {}, marker), areas.map(shape), wires, boxes.map(shape));
  const stage = h('div', { class: 'lf-stage', title: 'Scroll to zoom, drag to move' }, picture);
  host.classList.add('lens-view');
  dress(host, state.style);
  host.replaceChildren(stage);
  const moves = panZoom(stage, picture, { width: data.width, height: data.height, style: state.style });
  const zoom = h(
    'span',
    { class: 'switch plane-zoom' },
    h('button', { title: 'Zoom out', onclick: () => moves.zoomBy(1 / numberOf(state.style, 'zoom_step')) }, '−'),
    h('button', { title: 'All of it in sight', onclick: () => moves.fit() }, 'Fit'),
    h('button', { title: 'Zoom in', onclick: () => moves.zoomBy(numberOf(state.style, 'zoom_step')) }, '+'),
  );
  host.prepend(h('div', { class: 'toolbar fold-bar' }, h('span', { class: 'grow muted small' }, `${boxes.length} boxes, ${data.wires.length} wires`), download && h('a', { class: 'chip', href: download, target: '_blank', rel: 'noopener', title: 'The draw.io file it was drawn from, at its commit' }, '.drawio'), zoom));
}
