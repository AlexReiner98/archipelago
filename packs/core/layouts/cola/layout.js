// The cola layout in the flow's drawing (task e_x7kwbu3e): the kit's graph (./model.js) turned into cola's model, laid
// out by cola (./cola.js) and handed back as the model the flow's scene draws,
// every end landed (./land.js). Wires that run side by side are already parted into channels, so none is bundled. In
// the flow's drawing this module stands where the flow's own layout does. WebCola is handed in once by the drawing's
// entry (./entry.js, `useCola`). Layer: metrics. Pure but for WebCola: the layout's args in, the model the scene draws out.

import { colaLayout } from './cola.js';
import { finish } from './land.js';
import { model } from './model.js';
import { stage } from './stage.js';

export { stages } from './stage.js';

/** WebCola, as the drawing's tools gave it (ui/cola.module.min.js). */
let lib = null;
export const useCola = (cola) => (lib = cola);
const colaOf = (args) => {
  const cola = args.cola ?? lib;
  if (!cola) throw new Error('The cola layout needs WebCola: the drawing gives it as tools.cola(), the entry (cola/entry.js) hands it in');
  return cola;
};

/**
 * The kit's graph as cola's model: each step an item, the order's chains and the ties to actors as order links (their
 * `a` drawn above), every other tie as it is. Each link keeps the kit's wire it came from (`kit`), `kind` saying which.
 */
export function colaModel(m, islands = []) {
  const items = [...m.nodes.values()].map((n) => ({ id: n.id, w: n.w, h: n.h, island: n.item?.island ?? null, made: n.made }));
  const links = [
    ...m.chains.map((c, k) => ({ id: `c${k}`, from: c.b, to: c.a, type: 'depends_on', order: true, kit: c, kind: 'chain' })),
    ...m.ties.map((t, k) => ({ id: `t${k}`, ...(t.flipped ? { from: t.b, to: t.a, order: true } : { from: t.a, to: t.b, order: false }), type: t.type, kit: t, kind: 'tie' })),
  ];
  return { items, links, islands: islands.map((id) => ({ id })) };
}

/** What cola drew, as the scene's model before it is landed: each step's middle, each wire the kit's, from its `a` to its `b`. */
export function sceneOf(cm, got) {
  const x = new Map(got.boxes.map((b) => [b.id, b.x])), y = new Map(got.boxes.map((b) => [b.id, b.y]));
  const link = new Map(cm.links.map((l) => [l.id, l])), chains = [], ties = [];
  for (const w of got.wires) {
    const l = link.get(w.link);
    (l.kind === 'chain' ? chains : ties).push({ ...l.kit, points: w.from === l.kit.a ? w.points : [...w.points].reverse() });
  }
  return { x, y, chains, ties };
}

/** The whole of `args` laid out by cola, each island framed by `frameOf` (none, where it is not given). */
export function laidOut(args, islands, frameOf) {
  const m = model(args), cm = colaModel(m, islands);
  const got = colaLayout(cm, args.sizes, colaOf(args), stage, frameOf);
  return { m, got, ...sceneOf(cm, got) };
}

/** The model the flow's scene draws, of one group laid out by cola with no island frame. */
export function layout(args) {
  if (!args.items.length) return Object.assign(finish({ nodes: new Map(), x: new Map(), y: new Map(), chains: [], ties: [], margin: args.sizes.cola_margin }), { raw: { args } });
  const { m, x, y, chains, ties } = laidOut(args, []);
  const done = finish({ nodes: m.nodes, x, y, chains, ties, potential: m.potential, margin: args.sizes.cola_margin });
  stage('finish', { chains: done.chains.map((w) => w.points), ties: done.ties.map((w) => w.points) });
  return Object.assign(done, { raw: { args } });
}
