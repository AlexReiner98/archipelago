// Layer: metrics. The islands at sea: each island laid out alone (./island.js) and framed, the islands in shelves made
// first, as wide as the picture's shape asks; a link between two islands leaves each by a port on its foot and runs
// in the streets under the shelves, crossing a shelf on a waypoint at its right end, as the rows do inside an island.
// Pure: the model and the style's lengths in; every place, frame and wire out.

import { islandOf } from './island.js';
import { placed } from './place.js';
import { routed, simplified } from './route.js';
import { streetsOf } from './streets.js';

const byMade = (p, q) => (p.made < q.made ? -1 : p.made > q.made ? 1 : p.id < q.id ? -1 : p.id > q.id ? 1 : 0);

/** An island's frame round content w by h, when nothing else frames it: its pad, and its name over. */
const framed = (z) => (id, w, h) => ({ w: w + 2 * z.island_pad, h: h + 2 * z.island_pad + z.island_name, content: [z.island_pad, z.island_pad + z.island_name] });

/**
 * The whole picture: { places, islands (frames), wires, parts, w, h }. `frameOf(id, w, h)` frames an island's content:
 * its size and where the content goes ({ w, h, content: [dx, dy] }, and anything else, kept on the frame).
 */
export function seaOf(model, z, stage = () => {}, frameOf = framed(z)) {
  const groups = new Map();
  for (const i of model.items) (groups.get(i.island ?? '') ?? groups.set(i.island ?? '', []).get(i.island ?? '')).push(i);
  const home = new Map(model.items.map((i) => [i.id, i.island ?? ''])), named = new Map(model.islands.map((s) => [s.id, s]));
  const touching = (ids) => model.links.filter((l) => ids.has(l.from) || ids.has(l.to));
  const laid = [...groups].map(([id, items]) => {
    const ids = new Set(items.map((i) => i.id)), inner = islandOf(items, touching(ids), z, (name, snap) => stage(`${id || 'sea'}: ${name}`, snap), (item) => home.get(item));
    const made = items.reduce((m, i) => (i.made < m ? i.made : m), '~');
    const frame = frameOf(id, inner.w, inner.h);
    return { id, title: named.get(id)?.title ?? '', made, inner, frame, w: frame.w, h: frame.h };
  }).sort(byMade);
  // Shelves as wide as the picture's shape asks, an island never cut.
  const area = laid.reduce((s, i) => s + i.w * i.h, 0), wide = Math.max(...laid.map((i) => i.w), Math.sqrt(area * z.aspect));
  const shelves = [];
  for (const s of laid) {
    const last = shelves.at(-1), used = last ? last.reduce((t, i) => t + i.w + z.sea, 0) : 0;
    if (!last || used + s.w > wide) shelves.push([s]);
    else last.push(s);
  }
  const shelfOf = new Map(shelves.flatMap((list, k) => list.map((s) => [s.id, k])));
  // Each link between islands as two halves, one at each island's port: the sea joins them.
  const halves = new Map();
  for (const s of laid) for (const p of s.inner.ports) (halves.get(p.id) ?? halves.set(p.id, []).get(p.id)).push({ island: s, port: p });
  // Links that share a port at both ends are one wire at sea.
  const pairs = new Map();
  for (const [link, two] of halves) {
    if (two.length !== 2) continue;
    const [A, B] = shelfOf.get(two[0].island.id) <= shelfOf.get(two[1].island.id) ? two : [two[1], two[0]], id = `${A.port.key}|${B.port.key}`;
    if (!pairs.has(id)) {
      const [sa, sb] = [shelfOf.get(A.island.id) + 1, shelfOf.get(B.island.id) + 1];
      pairs.set(id, { id, A, B, street: sa, rows: Array.from({ length: sb - sa }, (_, k) => sa + k), links: [] });
    }
    pairs.get(id).links.push({ link, A, B });
  }
  const sea = [...pairs.values()];
  const table = shelves.map((list) => list.map((s) => ({ id: s.id, w: s.w })));
  for (const w of [...sea].sort((p, q) => p.rows.length - q.rows.length)) for (const r of w.rows) table[r].push({ id: `${w.id}@${r}`, w: 0, way: true });
  const ties = sea.flatMap((w) => w.rows.slice(1).map((r) => ({ up: `${w.id}@${r - 1}`, upDx: 0, down: `${w.id}@${r}`, downDx: 0 })));
  const x = placed(table, ties, { ...z, gap: z.sea }, (name, snap) => stage(`sea: ${name}`, snap));
  const portX = (h) => x.get(h.island.id) + h.island.frame.content[0] + h.port.x;
  const geo = (h) => ({ side: 'bottom', row: shelfOf.get(h.island.id), box: { x: x.get(h.island.id), y: 0, w: h.island.w, h: h.island.h }, x: portX(h) });
  const wires = sea.map((w) => ({ id: w.id, A: w.A, B: w.B, a: geo(w.A), b: geo(w.B), street: w.street, merge: {}, stops: [portX(w.A), ...w.rows.map((r) => x.get(`${w.id}@${r}`)), portX(w.B)] }));
  const streets = streetsOf(shelves.map((list) => Math.max(...list.map((s) => s.h))), wires, { ...z, street_least: z.sea });
  stage('sea: streets', { rowY: streets.rowY, streetH: streets.streetH });
  const places = new Map(), frames = [], parts = [], drawn = [];
  for (const s of laid) {
    const [ox, oy] = [x.get(s.id), streets.rowY[shelfOf.get(s.id)]], [ix, iy] = [ox + s.frame.content[0], oy + s.frame.content[1]];
    const move = (pts) => pts.map(([px, py]) => [px + ix, py + iy]);
    frames.push({ ...s.frame, id: s.id, title: s.title, x: ox, y: oy, w: s.w, h: s.h, steps: [...s.inner.places.keys()] });
    for (const [id, p] of s.inner.places) places.set(id, { ...p, x: p.x + ix, y: p.y + iy });
    for (const p of s.inner.parts) parts.push({ ...p, points: move(p.points) });
    for (const w of s.inner.wires) if (w.kind !== 'out') drawn.push({ ...w, points: move(w.points) });
    s.moved = move;
  }
  // A link between islands drawn whole: its half in one island, the sea, its half in the other, the head where it was.
  sea.forEach((s, k) => {
    const across = routed({ ...wires[k], track: streets.track.get(s.id) }, streets.rowY);
    for (const { link, A, B } of s.links) {
      const pick = (h) => h.island.inner.wires.find((v) => v.id === link), [ha, hb] = [pick(A), pick(B)];
      const points = simplified([...A.island.moved(ha.points), ...across, ...[...B.island.moved(hb.points)].reverse()]);
      drawn.push({ id: link, link: ha.link, type: ha.type, kind: 'sea', head: ha.head === 'a' ? 'a' : hb.head === 'a' ? 'b' : '', start: ha.start, points });
    }
  });
  const w = Math.max(0, ...table.flat().map((e) => x.get(e.id) + e.w));
  return { places, islands: frames, wires: drawn, parts, w, h: streets.bottom };
}
