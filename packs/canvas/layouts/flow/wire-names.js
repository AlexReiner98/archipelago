// Link names ride on the wires and give way (round 6, pass 14; Alex, 19 Nov 2026: "ink colour", the labels "onto the wires with
// some rules like how the reflex pack works so they fade away whenever they obstruct something"). Each wire carries its link
// type's name along its longest straight run, in ink on a small knock-out of the land, at one size on the screen. The names are
// laid out in order of importance (a lit wire's, then the order's, then the rest, the longer first); a name whose box, padded,
// would meet one already shown, a board or its plate, or a wire that is not its own, gives way: it fades out and its words are
// in the wire's tooltip. Room is judged at the page's zoom (`f`, the picture's units a screen unit takes), so zoomed in more
// names return. A lit wire always shows its name. The convex overlap test is the reflex tree's (packs/reflex_view/layouts/tree/
// names.js), brought here because a layout may import nothing across packs.
// Layer: marks. Pure: wires and boxes in, which names show and their marks out.

/** Whether two convex shapes (lists of corners) overlap: no axis of either's edges parts them. */
export const overlap = (a, b) => {
  for (const shape of [a, b])
    for (let i = 0; i < shape.length; i++) {
      const [x1, y1] = shape[i], [x2, y2] = shape[(i + 1) % shape.length], nx = y2 - y1, ny = x1 - x2;
      const pa = a.map(([x, y]) => x * nx + y * ny), pb = b.map(([x, y]) => x * nx + y * ny);
      if (Math.max(...pa) <= Math.min(...pb) || Math.max(...pb) <= Math.min(...pa)) return false;
    }
  return true;
};

/** A link type as a wire says it: its name without its pack, in lower case words ("depends_on" is "depends on"). */
export const nameOf = (type) => String(type).split('.').pop().replaceAll('_', ' ');

/** The longest straight run of a wire's points: its middle, its angle (degrees, turned to read left to right) and its length. */
export function longestRun(points) {
  let best = null;
  for (let i = 1; i < points.length; i++) {
    const [x1, y1] = points[i - 1], [x2, y2] = points[i], len = Math.hypot(x2 - x1, y2 - y1);
    if (!best || len > best.len) best = { x: (x1 + x2) / 2, y: (y1 + y2) / 2, len, angle: Math.atan2(y2 - y1, x2 - x1) };
  }
  if (!best) return null;
  // Read left to right, or upward: never upside down.
  if (best.angle > Math.PI / 2) best.angle -= Math.PI;
  else if (best.angle <= -Math.PI / 2) best.angle += Math.PI;
  return { x: best.x, y: best.y, len: best.len, turn: (best.angle * 180) / Math.PI };
}

/** The corners of a name's box, `w` by `h` at the run's middle, turned along it, padded by `pad` on every side. */
export function boxOf(run, w, h, pad = 0) {
  const a = (run.turn * Math.PI) / 180, c = Math.cos(a), s = Math.sin(a), hw = w / 2 + pad, hh = h / 2 + pad;
  return [[-hw, -hh], [hw, -hh], [hw, hh], [-hw, hh]].map(([x, y]) => [run.x + x * c - y * s, run.y + x * s + y * c]);
}

/**
 * Which names show at `f`. `wires` are { id, points, order, lit?, text }; `boxes` the boards (and their plates) as corner lists;
 * `width(text)` how wide a name is at one screen unit of size and `height` how tall; `pad` the room kept round a name, in
 * screen units. Answers the set of wire ids whose names show, and each shown name's run. The most important first: a lit
 * wire, then an order wire, then the rest, the longer first; a lit wire's name shows whatever.
 */
export function namesShown({ wires, boxes, width, height, pad, f }) {
  const runs = new Map(wires.map((w) => [w.id, longestRun(w.points)]));
  const asked = wires.filter((w) => runs.get(w.id)).sort((a, b) => Number(Boolean(b.lit)) - Number(Boolean(a.lit)) || Number(Boolean(b.order)) - Number(Boolean(a.order)) || runs.get(b.id).len - runs.get(a.id).len || (a.id < b.id ? -1 : 1));
  const segs = wires.map((w) => ({ id: w.id, segs: w.points.slice(1).map((p, k) => [w.points[k], p]) }));
  const shown = new Set(), kept = [];
  for (const w of asked) {
    const run = runs.get(w.id), box = boxOf(run, width(w.text) * f, height * f, pad * f);
    if (w.lit) { shown.add(w.id); kept.push(box); continue; }
    // It must lie along its run, and meet no name shown, no board, no wire that is not its own.
    if (run.len < width(w.text) * f + 2 * pad * f) continue;
    if (kept.some((other) => overlap(box, other)) || boxes.some((other) => overlap(box, other))) continue;
    if (segs.some((s) => s.id !== w.id && s.segs.some((seg) => overlap(seg, box)))) continue;
    kept.push(box);
    shown.add(w.id);
  }
  return { shown, runs };
}

/** A name's transform at `f`: at its run's middle, turned along it, scaled to one size on the screen. */
export const nameTransform = (run, f) => `translate(${+run.x.toFixed(2)} ${+run.y.toFixed(2)}) rotate(${+run.turn.toFixed(2)}) scale(${Math.round(f * 1000) / 1000})`;

/** The css of the names and of ink wires: the theme's ink at a quiet strength, colour only where a wire is lit, held or waits on you. */
export const wireRules = (style) => [
  style.ink_wires === true && `.lf-wire, .lf-tie { stroke: color-mix(in srgb, var(--ln-text) var(--ln-flow-wire-ink), transparent); } .lf-head { fill: color-mix(in srgb, var(--ln-text) var(--ln-flow-wire-ink), transparent); }
.lf-wire.lit, .lf-tie.lit { stroke: var(--ln-accent, var(--ln-text)); } .lf-head.lit { fill: var(--ln-accent, var(--ln-text)); }
.lf-wire.held, .lf-tie.held { stroke: var(--ln-you); } .lf-head.held { fill: var(--ln-you); } .lf-tie.you { stroke: var(--ln-you); } .lf-head.you { fill: var(--ln-you); }`,
  style.wire_names === true && `.lf-wn { pointer-events: none; transition: opacity 0.25s; } .lf-wn rect { fill: var(--ln-sea); stroke: none; }
.lf-wn text { fill: var(--ln-text); font-size: var(--ln-flow-wire-name-text); font-family: var(--ln-font); text-anchor: middle; dominant-baseline: central; }
.lf-wn.lf-wn-quiet { opacity: 0; } .lf-wn.lf-wn-quiet.lf-wn-force { opacity: 1; }
.lf-hit { fill: none; stroke: transparent; stroke-width: var(--ln-flow-wire-hit); pointer-events: stroke; }`,
].filter(Boolean).join('\n');

/**
 * The names of a picture's wires: `wired` its chains then its ties (`C` of them chains), each with its points and type; `boxes`
 * its boards as corner lists; `z` the style's sizes and `measure` a text's width. Answers null where the style asks for none,
 * else the `layer` of names (each keyed `wn:<j>`), `viewport(view)` (the patches that lay them out again when the zoom has
 * changed enough), `force(on)` (a lit wire's name shows whatever) and the `text` of each wire's tooltip.
 */
export function wireNames({ style, wired, C, boxes, z, measure, m, order }) {
  if (style.wire_names !== true) return null;
  const px = z('wire_name_text'), height = px * z('wire_name_leading'), pad = z('wire_name_pad'), knock = z('wire_name_knock');
  const items = wired.map((w, j) => ({ id: j, points: w.points, order: j < C, text: nameOf(w.type ?? order) }));
  const width = (text) => measure(text, px);
  let scaleAt = 1, now = namesShown({ wires: items, boxes, width, height, pad, f: 1 });
  const layer = items.flatMap((it) => {
    const run = now.runs.get(it.id);
    if (!run) return [];
    const w = width(it.text);
    return [m('g', { key: `wn:${it.id}`, class: `lf-wn${now.shown.has(it.id) ? '' : ' lf-wn-quiet'}`, transform: nameTransform(run, 1) }, m('rect', { x: -w / 2 - knock, y: -height / 2, width: w + 2 * knock, height }), m('text', { x: 0, y: 0 }, it.text))];
  });
  return {
    layer,
    text: (j) => items[j].text,
    /** A hit area for each wire, hovered to light it and show its name: invisible, `flow_wire_hit` wide, drawn under the boards. */
    hits: (line) => wired.map((w, j) => m('path', { key: `wh:${j}`, d: line(w), class: 'lf-hit', on: ['enter', 'leave'] })),
    viewport(view) {
      const f = 1 / Math.max(z('wire_name_zoom_least'), Number(view?.scale) || 1);
      if (Math.abs(Math.log(f / scaleAt)) < Math.log(z('wire_name_rescale'))) return [];
      scaleAt = f;
      now = namesShown({ wires: items, boxes, width, height, pad, f });
      return items.filter((it) => now.runs.has(it.id)).flatMap((it) => [{ key: `wn:${it.id}`, set: { transform: nameTransform(now.runs.get(it.id), f) } }, { key: `wn:${it.id}`, toggle: { 'lf-wn-quiet': !now.shown.has(it.id) } }]);
    },
    force: (on) => items.filter((it) => now.runs.has(it.id)).map((it) => ({ key: `wn:${it.id}`, toggle: { 'lf-wn-force': on.has(it.id) } })),
  };
}
