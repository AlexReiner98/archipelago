// One cluster of the flow laid out (./layout.js sets the clusters on the plane): every link a line through the rows,
// the order's and the ties alike. By Sugiyama's method: layers by longest path along the order (a step in no order
// takes its layer from its ties), a waypoint in every row a line passes, barycentre sweeps and, while it is small, a
// search of the layers and sifting for the order in each row, then places, then straightened. A tie's waypoints are
// shared with the ties of its type out of the same step, so the ties out of a hub come down it as one trunk and leave
// it by each part. A row wider than the picture should be wraps, so the cluster comes out about `aspect` times as
// wide as tall. Every line is then wired by ./wires.js. Pure: ids and links in, places and points out.

import { grouped, highest, lowest, NEAR, wrapLeaves } from './graph.js';
import { wire } from './wires.js';

/** Past this many steps in a cluster the layer search and the sifting are skipped: they grow with the square of the steps. */
export const LARGE = 60;

/**
 * Lay out the steps `ids` (in `nodes`, each with its size) with the order's `edges` ({ a, b }: a leads to b) and the
 * `ties` ({ a, b, type }), setting each step's place in `x` and `y` from the cluster's own corner and each line's
 * `points`. `z` holds the lengths it lays out by. Answers with what it placed (waypoints too), the order's lines, its
 * breaks and its size.
 */
export function lay(ids, edges, ties, { nodes, x, y, potential, aspect, z }) {
  const { LAYER_GAP, NODE_GAP, BOX_H } = z;
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
        asap.set(id, rel === 'parent' ? asap.get(from[k]) - 1 : asap.get(from[k]) + 1);
        from.push(id);
      }
  };
  spread([...asap.keys()]);
  for (const id of ids) if (!asap.has(id)) (asap.set(id, 0), spread([id]));
  // Two in no order tied side by side stack, the one the link points to (holding nothing) under: the tie drops straight.
  for (const t of ties) if (t.type !== NEAR && !flows(t.a) && !flows(t.b) && asap.get(t.a) === asap.get(t.b) && !near.get(t.b).some((n) => n.rel === 'child')) asap.set(t.b, asap.get(t.a) + 1);
  // Many leaves of one wrap under it in a block of rows and columns, toward the shape asked for (./graph.js).
  const wide = (id) => nodes.get(id).w + NODE_GAP;
  const blocks = wrapLeaves({ ids, near, asap, flows, wide, tall: (id) => nodes.get(id).h + LAYER_GAP / 2, bus: 2 * z.LEAD_OUT, aspect });
  const inBlock = new Set(blocks.flatMap((b) => b.leaves));
  // A layer wider than the picture should be wraps into rows, each a layer of its own, pushing what is under it down;
  // what is part of one thing stays together in a row. Only steps in no order and in no block wrap: the order keeps
  // its layers, and a block its rows.
  const across = Math.max(highest(ids.map(wide)), Math.sqrt(aspect * (BOX_H + LAYER_GAP) * ids.reduce((s, id) => s + wide(id), 0)));
  const byLayer = grouped(ids, (id) => asap.get(id));
  const parentOf = (id) => (near.get(id) ?? []).find((t) => t.rel === 'parent')?.id ?? '';
  let added = 0;
  for (const k of [...byLayer.keys()].sort((p, q) => p - q)) {
    const list = byLayer.get(k).sort((p, q) => Number(!flows(p)) - Number(!flows(q)) || (parentOf(p) < parentOf(q) ? -1 : parentOf(p) > parentOf(q) ? 1 : 0));
    let row = 0, run = 0;
    for (const id of list) {
      const stays = flows(id) || inBlock.has(id);
      if (!stays && run > 0 && run + wide(id) > across) (row++, (run = 0));
      asap.set(id, k + added + (stays ? 0 : row));
      run += wide(id);
    }
    added += row;
  }
  const least = lowest([...asap.values()]);
  for (const [id, k] of asap) asap.set(id, k - least);

  // Every link a line: the order's from what leads to what follows, a tie from the higher of its ends to the lower (or
  // from what is part of to what it is part of, in one row). A waypoint in each layer a line passes: the order's each
  // its own, a tie's shared with the ties of its type out of the same step.
  const lines = [...edges.map((e) => ({ order: true, link: e, from: e.a, to: e.b })), ...ties.map((t) => ({ order: false, link: t, from: t.a, to: t.b }))];
  const arrange = (layerOf) => {
    const waypoints = new Map();
    for (const line of lines) {
      if (!line.order && layerOf.get(line.to) < layerOf.get(line.from)) [line.from, line.to] = [line.to, line.from];
      if (!line.order && layerOf.get(line.to) === layerOf.get(line.from)) [line.from, line.to] = [line.link.a, line.link.b];
      line.bundle = line.order ? `${line.from}>${line.to}` : `${line.from}|${line.link.type}`;
      line.path = [line.from];
      for (let k = layerOf.get(line.from) + 1; k < layerOf.get(line.to); k++) {
        const id = `${line.bundle}@${k}`;
        if (!waypoints.has(id)) waypoints.set(id, { id, dummy: true, layer: k, w: 6, h: 0, order: line.order });
        line.path.push(id);
      }
      line.path.push(line.to);
      line.flat = layerOf.get(line.from) === layerOf.get(line.to);
    }
    const layerAt = (id) => waypoints.get(id)?.layer ?? layerOf.get(id);
    const every = [...ids, ...waypoints.keys()];
    // Who each is joined to above and below: by every line (`up`, `down`), and by the order's alone (`upOrder`, `downOrder`).
    const maps = () => new Map(every.map((id) => [id, []]));
    const [up, down, upOrder, downOrder] = [maps(), maps(), maps(), maps()];
    for (const line of lines)
      for (let k = 1; k < line.path.length && !line.flat; k++) {
        const [u, v] = [line.path[k - 1], line.path[k]];
        if (!down.get(u).includes(v)) (down.get(u).push(v), up.get(v).push(u));
        if (line.order) (downOrder.get(u).push(v), upOrder.get(v).push(u));
      }
    const layers = [];
    for (const id of every) (layers[layerAt(id)] ??= []).push(id);
    for (let k = 0; k < layers.length; k++) layers[k] ??= [];
    const pos = new Map();
    const index = () => layers.forEach((list) => list.forEach((id, k) => pos.set(id, k)));
    index();
    // Crossings between one layer and the one above it, and in all.
    // Two wires cross where one is left of the other above and right of it below: with the wires in order above (and,
    // where they start together, below), that is each pair out of order below, counted as a merge sort meets them.
    const between = (k) => {
      if (k < 1 || k >= layers.length) return 0;
      const pairs = layers[k].flatMap((b) => up.get(b).map((a) => [pos.get(a), pos.get(b)]));
      pairs.sort((p, q) => p[0] - q[0] || p[1] - q[1]);
      return inversions(pairs.map((p) => p[1]));
    };
    const crossings = () => layers.reduce((sum, _, k) => sum + between(k), 0);
    const sweep = (k, toward) => {
      const bary = new Map(layers[k].map((id) => [id, toward.get(id).length ? toward.get(id).reduce((s, v) => s + pos.get(v), 0) / toward.get(id).length : pos.get(id)]));
      layers[k].sort((a, b) => bary.get(a) - bary.get(b));
      layers[k].forEach((id, i) => pos.set(id, i));
    };
    let best = layers.map((l) => [...l]), fewest = crossings();
    for (let round = 0; round < 24 && (fewest > 0 || round < 4); round++) {
      if (round % 2 === 0) for (let k = 1; k < layers.length; k++) sweep(k, up);
      else for (let k = layers.length - 2; k >= 0; k--) sweep(k, down);
      const count = crossings();
      if (count < fewest || (count === fewest && round < 4)) (fewest = count), (best = layers.map((l) => [...l]));
    }
    layers.splice(0, layers.length, ...best);
    index();
    // Sifting: each one tried at every place in its layer, and left where the fewest lines cross.
    for (let better = fewest > 0 && !large; better; ) {
      better = false;
      layers.forEach((list, layer) => {
        const around = () => between(layer) + between(layer + 1);
        for (const id of [...list]) {
          const from = list.indexOf(id);
          let where = from, least = around();
          list.splice(from, 1);
          for (let k = 0; k <= list.length; k++) {
            list.splice(k, 0, id);
            list.forEach((other, j) => pos.set(other, j));
            const count = around();
            if (count < least) ((fewest -= least - count), (least = count), (where = k), (better = true));
            list.splice(k, 1);
          }
          list.splice(where, 0, id);
          list.forEach((other, j) => pos.set(other, j));
        }
      });
    }
    const span = lines.reduce((s, line) => s + line.path.length - 1, 0);
    return { layerOf, waypoints, up, down, upOrder, downOrder, layers, crossings: fewest, span, paths: lines.map((line) => [line.from, line.to, line.path, line.bundle, line.flat]) };
  };
  // While small, a step of the order free to sit lower is tried in each layer it could take, and kept where the
  // fewest lines cross, then where they are shortest.
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
  return placeRows({ lines, chosen, flows, nodes, x, y, potential, z });
}

/**
 * The rows `chosen` settled on made a picture: each step's place, each line's points. `chosen` holds `layers`, ids by
 * row in their order, `layerOf`, the `waypoints`, who each is joined to above and below (`up`, `down`, `upOrder`,
 * `downOrder`) and the `paths` of `lines`, in step. Answers as `lay` does.
 */
export function placeRows({ lines, chosen, flows, nodes, x, y, potential, z }) {
  const { LAYER_GAP, NODE_GAP } = z;
  // The lines as the chosen arrangement runs them.
  chosen.paths.forEach(([from, to, path, bundle, flat], k) => Object.assign(lines[k], { from, to, path, bundle, flat }));
  for (const [id, k] of chosen.layerOf) nodes.get(id).layer = k;
  for (const [id, w] of chosen.waypoints) nodes.set(id, w);
  const { up, down, upOrder, downOrder, layers } = chosen;
  const every = layers.flat();

  // ---- Places: each step pulled toward what it is joined to, in order, never overlapping.
  const gap = (a, b) => (nodes.get(a).dummy || nodes.get(b).dummy ? NODE_GAP / 2 : NODE_GAP);
  const apart = (a, b) => (nodes.get(a).w + nodes.get(b).w) / 2 + gap(a, b);
  for (const list of layers) {
    let at = 0;
    list.forEach((id, k) => (k && (at += apart(list[k - 1], id)), x.set(id, at)));
  }
  // Sugiyama's priority method: a sweep down sets each layer by the one above it, a sweep up by the one below. A
  // step wants the mean of its neighbours there, and the more of them it has the sooner it is placed; a waypoint of
  // the order counts as a little more than one, so a long wire runs straight unless it would pull a busier step aside;
  // a tie's waypoint next, so a bus runs straight down beside what it reaches; a step in no order last, in the room
  // the rest leaves.
  const place = (k, toward) => {
    const list = layers[k];
    const want = new Map(list.map((id) => [id, toward.get(id).length ? toward.get(id).reduce((s, v) => s + x.get(v), 0) / toward.get(id).length : x.get(id)]));
    const rank = (id) => (nodes.get(id).dummy ? (nodes.get(id).order ? 1.5 : 0.5) : flows(id) ? toward.get(id).length : 0);
    const done = new Set();
    const index = new Map(list.map((id, k) => [id, k]));
    const ranks = new Map(list.map((id) => [id, rank(id)]));
    for (const id of [...list].sort((a, b) => ranks.get(b) - ranks.get(a))) {
      const k0 = index.get(id);
      // As near what it wants as the nearest steps already placed on either side let it be.
      let lo = -Infinity, hi = Infinity;
      for (let j = k0 - 1, room = 0; j >= 0 && lo === -Infinity; j--) ((room += apart(list[j], list[j + 1])), done.has(list[j]) && (lo = x.get(list[j]) + room));
      for (let j = k0 + 1, room = 0; j < list.length && hi === Infinity; j++) ((room += apart(list[j - 1], list[j])), done.has(list[j]) && (hi = x.get(list[j]) - room));
      x.set(id, Math.min(hi, Math.max(lo, want.get(id))));
      done.add(id);
    }
  };
  // A step of the order is placed by the order's lines alone, where it has any that way, so the order runs straight;
  // a tie's waypoint by the waypoints of its own bus, so the bus runs straight down beside what it reaches; a step in
  // neither, and the last waypoint of a bus, by all of them.
  const by = (order, all) => new Map([...all].map(([id, list]) => [id, order.get(id).length ? order.get(id) : nodes.get(id).dummy && !nodes.get(id).order && list.some((v) => nodes.get(v).dummy) ? list.filter((v) => nodes.get(v).dummy) : list]));
  const [above, below] = [by(upOrder, up), by(downOrder, down)];
  const downward = () => { for (let k = 1; k < layers.length; k++) place(k, above); };
  const upward = () => { for (let k = layers.length - 2; k >= 0; k--) place(k, below); };
  for (let round = 0; round < 4; round++) (downward(), upward());
  // Balanced: halfway between the last sweep down and the last sweep up, which keeps every gap.
  downward();
  const fromAbove = new Map(every.map((id) => [id, x.get(id)]));
  upward();
  for (const [id, v] of fromAbove) x.set(id, (v + x.get(id)) / 2);
  // Then straightened: each step wants at least one of its lines below it, and one above it, to drop without a turn;
  // where none can, the nearest of the steps at the other end slides toward it, or it toward that one, as far as the
  // room in their layers lets them (a waypoint is a point, so its line must meet it exactly).
  const at = new Map();
  layers.forEach((list) => list.forEach((id, k) => at.set(id, k)));
  const reach = (id) => (nodes.get(id).dummy ? 0 : nodes.get(id).w * (nodes.get(id).shape === 'diamond' ? 0.1 : 0.38));
  const room = (id) => {
    const list = layers[nodes.get(id).layer], k = at.get(id);
    return [k > 0 ? x.get(list[k - 1]) + apart(list[k - 1], id) : -Infinity, k < list.length - 1 ? x.get(list[k + 1]) - apart(id, list[k + 1]) : Infinity];
  };
  const short = (a, b) => Math.abs(x.get(a) - x.get(b)) - reach(a) - reach(b);
  for (let round = 0; round < 6; round++)
    for (const [ends, back] of [[below, above], [above, below]])
      for (const [u, list] of ends) {
        if (!list.length || list.some((v) => short(u, v) <= 0)) continue;
        const v = list.reduce((p, q) => (short(u, q) < short(u, p) ? q : p));
        // The one at the other end moves first, if this is its only line that way; then this one.
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
  const { breaks, height } = wire({ nodes, x, y, lines, layers, room, z });
  // The order's lines are its chains, each as it was given with its path and points; a tie keeps its points on itself.
  const chains = lines.filter((line) => line.order).map((line) => ({ ...line.link, key: `${line.from} ${line.to}`, path: line.path, dashed: potential.has(line.to), points: line.points }));
  for (const line of lines.filter((l) => !l.order)) Object.assign(line.link, { points: line.points, headAt: line.to === line.link.b ? 'end' : 'start' });
  return { ids: every, chains, breaks, width, height: Math.max(height, highest(all.map((n) => y.get(n.id) + n.h / 2))) };
}

/** How many pairs of a list stand in the wrong order (a later one strictly less than an earlier one): a merge sort's count. */
function inversions(list) {
  let count = 0;
  const sort = (a) => {
    if (a.length < 2) return a;
    const mid = a.length >> 1, left = sort(a.slice(0, mid)), right = sort(a.slice(mid)), out = [];
    let i = 0, j = 0;
    while (i < left.length && j < right.length) {
      if (right[j] < left[i]) ((count += left.length - i), out.push(right[j++]));
      else out.push(left[i++]);
    }
    return out.concat(left.slice(i), right.slice(j));
  };
  sort(list);
  return count;
}
