// An island as a band (the kit, task e_7v52ek3c): its frame round its steps, a pad inside it, and over the steps its
// header: its name, and its legend under the name in at most `flow_island_legend_columns` columns. What the flow's
// islands draw (./islands.js) reads it: `land`, `name` (where the name's line starts, at its middle) and `entries` (each
// legend row's top left). Layer: metrics. Pure: sizes in, places out, from the band's top left.

/** Entries of the given widths in `columns` columns, a row each: each one's top left, and the size of all. */
function columned(widths, columns, gap, row) {
  const per = Math.max(1, Math.ceil(widths.length / columns)), at = [];
  let x = 0, wide = 0;
  widths.forEach((w, k) => {
    if (k && k % per === 0) (x += wide + gap), (wide = 0);
    at.push([x, (k % per) * row]);
    wide = Math.max(wide, w);
  });
  return { at, w: widths.length ? x + wide : 0, h: Math.min(widths.length, per) * row };
}

/**
 * A band round content `w` by `h`: `name` is how wide its name is drawn (0 for none), `legend` each legend row's width,
 * `shore` false for what lives on no island (no frame, no header). Answers `land` (its frame), `name`, `entries`,
 * `content` (where the content's top left goes) and its size, all from the band's top left.
 */
export function band({ w, h }, { name = 0, legend = [], shore = true, sizes }) {
  if (!shore) return { land: null, name: null, entries: [], content: [0, 0], w, h };
  const z = (k) => sizes[`flow_island_${k}`];
  const [PAD, ROOM, GAP, ROW, COLUMNS] = ['pad', 'name_room', 'legend_gap', 'legend_row', 'legend_columns'].map(z);
  const key = columned(legend, COLUMNS, GAP, ROW);
  const head = (name ? ROOM : 0) + (key.h ? key.h + GAP : 0);
  const W = Math.max(w, name, key.w) + 2 * PAD, H = head + h + 2 * PAD;
  return {
    land: { l: 0, t: 0, r: W, b: H },
    name: name ? [PAD - sizes.flow_island_name_x, PAD + ROOM / 2] : null,
    entries: key.at.map(([ex, ey]) => [PAD + ex, PAD + (name ? ROOM : 0) + ey]),
    content: [PAD, PAD + head],
    w: W, h: H,
  };
}
