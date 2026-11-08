// The last step of a cola picture (task e_x7kwbu3e): each island's frame grown to hold its own wires (channels parted
// at its edge can run past it), and the whole picture moved to start `margin` from the top left. Pure: places and
// wires in, the same moved and grown out.
// Layer: metrics.

export function framed(model, places, wires, { channel, margin }) {
  const island = new Map(model.items.map((it) => [it.id, it.island]));
  const islands = places.islands.map((f) => {
    const own = wires.filter((w) => island.get(w.from) === f.id && island.get(w.to) === f.id).flatMap((w) => w.points);
    return {
      ...f, l: Math.min(f.l, ...own.map((p) => p[0] - channel)), r: Math.max(f.r, ...own.map((p) => p[0] + channel)),
      t: Math.min(f.t, ...own.map((p) => p[1] - channel)), b: Math.max(f.b, ...own.map((p) => p[1] + channel)),
    };
  });
  const xs = [...places.boxes.flatMap((b) => [b.x - b.w / 2, b.x + b.w / 2]), ...islands.flatMap((f) => [f.l, f.r]), ...wires.flatMap((w) => w.points.map((p) => p[0]))];
  const ys = [...places.boxes.flatMap((b) => [b.y - b.h / 2, b.y + b.h / 2]), ...islands.flatMap((f) => [f.t, f.b]), ...wires.flatMap((w) => w.points.map((p) => p[1]))];
  const dx = margin - Math.min(...xs), dy = margin - Math.min(...ys);
  return {
    boxes: places.boxes.map((b) => ({ ...b, x: b.x + dx, y: b.y + dy })),
    islands: islands.map((f) => ({ ...f, l: f.l + dx, r: f.r + dx, t: f.t + dy, b: f.b + dy, head: f.head + dy, name: f.name && [f.name[0] + dx, f.name[1] + dy], entries: f.entries.map((e) => [e[0] + dx, e[1] + dy]) })),
    wires: wires.map((w) => ({ ...w, points: w.points.map(([x, y]) => [x + dx, y + dy]) })),
    width: Math.max(...xs) - Math.min(...xs) + 2 * margin, height: Math.max(...ys) - Math.min(...ys) + 2 * margin,
  };
}
