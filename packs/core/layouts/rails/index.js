// Rails: a view's items as a map walked in the view's order (decision e_btxq2nzq, the site that opens as a read-only
// map). Each item a stop, its name in a box with its number in the walk; the rail runs from stop to stop at right
// angles, left to right along a row and back along the next; every other link a quiet wire with its head where it
// points, in a lane of its own. Besides its marks the scene carries `stops` (each item's id, title, first paragraph,
// and the camera on it: centre x, y, the width of picture it frames `span`, and `zoom`, how much nearer than the
// whole) and `whole`, the camera on everything: what a page that walks the picture as it is scrolled reads
// (packs/reader/public/rails.js). Layer: marks. Its layout is ./layout.js; its look ./look.js, every length a size on
// the style (rails_*), every count a number (rails_columns, rails_lines_most).

import { layout } from './layout.js';
import { css } from './look.js';
import { m, titled } from './marks.js';

/** A link type as the key says it: its name without its pack, in words. */
const linkName = (type) => {
  const words = String(type).split('.').pop().replaceAll('_', ' ');
  return words.charAt(0).toUpperCase() + words.slice(1);
};

const pathOf = (points) => points.map(([x, y], k) => `${k ? 'L' : 'M'}${x} ${y}`).join('');

/** A head at a line's last point, along its last stretch. */
function headOf(points, sizes) {
  const [p, q] = points.slice(-2), len = Math.hypot(q[0] - p[0], q[1] - p[1]) || 1;
  const [dx, dy] = [(q[0] - p[0]) / len, (q[1] - p[1]) / len], L = sizes.rails_head_length, H = sizes.rails_head_half;
  const bx = q[0] - dx * L, by = q[1] - dy * L;
  return `M${q[0]} ${q[1]}L${bx - dy * H} ${by + dx * H}L${bx + dy * H} ${by - dx * H}Z`;
}

/** The marks of a model, and its key. */
export function marksOf(g, sizes, relations = {}) {
  const pad = sizes.rails_box_pad, line = sizes.rails_line;
  const wires = g.wires.map((w) => m('g', { key: `wire:${w.id}`, class: `rl-wire t-${String(w.type).replace(/[^\w-]/g, '_')}` },
    titled(m('path', { d: pathOf(w.points), class: 'rl-line' }), linkName(relations[w.type] ?? w.type)),
    m('path', { d: headOf(w.points, sizes), class: 'rl-head' })));
  const rails = g.rails.map((r, k) => m('g', { key: `rail:${k}`, class: r.link ? 'rl-rail carries' : 'rl-rail' },
    m('path', { d: pathOf(r.points), class: 'rl-track' }),
    r.link && m('path', { d: headOf(r.points, sizes), class: 'rl-head' })));
  const boxes = [...g.boxes.values()].map((b) => {
    const l = b.x - b.w / 2, t = b.y - b.h / 2, first = b.y - ((b.lines.length - 1) * line) / 2;
    return titled(m('a', { key: `stop:${b.id}`, item: b.id, href: `#/e/${b.id}`, class: 'rl-stop' },
      m('rect', { x: l, y: t, width: b.w, height: b.h, rx: sizes.rails_corner, class: 'rl-box' }),
      b.lines.map((text, k) => m('text', { x: l + pad, y: first + k * line, class: 'rl-name' }, text)),
      m('circle', { cx: l, cy: t, r: sizes.rails_badge, class: 'rl-badge' }),
      m('text', { x: l, y: t, class: 'rl-number', 'text-anchor': 'middle' }, String(b.n))), b.item.title);
  });
  const svg = m('svg', { key: 'rails', viewBox: `0 0 ${g.size.width} ${g.size.height}`, role: 'img', 'aria-label': `A walk through ${g.boxes.size} stops` },
    m('g', { class: 'rl-wires' }, wires), m('g', { class: 'rl-rails' }, rails), m('g', { class: 'rl-stops' }, boxes));
  const KW = sizes.flow_key_width, KH = sizes.flow_key_height;
  const glyph = (inner) => m('svg', { width: KW, height: KH, viewBox: `0 0 ${KW} ${KH}` }, inner);
  const types = [...new Set([...g.wires.map((w) => w.type), ...g.rails.filter((r) => r.link).map((r) => r.link.type)])];
  const key = [
    { glyph: glyph(m('rect', { x: 1, y: 1, width: KW - 2, height: KH - 2, rx: sizes.rails_corner / 2, class: 'rl-box' })), label: 'A stop' },
    ...(g.rails.length ? [{ glyph: glyph(m('path', { d: `M0 ${KH / 2}H${KW}`, class: 'rl-track' })), label: 'The walk' }] : []),
    ...types.map((t) => ({ glyph: glyph(m('path', { d: `M0 ${KH / 2}H${KW}`, class: 'rl-line' })), label: linkName(relations[t] ?? t) })),
  ];
  return { svg, key };
}

/** The picture: what the page gives every drawing in; the scene, with its stops, out. */
export function picture({ answer, style, relations }, { measure }) {
  const items = answer?.items ?? [], links = answer?.links ?? [];
  if (!items.length) return { scene: { message: 'Nothing here yet.' } };
  const sizes = style.sizes ?? {}, numbers = style.numbers ?? {};
  const g = layout({ items, links, measure: (text, px) => measure(text, px, style.font), sizes, numbers });
  const { svg, key } = marksOf(g, sizes, relations);
  const first = g.stops[0];
  return {
    scene: { svg, key, css, size: g.size, start: [first.x, first.y], stops: g.stops, whole: g.whole },
    end() {},
  };
}
