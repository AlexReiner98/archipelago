// Where a cola picture starts from (task e_x7kwbu3e): no random seed, so the same model always comes to the same rest.
// Each island is a block, side by side in the order the model lists them (what is on no island last); inside one, each
// item on the row of its layer (./order.js) and along it in the order it was made. Pure: the model and its order in,
// each item's centre out.
// Layer: metrics.

/** The islands' ids in the model's order, then null for what is on none, each with its items made first. */
export function blocksOf({ items, islands = [] }) {
  const ids = [...islands.map((i) => i.id).filter((id) => items.some((it) => it.island === id)), ...(items.some((it) => !islands.some((i) => i.id === it.island)) ? [null] : [])];
  const on = (id) => items.filter((it) => (id === null ? !islands.some((i) => i.id === it.island) : it.island === id));
  return ids.map((id) => ({ id, items: [...on(id)].sort((a, b) => (a.made ?? 0) - (b.made ?? 0) || (a.id < b.id ? -1 : 1)) }));
}

/** Each item's centre to start from: { x, y } by id. `gap` apart along a row, `rise` between rows, `sea` between blocks. */
export function startOf(model, layer, { gap, rise, sea }) {
  const at = new Map();
  let left = 0;
  for (const block of blocksOf(model)) {
    const rows = new Map();
    for (const it of block.items) (rows.get(layer.get(it.id)) ?? rows.set(layer.get(it.id), []).get(layer.get(it.id))).push(it);
    let widest = 0, top = 0;
    for (const n of [...rows.keys()].sort((a, b) => a - b)) {
      const row = rows.get(n), tall = Math.max(...row.map((it) => it.h));
      let x = left;
      for (const it of row) (at.set(it.id, { x: x + it.w / 2, y: top + tall / 2 }), (x += it.w + gap));
      widest = Math.max(widest, x - left);
      top += tall + rise;
    }
    left += widest + sea;
  }
  return at;
}
