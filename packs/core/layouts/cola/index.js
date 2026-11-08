// The cola layout (task e_x7kwbu3e): a model laid out by constrained stress and wired at right angles, in four steps,
// each a module of its own with a snapshot for the explainer: the order (./order.js), the places (./start.js,
// ./place.js), the wires (./route.js) and the frames (./frame.js). The model is the shared kit's: items { id, w, h, island, made }, links
// { id, from, to, type, order }, islands. WebCola is handed in (`cola`); `stage(name, snapshot)` keeps each step.

import { orderOf } from './order.js';
import { startOf } from './start.js';
import { placeOf } from './place.js';
import { routeOf } from './route.js';
import { framed } from './frame.js';

/** The style's lengths and counts for cola, each named in the house style (packs/core/pack.json). */
export function lengthsOf(sizes) {
  const need = (n) => {
    if (typeof sizes[n] !== 'number') throw new Error(`The style names no number "${n}": the house style names every one the cola layout uses`);
    return sizes[n];
  };
  return {
    gap: need('cola_gap'), rise: need('cola_rise'), sea: need('cola_sea'), pad: need('cola_island_pad'), link: need('cola_link'), across: need('cola_across'),
    channel: need('cola_channel'), bend: need('cola_bend'), margin: need('cola_margin'), free: need('cola_free'), held: need('cola_held'), all: need('cola_all'), settled: need('cola_settled'),
  };
}

const copy = (v) => JSON.parse(JSON.stringify(v));

/** Places and wires: { boxes, islands, width, height, wires, dropped }. */
export function colaLayout(model, sizes, cola, stage = () => {}) {
  const z = lengthsOf(sizes);
  const order = orderOf(model);
  stage('order', { kept: copy(order.kept), dropped: order.dropped.map((l) => l.id), layer: Object.fromEntries(order.layer) });
  const start = startOf(model, order.layer, { gap: z.gap, rise: z.rise, sea: z.sea });
  stage('start', { boxes: model.items.map((it) => ({ id: it.id, ...start.get(it.id), w: it.w, h: it.h })) });
  const places = placeOf(model, order, start, z, cola);
  stage('placed', copy(places));
  const wires = routeOf(model, places, z, cola);
  stage('routed', { wires: copy(wires) });
  const done = framed(model, places, wires, z);
  stage('framed', copy(done));
  return { ...done, dropped: order.dropped.map((l) => l.id) };
}
