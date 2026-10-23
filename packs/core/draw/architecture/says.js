// What a wire carries is written on it where there is room: on its drop into what it calls when nothing else drops
// there, else on its drop from the caller, else on its run across; otherwise only in its tooltip. A place's name and
// another wire's words are never written over. The still picture and the story place them alike.

/** Where each of `labels` ({ c: a wire, text }) is written, as { c, text, x, y, w }; those with no room are left out. */
export function saysSpots({ labels, chains, boxes, measure, z }) {
  const [SAYS_TEXT, PLACE_TEXT] = [z('says_text'), z('place_text')];
  const once = (list, v) => list.filter((p) => p === v).length === 1;
  const heads = chains.map((c) => c.points.at(-1)[0]), feet = chains.map((c) => c.points[0][0]);
  const placed = boxes.map((b) => [b.x + Math.min(b.w, measure(b.item.title, PLACE_TEXT) + z('place_name_room')) / 2, b.y + z('place_name_inset') + z('place_name_height') / 2, Math.min(b.w, measure(b.item.title, PLACE_TEXT) + z('place_name_room'))]);
  return labels.flatMap(({ c, text }) => {
    const w = measure(text, SAYS_TEXT) + 2 * z('says_pad'), p = c.points;
    const spots = [once(heads, p.at(-1)[0]) && [p.at(-1)[0], (p.at(-2)[1] + p.at(-1)[1]) / 2], once(feet, p[0][0]) && [p[0][0], (p[0][1] + p[1][1]) / 2], p.length > 2 && Math.abs(p[2][0] - p[1][0]) > w + 16 && [(p[1][0] + p[2][0]) / 2, p[1][1]]].filter(Boolean);
    const spot = spots.find(([lx, ly]) => !placed.some(([px, py, pw]) => Math.abs(px - lx) < (pw + w) / 2 + 4 && Math.abs(py - ly) < 16));
    if (!spot) return [];
    placed.push([...spot, w]);
    return [{ c, text, x: spot[0], y: spot[1], w }];
  });
}
