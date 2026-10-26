// A flow's layout, apart from its drawing (the core pack's flow drawing, index.js): a flat graph on one plane, where
// depth is never drawn (e_ktdensts). Every item is a step. depends_on is the order: a step leads to another when the
// other depends on it, read from the top down and routed at right angles. Every other link (part_of first) is a quiet
// tie that pulls its two ends near and is drawn straight; nothing is grouped, boxed or nested. What is tied together
// is one cluster, laid out by Sugiyama's method (layers by longest path along the order, a waypoint where a wire
// passes a layer, barycentre sweeps and, while it is small, a search of the layers and sifting for the order, then
// straightened) and its wires routed each on a track of its own. A step in no order sits a layer under what it is
// part of, or a layer above the first of what is part of it. A step put by hand (`placed`) stays exactly where it was
// put; the clusters are set round it, and the wires to it are solved at right angles (./free.js). What follows an
// open question is a scenario, and a choice nothing follows yet ends in a step of its own. Pure: an answer in,
// geometry out; `measure(text, px)` gives a title's width at a size.

import { drawnPaths, field, route, take, tieRoute } from './free.js';
import { acyclic, flatten, grouped, highest, lowest, NEAR, ORDER, QUIET, reduced } from './graph.js';

/** Past this many steps in a cluster the layer search and the sifting are skipped: they grow with the square of the steps. */
export const LARGE = 60;
/** More than this many steps part of one, tied to nothing else and in no order, are wrapped in rows under it. */
export const ACROSS = 6;
/** The shape a large picture is wrapped toward, as wide as tall times this: about a page's. */
export const ASPECT = 1.6;

/**
 * The steps (each with its place x, y and size w, h), the wires of the order (`chains`, each with its points), the
 * ties (each with its two points), the breaks and the whole size. Every length and count it lays out by is the
 * style's (`sizes` and `numbers`, flow_*): the house style in packs/core/pack.json names each, and a nearer style may
 * change any. `placed` is where steps were put by hand, their middles by item.
 */
export function layout({ items: given, links: told = [], undrawn = [], placed = {}, measure, sizes }) {
  const need = (set, name) => {
    if (typeof set?.[name] !== 'number') throw new Error(`The style names no "${name}": the house style names every one the flow lays out by`);
    return set[name];
  };
  const [LAYER_GAP, NODE_GAP, MARGIN, MAX_TEXT, TRACK, SLOT, LEAD_OUT, LEAD_IN] = ['flow_layer_gap', 'flow_node_gap', 'flow_margin', 'flow_max_text', 'flow_track', 'flow_slot', 'flow_lead_out', 'flow_lead_in'].map((n) => need(sizes, n));
  const [TEXT, STUB_TEXT] = ['flow_text', 'flow_stub_text'].map((n) => need(sizes, n));
  const [DIAMOND_PAD, DIAMOND_H, END_PAD, END_H, BOX_PAD, BOX_H, SHEET_H] = ['flow_diamond_pad', 'flow_diamond_height', 'flow_end_pad', 'flow_end_height', 'flow_box_pad', 'flow_box_height', 'flow_sheet_height'].map((n) => need(sizes, n));
  const { items, links } = flatten({ items: given, links: told, undrawn });
  const shapeOf = (i) => (i.kind === 'question' ? 'diamond' : i.kind === 'occurrence' ? 'pill' : i.kind === 'record' ? 'sheet' : 'box');
  const nodes = new Map();
  for (const i of [...items].sort((a, b) => (a.place ?? 0) - (b.place ?? 0))) nodes.set(i.id, { id: i.id, item: i, shape: shapeOf(i) });
  if (!nodes.size) return { nodes, all: [], chains: [], ties: [], breaks: [], potential: new Set(), x: new Map(), y: new Map(), width: 0, height: 0 };

  // ---- The order (a leads to b when b depends on a; a line that says something says which option it follows), and
  // the ties: every other link, from what is part of to what it is part of.
  const seen = new Set();
  let edges = [];
  for (const l of links) if (l.type === ORDER && !seen.has(`${l.to} ${l.from}`)) (seen.add(`${l.to} ${l.from}`), edges.push({ a: l.to, b: l.from, ...(l.says && { says: l.says }), ...(l.pending && { pending: l.pending }) }));
  edges = reduced(acyclic(edges, [...nodes.keys()]));
  const ties = links.filter((l) => l.type !== ORDER).map((l) => ({ a: l.from, b: l.to, type: l.type, ...(l.pending && { pending: l.pending }) }));

  // An open question's choices: each one no wire follows yet ends in a pill of its own.
  const decisions = [...nodes.values()].filter((n) => n.shape === 'diamond' && n.item.open);
  for (const d of decisions) {
    const taken = new Set(edges.filter((e) => e.a === d.id).map((e) => e.says));
    (Array.isArray(d.item.choices) ? d.item.choices : []).forEach((option, k) => {
      if (taken.has(option)) return;
      const id = `${d.id}:${k}`;
      nodes.set(id, { id, stub: true, shape: 'end', item: { id: d.id, title: option, open: true, status: 'a scenario', state: QUIET } });
      edges.push({ a: d.id, b: id, says: option });
    });
  }
  // What follows an open decision happens only if that option is chosen.
  const after = grouped(edges, (e) => e.a, (e) => e.b), potential = new Set();
  const markOn = (id) => (after.get(id) ?? []).forEach((v) => potential.has(v) || (potential.add(v), markOn(v)));
  decisions.forEach((d) => markOn(d.id));

  // ---- Sizes: a step is as wide as its name.
  for (const n of nodes.values()) {
    const text = Math.min(measure(n.item.title, n.stub ? STUB_TEXT : TEXT), MAX_TEXT);
    if (n.shape === 'diamond') [n.w, n.h] = [text + DIAMOND_PAD, DIAMOND_H];
    else if (n.shape === 'end') [n.w, n.h] = [text + END_PAD, END_H];
    else [n.w, n.h] = [text + BOX_PAD, n.shape === 'sheet' ? SHEET_H : BOX_H];
  }

  // ---- Clusters: what the order and the ties join, apart from the steps put by hand.
  const fixed = new Set(Object.keys(placed).filter((id) => nodes.has(id) && Array.isArray(placed[id])));
  const root = new Map([...nodes.keys()].map((id) => [id, id]));
  const find = (id) => {
    while (root.get(id) !== id) (root.set(id, root.get(root.get(id))), (id = root.get(id)));
    return id;
  };
  for (const { a, b } of [...edges, ...ties]) if (!fixed.has(a) && !fixed.has(b)) root.set(find(b), find(a));
  const clusters = grouped([...nodes.keys()].filter((id) => !fixed.has(id)), find);
  const x = new Map(), y = new Map();

  /** One cluster laid out from its own corner: its places in x and y, its wires, breaks and size. */
  const lay = (ids, edges, ties) => {
    const large = ids.length > LARGE;
    const ins = grouped(edges, (e) => e.b, (e) => e.a), outs = grouped(edges, (e) => e.a, (e) => e.b);
    const flows = (id) => ins.has(id) || outs.has(id);
    // Layers: each step of the order one below the lowest it follows, to start with.
    const asap = new Map(), indeg = new Map(ids.filter(flows).map((id) => [id, (ins.get(id) ?? []).length]));
    const queue = [...indeg.keys()].filter((id) => !indeg.get(id));
    queue.forEach((id) => asap.set(id, 0));
    for (let k = 0; k < queue.length; k++)
      for (const v of outs.get(queue[k]) ?? []) {
        asap.set(v, Math.max(asap.get(v) ?? 0, asap.get(queue[k]) + 1));
        indeg.set(v, indeg.get(v) - 1);
        if (!indeg.get(v)) queue.push(v);
      }
    // A step in no order takes its layer from its ties: a layer above the first of what is part of it, a layer under
    // what it is part of or is otherwise tied to, so every tie runs from one layer to another and pulls in the order.
    // Nothing more than that is drawn of depth: what is part of something is not inside it.
    const near = new Map();
    for (const t of ties) {
      (near.get(t.a) ?? near.set(t.a, []).get(t.a)).push({ id: t.b, rel: t.type === NEAR ? 'parent' : 'beside' });
      (near.get(t.b) ?? near.set(t.b, []).get(t.b)).push({ id: t.a, rel: t.type === NEAR ? 'child' : 'beside' });
    }
    for (const id of ids) {
      const kids = asap.has(id) ? [] : (near.get(id) ?? []).filter((t) => t.rel === 'child' && flows(t.id));
      if (kids.length) asap.set(id, lowest(kids.map((t) => asap.get(t.id))) - 1);
    }
    const spread = (from) => {
      for (let k = 0; k < from.length; k++)
        for (const { id, rel } of near.get(from[k]) ?? []) {
          if (asap.has(id)) continue;
          const at = asap.get(from[k]);
          asap.set(id, rel === 'parent' ? at - 1 : at + 1);
          from.push(id);
        }
    };
    spread([...asap.keys()]);
    for (const id of ids) if (!asap.has(id)) (asap.set(id, 0), spread([id]));
    // Many leaves of one (part of it, tied to nothing else) wrap in rows under it.
    for (const id of ids) {
      const leaves = (near.get(id) ?? []).filter((t) => t.rel === 'child' && !flows(t.id) && near.get(t.id).length === 1 && asap.get(t.id) === asap.get(id) + 1);
      if (leaves.length > ACROSS) leaves.forEach((t, k) => asap.set(t.id, asap.get(id) + 1 + Math.floor(k / ACROSS)));
    }
    // In a large cluster, a layer wider than the picture should be wraps into rows, each a layer of its own, and pushes
    // what is under it down: the order still reads from the top down, and a large map comes out about the page's
    // shape, not one band. The width is the one that makes the whole about ASPECT times as wide as tall; what is part
    // of one thing stays together in a row. Only steps in no order wrap: a step of the order keeps its layer, so the
    // order's wires gain no waypoints from the rows.
    const wide = (id) => nodes.get(id).w + NODE_GAP;
    const across = Math.max(highest(ids.map(wide)), Math.sqrt(ASPECT * (BOX_H + LAYER_GAP) * ids.reduce((s, id) => s + wide(id), 0)));
    const byLayer = grouped(ids, (id) => asap.get(id));
    const parentOf = (id) => (near.get(id) ?? []).find((t) => t.rel === 'parent')?.id ?? '';
    let added = 0;
    if (large) for (const k of [...byLayer.keys()].sort((p, q) => p - q)) {
      const list = byLayer.get(k).sort((p, q) => Number(!flows(p)) - Number(!flows(q)) || (parentOf(p) < parentOf(q) ? -1 : parentOf(p) > parentOf(q) ? 1 : 0));
      let row = 0, run = 0;
      for (const id of list) {
        if (flows(id)) {
          asap.set(id, k + added);
          run += wide(id);
          continue;
        }
        if (run > 0 && run + wide(id) > across) (row++, (run = 0));
        asap.set(id, k + added + row);
        run += wide(id);
      }
      added += row;
    }
    const least = lowest([...asap.values()]);
    for (const [id, k] of asap) asap.set(id, k - least);

    // An arrangement of given layers: each wire with a waypoint in every layer it passes, and the order in each
    // layer with the fewest crossings (barycentre sweeps, then, while small, each one sifted to the place in its
    // layer that takes most away). A tie pulls as a wire does, but is never counted as crossing.
    const arrange = (layerOf) => {
      const waypoints = new Map();
      const chains = edges.map((e) => {
        const path = [e.a];
        for (let k = layerOf.get(e.a) + 1; k < layerOf.get(e.b); k++) {
          const id = `${e.a}>${e.b}@${k}`;
          waypoints.set(id, { id, dummy: true, layer: k, w: 6, h: 0 });
          path.push(id);
        }
        path.push(e.b);
        return { ...e, key: `${e.a} ${e.b}`, path, dashed: potential.has(e.b) };
      });
      const layerAt = (id) => waypoints.get(id)?.layer ?? layerOf.get(id);
      const every = [...ids, ...waypoints.keys()];
      const up = new Map(every.map((id) => [id, []])), down = new Map(every.map((id) => [id, []]));
      for (const c of chains)
        for (let k = 1; k < c.path.length; k++) (down.get(c.path[k - 1]).push(c.path[k]), up.get(c.path[k]).push(c.path[k - 1]));
      const pullUp = new Map(every.map((id) => [id, [...up.get(id)]])), pullDown = new Map(every.map((id) => [id, [...down.get(id)]]));
      for (const t of ties) {
        const [p, q] = [layerAt(t.a), layerAt(t.b)];
        if (p < q) (pullDown.get(t.a).push(t.b), pullUp.get(t.b).push(t.a));
        else if (q < p) (pullDown.get(t.b).push(t.a), pullUp.get(t.a).push(t.b));
      }
      const layers = [];
      for (const id of every) (layers[layerAt(id)] ??= []).push(id);
      for (let k = 0; k < layers.length; k++) layers[k] ??= [];
      const pos = new Map();
      const index = () => layers.forEach((list) => list.forEach((id, k) => pos.set(id, k)));
      index();
      // Crossings between one layer and the one above it, and in all.
      const between = (k) => {
        if (k < 1 || k >= layers.length) return 0;
        let count = 0;
        const pairs = layers[k].flatMap((b) => up.get(b).map((a) => [pos.get(a), pos.get(b)]));
        for (let i = 0; i < pairs.length; i++) for (let j = i + 1; j < pairs.length; j++) if ((pairs[i][0] - pairs[j][0]) * (pairs[i][1] - pairs[j][1]) < 0) count++;
        return count;
      };
      const crossings = () => layers.reduce((sum, _, k) => sum + between(k), 0);
      const sweep = (k, toward) => {
        const bary = new Map(layers[k].map((id) => [id, toward.get(id).length ? toward.get(id).reduce((s, v) => s + pos.get(v), 0) / toward.get(id).length : pos.get(id)]));
        layers[k].sort((a, b) => bary.get(a) - bary.get(b));
        layers[k].forEach((id, i) => pos.set(id, i));
      };
      let best = layers.map((l) => [...l]), fewest = crossings();
      for (let round = 0; round < 24 && (fewest > 0 || round < 4); round++) {
        if (round % 2 === 0) for (let k = 1; k < layers.length; k++) sweep(k, pullUp);
        else for (let k = layers.length - 2; k >= 0; k--) sweep(k, pullDown);
        const count = crossings();
        if (count < fewest || (count === fewest && round < 4)) (fewest = count), (best = layers.map((l) => [...l]));
      }
      layers.splice(0, layers.length, ...best);
      index();
      // Sifting: each one tried at every place in its layer, and left where the fewest wires cross.
      for (let better = fewest > 0 && !large; better; ) {
        better = false;
        layers.forEach((list, layer) => {
          const near = () => between(layer) + between(layer + 1);
          for (const id of [...list]) {
            const from = list.indexOf(id);
            let where = from, least = near();
            list.splice(from, 1);
            for (let k = 0; k <= list.length; k++) {
              list.splice(k, 0, id);
              list.forEach((other, j) => pos.set(other, j));
              const count = near();
              if (count < least) ((fewest -= least - count), (least = count), (where = k), (better = true));
              list.splice(k, 1);
            }
            list.splice(where, 0, id);
            list.forEach((other, j) => pos.set(other, j));
          }
        });
      }
      return { layerOf, waypoints, chains, up, down, pullUp, pullDown, layers, crossings: fewest, span: chains.reduce((s, c) => s + c.path.length - 1, 0) };
    };
    // While small, a step of the order free to sit lower is tried in each layer it could take, and kept where the
    // fewest wires cross, then where they are shortest.
    const bottom = highest([...asap.values()]);
    const score = (a) => a.crossings * 1e4 + a.span;
    let chosen = arrange(asap);
    for (let pass = 0; pass < 2 && chosen.crossings > 0 && !large; pass++)
      for (const id of ids.filter(flows)) {
        const lo = Math.max(0, ...(ins.get(id) ?? []).map((a) => chosen.layerOf.get(a) + 1));
        const hi = outs.has(id) ? Math.min(...outs.get(id).map((b) => chosen.layerOf.get(b) - 1)) : bottom + 2;
        for (let k = lo; k <= hi; k++) {
          if (k === chosen.layerOf.get(id)) continue;
          const tried = arrange(new Map(chosen.layerOf).set(id, k));
          if (score(tried) < score(chosen)) chosen = tried;
        }
      }
    for (const [id, k] of chosen.layerOf) nodes.get(id).layer = k;
    for (const [id, w] of chosen.waypoints) nodes.set(id, w);
    const { chains, up, down, pullUp, pullDown, layers } = chosen;
    const every = layers.flat();

    // ---- Places: each step pulled toward what it is wired and tied to, in order, never overlapping.
    const gap = (a, b) => (nodes.get(a).dummy || nodes.get(b).dummy ? NODE_GAP / 2 : NODE_GAP);
    const apart = (a, b) => (nodes.get(a).w + nodes.get(b).w) / 2 + gap(a, b);
    for (const list of layers) {
      let at = 0;
      list.forEach((id, k) => (k && (at += apart(list[k - 1], id)), x.set(id, at)));
    }
    // Sugiyama's priority method: a sweep down sets each layer by the one above it, a sweep up by the one below. A
    // step wants the mean of its neighbours there, and the more of them it has the sooner it is placed; a waypoint
    // counts as a little more than one, so a long wire runs straight unless it would pull a busier step aside; a step
    // in no order is placed last, in the room the order leaves.
    const place = (k, toward) => {
      const list = layers[k];
      const want = new Map(list.map((id) => [id, toward.get(id).length ? toward.get(id).reduce((s, v) => s + x.get(v), 0) / toward.get(id).length : x.get(id)]));
      const rank = (id) => (nodes.get(id).dummy ? 1.5 : flows(id) ? toward.get(id).length : 0);
      const done = new Set();
      const index = new Map(list.map((id, k) => [id, k]));
      for (const id of [...list].sort((a, b) => rank(b) - rank(a))) {
        const k0 = index.get(id);
        // As near what it wants as the nearest steps already placed on either side let it be (they keep their room
        // from those beyond them already).
        let lo = -Infinity, hi = Infinity;
        for (let j = k0 - 1, room = 0; j >= 0 && lo === -Infinity; j--) ((room += apart(list[j], list[j + 1])), done.has(list[j]) && (lo = x.get(list[j]) + room));
        for (let j = k0 + 1, room = 0; j < list.length && hi === Infinity; j++) ((room += apart(list[j - 1], list[j])), done.has(list[j]) && (hi = x.get(list[j]) - room));
        x.set(id, Math.min(hi, Math.max(lo, want.get(id))));
        done.add(id);
      }
    };
    // A step of the order is placed by its wires alone, where it has any that way, so the order runs straight; a
    // step in none by its ties.
    const by = (wires, pulls) => new Map([...pulls].map(([id, list]) => [id, wires.get(id).length ? wires.get(id) : list]));
    const [above, below] = [by(up, pullUp), by(down, pullDown)];
    const downward = () => { for (let k = 1; k < layers.length; k++) place(k, above); };
    const upward = () => { for (let k = layers.length - 2; k >= 0; k--) place(k, below); };
    for (let round = 0; round < 4; round++) (downward(), upward());
    // Balanced: halfway between the last sweep down and the last sweep up, which keeps every gap.
    downward();
    const fromAbove = new Map(every.map((id) => [id, x.get(id)]));
    upward();
    for (const [id, v] of fromAbove) x.set(id, (v + x.get(id)) / 2);
    // Then straightened: each step wants at least one of its wires below it, and one above it, to drop without a
    // turn; where none can, the nearest of the steps at the other end slides toward it, or it toward that one, as far
    // as the room in their layers lets them (a waypoint is a point, so its wire must meet it exactly).
    const at = new Map();
    layers.forEach((list) => list.forEach((id, k) => at.set(id, k)));
    const reach = (id) => (nodes.get(id).dummy ? 0 : nodes.get(id).w * (nodes.get(id).shape === 'diamond' ? 0.1 : 0.38));
    const room = (id) => {
      const list = layers[nodes.get(id).layer], k = at.get(id);
      return [k > 0 ? x.get(list[k - 1]) + apart(list[k - 1], id) : -Infinity, k < list.length - 1 ? x.get(list[k + 1]) - apart(id, list[k + 1]) : Infinity];
    };
    const short = (a, b) => Math.abs(x.get(a) - x.get(b)) - reach(a) - reach(b);
    for (let round = 0; round < 6; round++)
      for (const [ends, back] of [[down, up], [up, down]])
        for (const [u, list] of ends) {
          if (!list.length || list.some((v) => short(u, v) <= 0)) continue;
          const v = list.reduce((p, q) => (short(u, q) < short(u, p) ? q : p));
          // The one at the other end moves first, if this is its only wire that way; then this one.
          for (const mover of back.get(v).length === 1 ? [v, u] : [u]) {
            const need = short(u, v);
            if (need <= 0) break;
            const other = mover === v ? u : v, [lo, hi] = room(mover);
            x.set(mover, Math.min(hi, Math.max(lo, x.get(mover) + Math.sign(x.get(other) - x.get(mover)) * need)));
          }
        }
    const all = every.map((id) => nodes.get(id));
    const minX = lowest(all.map((n) => x.get(n.id) - n.w / 2));
    for (const id of every) x.set(id, x.get(id) - minX);
    const width = highest(all.map((n) => x.get(n.id) + n.w / 2));
    const { breaks, height } = wire({ all, chains, layers, room });
    return { ids: every, chains, breaks, width, height };
  };

  // ---- Routing, at right angles only. Between two layers a wire drops from the foot of its step, runs across on a
  // track of its own, and drops to the head of the next. No two wires share a stretch: each has its own place on the
  // steps it leaves and reaches, side by side, and its own track, so wires going the same way run parallel. The
  // tracks in each gap are ordered so that as few drops as can be pass over another track.
  const wire = ({ all, chains, layers, room }) => {
    const layerOf = (id) => nodes.get(id).layer;
    const segs = chains.flatMap((c) => c.path.slice(1).map((v, k) => ({ chain: c, u: c.path[k], v, gap: layerOf(c.path[k]) })));
    const pieces = grouped(segs, (sg) => sg.chain);
    const range = (id) => {
      const n = nodes.get(id), half = n.dummy ? 0 : n.w * (n.shape === 'diamond' ? 0.12 : 0.4);
      return [x.get(id) - half, x.get(id) + half];
    };
    const clampTo = (v, [lo, hi]) => Math.min(hi, Math.max(lo, v));
    // A step's places for its wires: each as near where its wire would drop straight (`want`) as the step allows,
    // in the order of what is at their other ends, at least SLOT apart (closer only when the step is too narrow).
    const slots = (id, list, want) => {
      const [lo, hi] = range(id), k = list.length;
      const gap = k > 1 ? Math.min(SLOT, (hi - lo) / (k - 1)) : 0;
      const spots = list.map((sg) => clampTo(want(sg), [lo, hi]));
      for (let i = 1; i < k; i++) spots[i] = Math.max(spots[i], spots[i - 1] + gap);
      if (k) spots[k - 1] = Math.min(spots[k - 1], hi);
      for (let i = k - 2; i >= 0; i--) spots[i] = Math.min(spots[i], spots[i + 1] - gap);
      for (let i = 1; i < k; i++) spots[i] = Math.max(spots[i], spots[i - 1] + gap, lo + i * gap);
      return spots;
    };
    const leavingOf = grouped(segs, (sg) => sg.u), arrivingOf = grouped(segs, (sg) => sg.v);
    const leaving = (id) => leavingOf.get(id) ?? [], arriving = (id) => arrivingOf.get(id) ?? [];
    // Feet first, each toward the step it goes to; then heads, each onto the foot its wire comes from.
    const ports = () => {
      for (const n of all) {
        const list = [...leaving(n.id)].sort((p, q) => x.get(p.v) - x.get(q.v));
        const reachOf = (sg) => (arriving(sg.v).length === 1 ? range(sg.v) : [x.get(sg.v), x.get(sg.v)]);
        slots(n.id, list, (sg) => clampTo(x.get(sg.u), reachOf(sg))).forEach((spot, i) => (list[i].fx = spot));
      }
      for (const n of all) {
        const list = [...arriving(n.id)].sort((p, q) => p.fx - q.fx);
        slots(n.id, list, (sg) => sg.fx).forEach((spot, i) => (list[i].hx = spot));
      }
    };
    ports();
    // A long wire runs straight between its ends: its waypoints slide, as far as the room in their layers lets them,
    // in line with the end that would not turn anyway (the step it reaches when it leaves a step that sends many, else
    // the place it leaves from), so it turns once rather than in every gap it crosses.
    for (const c of chains) {
      const list = pieces.get(c) ?? [];
      if (list.length < 2) continue;
      const toEnd = leaving(c.a).length > 1;
      const line = toEnd ? clampTo(x.get(c.b), range(c.b)) : list[0].fx;
      for (const sg of toEnd ? [...list].reverse() : list) {
        const d = toEnd ? sg.u : sg.v;
        if (nodes.get(d).dummy) x.set(d, clampTo(line, room(d)));
      }
    }
    ports();
    // Last, a port that is its step's only one that way follows the other end of its wire as far as the step allows.
    for (const sg of segs) {
      if (leaving(sg.u).length === 1) sg.fx = clampTo(sg.hx, range(sg.u));
      if (arriving(sg.v).length === 1) sg.hx = clampTo(sg.fx, range(sg.v));
    }
    for (const sg of segs) [sg.x1, sg.x2] = [Math.min(sg.fx, sg.hx), Math.max(sg.fx, sg.hx)];
    // A wire's track above another's costs a crossing where its drop down passes the other's track, and where the
    // other's drop from above passes its own.
    const inside = (v, sg) => v > sg.x1 + 0.5 && v < sg.x2 - 0.5;
    const cost = (a, b) => Number(inside(a.hx, b)) + Number(inside(b.fx, a));
    const tracks = layers.map(() => []);
    for (const sg of [...segs].sort((p, q) => q.x2 - q.x1 - (p.x2 - p.x1))) {
      const list = tracks[sg.gap];
      // The cost of each place, from the one before it: what goes below the new one instead of above it.
      let c = list.reduce((s, o) => s + cost(sg, o), 0), bestAt = 0, least = c;
      for (let k = 0; k < list.length; k++) {
        c += cost(list[k], sg) - cost(sg, list[k]);
        if (c < least) ((least = c), (bestAt = k + 1));
      }
      list.splice(bestAt, 0, sg);
    }
    // Rows: each layer as tall as its tallest step; each gap as tall as its tracks need.
    let top = 0;
    layers.forEach((list, k) => {
      const tall = highest([BOX_H, ...list.map((id) => nodes.get(id).h)]);
      for (const id of list) y.set(id, top + tall / 2);
      top += tall;
      // A wire leaves its foot by LEAD_OUT at least and runs LEAD_IN at least before its head; the tracks sit between.
      const n = tracks[k].length, gap = Math.max(LAYER_GAP / 2, LEAD_OUT + LEAD_IN + (n - 1) * TRACK);
      const first = top + LEAD_OUT + (gap - LEAD_OUT - LEAD_IN - (n - 1) * TRACK) / 2;
      tracks[k].forEach((sg, i) => (sg.y = first + i * TRACK));
      top += gap;
    });
    const height = top - Math.max(LAYER_GAP / 2, LEAD_OUT + LEAD_IN - TRACK);
    // A step's edge at a given x: its foot or its head, along a diamond's slope where it is one.
    const edgeY = (id, px, below) => {
      const n = nodes.get(id);
      if (n.dummy) return y.get(id);
      const slope = n.shape === 'diamond' ? (Math.abs(px - x.get(id)) * n.h) / n.w : 0;
      return y.get(id) + (below ? 1 : -1) * (n.h / 2 - slope) - (below && n.shape === 'sheet' ? 3 : 0);
    };
    // Each wire as a path of right angles; a waypoint's own place is where its wire passes.
    for (const sg of segs) sg.points = [[sg.fx, edgeY(sg.u, sg.fx, true)], [sg.fx, sg.y], [sg.hx, sg.y], [sg.hx, edgeY(sg.v, sg.hx, false)]];
    for (const c of chains) c.points = (pieces.get(c) ?? []).flatMap((sg, k) => (k ? sg.points.slice(1) : sg.points));
    // Where a drop passes over another wire's track, the drop is broken: the drafting way to show wires that do not meet.
    const breaks = [];
    for (const sg of segs)
      for (const [p, q] of [[sg.points[0], sg.points[1]], [sg.points[2], sg.points[3]]])
        for (const o of tracks[sg.gap]) if (o !== sg && inside(p[0], o) && o.y > Math.min(p[1], q[1]) + 1 && o.y < Math.max(p[1], q[1]) - 1) breaks.push([p[0], o.y]);
    return { breaks, height };
  };

  // ---- The plane: the steps put by hand where they were put, each cluster set by them when it is tied to them
  // (under what leads into it, over what it leads into, else beside), and the rest in rows under all of that, the
  // largest first. A cluster set by others slides down until it is clear of all of them.
  const GAP = LAYER_GAP / 2;
  const boxes = [];
  for (const id of fixed) {
    const n = nodes.get(id);
    x.set(id, Number(placed[id][0]));
    y.set(id, Number(placed[id][1]));
    boxes.push({ l: x.get(id) - n.w / 2, t: y.get(id) - n.h / 2, r: x.get(id) + n.w / 2, b: y.get(id) + n.h / 2 });
  }
  const owned = new Map([...clusters].flatMap(([key, ids]) => ids.map((id) => [id, key])));
  const byCluster = (list) => grouped(list.filter((e) => owned.has(e.a) && owned.get(e.a) === owned.get(e.b)), (e) => owned.get(e.a));
  const [edgesOf, tiesOf] = [byCluster(edges), byCluster(ties)];
  const laid = [...clusters].map(([key, ids]) => ({ key, ...lay(ids, edgesOf.get(key) ?? [], tiesOf.get(key) ?? []) }));
  const chains = laid.flatMap((c) => c.chains), breaks = [];
  const shift = (c, l, t) => {
    for (const id of c.ids) (x.set(id, x.get(id) + l), y.set(id, y.get(id) + t));
    for (const w of c.chains) w.points = w.points.map(([px, py]) => [px + l, py + t]);
    for (const [px, py] of c.breaks) breaks.push([px + l, py + t]);
  };
  const box = (id) => ({ x: x.get(id), y: y.get(id), w: nodes.get(id).w, h: nodes.get(id).h });
  const lone = laid.sort((p, q) => q.ids.length - p.ids.length).filter((c) => {
    const own = new Set(c.ids);
    const into = edges.filter((e) => fixed.has(e.a) && own.has(e.b)).map((e) => box(e.a)), onto = edges.filter((e) => own.has(e.a) && fixed.has(e.b)).map((e) => box(e.b));
    const beside = [...edges, ...ties].filter((e) => (fixed.has(e.a) && own.has(e.b)) || (own.has(e.a) && fixed.has(e.b))).map((e) => box(fixed.has(e.a) ? e.a : e.b));
    if (!beside.length) return true;
    const mid = (list) => list.reduce((s, b) => s + b.x, 0) / list.length;
    let [l, t] = [mid(beside) - c.width / 2, 0];
    if (into.length) t = Math.max(...into.map((b) => b.y + b.h / 2)) + LAYER_GAP;
    else if (onto.length) t = Math.min(...onto.map((b) => b.y - b.h / 2)) - LAYER_GAP - c.height;
    else [l, t] = [Math.max(...beside.map((b) => b.x + b.w / 2)) + GAP, beside.reduce((s, b) => s + b.y, 0) / beside.length - c.height / 2];
    [l, t] = [Math.max(MARGIN, l), Math.max(MARGIN, t)];
    for (let hit; (hit = boxes.find((b) => l < b.r + GAP && l + c.width + GAP > b.l && t < b.b + GAP && t + c.height + GAP > b.t)); ) t = hit.b + GAP;
    shift(c, l, t);
    boxes.push({ l, t, r: l + c.width, b: t + c.height });
    return false;
  });
  // The rest in rows, as wide as the widest of it or of what is placed, and about as wide as tall.
  const area = lone.reduce((s, c) => s + (c.width + GAP) * (c.height + GAP), 0);
  const most = highest([...lone.map((c) => c.width), ...boxes.map((b) => b.r - MARGIN), Math.sqrt(area) * ASPECT]);
  const shelf = { x: MARGIN, y: boxes.length ? highest(boxes.map((b) => b.b)) + LAYER_GAP : MARGIN, row: 0 };
  for (const c of lone) {
    if (shelf.x > MARGIN && shelf.x + c.width > MARGIN + most) Object.assign(shelf, { x: MARGIN, y: shelf.y + shelf.row + GAP, row: 0 });
    shift(c, shelf.x, shelf.y);
    Object.assign(shelf, { x: shelf.x + c.width + GAP, row: Math.max(shelf.row, c.height) });
  }

  // ---- Wires to and from the steps put by hand, solved round the others; then the ties, at right angles as the
  // wires are, round the other steps, from the higher of their two ends to the lower.
  const all = [...nodes.values()].filter((n) => x.has(n.id));
  const steps = all.filter((n) => !n.dummy);
  for (const e of edges)
    if (fixed.has(e.a) || fixed.has(e.b)) {
      const others = steps.filter((n) => n.id !== e.a && n.id !== e.b).map((n) => box(n.id));
      chains.push({ ...e, key: `${e.a} ${e.b}`, path: [e.a, e.b], dashed: potential.has(e.b), points: route(box(e.a), box(e.b), LEAD_OUT, others) });
    }
  // Each tie keeps off what is drawn already: the order's wires, then the ties before it (a tie that shares a step
  // with another may run along it, as a bus out of one step).
  const around = field(steps.map((n) => ({ id: n.id, ...box(n.id) })), LAYER_GAP);
  const taken = drawnPaths(LEAD_OUT / 2);
  for (const c of chains) take(taken, c.points, [c.a, c.b]);
  for (const t of ties) t.points = tieRoute({ id: t.a, ...box(t.a) }, { id: t.b, ...box(t.b) }, LEAD_OUT, around, taken);
  const reachX = [...steps.map((n) => x.get(n.id) + n.w / 2), ...chains.flatMap((c) => c.points.map((p) => p[0]))];
  const reachY = [...steps.map((n) => y.get(n.id) + n.h / 2), ...chains.flatMap((c) => c.points.map((p) => p[1]))];
  return { nodes, all, chains, ties, breaks, potential, x, y, width: highest(reachX) + MARGIN, height: highest(reachY) + MARGIN };
}
