// Parts of a picture set out in rows, about the shape asked for. Layer: metrics. Pure: sizes in, moves told.

/** Each of `sets` ({ l, t, w, h }, in the order to set them) told by `put(set, dx, dy)` how far it moves. */
export function shelve(sets, { gap, margin, aspect }, put) {
  const area = sets.reduce((sum, c) => sum + (c.w + gap) * (c.h + gap), 0), most = Math.max(sets[0]?.w ?? 0, Math.sqrt(area * aspect));
  let x = margin, y = margin, row = 0;
  for (const c of sets) {
    if (x > margin && x + c.w > margin + most) ((x = margin), (y += row + gap), (row = 0));
    put(c, x - c.l, y - c.t);
    x += c.w + gap;
    row = Math.max(row, c.h);
  }
}
