// The layout of a process map, apart from its drawing: which items are steps, the wires between them, and where
// each sits. Steps are laid out by Sugiyama’s method and wires routed at right angles; process.js says how, and
// draws what this answers. It touches no canvas: `measure(text, px)` gives the width of a title at a size.

const FLOW = new Set(['depends_on']);
const LAYER_GAP = 84, NODE_GAP = 16, MARGIN = 24, MAX_TEXT = 140, TRACK = 8, SLOT = 9, LEAD_OUT = 12, LEAD_IN = 22;

export function layout({ items, links, rootId, measure }) {
  // ---- Steps: everything in the picture but the item it is of.
  const shapeOf = (i) => (i.kind === 'question' ? 'diamond' : i.kind === 'occurrence' ? 'pill' : i.kind === 'record' ? 'sheet' : 'box');
  const nodes = new Map();
  for (const i of [...items].sort((a, b) => a.place - b.place)) if (i.id !== rootId) nodes.set(i.id, { id: i.id, item: i, shape: shapeOf(i) });

  // a leads to b when b depends on a; a line that says something says which option it follows.
  let edges = [];
  const seen = new Set();
  for (const l of links) {
    if (!FLOW.has(l.kind) || !nodes.has(l.to) || !nodes.has(l.from) || seen.has(`${l.to} ${l.from}`)) continue;
    seen.add(`${l.to} ${l.from}`);
    edges.push({ a: l.to, b: l.from, ...(l.says && { says: l.says }) });
  }
  // A wire another path already implies is not drawn.
  const outs = (id) => edges.filter((e) => e.a === id).map((e) => e.b);
  const implied = (a, b) => {
    const stack = outs(a).filter((x) => x !== b), been = new Set();
    while (stack.length) {
      const x = stack.pop();
      if (x === b) return true;
      if (been.has(x)) continue;
      been.add(x);
      stack.push(...outs(x));
    }
    return false;
  };
  edges = edges.filter((e) => !implied(e.a, e.b));
  // Work about a step rather than a step of the process (nothing leads to it or from it) is not drawn as a step: it
  // is a mark on the step it is part of, there when that step is.
  const wired = new Set(edges.flatMap((e) => [e.a, e.b]));
  if (wired.size)
    for (const n of [...nodes.values()]) {
      if (wired.has(n.id)) continue;
      nodes.delete(n.id);
      const host = nodes.get(n.item.inside);
      if (host) (host.notes ??= []).push(n.item);
    }

  // An open decision's options: each one no wire follows yet ends in a pill of its own.
  const decisions = [...nodes.values()].filter((n) => n.shape === 'diamond' && n.item.open);
  for (const d of decisions) {
    const options = Array.isArray(d.item.fields?.options) ? d.item.fields.options : [];
    const taken = new Set(edges.filter((e) => e.a === d.id).map((e) => e.says));
    options.forEach((option, k) => {
      if (taken.has(option)) return;
      const id = `${d.id}:${k}`;
      nodes.set(id, { id, stub: true, shape: 'end', item: { id: d.id, title: option, open: true, status: 'a scenario', state: { blocked: false, waits_on: [], sessions: 0 } } });
      edges.push({ a: d.id, b: id, says: option });
    });
  }
  // What follows an open decision happens only if that option is chosen.
  const potential = new Set();
  const markOn = (id) => outs(id).forEach((x) => potential.has(x) || (potential.add(x), markOn(x)));
  decisions.forEach((d) => markOn(d.id));

  // ---- Sizes.
  for (const n of nodes.values()) {
    const text = Math.min(measure(n.item.title, n.stub ? 12 : 13), MAX_TEXT);
    if (n.shape === 'diamond') [n.w, n.h] = [text + 96, 60];
    else if (n.shape === 'end') [n.w, n.h] = [text + 30, 30];
    else [n.w, n.h] = [text + 42, n.shape === 'sheet' ? 40 : 34];
  }

  // ---- Layers: each step one below the lowest it follows, to start with.
  const ins = (id) => edges.filter((e) => e.b === id).map((e) => e.a);
  const asap = new Map();
  const depth = (id, path = new Set()) => {
    if (asap.has(id)) return asap.get(id);
    if (path.has(id)) return 0;
    path.add(id);
    let r = 0;
    for (const a of ins(id)) r = Math.max(r, depth(a, path) + 1);
    path.delete(id);
    asap.set(id, r);
    return r;
  };
  for (const id of nodes.keys()) depth(id);

  // An arrangement of given layers: each wire with a waypoint in every layer it passes, and the order in each layer
  // with the fewest crossings (barycentre sweeps, then each one sifted to the place in its layer that takes most away).
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
    const ids = [...nodes.keys(), ...waypoints.keys()];
    const up = new Map(ids.map((id) => [id, []])), down = new Map(ids.map((id) => [id, []]));
    for (const c of chains)
      for (let k = 1; k < c.path.length; k++) {
        down.get(c.path[k - 1]).push(c.path[k]);
        up.get(c.path[k]).push(c.path[k - 1]);
      }
    const layers = [];
    for (const id of ids) (layers[layerAt(id)] ??= []).push(id);
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
      const bary = new Map(layers[k].map((id) => [id, toward.get(id).length ? toward.get(id).reduce((s, x) => s + pos.get(x), 0) / toward.get(id).length : pos.get(id)]));
      layers[k].sort((a, b) => bary.get(a) - bary.get(b));
      layers[k].forEach((id, i) => pos.set(id, i));
    };
    let best = layers.map((l) => [...l]), fewest = crossings();
    for (let round = 0; round < 24 && fewest > 0; round++) {
      if (round % 2 === 0) for (let k = 1; k < layers.length; k++) sweep(k, up);
      else for (let k = layers.length - 2; k >= 0; k--) sweep(k, down);
      const count = crossings();
      if (count < fewest) (fewest = count), (best = layers.map((l) => [...l]));
    }
    layers.splice(0, layers.length, ...best);
    index();
    // Sifting: each one tried at every place in its layer, and left where the fewest wires cross.
    for (let better = fewest > 0; better; ) {
      better = false;
      layers.forEach((list, layer) => {
        // Only the crossings on either side of its layer can change.
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
    return { layerOf, waypoints, chains, up, down, layers, crossings: fewest, span: chains.reduce((s, c) => s + c.path.length - 1, 0) };
  };

  // A step free to sit lower (an end may go below the last layer) is tried in each layer it could take, and kept where
  // the fewest wires cross, then where they are shortest: two steps both fed by the same two others cannot sit
  // side by side without a crossing, but one can sit below the other.
  const outsOf = (id) => edges.filter((e) => e.a === id).map((e) => e.b);
  const bottom = Math.max(...asap.values());
  const score = (a) => a.crossings * 1e4 + a.span;
  let chosen = arrange(asap);
  for (let pass = 0; pass < 2 && chosen.crossings > 0; pass++)
    for (const id of nodes.keys()) {
      const lo = Math.max(0, ...ins(id).map((a) => chosen.layerOf.get(a) + 1));
      const hi = outsOf(id).length ? Math.min(...outsOf(id).map((b) => chosen.layerOf.get(b) - 1)) : bottom + 2;
      for (let k = lo; k <= hi; k++) {
        if (k === chosen.layerOf.get(id)) continue;
        const tried = arrange(new Map(chosen.layerOf).set(id, k));
        if (score(tried) < score(chosen)) chosen = tried;
      }
    }
  for (const [id, k] of chosen.layerOf) nodes.get(id).layer = k;
  for (const [id, w] of chosen.waypoints) nodes.set(id, w);
  const { chains, up, down, layers } = chosen;

  // ---- Places: each step pulled toward what it is wired to, in order, never overlapping.
  const x = new Map(), y = new Map();
  const gap = (a, b) => (nodes.get(a).dummy || nodes.get(b).dummy ? NODE_GAP / 2 : NODE_GAP);
  const apart = (a, b) => (nodes.get(a).w + nodes.get(b).w) / 2 + gap(a, b);
  for (const ids of layers) {
    let at = 0;
    ids.forEach((id, k) => (k && (at += apart(ids[k - 1], id)), x.set(id, at)));
  }
  // Sugiyama's priority method: a sweep down sets each layer by the one above it, a sweep up by the one below.
  // A step wants the mean of its neighbours there, and the more of them it has the sooner it is placed; a waypoint
  // counts as a little more than one, so a long wire runs straight unless it would pull a busier step aside.
  const place = (k, toward) => {
    const ids = layers[k];
    const want = new Map(ids.map((id) => [id, toward.get(id).length ? toward.get(id).reduce((s, n) => s + x.get(n), 0) / toward.get(id).length : x.get(id)]));
    const rank = (id) => (nodes.get(id).dummy ? 1.5 : toward.get(id).length);
    const fixed = new Set();
    for (const id of [...ids].sort((a, b) => rank(b) - rank(a))) {
      const k0 = ids.indexOf(id);
      // As near what it wants as the steps already placed on either side let it be.
      let lo = -Infinity, hi = Infinity;
      for (let j = k0 - 1, room = 0; j >= 0; j--) {
        room += apart(ids[j], ids[j + 1]);
        if (fixed.has(ids[j])) (lo = Math.max(lo, x.get(ids[j]) + room));
      }
      for (let j = k0 + 1, room = 0; j < ids.length; j++) {
        room += apart(ids[j - 1], ids[j]);
        if (fixed.has(ids[j])) (hi = Math.min(hi, x.get(ids[j]) - room));
      }
      x.set(id, Math.min(hi, Math.max(lo, want.get(id))));
      fixed.add(id);
    }
  };
  const downward = () => { for (let k = 1; k < layers.length; k++) place(k, up); };
  const upward = () => { for (let k = layers.length - 2; k >= 0; k--) place(k, down); };
  for (let round = 0; round < 4; round++) (downward(), upward());
  // Balanced: halfway between the last sweep down and the last sweep up, which keeps every gap.
  downward();
  const fromAbove = new Map(x);
  upward();
  for (const [id, v] of fromAbove) x.set(id, (v + x.get(id)) / 2);
  // Then straightened: each step wants at least one of its wires below it, and one above it, to drop without a
  // turn; where none can, the nearest of the steps at the other end slides toward it, or it toward that one, as far
  // as the room in their layers lets them (a waypoint is a point, so its wire must meet it exactly).
  const reach = (id) => (nodes.get(id).dummy ? 0 : nodes.get(id).w * (nodes.get(id).shape === 'diamond' ? 0.1 : 0.38));
  const room = (id) => {
    const list = layers[nodes.get(id).layer], k = list.indexOf(id);
    return [k > 0 ? x.get(list[k - 1]) + apart(list[k - 1], id) : -Infinity, k < list.length - 1 ? x.get(list[k + 1]) - apart(id, list[k + 1]) : Infinity];
  };
  const short = (a, b) => Math.abs(x.get(a) - x.get(b)) - reach(a) - reach(b);
  for (let round = 0; round < 6; round++)
    for (const [ends, back] of [[down, up], [up, down]])
      for (const [u, list] of ends) {
        if (!list.length || list.some((v) => short(u, v) <= 0)) continue;
        const v = [...list].sort((p, q) => short(u, p) - short(u, q))[0];
        // The one at the other end moves first, if this is its only wire that way; then this one.
        for (const mover of back.get(v).length === 1 ? [v, u] : [u]) {
          const need = short(u, v);
          if (need <= 0) break;
          const other = mover === v ? u : v, [lo, hi] = room(mover);
          x.set(mover, Math.min(hi, Math.max(lo, x.get(mover) + Math.sign(x.get(other) - x.get(mover)) * need)));
        }
      }
  const all = [...nodes.values()];
  const minX = Math.min(...all.map((n) => x.get(n.id) - n.w / 2));
  for (const id of x.keys()) x.set(id, x.get(id) - minX + MARGIN);
  const width = Math.max(...all.map((n) => x.get(n.id) + n.w / 2)) + MARGIN;

  // ---- Routing, at right angles only. Between two layers a wire drops from the foot of its step, runs across on a
  // track of its own, and drops to the head of the next. No two wires share a stretch: each has its own place on
  // the steps it leaves and reaches, side by side, and its own track, so wires going the same way run parallel. The
  // tracks in each gap are ordered so that as few drops as can be pass over another track.
  const layerOf = (id) => nodes.get(id).layer;
  const segs = chains.flatMap((c) => c.path.slice(1).map((v, k) => ({ chain: c, key: `${c.key}#${k}`, u: c.path[k], v, gap: layerOf(c.path[k]) })));
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
    const at = list.map((sg) => clampTo(want(sg), [lo, hi]));
    for (let i = 1; i < k; i++) at[i] = Math.max(at[i], at[i - 1] + gap);
    if (k) at[k - 1] = Math.min(at[k - 1], hi);
    for (let i = k - 2; i >= 0; i--) at[i] = Math.min(at[i], at[i + 1] - gap);
    for (let i = 1; i < k; i++) at[i] = Math.max(at[i], at[i - 1] + gap, lo + i * gap);
    return at;
  };
  const leaving = (id) => segs.filter((sg) => sg.u === id), arriving = (id) => segs.filter((sg) => sg.v === id);
  // Feet first, each toward the step it goes to; then heads, each onto the foot its wire comes from.
  const ports = () => {
    for (const n of all) {
      const list = leaving(n.id).sort((p, q) => x.get(p.v) - x.get(q.v));
      const reachOf = (sg) => (arriving(sg.v).length === 1 ? range(sg.v) : [x.get(sg.v), x.get(sg.v)]);
      slots(n.id, list, (sg) => clampTo(x.get(sg.u), reachOf(sg))).forEach((at, i) => (list[i].fx = at));
    }
    for (const n of all) {
      const list = arriving(n.id).sort((p, q) => p.fx - q.fx);
      slots(n.id, list, (sg) => sg.fx).forEach((at, i) => (list[i].hx = at));
    }
  };
  ports();
  // A long wire runs straight between its ends: its waypoints slide, as far as the room in their layers lets them,
  // in line with the end that would not turn anyway (the step it reaches when it leaves a step that sends many, else
  // the place it leaves from), so it turns once rather than in every gap it crosses.
  for (const c of chains) {
    const pieces = segs.filter((s) => s.chain === c);
    if (pieces.length < 2) continue;
    const toEnd = leaving(c.a).length > 1;
    const line = toEnd ? clampTo(x.get(c.b), range(c.b)) : pieces[0].fx;
    for (const sg of toEnd ? [...pieces].reverse() : pieces) {
      const d = toEnd ? sg.u : sg.v;
      if (!nodes.get(d).dummy) continue;
      x.set(d, clampTo(line, room(d)));
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
    let bestAt = 0, least = Infinity;
    for (let k = 0; k <= list.length; k++) {
      const c = list.slice(0, k).reduce((s, o) => s + cost(o, sg), 0) + list.slice(k).reduce((s, o) => s + cost(sg, o), 0);
      if (c < least) ((least = c), (bestAt = k));
    }
    list.splice(bestAt, 0, sg);
  }
  // Rows: each layer as tall as its tallest step; each gap as tall as its tracks need.
  let at = MARGIN;
  layers.forEach((ids, k) => {
    const tall = Math.max(24, ...ids.map((id) => nodes.get(id).h));
    for (const id of ids) y.set(id, at + tall / 2);
    at += tall;
    // A wire leaves its foot by LEAD_OUT at least and runs LEAD_IN at least before its head; the tracks sit between.
    const n = tracks[k].length, room = Math.max(LAYER_GAP / 2, LEAD_OUT + LEAD_IN + (n - 1) * TRACK);
    const top = at + LEAD_OUT + (room - LEAD_OUT - LEAD_IN - (n - 1) * TRACK) / 2;
    tracks[k].forEach((sg, i) => (sg.y = top + i * TRACK));
    at += room;
  });
  const height = at - Math.max(LAYER_GAP / 2, LEAD_OUT + LEAD_IN - TRACK) + MARGIN;

  // A step's edge at a given x: its foot or its head, along a diamond's slope where it is one.
  const edgeY = (id, px, below) => {
    const n = nodes.get(id);
    if (n.dummy) return y.get(id);
    const slope = n.shape === 'diamond' ? (Math.abs(px - x.get(id)) * n.h) / n.w : 0;
    return y.get(id) + (below ? 1 : -1) * (n.h / 2 - slope) - (below && n.shape === 'sheet' ? 3 : 0);
  };
  // Each wire as a path of right angles; a waypoint's own place is where its wire passes.
  for (const sg of segs) sg.points = [[sg.fx, edgeY(sg.u, sg.fx, true)], [sg.fx, sg.y], [sg.hx, sg.y], [sg.hx, edgeY(sg.v, sg.hx, false)]];
  for (const c of chains) c.points = segs.filter((sg) => sg.chain === c).flatMap((sg, k) => (k ? sg.points.slice(1) : sg.points));
  // Where a drop passes over another wire's track, the drop is broken: the drafting way to show wires that do not meet.
  const breaks = [];
  for (const sg of segs)
    for (const [p, q] of [[sg.points[0], sg.points[1]], [sg.points[2], sg.points[3]]])
      for (const o of tracks[sg.gap])
        if (o !== sg && inside(p[0], o) && o.y > Math.min(p[1], q[1]) + 1 && o.y < Math.max(p[1], q[1]) - 1) breaks.push([p[0], o.y]);

  return { nodes, all, chains, breaks, potential, x, y, width, height };
}
