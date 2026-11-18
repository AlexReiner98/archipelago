// A pack's parts drawn as a ghost island beside the island that runs it (study e_a4zcgpda, round three, direction 1:
// the owner, 18 Nov 2026). A click on a pack's mark in the header lays its parts out in two columns on a dashed frame:
// what it declares to be written (types, link types) on the left, what acts on those (rules, instructions, views,
// lenses, styles) on the right, and a wire from each part on the right to each type it names on the left, so what needs
// what is drawn, never listed. Each part is a row with its kind's glyph in its state on this island (off dashed, waiting
// faded) and its id; one the session may turn is a toggle the page answers in the island's parts_off. Layer: marks.
// Pure: the pack as the answer gives it, its place and the style's sizes in, marks out; how a row's tip reads and
// whether it may toggle are handed in, so this imports nothing.

/** Which column a kind stands in: what is written on the left, what acts on it on the right. */
const LEFT = new Set(['type', 'link']);

/**
 * The ghost island of `pack` with its top left at `[x, y]`: { marks, tips, width, height }. `glyph(kind)` is a kind's
 * glyph, `state(part)` its state, `toggles(part)` whether the session may turn it, `tip(part, toggles)` its tip's lines.
 */
export function ghostParts({ island, pack, at: [x, y], z, m, titled, measure, glyph, state, toggles, tip }) {
  const [d, gap, row, text, pad, apart] = ['island_part_mark', 'island_part_gap', 'island_part_row', 'island_part_list_text', 'island_part_list_pad', 'island_part_column_gap'].map(z);
  const parts = Array.isArray(pack.parts) ? pack.parts : [];
  const left = parts.filter((p) => LEFT.has(p.kind)), right = parts.filter((p) => !LEFT.has(p.kind));
  const wide = (col) => (col.length ? d + gap * 2 + Math.max(...col.map((p) => measure(p.id, text))) : 0);
  const [lw, rw] = [wide(left), wide(right)];
  const head = row, top = y + pad + head;
  const width = pad * 2 + lw + (lw && rw ? apart : 0) + rw, height = pad * 2 + head + row * Math.max(left.length, right.length);
  const lx = x + pad, rx = lx + lw + (lw && rw ? apart : 0);
  const place = new Map();
  const tips = new Map();
  const rowOf = (p, k, cx) => {
    const key = `pt:${island}:${p.id}`, flips = toggles(p), cy = top + row * (k + 0.5), lines = tip(p, flips);
    place.set(p.id, { x: cx, y: cy });
    tips.set(key, m('div', { class: 'lf-tip' }, m('b', {}, lines[0]), ...lines.slice(1).map((l) => m('span', { class: 'lf-tip-row' }, l))));
    return titled(m('g', { key, on: ['enter', 'leave', ...(flips ? ['toggle'] : [])], ...(flips && { item: island, pack: p.id }), class: `lf-part lf-part-row k-${p.kind} st-${state(p)}${flips ? ' toggles' : ''}` },
      m('circle', { cx: cx + d / 2, cy, r: d / 2 }), m('text', { x: cx + d / 2, y: cy }, glyph(p.kind)), m('text', { x: cx + d + gap * 2, y: cy, class: 'lf-part-name' }, p.id)), lines.join('\n'));
  };
  const rows = [...left.map((p, k) => rowOf(p, k, lx)), ...right.map((p, k) => rowOf(p, k, rx))];
  // A wire from each part on the right to each part on the left it names: out of its mark, across the gap, into the end of the name it needs.
  const wires = right.flatMap((p) => (Array.isArray(p.needs) ? p.needs : []).filter((n) => place.has(n) && LEFT.has(parts.find((q) => q.id === n)?.kind)).map((n) => {
    const a = place.get(p.id), b = place.get(n), from = a.x - gap, to = lx + lw, mid = to + apart / 2;
    return m('path', { d: `M${from} ${a.y}H${mid}V${b.y}H${to}`, class: `lf-ghost-wire st-${state(p)}` });
  }));
  const frame = m('rect', { x, y, width, height, rx: pad, class: 'lf-ghost' });
  const title = m('text', { x: x + pad, y: y + pad + head / 2, class: 'lf-ghost-title' }, `${pack.title ?? pack.id}: its parts here`);
  return { marks: [m('g', { key: `gh:${island}`, class: 'lf-ghost-parts' }, frame, title, ...wires, ...rows)], tips, width, height };
}

export const css = `
/* A pack's parts as a ghost island: a dashed frame on the sea, its rows, and wires from what acts to what it names. */
.lf-ghost { fill: var(--ln-land); stroke: var(--ln-line); stroke-width: var(--ln-flow-island-stroke); stroke-dasharray: var(--ln-flow-dash-held); pointer-events: auto; }
.lf-ghost-title { fill: var(--ln-muted); font-size: var(--ln-flow-island-text); font-family: var(--type-region-family, var(--ln-font)); text-transform: var(--type-region-case, none); letter-spacing: var(--type-region-track, 0); dominant-baseline: central; }
.lf-ghost-wire { fill: none; stroke: var(--ln-line); stroke-width: var(--ln-rule); }
.lf-ghost-wire.st-waiting, .lf-ghost-wire.st-off { stroke-dasharray: var(--ln-flow-dash-held); opacity: var(--ln-flow-waiting); }
[data-text=none] .lf-ghost-parts { display: none; }
`;
