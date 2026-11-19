// A pack's parts drawn as an island beside the island that runs it (study e_a4zcgpda, round three, direction 1: the
// owner, 18 Nov 2026), in the grammar every island has since round 4 of the canvas by eye (study e_unru8ftt): land like
// its island's (./islands.js draws it), its name bold, what it says of itself in quiet words, and its parts as words.
// Two columns: what the pack declares to be written (types, link types) on the left, what acts on those (rules,
// instructions, views, lenses, styles) on the right, each under its kind's name, and a wire from each part on the right
// to each type it names on the left, so what needs what is drawn, never listed. A part is its id, in its state on this
// island (off crossed out, as an off pack's name is; waiting faded); one the session may turn is a toggle the page
// answers in the island's parts_off. After the name, the switch for the whole pack, in words. Layer: marks.
// Pure: the pack as the answer gives it, its place and the style's sizes in, marks out; how a row's tip reads and
// whether it may toggle are handed in, so this imports nothing.

/** Which column a kind stands in: what is written on the left, what acts on it on the right. */
const LEFT = new Set(['type', 'link']);

/** The columns of a pack's parts: each a list of [kind, parts], in the order the kinds first come. */
function columns(pack, kinds) {
  const parts = Array.isArray(pack?.parts) ? pack.parts : [];
  const grouped = (list) => [...list.reduce((by, p) => by.set(p.kind, [...(by.get(p.kind) ?? []), p]), new Map())];
  const left = parts.filter((p) => LEFT.has(p.kind));
  // What acts stands beside what it names: sorted by the first part on the left it needs, those naming none last.
  const first = (p) => ((k) => (k < 0 ? left.length : k))(left.findIndex((q) => (p.needs ?? []).includes(q.id)));
  const right = parts.filter((p) => !LEFT.has(p.kind)).map((p, k) => [p, k]).sort(([a, i], [b, j]) => first(a) - first(b) || i - j).map(([p]) => p);
  const order = (cols) => cols.sort(([a], [b]) => kinds.indexOf(a) - kinds.indexOf(b));
  return { parts, left: order(grouped(left)), right: grouped(right) };
}

/** The lines a column takes: a kind's name, then each of its parts. */
const linesOf = (col) => col.reduce((n, [, ps]) => n + 1 + ps.length, 0);

/**
 * How much room a pack's parts take, as an island of their own: each column's width, the head's height, and the whole
 * width and height. `said(kind)` is how a kind's name reads; `measure(text, px, role)` how wide a text is.
 */
export function ghostSize(pack, z, measure, said = (k) => k, switchWords = '') {
  const [row, text, pad, apart, head, name, quiet, gap] = ['island_part_row', 'island_part_list_text', 'island_part_list_pad', 'island_part_column_gap', 'island_name_room', 'island_text', 'island_pack_text', 'island_pack_gap'].map(z);
  const { left, right } = columns(pack, Object.keys(KINDS));
  const wide = (col) => (col.length ? Math.max(...col.map(([kind]) => measure(said(kind), quiet)), ...col.flatMap(([, ps]) => ps.map((p) => measure(p.id, text)))) : 0);
  const [lw, rw] = [wide(left), wide(right)];
  const title = measure(pack?.title ?? pack?.id ?? '', name, 'name') + (switchWords ? gap + measure(switchWords, quiet) : 0);
  return { lw, rw, head, width: pad * 2 + Math.max(title, lw + (lw && rw ? apart : 0) + rw), height: pad * 2 + head + row * Math.max(linesOf(left), linesOf(right)) };
}

/** The kinds in the order a column lists them, and the name each is listed under. */
export const KINDS = { type: 'Types', link: 'Link types', rule: 'Rules', instruction: 'Instructions', view: 'Views', lens: 'Lenses', style: 'Styles' };

/**
 * The parts island of `pack` with its top left at `[x, y]`: { marks, tips, width, height }. `state(part)` is a part's
 * state, `toggles(part)` whether the session may turn it, `tip(part, toggles)` its tip's lines; `whole` the switch for
 * the whole pack ({ key, words, state, toggles, lines }), or none.
 */
export function ghostParts({ island, pack, at: [x, y], z, m, titled, measure, state, toggles, tip, whole = null }) {
  const [row, text, pad, apart, name, quiet, gap] = ['island_part_row', 'island_part_list_text', 'island_part_list_pad', 'island_part_column_gap', 'island_text', 'island_pack_text', 'island_pack_gap'].map(z);
  const said = (kind) => KINDS[kind] ?? kind;
  const { parts, left, right } = columns(pack, Object.keys(KINDS));
  const { lw, rw, head, width, height } = ghostSize(pack, z, measure, said, whole?.words);
  const top = y + pad + head, lx = x + pad, rx = lx + lw + (lw && rw ? apart : 0);
  const place = new Map(), tips = new Map();
  const tipOf = (key, lines) => tips.set(key, m('div', { class: 'lf-tip' }, m('b', {}, lines[0]), ...lines.slice(1).map((l) => m('span', { class: 'lf-tip-row' }, l))));
  const rowOf = (p, cx, cy) => {
    const key = `pt:${island}:${p.id}`, flips = toggles(p), lines = tip(p, flips);
    place.set(p.id, { x: cx, y: cy });
    tipOf(key, lines);
    return titled(m('g', { key, on: ['enter', 'leave', ...(flips ? ['toggle'] : [])], ...(flips && { item: island, pack: p.id }), class: `lf-part lf-part-row k-${p.kind} st-${state(p)}${flips ? ' toggles' : ''}` },
      m('rect', { x: cx, y: cy - row / 2, width: measure(p.id, text), height: row, class: 'lf-hit' }), m('text', { x: cx, y: cy, class: 'lf-part-name' }, p.id)), lines.join('\n'));
  };
  // Each column down from the head: a kind's name, quiet, then its parts.
  const columnOf = (col, cx) => {
    let k = 0;
    return col.flatMap(([kind, ps]) => [m('text', { x: cx, y: top + row * (k++ + 0.5), class: 'lf-part-kind' }, said(kind)), ...ps.map((p) => rowOf(p, cx, top + row * (k++ + 0.5)))]);
  };
  const rows = [...columnOf(left, lx), ...columnOf(right, rx)];
  // A wire from each part on the right to each part on the left it names: out of the start of its name, across the gap
  // in the channel of the part it names (one channel a part on the left, so no two parts' wires share a stretch), into
  // the column's edge beside the name it names.
  const lefts = left.flatMap(([, ps]) => ps), rights = right.flatMap(([, ps]) => ps);
  const named = lefts.filter((q) => rights.some((p) => (p.needs ?? []).includes(q.id)));
  const channel = (n) => lx + lw + (apart * (named.findIndex((q) => q.id === n) + 1)) / (named.length + 1);
  const wires = rights.flatMap((p) => (Array.isArray(p.needs) ? p.needs : []).filter((n) => place.has(n) && LEFT.has(parts.find((q) => q.id === n)?.kind)).map((n) => {
    const a = place.get(p.id), b = place.get(n);
    return m('path', { d: `M${a.x - gap / 2} ${a.y}H${channel(n)}V${b.y}H${lx + lw}`, class: `lf-ghost-wire st-${state(p)}` });
  }));
  // Its name, bold as an island's is, and after it the switch for the whole pack, in quiet words.
  const cy = y + pad + head / 2, title = pack.title ?? pack.id;
  const named0 = m('text', { x: lx, y: cy, class: 'lf-parts-name' }, title);
  let switcher = [];
  if (whole) {
    const sx = lx + measure(title, name, 'name') + gap;
    tipOf(whole.key, whole.lines);
    switcher = [titled(m('g', { key: whole.key, on: ['enter', 'leave', ...(whole.toggles ? ['toggle'] : [])], ...(whole.toggles && { item: island, pack: pack.id }), class: `lf-pack whole own st-${whole.state}${whole.toggles ? ' toggles' : ''}` },
      m('rect', { x: sx - gap / 2, y: cy - head / 2, width: measure(whole.words, quiet) + gap, height: head, class: 'lf-hit' }), m('text', { x: sx, y: cy, class: 'lf-pack-name' }, whole.words)), whole.lines.join('\n'))];
  }
  return { marks: [m('g', { key: `gh:${island}:${pack.id}`, class: 'lf-ghost-parts' }, named0, ...switcher, ...wires, ...rows)], tips, width, height };
}

export const css = `
/* A pack's parts as an island: its land is any island's (./islands.js); its name bold, its kinds quiet, its parts words. */
.lf-parts-name { fill: color-mix(in srgb, var(--lf-island, var(--ln-muted)), var(--ln-text) var(--ln-flow-island-name-mix)); font-size: var(--ln-flow-island-text); font-family: var(--type-name-family, var(--ln-font)); font-weight: var(--type-name-weight, bold); dominant-baseline: central; }
.lf-part-kind { fill: var(--ln-muted); font-size: var(--ln-flow-island-pack-text); font-family: var(--ln-font); dominant-baseline: central; }
.lf-part-row .lf-hit, .lf-pack.whole .lf-hit { fill: transparent; stroke: none; }
.lf-part-row text.lf-part-name { text-anchor: start; }
.lf-part-row.st-off text.lf-part-name { text-decoration: line-through; }
.lf-ghost-parts .lf-pack.whole text { dominant-baseline: central; }
.lf-ghost-wire { fill: none; stroke: var(--ln-line); stroke-width: var(--ln-rule); }
.lf-ghost-wire.st-waiting, .lf-ghost-wire.st-off { stroke-dasharray: var(--ln-flow-dash-held); opacity: var(--ln-flow-waiting); }
[data-text=none] .lf-ghost-parts { display: none; }
`;
