// Outlines: the shapes a node is drawn in, each a few lines of path, so a style can make a view evocative by naming
// one per type or kind (`outlines` in a style: a type's id, its root type or its kind, to an outline's name). Each
// outline says how much room it needs around its text (`room`, as shares of its height), how much taller than a plain
// box it stands (`grow`), and draws itself into a box of any size (`draw`, from its top left). A drawing asks
// `outlineOf` which one an item is drawn in and `outline` for its marks; nothing here knows of a lens or a page.

import { m } from './marks.js';

const r1 = (n) => Math.round(n * 10) / 10;
const pts = (list) => list.map(([x, y]) => `${r1(x)},${r1(y)}`).join(' ');
const shape = (cls, d) => m('path', { d, class: cls });
const poly = (cls, list) => m('polygon', { points: pts(list), class: cls });

/** Every outline, by name: room around the text (left, right, top, bottom, as shares of the height), how tall, how drawn. */
export const OUTLINES = {
  // A plain step of work: the flow's box, its corners as round as the style says.
  box: { draw: (c, l, t, w, h, r) => [m('rect', { x: l, y: t, width: w, height: h, rx: Math.min(r, h / 5), class: c })] },
  // A softer box: a thing that holds a stream of work.
  round: { draw: (c, l, t, w, h) => [m('rect', { x: l, y: t, width: w, height: h, rx: h / 3, class: c })] },
  // An occurrence: something that happens, rounded at both ends.
  pill: { room: [0.15, 0.15], draw: (c, l, t, w, h) => [m('rect', { x: l, y: t, width: w, height: h, rx: h / 2, class: c })] },
  // A question: a diamond, as on every flow chart.
  diamond: { room: [0.75, 0.75], grow: 1.5, draw: (c, l, t, w, h) => [poly(c, [[l + w / 2, t], [l + w, t + h / 2], [l + w / 2, t + h], [l, t + h / 2]])] },
  // A document: a sheet whose foot is a wave.
  sheet: {
    grow: 1.15,
    room: [0, 0, 0, 0.12],
    draw: (c, l, t, w, h) => {
      const r = l + w, b = t + h, x = l + w / 2;
      return [shape(c, `M${r1(l)} ${r1(t)}H${r1(r)}V${r1(b - 5)}C${r1(r - w / 4)} ${r1(b - 13)} ${r1(x + w / 8)} ${r1(b + 5)} ${r1(x)} ${r1(b - 3)}C${r1(x - w / 8)} ${r1(b - 11)} ${r1(l + w / 4)} ${r1(b + 5)} ${r1(l)} ${r1(b - 3)}Z`)];
    },
  },
  // Many records: sheets stacked, the one behind showing at its corner.
  stack: {
    grow: 1.1,
    room: [0, 0.12, 0.12, 0],
    draw: (c, l, t, w, h, r) => {
      const o = h * 0.12, k = Math.min(r, h / 5);
      return [m('rect', { x: l + o, y: t, width: w - o, height: h - o, rx: k, class: `${c} behind` }), m('rect', { x: l, y: t + o, width: w - o, height: h - o, rx: k, class: c })];
    },
  },
  // A note: a sheet with its corner folded down.
  note: {
    grow: 1.1,
    room: [0, 0.2],
    draw: (c, l, t, w, h) => {
      const f = h * 0.3, r = l + w, b = t + h;
      return [shape(c, `M${r1(l)} ${r1(t)}H${r1(r - f)}L${r1(r)} ${r1(t + f)}V${r1(b)}H${r1(l)}Z`), shape(`${c} fold`, `M${r1(r - f)} ${r1(t)}V${r1(t + f)}H${r1(r)}`)];
    },
  },
  // A project: a folder, its tab up on the left.
  folder: {
    grow: 1.25,
    room: [0, 0, 0.22, 0],
    draw: (c, l, t, w, h, r) => {
      // The tab is as deep as a corner and a bit, however tall the folder: a region keeps the same tab as a node.
      const k = Math.min(h * 0.2, r * 1.2), tab = Math.min(w * 0.38, k * 8), q = Math.min(r, k), b = t + h, rt = l + w;
      return [shape(c, `M${r1(l)} ${r1(b - q)}V${r1(t + q)}Q${r1(l)} ${r1(t)} ${r1(l + q)} ${r1(t)}H${r1(l + tab)}L${r1(l + tab + k)} ${r1(t + k)}H${r1(rt - q)}Q${r1(rt)} ${r1(t + k)} ${r1(rt)} ${r1(t + k + q)}V${r1(b - q)}Q${r1(rt)} ${r1(b)} ${r1(rt - q)} ${r1(b)}H${r1(l + q)}Q${r1(l)} ${r1(b)} ${r1(l)} ${r1(b - q)}Z`)];
    },
  },
  // A place: a hexagon, a cell of ground something stands on.
  hexagon: { room: [0.3, 0.3], draw: (c, l, t, w, h) => { const i = h * 0.32; return [poly(c, [[l + i, t], [l + w - i, t], [l + w, t + h / 2], [l + w - i, t + h], [l + i, t + h], [l, t + h / 2]])]; } },
  // Something to stop at: an issue, a block.
  octagon: { room: [0.18, 0.18], draw: (c, l, t, w, h) => { const i = h * 0.3; return [poly(c, [[l + i, t], [l + w - i, t], [l + w, t + i], [l + w, t + h - i], [l + w - i, t + h], [l + i, t + h], [l, t + h - i], [l, t + i]])]; } },
  // What comes in or goes out: a parallelogram.
  slant: { room: [0.3, 0.3], draw: (c, l, t, w, h) => { const s = h * 0.32; return [poly(c, [[l + s, t], [l + w, t], [l + w - s, t + h], [l, t + h]])]; } },
  // A step forward: a release, a milestone, pointing on.
  chevron: { room: [0.3, 0.35], draw: (c, l, t, w, h) => { const a = h * 0.32; return [poly(c, [[l, t], [l + w - a, t], [l + w, t + h / 2], [l + w - a, t + h], [l, t + h], [l + a, t + h / 2]])]; } },
  // An aim: a pennant, notched at its free end.
  flag: {
    room: [0.22, 0.35],
    draw: (c, l, t, w, h) => {
      const a = h * 0.3, p = h * 0.12;
      return [poly(c, [[l + p, t], [l + w, t], [l + w - a, t + h / 2], [l + w, t + h], [l + p, t + h]]), m('path', { d: `M${r1(l + p / 2)} ${r1(t - p)}V${r1(t + h + p)}`, class: `${c} pole` })];
    },
  },
  // A label: a tag with its hole.
  tag: {
    room: [0.5, 0.1],
    draw: (c, l, t, w, h) => {
      const a = h * 0.36;
      return [poly(c, [[l + a, t], [l + w, t], [l + w, t + h], [l + a, t + h], [l, t + h / 2]]), m('circle', { cx: r1(l + a * 0.85), cy: r1(t + h / 2), r: r1(h * 0.08), class: `${c} hole` })];
    },
  },
  // A store: a cylinder, its rim drawn across the top.
  cylinder: {
    grow: 1.35,
    room: [0, 0, 0.24, 0.06],
    draw: (c, l, t, w, h) => {
      const e = h * 0.12, rx = w / 2, rt = l + w, b = t + h;
      return [shape(c, `M${r1(l)} ${r1(t + e)}A${r1(rx)} ${r1(e)} 0 0 1 ${r1(rt)} ${r1(t + e)}V${r1(b - e)}A${r1(rx)} ${r1(e)} 0 0 1 ${r1(l)} ${r1(b - e)}Z`), shape(`${c} rim`, `M${r1(l)} ${r1(t + e)}A${r1(rx)} ${r1(e)} 0 0 0 ${r1(rt)} ${r1(t + e)}`)];
    },
  },
  // A person: a rounded card with a head and shoulders at its start.
  person: {
    room: [0.62, 0.15],
    draw: (c, l, t, w, h) => {
      const cx = l + h * 0.42, hr = h * 0.15;
      return [m('rect', { x: l, y: t, width: w, height: h, rx: h / 2, class: c }), m('circle', { cx: r1(cx), cy: r1(t + h * 0.38), r: r1(hr), class: `${c} glyph` }), shape(`${c} glyph`, `M${r1(cx - hr * 1.9)} ${r1(t + h * 0.84)}Q${r1(cx)} ${r1(t + h * 0.46)} ${r1(cx + hr * 1.9)} ${r1(t + h * 0.84)}`)];
    },
  },
  // An agent, or anything that is one whole: an ellipse.
  circle: { room: [0.3, 0.3], grow: 1.2, draw: (c, l, t, w, h) => [m('ellipse', { cx: r1(l + w / 2), cy: r1(t + h / 2), rx: r1(w / 2), ry: r1(h / 2), class: c })] },
  // What is outside: a cloud.
  cloud: {
    grow: 1.45,
    room: [0.2, 0.2, 0.2, 0.04],
    draw: (c, l, t, w, h) => {
      const q = h * 0.32, b = t + h, n = Math.max(2, Math.round((w - 2 * q) / (q * 1.7))), step = (w - 2 * q) / n;
      let d = `M${r1(l + q)} ${r1(b)}H${r1(l + w - q)}A${r1(q)} ${r1(q)} 0 0 0 ${r1(l + w - q * 0.6)} ${r1(t + h * 0.42)}`;
      for (let i = n - 1; i >= 0; i--) d += `A${r1(step * 0.62)} ${r1(q)} 0 0 0 ${r1(l + q + step * i)} ${r1(t + h * (i % 2 ? 0.3 : 0.24))}`;
      return [shape(c, `${d}A${r1(q)} ${r1(q)} 0 0 0 ${r1(l + q)} ${r1(b)}Z`)];
    },
  },
  // A rule, a guard: a shield, its text in its upper part.
  shield: {
    grow: 1.3,
    room: [0.12, 0.12, 0, 0.3],
    draw: (c, l, t, w, h) => {
      const rt = l + w, b = t + h, x = l + w / 2;
      return [shape(c, `M${r1(l)} ${r1(t)}H${r1(rt)}V${r1(t + h * 0.42)}Q${r1(rt)} ${r1(b - h * 0.08)} ${r1(x)} ${r1(b)}Q${r1(l)} ${r1(b - h * 0.08)} ${r1(l)} ${r1(t + h * 0.42)}Z`)];
    },
  },
};

/** The outlines a region (a thing drawn holding others) can be drawn in: those whose inside is all room. */
export const REGIONS = ['box', 'round', 'folder', 'note', 'stack'];

/** The outline an item is drawn in: what the style names for its type, then its root type, then its kind; else a box. */
export function outlineOf(item, outlines) {
  const map = outlines && typeof outlines === 'object' ? outlines : {};
  for (const key of [item.type, item.root, item.kind]) if (typeof key === 'string' && OUTLINES[map[key]]) return map[key];
  return 'box';
}

/** The room an outline needs around its text, in pixels, for a box this tall; and how tall it stands, from a box's height. */
export function roomOf(name, height) {
  const o = OUTLINES[name] ?? OUTLINES.box, h = height * (o.grow ?? 1);
  const [left = 0, right = 0, top = 0, bottom = 0] = o.room ?? [];
  return { h, left: left * h, right: right * h, top: top * h, bottom: bottom * h };
}

/** An outline's marks in the box l, t, w, h, its corners as round as r, each with class cls. */
export const outline = (name, l, t, w, h, r, cls) => (OUTLINES[name] ?? OUTLINES.box).draw(cls, l, t, w, h, r);
