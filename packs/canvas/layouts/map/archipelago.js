// The layout on islands (hub e_9uhaqhwe): the whole picture laid out at once (./layout.js), each island's header sized
// first (its name, its legend under it), so the layout leaves the room for it, and each island framed where it stands. Layer: metrics. Pure: the answer's parts in, the model the flow's scene draws out.

import { finish } from './land.js';
import { laidOut } from './layout.js';
import { stage } from './stage.js';

/** The islands an answer's items live on, in the order they come. */
export const islandsOf = (items) => [...new Set(items.map((i) => i.island).filter(Boolean))];

/**
 * Each island's items and links, for its legend: the kit's plain graph of each (`run` asked for no places), and the
 * args the whole picture is laid out with.
 */
export function islandModels({ items, links, run }) {
  const where = new Map(items.map((i) => [i.id, i.island ?? null]));
  const ids = [...islandsOf(items), ...(items.some((i) => !i.island) ? [null] : [])];
  const groups = ids.map((id) => {
    const own = items.filter((i) => where.get(i.id) === id), set = new Set(own.map((i) => i.id)), inner = links.filter((l) => set.has(l.from) && set.has(l.to));
    return { id, items: own, links: inner, model: run({ items: own, links: inner, extras: { plain: true } }) };
  });
  // The args the whole picture is laid out with: asked of the layout, not made into a graph that would go unread.
  const all = run({ items, links, extras: { plain: true, args: true } });
  return { groups, where, items, links, args: all.args };
}

/**
 * Entries of the given widths, a row each: each one's top left, and the size of all. Entries that say their group
 * ({ w, group }: its types, its links, its counts) stand a column a group, in the order they come, so a link type never
 * stands under the types (study e_unru8ftt); a group after the first that is not the add row starts a column. Bare
 * widths stand in `columns` columns of even length. Where `most` is more than none, no column is longer than that many rows:
 * a column that would be goes on in the next, so a long key is wide and low, never one column down the island's side.
 */
export function columned(entries, columns, gap, row, most = 0) {
  const ws = entries.map((e) => (typeof e === 'number' ? e : e?.w ?? 0)), groups = entries.map((e) => (typeof e === 'number' ? null : e?.group ?? null));
  const grouped = groups.some((g) => g !== null), per = most > 0 ? most : Math.max(1, Math.ceil(ws.length / columns)), at = [];
  let x = 0, wide = 0, y = 0, tall = 0;
  ws.forEach((w, k) => {
    const breaks = (grouped ? k > 0 && groups[k] !== groups[k - 1] && groups[k] !== 'add' : k && k % per === 0) || (grouped && most > 0 && y >= most);
    if (breaks) (x += wide + gap), (wide = 0), (y = 0);
    at.push([x, y * row]);
    wide = Math.max(wide, w);
    tall = Math.max(tall, ++y);
  });
  return { at, w: ws.length ? x + wide : 0, h: tall * row };
}

/** The whole picture laid out at once, each island framed where it stands with its name and legend over what it holds. */
export function compose({ where, items, links, args }, { legends, names = new Map(), sizes, numbers = {}, rooms = new Map(), follows = new Map() }) {
  const z = (k) => sizes[`flow_island_${k}`], [PAD, ROOM, GAP, ROW, COLUMNS] = ['pad', 'name_room', 'legend_gap', 'legend_row', 'legend_columns'].map(z);
  // The header may grow up to the style's flow_island_head_most as the camera zooms out (../flow/islands.js,
  // .lf-head-scale; 1, as the house has it, is a header that scales with its island, one piece), from its foot: up into the sea, the island's top rising with it, never down over what it holds
  // (verdict e_enzjk53r: no band of empty land under it). Its room on the land is its size at 1; beside it, at its most;
  // above every island, the sea it may rise into (`rise`).
  const MOST = Number.isFinite(numbers.flow_island_head_most) && numbers.flow_island_head_most > 1 ? numbers.flow_island_head_most : null;
  const grown = (d) => (MOST ? (PAD + d) * MOST - PAD : d);
  const keys = new Map([...legends].map(([id, rows]) => [id, columned(rows, COLUMNS, GAP, ROW, z('legend_rows') ?? 0)]));
  const heads = new Map([...keys].map(([id, key]) => [id, (names.get(id) ? ROOM : 0) + (key.h ? key.h + GAP : 0)]));
  const rise = MOST ? Math.max(0, ...[...heads.values()].map((h) => (MOST - 1) * (PAD + h))) : 0;
  // Its frame at least as wide as its header: its name (and what follows it, its packs) from its pad, and the pad after.
  const wides = new Map([...names].filter(([, w]) => typeof w === 'number').map(([id, w]) => [id, PAD + grown(PAD + w - sizes.flow_island_name_x)]));
  // And at least as wide as its legend, a column a group of it.
  for (const [id, key] of keys) if (key.w) wides.set(id, Math.max(wides.get(id) ?? 0, PAD + grown(PAD + key.w)));
  // An island whose room is said (a pack's parts, ../flow/parts-islands.js) holds that room as its header, at least as wide.
  for (const [id, r] of rooms) heads.set(id, r.h - PAD), wides.set(id, r.w);
  const a = laidOut({ ...args, items, links, rise }, { islandOf: (id) => where.get(id) ?? null, heads, wides, follows });
  const shores = a.islands.map((i) => {
    // The name and legend stand in the top left of the highest band of its land.
    const top = [...i.land].sort((p, q) => p.t - q.t || p.l - q.l)[0], [l, t] = [top.l, top.t], key = keys.get(i.id) ?? { at: [] }, named = names.get(i.id);
    return {
      id: i.id, land: i.land, ...(i.look && { look: i.look }), ...(i.canvas && { canvas: i.canvas }), name: named ? [l + PAD - sizes.flow_island_name_x, t + PAD + ROOM / 2] : [l, t],
      entries: key.at.map(([ex, ey]) => [l + PAD + ex, t + PAD + (named ? ROOM : 0) + ey]),
      // The header's foot, where it grows from, on a land of one band (one with more keeps it at its size).
      ...(i.land.length === 1 && heads.has(i.id) && !rooms.has(i.id) && { foot: t + PAD + heads.get(i.id) }), steps: new Set(items.filter((it) => where.get(it.id) === i.id).map((it) => it.id)),
    };
  });
  const done = finish({ nodes: a.nodes, x: a.x, y: a.y, chains: a.chains, ties: a.ties, potential: a.m.potential, margin: sizes.flow_margin, islands: shores });
  stage('finish', { chains: done.chains.map((w) => w.points), ties: done.ties.map((w) => w.points) });
  return done;
}
