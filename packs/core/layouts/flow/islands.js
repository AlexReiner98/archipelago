// Each island of an archipelago drawn as a region round what lives on it (task e_auw7hb3v; settled e_ge3c6t4w: its
// border a mark the layout draws; the owner, 5 Nov 2026: regions never overlap, what crosses is shown at the border,
// each island carries its own legend). The places are ./archipelago.js's; this draws them. The region is its frame, one
// clean rect (design e_87x2us2b, stage 5), its shore in the island's colour (the style's island_hues, else its hues) and
// its land a tint of it, under every wire. Named at its top left, its legend (its own types and link types) beside its
// steps. Where a link between two islands crosses a shore is a gate, at its port: a bar on the shore. A finding read
// across is outlined in its island's colour (`found`), so what crosses is the item itself, not a name for it at sea.
// When the finding moves, a pulse runs from its gate across the sea to each reader's (task e_fqhbp4yq).
// Layer: marks. Pure: the composed model and each island's legend rows in, marks and colour rules out.

/** An island's name as its header says it: its title, and the pack it speaks. */
export const nameOf = (i) => `${i?.title ?? ''}${i?.pack?.title ? ` · ${i.pack.title}` : ''}`;

/** What a link across names: what it points to, and its value. */
export function saidOf(to) {
  const value = to?.fields?.value;
  return `${to?.title ?? ''}${value !== undefined && value !== null && typeof value !== 'object' ? `: ${value}` : ''}`;
}

/**
 * The islands' marks: `layer` (drawn first, under the wires), `gates` (drawn over them), the colour `rules` they read,
 * and `found`: the class each finding read across takes, by its id, for its outline in its island's colour.
 * `legends` holds each island's rows ({ glyph, label }); `isHex` says what is a colour.
 */
export function islandMarks({ g, legends, islands = [], style, z, m, titled, isHex }) {
  if (!g.islands?.length) return { layer: [], gates: [], rules: [], tips: new Map(), found: new Map() };
  const given = Array.isArray(style.island_hues) && style.island_hues.length ? style.island_hues : Array.isArray(style.hues) ? style.hues : [];
  const hues = given.filter(isHex);
  const named = new Map(islands.map((i) => [i.id, nameOf(i)]));
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
    // The land a tint of the island's colour, its shore a line of it round the frame.
    const land = m('g', { class: 'lf-land' }, ...rects.map((r) => m('rect', r)));
    const shore = m('g', { class: 'lf-shore' }, ...rects.map((r) => m('rect', r)));
    const title = named.get(isle.id);
    const name = title && titled(m('a', { href: `#/e/${isle.id}`, class: 'lf-island-name' }, m('text', { x: isle.name[0] + z('island_name_x'), y: isle.name[1] }, title)), title);
    // Its legend: each row's mark, then its words.
    const legend = (legends.get(isle.id) ?? []).map((row, n) => {
      const [ex, ey] = isle.entries[n], [tag, attrs, ...inner] = row.glyph;
      return m('g', { class: 'lf-island-key' }, m(tag, { ...attrs, x: ex, y: ey + (ROW - KEY_H) / 2 }, ...inner), m('text', { x: ex + KEY_W + MARK_GAP, y: ey + ROW / 2 }, row.label));
    });
    return m('g', { key: `i:${isle.id}`, class: `${classes.get(isle.id)} lf-region` }, land, shore, name, legend);
  });
  // A gate on each shore a link between islands crosses: a bar across the wire in its island's colour, as long as the
  // port it marks. A finding
  // crossing is of the grammar every island shares, so no legend says what a gate is: each gate answers a hover with a
  // tip (`tips`, by the mark's key) saying what crosses and which way.
  const BAR = z('island_gate_bar');
  const tips = new Map(), found = new Map();
  const tip = (key, said, what) => tips.set(key, m('div', { class: 'lf-tip' }, m('b', {}, said), m('span', {}, what)));
  const islandOf = new Map(g.islands.flatMap((isle) => [...isle.steps].map((id) => [id, isle.id]))), barred = new Set();
  const gates = g.ties.filter((t) => t.crossing && t.gates.length).flatMap((t, n) => {
    const to = g.nodes.get(t.b)?.item, value = to?.fields?.value, said = saidOf(to);
    const [reader, source] = [t.a, t.b].map((id) => named.get(g.nodes.get(id)?.item?.island));
    if (islandOf.has(t.b)) found.set(t.b, `lf-found ${classes.get(islandOf.get(t.b)) ?? ''}`);
    // A finding's reads that leave by one port share its bar there: drawn once.
    const bars = t.gates.map((gate, k) => [gate, k]).filter(([gate]) => !barred.has(gate.at.join()) && barred.add(gate.at.join())).map(([gate, k]) => {
      const [gx, gy] = gate.at, half = Math.max(BAR, gate.span ?? 0) / 2, d = gate.way[0] ? `M${gx} ${gy - half}V${gy + half}` : `M${gx - half} ${gy}H${gx + half}`;
      const key = `gate:${n}:${k}`;
      tip(key, said, k ? `A finding read across: it leaves ${source ?? 'its island'} here` : `A finding read across: it comes into ${reader ?? 'this island'} here`);
      return titled(m('path', { key, on: ['enter', 'leave'], d, class: `lf-gate-bar ${classes.get(gate.island) ?? ''}` }), `${said}\n${k ? 'Goes out here' : 'Comes in here'}`);
    });
    // Its pulse: the line through the sea from the finding's gate to the reader's, unseen until what the finding
    // promises moves, when the page runs it along that line (ui/transition.js), in the finding's island's colour.
    const pulse = t.sea && t.gates.length === 2 ? [m('path', { key: `pulse:${t.b}:${t.a}`, pulse: JSON.stringify([value ?? null, to?.fields?.as_of ?? null]), d: `M${[...t.sea].reverse().map((p) => p.join(' ')).join('L')}`, class: `lf-pulse ${classes.get(t.gates[1].island) ?? ''}`, 'aria-hidden': 'true' })] : [];
    return [...pulse, ...bars];
  });
  return { layer, gates, rules: [...rules], tips, found };
}

export const css = `
/* An island: its shore its frame's outline in its colour, its land a tint of it over the sea, under every wire. */
.lf-island { --lf-land: color-mix(in srgb, var(--lf-island, var(--ln-line)) var(--ln-flow-island-tint), var(--ln-sea)); }
.lf-region { pointer-events: none; }
.lf-land rect { fill: var(--lf-land); stroke: none; }
.lf-shore rect { fill: none; stroke: var(--lf-island, var(--ln-line)); stroke-width: var(--ln-flow-island-stroke); }
.lf-island-name { pointer-events: auto; cursor: pointer; }
.lf-island-name text { fill: color-mix(in srgb, var(--lf-island, var(--ln-muted)), var(--ln-text) var(--ln-flow-lit-mix)); font-size: var(--ln-flow-island-text); font-family: var(--type-region-family, var(--ln-font)); font-weight: var(--type-region-weight, 400); font-style: var(--type-region-style, normal); text-transform: var(--type-region-case, none); letter-spacing: var(--type-region-track, 0); dominant-baseline: central; }
.lf-island-key text { fill: var(--ln-muted); font-size: var(--ln-flow-island-legend-text); font-family: var(--ln-font); dominant-baseline: central; }
/* A gate: a bar on the shore in the island's colour. A finding read across: its outline in its island's colour. */
.lf-gate-bar { fill: none; stroke: var(--lf-island, var(--ln-text)); stroke-width: var(--ln-flow-island-gate-stroke); stroke-linecap: round; }
.lf-step.lf-found .lf-shape { stroke: var(--lf-island, var(--ln-line)); stroke-width: var(--ln-flow-stroke-lit); }
/* A pulse: a dash of the finding's island's colour, unseen but while the page runs it to a reader. */
.lf-pulse { fill: none; stroke: var(--lf-island, var(--ln-text)); stroke-width: var(--ln-flow-island-pulse-stroke); stroke-dasharray: var(--ln-flow-island-pulse-dash); stroke-linecap: round; opacity: 0; pointer-events: none; }
[data-text=none] :is(.lf-island-name, .lf-island-key) { display: none; }
`;
