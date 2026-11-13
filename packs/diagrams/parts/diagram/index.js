// A diagram made from the code, as the diagrams pack's part (piece.diagram): the boxes an item keeps in props.diagram,
// where they sit on the page, the areas they sit in and the wires between them, answered as a paint surface the host
// pans and zooms, with its zoom buttons. The part only says what each line and word is; how it looks is the workspace's style.

/** How each kind of box is drawn on the plane: an area and a box filled from the style (a box over the wires), a strong one solid. */
const LOOK = { area: 'area', box: 'box', strong: 'strong' };
/** A box's words, a step on the style's scale: an area's heading a step over a box's, a wire's label a step under. */
const SIZE = { area: 4, box: 3, text: 3, wire: 2 };
/** How far below its middle a line of words sits, in the plane's units, so the words stand centred on it. */
const BASELINE = 4;
/** The height of a line of words and the length of a wire's arrowhead, in the plane's units. */
const LINE = 15;
const ARROW = 7;

const n = (v) => Math.round(v * 10) / 10;

/** Where the line from a box's middle towards a point leaves the box. */
export function edge(b, [tx, ty]) {
  const [cx, cy] = [b.x + b.w / 2, b.y + b.h / 2];
  const [dx, dy] = [tx - cx, ty - cy];
  if (!dx && !dy) return [cx, cy];
  const t = Math.min(dx ? b.w / 2 / Math.abs(dx) : Infinity, dy ? b.h / 2 / Math.abs(dy) : Infinity);
  return [cx + dx * t, cy + dy * t];
}

/** A box's outline: square for an area, its corners rounded for a box. */
function outline(b) {
  const r = b.kind === 'area' ? 0 : Math.min(6, b.w / 2, b.h / 2);
  if (!r) return `M${n(b.x)} ${n(b.y)}h${n(b.w)}v${n(b.h)}h${n(-b.w)}Z`;
  const [w, h] = [b.w - 2 * r, b.h - 2 * r];
  return `M${n(b.x + r)} ${n(b.y)}h${n(w)}a${r} ${r} 0 0 1 ${r} ${r}v${n(h)}a${r} ${r} 0 0 1 ${-r} ${r}h${n(-w)}a${r} ${r} 0 0 1 ${-r} ${-r}v${n(-h)}a${r} ${r} 0 0 1 ${r} ${-r}Z`;
}

const strong = (b) => b.kind === 'box' && b.tone === 'strong';

/** The words of a box, one line under another, from its middle (an area's, along its heading). */
function words(b) {
  const left = b.kind === 'area' || b.kind === 'text';
  const x = left ? b.x + 8 : b.x + b.w / 2;
  const y = b.kind === 'area' ? b.y + (b.head ?? 0) / 2 : b.y + b.h / 2;
  const lines = (b.kind === 'area' ? (b.lines ?? []).slice(0, 1) : b.lines ?? []).map(String);
  return lines.map((line, i) => [
    'text',
    { x: n(x), y: n(y + (i - (lines.length - 1) / 2) * LINE + BASELINE), anchor: left ? 'start' : 'middle', size: SIZE[b.kind] ?? SIZE.box, ...(b.bold && { bold: true }), ...(strong(b) && { tone: 'closed' }) },
    line,
  ]);
}

/** A box: its outline, then its words over it. */
function shape(b) {
  if (b.kind === 'text') return words(b);
  const look = strong(b) ? LOOK.strong : b.dashed ? 'dash' : LOOK[b.kind] ?? LOOK.box;
  const tone = b.tone === 'warn' ? 'warn' : undefined;
  const link = web(b.link);
  return [['path', { d: outline(b), look, ...(tone && { tone }), ...(typeof b.tooltip === 'string' && b.tooltip && { tip: b.tooltip.slice(0, 200) }), ...(link && { href: link }) }], ...words(b)];
}

/** A wire between two boxes: a line from edge to edge, an arrowhead at its end, and its label at its middle. */
function wire(w, byId) {
  const [a, b] = [byId.get(w.from), byId.get(w.to)];
  if (!a || !b) return [];
  const [x1, y1] = edge(a, [b.x + b.w / 2, b.y + b.h / 2]);
  const [x2, y2] = edge(b, [a.x + a.w / 2, a.y + a.h / 2]);
  const len = Math.hypot(x2 - x1, y2 - y1) || 1;
  const [ux, uy] = [(x2 - x1) / len, (y2 - y1) / len];
  const [bx, by] = [x2 - ux * ARROW, y2 - uy * ARROW];
  const [px, py] = [(-uy * ARROW) / 2, (ux * ARROW) / 2];
  const tone = w.faint ? 'closed' : 'muted';
  return [
    ['path', { d: `M${n(x1)} ${n(y1)}L${n(bx)} ${n(by)}`, tone, ...(w.dashed && { look: 'dash' }), tip: `${a.lines?.[0] ?? a.id} → ${b.lines?.[0] ?? b.id}${w.label ? `: ${w.label}` : ''}`.slice(0, 200) }],
    ['path', { d: `M${n(x2)} ${n(y2)}L${n(bx + px)} ${n(by + py)}L${n(bx - px)} ${n(by - py)}Z`, look: 'fill', tone }],
    ...(w.label ? [['text', { x: n((x1 + x2) / 2), y: n((y1 + y2) / 2 + BASELINE), anchor: 'middle', size: SIZE.wire, tone: 'muted' }, String(w.label)]] : []),
  ];
}

/** An address on the web the diagram's file is at, or nothing. */
const web = (v) => (typeof v === 'string' && /^https?:\/\/[^\s"'<>\\]+$/i.test(v) ? v : undefined);

/** The marks for a diagram: a line of what it holds and its file over the picture, or a word that it is not made yet. */
export function diagramMarks(data) {
  if (!data?.boxes?.length || !(data.width > 0) || !(data.height > 0)) return ['text', { look: 'muted' }, 'Nothing drawn yet: the diagram is made on the next push.'];
  const byId = new Map(data.boxes.map((b) => [b.id, b]));
  const areas = data.boxes.filter((b) => b.kind === 'area');
  const boxes = data.boxes.filter((b) => b.kind !== 'area');
  const wires = data.wires ?? [];
  const file = web(data.drawio);
  const head = [
    'box',
    { flow: 'row', gap: 4, align: 'between' },
    ['text', { look: 'muted' }, `${boxes.length} boxes, ${wires.length} wires`],
    ...(file ? [['text', { look: 'mark', href: file, tip: 'The draw.io file it was drawn from, at its commit' }, '.drawio']] : []),
  ];
  // Areas first, then the wires, then the boxes over them.
  const plane = ['paint', { width: data.width, height: data.height, controls: true, tip: 'Scroll to zoom, drag to move' }, ...areas.flatMap(shape), ...wires.flatMap((w) => wire(w, byId)), ...boxes.flatMap(shape)];
  return ['box', { gap: 3 }, head, plane];
}

export default function diagram(input) {
  return { marks: diagramMarks(input?.item?.diagram), update: (next) => diagramMarks(next?.item?.diagram) };
}
