// Cola on islands (task e_x7kwbu3e): the whole answer laid out by cola at once (./layout.js), each island framed by the
// kit's band (./bands.js), its name and legend over its steps, the islands parted by the sea. In the flow's drawing this
// module stands where the flow's own archipelago does. Layer: metrics. Pure but for WebCola: the groups in, one model out.

import { band } from './bands.js';
import { finish } from './land.js';
import { laidOut } from './layout.js';
import { model } from './model.js';
import { stage } from './stage.js';

/** The islands an answer's items live on, in the order they come. */
export const islandsOf = (items) => [...new Set(items.map((i) => i.island).filter(Boolean))];

/**
 * Each island's items and links, with the kit's graph of them for its legend (no layout: cola lays out the whole at
 * once in `compose`), and the links that join two of them.
 */
export function islandModels({ items, links, run }) {
  const where = new Map(items.map((i) => [i.id, i.island ?? null]));
  const ids = [...islandsOf(items), ...(items.some((i) => !i.island) ? [null] : [])];
  // `run` is the flow's call of this layout; its args, without the items, are what every group is laid out with.
  let args = null;
  const groups = ids.map((id) => {
    const own = items.filter((i) => where.get(i.id) === id), set = new Set(own.map((i) => i.id)), inner = links.filter((l) => set.has(l.from) && set.has(l.to));
    return { id, items: own, links: inner, model: legendOf(own, inner, () => (args ??= run({ items: [], links: [] }).raw.args)) };
  });
  const cross = links.filter((l) => where.has(l.from) && where.has(l.to) && where.get(l.from) !== where.get(l.to));
  return { groups, cross, where, run };
}

/** What an island's legend reads of its steps: the kit's graph, with no places. */
function legendOf(items, links, argsOf) {
  const args = { ...argsOf(), items, links }, m = model(args);
  return { all: [...m.nodes.values()], chains: m.chains, ties: m.ties, breaks: [], raw: { args } };
}

/** The whole picture: every group laid out by cola together, each island a band, one model as the flow's scene reads it. */
export function compose({ groups, cross }, { legends, names = new Map(), sizes }) {
  const args = { ...groups[0].model.raw.args, items: groups.flatMap((g) => g.items), links: [...groups.flatMap((g) => g.links), ...cross] };
  const frameOf = (id, w, h) => band({ w, h }, { name: names.get(id) ?? 0, legend: legends.get(id) ?? [], sizes });
  const { m, got, x, y, chains, ties } = laidOut(args, islandsOf(args.items), frameOf);
  const island = new Map(args.items.map((i) => [i.id, i.island]));
  const islands = got.islands.map((f) => ({
    id: f.id, land: [{ l: f.l, t: f.t, r: f.r, b: f.b }], name: f.name ?? [f.l, f.t], entries: f.entries,
    steps: new Set([...m.nodes.keys()].filter((id) => island.get(m.nodes.get(id).item?.id ?? id) === f.id)),
  }));
  const done = finish({ nodes: m.nodes, x, y, chains, ties, potential: m.potential, margin: sizes.cola_margin, islands });
  stage('finish', { chains: done.chains.map((w) => w.points), ties: done.ties.map((w) => w.points) });
  return done;
}
