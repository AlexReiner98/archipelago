// The rows layout in the flow's drawing (task e_95d3fn63): the kit's graph (./model.js) turned into the rows model,
// laid out by rows (./rows.js), and handed back as the model the flow's scene draws: wires into one item cut to one
// trunk (./bundle.js), every end landed (./land.js). In the flow's drawing this module stands where the flow's own
// layout does. Layer: metrics. Pure: the layout's args in, the model the scene draws out.

import { bundle } from './bundle.js';
import { finish } from './land.js';
import { model } from './model.js';
import { lengthsOf, rowsOf } from './rows.js';
import { stage } from './stage.js';

export { stages } from './stage.js';

/**
 * The kit's graph as the rows model: each step an item, the order's chains and the ties to actors in the order (their
 * `to` drawn above), every other tie as it is. Each link keeps the kit's wire it came from (`kit`), whose `b` is
 * where its head is.
 */
export function rowsModel(m) {
  const made = (n) => String(n).padStart(String(m.nodes.size).length, '0');
  const items = [...m.nodes.values()].map((n) => ({ id: n.id, w: n.w, h: n.h, island: n.item?.island ?? null, made: made(n.made) }));
  const links = [
    ...m.chains.map((c, k) => ({ id: `c${k}`, from: c.b, to: c.a, type: 'depends_on', order: true, kit: c, kind: 'chain' })),
    ...m.ties.map((t, k) => ({ id: `t${k}`, ...(t.flipped ? { from: t.b, to: t.a, order: true } : { from: t.a, to: t.b, order: false }), type: t.type, kit: t, kind: 'tie' })),
  ];
  return { items, links, islands: [] };
}

/**
 * The picture rows drew, as the scene's model before it is landed: each step's middle, each wire's points from the
 * kit's `a` to its `b`, wires into one item cut to one trunk, a part's tie along its spine, all moved by `margin`.
 */
export function sceneOf(m, rm, pic, margin) {
  const at = (p) => [p[0] + margin, p[1] + margin], x = new Map(), y = new Map();
  for (const [id, b] of pic.places) (x.set(id, b.x + b.w / 2 + margin), y.set(id, b.y + b.h / 2 + margin));
  const drawn = new Map();
  for (const w of pic.wires) {
    const kit = w.link.kit, points = (w.start === kit.a ? w.points : [...w.points].reverse()).map(at);
    if (!drawn.has(w.link.id)) drawn.set(w.link.id, { link: w.link, points, back: w.kind === 'back' });
  }
  // A part's tie runs along its whole's spine, from the part.
  const partOf = new Map(pic.parts.map((p) => [`${p.part} ${p.whole}`, p.points]));
  for (const l of rm.links) {
    const spine = l.type === 'part_of' && partOf.get(`${l.from} ${l.to}`);
    if (spine && !drawn.has(l.id)) drawn.set(l.id, { link: l, points: [...spine].reverse().map(at) });
  }
  // Wires of a type into one item run on one another: one trunk, each cut where it leaves it.
  const groups = new Map();
  for (const d of drawn.values()) (groups.get(`${d.link.type}>${d.link.kit.b}`) ?? groups.set(`${d.link.type}>${d.link.kit.b}`, []).get(`${d.link.type}>${d.link.kit.b}`)).push(d);
  const chains = [], ties = [];
  for (const list of groups.values()) {
    const cut = list.length > 1 ? bundle(list.map((d) => ({ points: d.points, hub: 'b' }))) : list;
    list.forEach((d, k) => {
      const { stop, toPort } = cut[k], wire = { ...d.link.kit, points: cut[k].points, ...(stop && { stop }), ...(toPort && { toPort }), ...(d.back && { dashed: true }) };
      (d.link.kind === 'chain' ? chains : ties).push(wire);
    });
  }
  return { x, y, chains, ties };
}

/** The model the flow's scene draws, of one group laid out by rows with no island frame. */
export function layout(args) {
  const m = model(args), rm = rowsModel(m), M = args.sizes.flow_margin;
  for (const i of rm.items) i.island = null;
  const pic = rowsOf(rm, lengthsOf(args.sizes, args.aspect ?? 1), stage, (id, w, h) => ({ w, h, content: [0, 0] }));
  const { x, y, chains, ties } = sceneOf(m, rm, pic, M);
  const done = finish({ nodes: m.nodes, x, y, chains, ties, potential: m.potential, margin: M });
  stage('finish', { chains: done.chains.map((w) => w.points), ties: done.ties.map((w) => w.points) });
  return Object.assign(done, { raw: { args } });
}
