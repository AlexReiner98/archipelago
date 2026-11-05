// Each island drawn as a region round what lives on it, where a picture holds more than one (task e_auw7hb3v; settled
// e_ge3c6t4w: an island is a term of the query, its border a mark the layout draws). The region is land on the one
// plane, never a box holding boxes (depth is never drawn): each of its steps and each stretch of a wire between two of
// them taken in by a margin (flow_island_pad, flow_island_wire_pad), and the union of those drawn as one shape, its
// shore in the island's colour (the style's island_hues, else its hues), its land a tint of it, under every wire. A wire
// between two islands (a finding read across) is on neither and crosses the sea. The layout keeps two things on two
// islands a shore apart (flow_island_shore, ./solve.js), so regions do not meet. Named once, at its top left, and in the
// key. Layer: marks. Pure: the model and the answer's islands in, marks, key rows and colour rules out.

/**
 * The islands' marks for a laid-out model `g`: `layer` (drawn first, under the ties), `rows` for the key (`mark(glyph,
 * label)` makes one), and the colour `rules` they read; `isHex` says what is a colour. Nothing where fewer than two
 * islands are drawn.
 */
export function islandMarks({ g, steps, islands = [], style, z, m, titled, mark, glyph, isHex }) {
  const islandOf = (id) => g.nodes.get(id)?.item?.island;
  const on = new Map();
  for (const n of steps) if (n.item.island) (on.get(n.item.island) ?? on.set(n.item.island, []).get(n.item.island)).push(n);
  if (on.size < 2) return { layer: [], rows: [], rules: [] };
  const given = Array.isArray(style.island_hues) && style.island_hues.length ? style.island_hues : Array.isArray(style.hues) ? style.hues : [];
  const hues = given.filter(isHex);
  const named = new Map(islands.map((i) => [i.id, i.title]));
  // In the order the answer names them, then any it did not.
  const order = [...islands.map((i) => i.id).filter((id) => on.has(id)), ...[...on.keys()].filter((id) => !named.has(id))];
  const rules = [];
  const classOf = (id, k) => {
    const hex = hues.length ? hues[k % hues.length] : null;
    if (!hex) return 'lf-island';
    const cls = `lf-i-${hex.slice(1).toLowerCase()}`;
    rules.push(`.${cls} { --lf-island: ${hex}; }`);
    return `lf-island ${cls}`;
  };
  const [PAD, WIRE, CORNER] = ['island_pad', 'island_wire_pad', 'island_corner'].map(z);
  const box = (l, t, r, b) => ({ x: l, y: t, width: r - l, height: b - t });
  /** A step taken in by the island's margin. */
  const around = (n) => box(g.x.get(n.id) - n.w / 2 - PAD, g.y.get(n.id) - n.h / 2 - PAD, g.x.get(n.id) + n.w / 2 + PAD, g.y.get(n.id) + n.h / 2 + PAD);
  /** Each stretch of a wire taken in by its margin. */
  const along = (points) => points.slice(1).map((p, k) => {
    const q = points[k];
    return box(Math.min(p[0], q[0]) - WIRE, Math.min(p[1], q[1]) - WIRE, Math.max(p[0], q[0]) + WIRE, Math.max(p[1], q[1]) + WIRE);
  });
  const wires = [...g.chains, ...g.ties];
  const layer = order.map((id, k) => {
    const cls = classOf(id, k);
    const rects = [...on.get(id).map(around), ...wires.filter((w) => islandOf(w.a) === id && islandOf(w.b) === id).flatMap((w) => along(w.points))];
    // The shore is every rect drawn wide in the island's colour, the land every rect over it: their union, one outline.
    const shore = m('g', { class: 'lf-shore' }, ...rects.map((r) => m('rect', { ...r, rx: CORNER })));
    const land = m('g', { class: 'lf-land' }, ...rects.map((r) => m('rect', { ...r, rx: CORNER })));
    // Its name in the margin over its top left step.
    const top = on.get(id).reduce((p, q) => {
      const [pt, qt] = [g.y.get(p.id) - p.h / 2, g.y.get(q.id) - q.h / 2];
      return qt < pt || (qt === pt && g.x.get(q.id) < g.x.get(p.id)) ? q : p;
    });
    const at = around(top);
    const title = named.get(id);
    const name = title && titled(m('a', { href: `#/e/${id}`, class: 'lf-island-name' }, m('text', { x: at.x + z('island_name_x'), y: at.y + PAD / 2 }, title)), title);
    return m('g', { key: `i:${id}`, class: `${cls} lf-region` }, shore, land, name);
  });
  const rows = order.map((id, k) => mark(m('g', { class: classOf(id, k) }, m('g', { class: 'lf-shore' }, m('rect', glyph)), m('g', { class: 'lf-land' }, m('rect', glyph))), named.get(id) ?? 'An island'));
  return { layer, rows, rules: [...new Set(rules)] };
}

export const css = `
/* An island: its shore the union's outline in its colour, its land a tint of it over the sea, under every wire. */
.lf-island { pointer-events: none; --lf-land: color-mix(in srgb, var(--lf-island, var(--ln-line)) var(--ln-flow-island-tint), var(--ln-sea)); }
.lf-shore rect { fill: var(--lf-island, var(--ln-line)); stroke: var(--lf-island, var(--ln-line)); stroke-width: calc(2 * var(--ln-flow-island-stroke)); }
.lf-land rect { fill: var(--lf-land); }
/* On the picture both are drawn wider than the rects by flow_island_close, so a sliver of sea narrower than that between
   two of an island's rects is land; a key's swatch is one rect, drawn as it is. */
.lf-region .lf-shore rect { stroke-width: calc(2 * (var(--ln-flow-island-close) + var(--ln-flow-island-stroke))); }
.lf-region .lf-land rect { stroke: var(--lf-land); stroke-width: calc(2 * var(--ln-flow-island-close)); }
.lf-island-name { pointer-events: auto; cursor: pointer; }
.lf-island-name text { fill: color-mix(in srgb, var(--lf-island, var(--ln-muted)), var(--ln-text) var(--ln-flow-lit-mix)); font-size: var(--ln-flow-island-text); font-family: var(--type-region-family, var(--ln-font)); font-weight: var(--type-region-weight, 400); font-style: var(--type-region-style, normal); text-transform: var(--type-region-case, none); letter-spacing: var(--type-region-track, 0); dominant-baseline: central; }
[data-text=none] .lf-island-name { display: none; }
`;
