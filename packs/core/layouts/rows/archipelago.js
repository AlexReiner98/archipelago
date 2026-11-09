// Rows on islands (task e_95d3fn63): the whole answer laid out by rows at once, each island framed by the kit's band
// (./bands.js), its name and legend over it, the islands in shelves made first and a link between two of them run
// through the sea under the shelves (./sea.js). In the flow's drawing this module stands where the flow's own
// archipelago does. Layer: metrics. Pure: the groups and their layout in, one model out.

import { band } from './bands.js';
import { finish } from './land.js';
import { sceneOf, rowsModel } from './layout.js';
import { model } from './model.js';
import { lengthsOf, rowsOf } from './rows.js';
import { stage } from './stage.js';

/** The islands an answer's items live on, in the order they come. */
export const islandsOf = (items) => [...new Set(items.map((i) => i.island).filter(Boolean))];

/** Each island's items laid out alone by `run` (this layout), for its legend, and the links that join two of them. */
export function islandModels({ items, links, run }) {
  const where = new Map(items.map((i) => [i.id, i.island ?? null]));
  const ids = [...islandsOf(items), ...(items.some((i) => !i.island) ? [null] : [])];
  const groups = ids.map((id) => {
    const own = items.filter((i) => where.get(i.id) === id), set = new Set(own.map((i) => i.id)), inner = links.filter((l) => set.has(l.from) && set.has(l.to));
    return { id, items: own, links: inner, model: run({ items: own, links: inner }) };
  });
  const cross = links.filter((l) => where.has(l.from) && where.has(l.to) && where.get(l.from) !== where.get(l.to));
  return { groups, cross, where, run };
}

/** The whole picture: every group's items and links laid out by rows together, one model as the flow's scene reads it. */
export function compose({ groups, cross }, { legends, names = new Map(), sizes }) {
  const args = { ...groups[0].model.raw.args, items: groups.flatMap((g) => g.items), links: [...groups.flatMap((g) => g.links), ...cross] };
  const m = model(args), rm = rowsModel(m), M = sizes.flow_margin;
  const frameOf = (id, w, h) => band({ w, h }, id ? { name: names.get(id) ?? 0, legend: legends.get(id) ?? [], sizes } : { shore: false, sizes });
  const pic = rowsOf(rm, lengthsOf(sizes, args.aspect ?? 1), stage, frameOf);
  const { x, y, chains, ties } = sceneOf(m, rm, pic, M);
  const to = (f, p) => [p[0] + f.x + M, p[1] + f.y + M];
  const islands = pic.islands.filter((f) => f.id && f.land).map((f) => ({
    id: f.id, land: [{ l: f.x + M, t: f.y + M, r: f.x + f.w + M, b: f.y + f.h + M }], name: f.name ? to(f, f.name) : [f.x + M, f.y + M],
    entries: f.entries.map((e) => to(f, e)), steps: new Set(f.steps),
  }));
  const done = finish({ nodes: m.nodes, x, y, chains, ties, potential: m.potential, margin: M, islands });
  stage('finish', { chains: done.chains.map((w) => w.points), ties: done.ties.map((w) => w.points) });
  return done;
}
