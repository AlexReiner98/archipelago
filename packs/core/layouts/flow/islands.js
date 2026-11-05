// Each island of an archipelago drawn as a region round what lives on it (task e_auw7hb3v; settled e_ge3c6t4w: its
// border a mark the layout draws; the owner, 5 Nov 2026: regions never overlap, what crosses is shown at the border,
// each island carries its own legend). The places are ./archipelago.js's; this draws them. The region is land on the
// one plane, never a box holding boxes (depth is never drawn): the union of its padded steps, its own wires, its name's
// room and its legend's, its shore in the island's colour (the style's island_hues, else its hues) and its land a tint
// of it, under every wire. Named at its top left, its legend (what each mark in it means) at its foot. Where a link
// between two islands crosses a shore is a gate: a mark on the shore naming what crosses (a finding, and its value).
// Layer: marks. Pure: the composed model and each island's legend rows in, marks and colour rules out.

/**
 * The islands' marks: `layer` (drawn first, under the wires), `gates` (drawn over them) and the colour `rules` they read.
 * `legends` holds each island's rows ({ glyph, label }); `isHex` says what is a colour.
 */
export function islandMarks({ g, legends, islands = [], style, z, m, titled, measure, fit, isHex }) {
  if (!g.islands?.length) return { layer: [], gates: [], rules: [] };
  const given = Array.isArray(style.island_hues) && style.island_hues.length ? style.island_hues : Array.isArray(style.hues) ? style.hues : [];
  const hues = given.filter(isHex);
  const named = new Map(islands.map((i) => [i.id, i.title]));
  const rules = new Set(), classes = new Map();
  g.islands.forEach((isle, k) => {
    const hex = hues.length ? hues[k % hues.length] : null;
    if (!hex) return classes.set(isle.id, 'lf-island');
    const cls = `lf-i-${hex.slice(1).toLowerCase()}`;
    rules.add(`.${cls} { --lf-island: ${hex}; }`);
    classes.set(isle.id, `lf-island ${cls}`);
  });
  const [PAD, CORNER, ROW, KEY_W, KEY_H, MARK_GAP] = ['island_pad', 'island_corner', 'island_legend_row', 'key_width', 'key_height', 'island_legend_mark_gap'].map(z);
  const rectOf = (r) => ({ x: r.l, y: r.t, width: r.r - r.l, height: r.b - r.t, rx: CORNER });
  const layer = g.islands.map((isle) => {
    const rects = isle.land.map(rectOf);
    // The shore is every rect drawn wide in the island's colour, the land every rect over it: their union, one outline.
    const shore = m('g', { class: 'lf-shore' }, ...rects.map((r) => m('rect', r)));
    const land = m('g', { class: 'lf-land' }, ...rects.map((r) => m('rect', r)));
    const title = named.get(isle.id);
    const name = title && titled(m('a', { href: `#/e/${isle.id}`, class: 'lf-island-name' }, m('text', { x: isle.name[0] + z('island_name_x'), y: isle.name[1] }, title)), title);
    // Its legend: each row's mark, then its words.
    const legend = (legends.get(isle.id) ?? []).map((row, n) => {
      const [ex, ey] = isle.entries[n], [tag, attrs, ...inner] = row.glyph;
      return m('g', { class: 'lf-island-key' }, m(tag, { ...attrs, x: ex, y: ey + (ROW - KEY_H) / 2 }, ...inner), m('text', { x: ex + KEY_W + MARK_GAP, y: ey + ROW / 2 }, row.label));
    });
    return m('g', { key: `i:${isle.id}`, class: `${classes.get(isle.id)} lf-region` }, shore, land, name, legend);
  });
  // A gate on each shore a link between islands crosses: a bar across the wire in its island's colour. What crosses
  // (what the link points to, and its value) is named once, in the sea between the two, cut to the room there.
  const [GATE_H, GATE_PAD, GATE_TEXT, BAR, MOST] = ['island_gate_height', 'island_gate_pad', 'island_gate_text', 'island_gate_bar', 'island_gate_most'].map(z);
  const gates = g.ties.filter((t) => t.crossing && t.gates.length).flatMap((t, n) => {
    const to = g.nodes.get(t.b)?.item, value = to?.fields?.value;
    const said = `${to?.title ?? ''}${value !== undefined && value !== null && typeof value !== 'object' ? `: ${value}` : ''}`;
    const bars = t.gates.map((gate, k) => {
      const [gx, gy] = gate.at, half = BAR / 2, d = gate.way[0] ? `M${gx} ${gy - half}V${gy + half}` : `M${gx - half} ${gy}H${gx + half}`;
      return titled(m('path', { key: `gate:${n}:${k}`, d, class: `lf-gate-bar ${classes.get(gate.island) ?? ''}` }), `${said}\n${k ? 'Goes out here' : 'Comes in here'}`);
    });
    const l = t.label, text = l && fit(said, Math.min(l.across ? l.room - 2 * GATE_PAD : MOST, MOST) - 2 * GATE_PAD, GATE_TEXT);
    if (!text || text.length < 2) return bars;
    const w = measure(text, GATE_TEXT) + 2 * GATE_PAD;
    return [...bars, titled(m('g', { key: `cross:${n}`, class: 'lf-gate' }, m('rect', { x: l.at[0] - w / 2, y: l.at[1] - GATE_H / 2, width: w, height: GATE_H, rx: GATE_H / 2 }), m('text', { x: l.at[0], y: l.at[1] }, text)), said)];
  });
  return { layer, gates, rules: [...rules] };
}

/** A gate as the key draws it, in a box of the key's size (`G`: its middle and how big): a wire through a bar. */
export const gateGlyph = (m, G) => m('g', {}, m('path', { d: `M${G.x - G.w / 2} ${G.y}H${G.x + G.w / 2}`, class: 'lf-tie headed' }), m('path', { d: `M${G.x} ${G.y - G.r - 1}V${G.y + G.r + 1}`, class: 'lf-gate-bar' }));

export const css = `
/* An island: its shore the union's outline in its colour, its land a tint of it over the sea, under every wire. */
.lf-island { --lf-land: color-mix(in srgb, var(--lf-island, var(--ln-line)) var(--ln-flow-island-tint), var(--ln-sea)); }
.lf-region { pointer-events: none; }
.lf-shore rect { fill: var(--lf-island, var(--ln-line)); stroke: var(--lf-island, var(--ln-line)); stroke-width: calc(2 * (var(--ln-flow-island-close) + var(--ln-flow-island-stroke))); }
/* Drawn wider than its rects by flow_island_close, so a sliver of sea narrower than that between two of them is land. */
.lf-land rect { fill: var(--lf-land); stroke: var(--lf-land); stroke-width: calc(2 * var(--ln-flow-island-close)); }
.lf-island-name { pointer-events: auto; cursor: pointer; }
.lf-island-name text { fill: color-mix(in srgb, var(--lf-island, var(--ln-muted)), var(--ln-text) var(--ln-flow-lit-mix)); font-size: var(--ln-flow-island-text); font-family: var(--type-region-family, var(--ln-font)); font-weight: var(--type-region-weight, 400); font-style: var(--type-region-style, normal); text-transform: var(--type-region-case, none); letter-spacing: var(--type-region-track, 0); dominant-baseline: central; }
.lf-island-key text { fill: var(--ln-muted); font-size: var(--ln-flow-island-legend-text); font-family: var(--ln-font); dominant-baseline: central; }
/* A gate: a bar on the shore in the island's colour; what crosses named in the sea. */
.lf-gate-bar { fill: none; stroke: var(--lf-island, var(--ln-text)); stroke-width: var(--ln-flow-island-gate-stroke); stroke-linecap: round; }
.lf-gate rect { fill: var(--ln-land); stroke: var(--lf-island, var(--ln-line)); stroke-width: var(--ln-flow-stroke-lit); }
.lf-gate text { fill: var(--ln-text); font-size: var(--ln-flow-island-gate-text); font-family: var(--ln-font); text-anchor: middle; dominant-baseline: central; }
[data-text=none] :is(.lf-island-name, .lf-island-key, .lf-gate) { display: none; }
`;
