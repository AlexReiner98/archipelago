// The one layout on islands (hub e_9uhaqhwe): not each island alone and a sea between, but the whole picture in one
// solve (./layout.js), its islands closed loops the wires cross at ports. Here each island's header is sized first
// (./bands.js's rule: its name, its legend under it), so the relaxation leaves the room for it, and each island framed
// as the solve placed it. Layer: metrics. Pure: the answer's parts in, the model the flow's scene draws out.

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
  const all = run({ items, links, extras: { plain: true } });
  return { groups, where, items, links, args: all.args };
}

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

/** The whole picture in one solve, each island framed where it stands with its name and legend over what it holds. */
export function compose({ where, items, links, args }, { legends, names = new Map(), sizes }) {
  const z = (k) => sizes[`flow_island_${k}`], [PAD, ROOM, GAP, ROW, COLUMNS] = ['pad', 'name_room', 'legend_gap', 'legend_row', 'legend_columns'].map(z);
  const keys = new Map([...legends].map(([id, rows]) => [id, columned(rows, COLUMNS, GAP, ROW)]));
  const heads = new Map([...keys].map(([id, key]) => [id, (names.get(id) ? ROOM : 0) + (key.h ? key.h + GAP : 0)]));
  const a = laidOut({ ...args, items, links }, { islandOf: (id) => where.get(id) ?? null, heads });
  const shores = a.islands.map((i) => {
    // The name and legend stand in the top left of the highest band of its land.
    const top = [...i.land].sort((p, q) => p.t - q.t || p.l - q.l)[0], [l, t] = [top.l, top.t], key = keys.get(i.id) ?? { at: [] }, named = names.get(i.id);
    return {
      id: i.id, land: i.land, name: named ? [l + PAD - sizes.flow_island_name_x, t + PAD + ROOM / 2] : [l, t],
      entries: key.at.map(([ex, ey]) => [l + PAD + ex, t + PAD + (named ? ROOM : 0) + ey]), steps: new Set(items.filter((it) => where.get(it.id) === i.id).map((it) => it.id)),
    };
  });
  const done = finish({ nodes: a.nodes, x: a.x, y: a.y, chains: a.chains, ties: a.ties, potential: a.m.potential, margin: sizes.flow_margin, islands: shores });
  stage('finish', { chains: done.chains.map((w) => w.points), ties: done.ties.map((w) => w.points) });
  return a.unwired ? Object.assign(done, { unwired: a.unwired }) : done;
}
