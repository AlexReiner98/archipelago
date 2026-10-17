// A style's drawing code: a process map, read from the top down, in the shapes
// flowcharts and BPMN share. Every item is a step of its own: work a box, a
// decision a diamond, an event a pill, a record a sheet with a wavy foot. One
// step leads to another when the other depends on it, and every such wire is
// drawn at right angles with as few turns as the steps' places allow, except
// one another path already implies; where one must pass over another, the
// one passing under is broken. The steps are
// laid out by Sugiyama's method (layers by longest path, a waypoint where a
// wire passes a layer, barycentre sweeps for the order, the order with the
// fewest crossings kept, and a step with room to sit lower moved down where
// that takes crossings away) so that wires do not cross. What follows an open
// decision is a scenario: dashed, with the option it follows written under
// the decision, and an option nothing follows yet ends in a dashed pill.
//
// It runs in a worker with a canvas and nothing else (see the style type's code field).

const FLOW = new Set(['depends_on']);
const LAYER_GAP = 84, NODE_GAP = 16, MARGIN = 24, MAX_TEXT = 140, TRACK = 8, SLOT = 9, LEGEND = 128, LEAD_OUT = 12, LEAD_IN = 22;

export default function draw({ canvas, answer, theme, size, tree, on, open, tip, cursor }) {
  const ctx = canvas.getContext('2d');
  const { me } = tree();
  const items = answer.items;
  const root = items.find((i) => i.id === answer.lens.from) ?? items.find((i) => i.inside === null);
  const font = (px, weight = 400) => (ctx.font = `${weight} ${px}px system-ui, -apple-system, 'Segoe UI', sans-serif`);
  const fit = (text, width) => {
    if (ctx.measureText(text).width <= width) return text;
    let t = text;
    while (t.length > 1 && ctx.measureText(`${t}…`).width > width) t = t.slice(0, -1);
    return `${t}…`;
  };

  // ---- Steps: everything in the picture but the item it is of.
  const shapeOf = (i) => (i.kind === 'question' ? 'diamond' : i.kind === 'occurrence' ? 'pill' : i.kind === 'record' ? 'sheet' : 'box');
  const nodes = new Map();
  for (const i of [...items].sort((a, b) => a.place - b.place)) if (i.id !== root.id) nodes.set(i.id, { id: i.id, item: i, shape: shapeOf(i) });

  // a leads to b when b depends on a; a line that says something says which option it follows.
  let edges = [];
  const seen = new Set();
  for (const l of answer.links) {
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
    font(n.stub ? 12 : 13);
    const text = Math.min(ctx.measureText(n.item.title).width, MAX_TEXT);
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

  // ---- Drawing.
  const done = (i) => !i.open;
  const yours = (i) => me && i.state.waits_on.includes(me);
  const dotColor = (i) => (done(i) ? theme.done : yours(i) ? theme.you : i.state.blocked ? theme.blocked : i.state.sessions ? theme.session : null);
  const words = (n) =>
    n.stub
      ? `${n.item.title} · a scenario`
      : [n.item.title, n.item.status, n.item.fields?.outcome && `chose: ${n.item.fields.outcome}`, n.item.state.blocked && 'blocked', yours(n.item) ? 'waits on you' : n.item.state.waits_on.length ? 'waits on someone' : null, potential.has(n.id) && 'a scenario', ...(n.notes ?? []).map((i) => `on it: ${i.title}${yours(i) ? ' (waits on you)' : ''}`)].filter(Boolean).join(' · ');
  const view = { s: 1, dx: 0, dy: 0 };
  let hover = null, drag = null;

  const outline = (n, X, Y) => {
    const { w, h } = n;
    ctx.beginPath();
    if (n.shape === 'diamond') {
      ctx.moveTo(X, Y - h / 2);
      ctx.lineTo(X + w / 2, Y);
      ctx.lineTo(X, Y + h / 2);
      ctx.lineTo(X - w / 2, Y);
      ctx.closePath();
    } else if (n.shape === 'pill' || n.shape === 'end') ctx.roundRect(X - w / 2, Y - h / 2, w, h, h / 2);
    else if (n.shape === 'sheet') {
      // A document: a sheet whose foot is a wave.
      const l = X - w / 2, r = X + w / 2, t = Y - h / 2, b = Y + h / 2 - 5;
      ctx.moveTo(l, t);
      ctx.lineTo(r, t);
      ctx.lineTo(r, b);
      ctx.bezierCurveTo(r - w / 4, b - 8, X + w / 8, b + 10, X, b + 2);
      ctx.bezierCurveTo(X - w / 8, b - 6, l + w / 4, b + 10, l, b + 2);
      ctx.closePath();
    } else ctx.roundRect(X - w / 2, Y - h / 2, w, h, Math.min(6, h / 5));
  };

  function paint() {
    const W = size.width, H = size.height;
    canvas.width = Math.round(W * size.dpr);
    canvas.height = Math.round(H * size.dpr);
    ctx.setTransform(size.dpr, 0, 0, size.dpr, 0, 0);
    ctx.fillStyle = theme.sea;
    ctx.fillRect(0, 0, W, H);
    ctx.translate(view.dx, view.dy);
    ctx.scale(view.s, view.s);

    // Wires, at right angles, through their waypoints; the arrowhead points down into the step.
    const lit = (c) => hover && (c.a === hover.id || c.b === hover.id);
    for (const c of [...chains].sort((p, q) => Number(lit(p)) - Number(lit(q)))) {
      const pts = c.points;
      ctx.beginPath();
      ctx.moveTo(...pts[0]);
      for (const p of pts.slice(1)) ctx.lineTo(...p);
      ctx.setLineDash(c.dashed ? [6, 5] : []);
      ctx.strokeStyle = lit(c) ? theme.text : theme.muted;
      ctx.lineWidth = lit(c) ? 2 : 1.25;
      ctx.stroke();
      ctx.setLineDash([]);
      const [ex, ey] = pts.at(-1);
      ctx.beginPath();
      ctx.moveTo(ex, ey);
      ctx.lineTo(ex - 4.5, ey - 9);
      ctx.lineTo(ex + 4.5, ey - 9);
      ctx.closePath();
      ctx.fillStyle = ctx.strokeStyle;
      ctx.fill();
    }
    // The breaks, cut out of the drops with the colour of the sea, the track left whole across them.
    for (const [bx, by] of breaks) {
      ctx.fillStyle = theme.sea;
      ctx.fillRect(bx - 3, by - 8, 6, 16);
      ctx.beginPath();
      ctx.moveTo(bx - 6, by);
      ctx.lineTo(bx + 6, by);
      ctx.strokeStyle = theme.muted;
      ctx.lineWidth = 1.25;
      ctx.stroke();
    }

    for (const n of all) {
      if (n.dummy) continue;
      const X = x.get(n.id), Y = y.get(n.id), i = n.item, scenario = n.stub || potential.has(n.id);
      outline(n, X, Y);
      ctx.fillStyle = theme.land;
      ctx.fill();
      ctx.setLineDash(scenario ? [5, 4] : []);
      ctx.strokeStyle = hover?.id === n.id ? theme.text : yours(i) ? theme.you : scenario ? theme.muted : theme.line;
      ctx.lineWidth = hover?.id === n.id ? 2 : 1.25;
      ctx.stroke();
      ctx.setLineDash([]);
      const left = n.shape === 'diamond' ? X - n.w / 2 + 48 : X - n.w / 2 + (n.stub ? 15 : 27);
      if (!n.stub) {
        ctx.beginPath();
        ctx.arc(left - 12, Y, 4.5, 0, Math.PI * 2);
        const color = dotColor(i);
        if (color) ((ctx.fillStyle = color), ctx.fill());
        else ((ctx.strokeStyle = theme.muted), (ctx.lineWidth = 1.5), ctx.stroke());
      }
      font(n.stub ? 12 : 13);
      ctx.fillStyle = done(i) || n.stub ? theme.muted : theme.text;
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      ctx.fillText(fit(i.title, n.shape === 'diamond' ? n.w - 96 : n.w - (n.stub ? 30 : 38)), left, Y - (n.shape === 'sheet' ? 2 : 0) + 0.5);
      // Work on it that is not a step: a count on its corner, lit when some of it waits on you.
      if (n.notes) {
        const bx = X + n.w / 2 - 4, by = Y - n.h / 2;
        ctx.beginPath();
        ctx.arc(bx, by, 8, 0, Math.PI * 2);
        ctx.fillStyle = n.notes.some(yours) ? theme.you : theme.inner;
        ctx.fill();
        ctx.strokeStyle = theme.line;
        ctx.lineWidth = 1;
        ctx.stroke();
        font(10.5, 700);
        ctx.fillStyle = n.notes.some(yours) ? theme.sea : theme.text;
        ctx.textAlign = 'center';
        ctx.fillText(String(n.notes.length), bx, by + 0.5);
      }
    }

    // What each option is, written once beside the decision's drop; a scenario's pill already says it.
    const labels = new Map();
    for (const c of chains) if (c.says && !nodes.get(c.b).stub) labels.set(`${c.a} ${c.says}`, c);
    font(11.5);
    for (const c of labels.values()) {
      const d = nodes.get(c.a), text = fit(c.says, 200), w = ctx.measureText(text).width + 14;
      // Beside the drop from the decision, halfway to its track.
      const lx = x.get(d.id) + w / 2 + 6, ly = (y.get(d.id) + d.h / 2 + c.points[1][1]) / 2;
      ctx.beginPath();
      ctx.roundRect(lx - w / 2, ly - 10, w, 20, 10);
      ctx.fillStyle = theme.sea;
      ctx.fill();
      ctx.fillStyle = theme.muted;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(text, lx, ly + 0.5);
    }
    legend();
  }

  // ---- The legend: what the marks on this map mean, only those it uses, in the frame's corner whatever the zoom.
  const real = all.filter((n) => !n.dummy);
  const uses = (test) => real.some(test);
  const entries = [
    ...[['box', 'Work'], ['diamond', 'Decision'], ['pill', 'Event'], ['sheet', 'Record'], ['end', 'Possible end']].filter(([shape]) => uses((n) => n.shape === shape)).map(([shape, label]) => ({ shape, label })),
    ...[[theme.done, 'Done', (i) => done(i)], [theme.blocked, 'Blocked', (i) => !done(i) && !yours(i) && i.state.blocked], [theme.you, 'Waits on you', (i) => !done(i) && yours(i)], [null, 'Not started', (i) => !done(i) && !yours(i) && !i.state.blocked && !i.state.sessions]]
      .filter(([, , test]) => uses((n) => !n.stub && test(n.item)))
      .map(([color, label]) => ({ dot: color, label })),
    ...(uses((n) => n.notes) ? [{ badge: true, label: 'Work on it' }] : []),
    { wire: 'solid', label: 'Leads to' },
    ...(chains.some((c) => c.dashed) ? [{ wire: 'dashed', label: 'If chosen' }] : []),
    ...(breaks.length ? [{ wire: 'break', label: 'Passes under' }] : []),
  ];
  function legend() {
    ctx.setTransform(size.dpr, 0, 0, size.dpr, 0, 0);
    const row = 18, w = LEGEND, h = entries.length * row + 12, lx = 10, ly = 10;
    ctx.beginPath();
    ctx.roundRect(lx, ly, w, h, 8);
    ctx.fillStyle = theme.land;
    ctx.fill();
    ctx.strokeStyle = theme.line;
    ctx.lineWidth = 1;
    ctx.stroke();
    entries.forEach((e, k) => {
      const cx = lx + 20, cy = ly + 6 + row * k + row / 2;
      ctx.strokeStyle = theme.muted;
      ctx.lineWidth = 1.25;
      ctx.beginPath();
      if (e.shape) {
        outline({ shape: e.shape, w: 20, h: e.shape === 'diamond' ? 12 : 11 }, cx, cy);
        ctx.setLineDash(e.shape === 'end' ? [3, 2] : []);
        ctx.stroke();
        ctx.setLineDash([]);
      } else if (e.badge || 'dot' in e) {
        ctx.arc(cx, cy, e.badge ? 6 : 4, 0, Math.PI * 2);
        if (e.badge || e.dot) ((ctx.fillStyle = e.badge ? theme.inner : e.dot), ctx.fill());
        if (e.badge || !e.dot) ctx.stroke();
      } else {
        ctx.setLineDash(e.wire === 'dashed' ? [4, 3] : []);
        if (e.wire === 'break') {
          ctx.moveTo(cx - 10, cy);
          ctx.lineTo(cx + 10, cy);
          ctx.moveTo(cx, cy - 7);
          ctx.lineTo(cx, cy - 3);
          ctx.moveTo(cx, cy + 3);
          ctx.lineTo(cx, cy + 7);
        } else {
          ctx.moveTo(cx - 10, cy);
          ctx.lineTo(cx + 10, cy);
        }
        ctx.stroke();
        ctx.setLineDash([]);
      }
      font(11.5);
      ctx.fillStyle = theme.text;
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      ctx.fillText(e.label, lx + 38, cy + 0.5);
    });
  }

  // Opened with all of it in sight when it can be read so, else at a size that reads, at its start; the wheel zooms
  // about the pointer (out to all of it) and a drag moves it, like a map.
  let fitted = 1;
  const READABLE = 0.62;
  // The map is fitted into the room beside the legend.
  const left = LEGEND + 20;
  const frame = () => {
    fitted = Math.min(1, (size.width - left - 8) / width, (size.height - 8) / height);
    view.s = Math.max(fitted, Math.min(1, READABLE));
    const start = all.find((n) => !n.dummy && n.layer === 0);
    view.dx = view.s === fitted ? left + (size.width - left - width * view.s) / 2 : left + (size.width - left) / 2 - x.get(start.id) * view.s;
    view.dy = view.s === fitted ? (size.height - height * view.s) / 2 : 0;
  };
  const clamp = () => {
    // However it is moved, some of it stays in sight.
    const keep = 80;
    view.dx = Math.min(size.width - keep, Math.max(view.dx, keep - width * view.s));
    view.dy = Math.min(size.height - keep, Math.max(view.dy, keep - height * view.s));
  };
  const hitAt = (e) => {
    const px = (e.x - view.dx) / view.s, py = (e.y - view.dy) / view.s;
    return all.find((n) => !n.dummy && Math.abs(px - x.get(n.id)) <= n.w / 2 && Math.abs(py - y.get(n.id)) <= n.h / 2) ?? null;
  };
  on('pointerdown', (e) => (drag = { x: e.x, y: e.y, dx: view.dx, dy: view.dy, moved: false }));
  on('pointermove', (e) => {
    if (drag && e.buttons) {
      if (Math.abs(e.x - drag.x) + Math.abs(e.y - drag.y) > 4) drag.moved = true;
      view.dx = drag.dx + e.x - drag.x;
      view.dy = drag.dy + e.y - drag.y;
      clamp();
      return paint();
    }
    const n = hitAt(e);
    cursor(n && !n.stub ? 'pointer' : 'default');
    tip(n ? words(n) : null, e.x, e.y);
    if (n?.id !== hover?.id) ((hover = n), paint());
  });
  on('pointerup', (e) => {
    const n = !drag?.moved && hitAt(e);
    drag = null;
    if (n && !n.stub) open(n.item.id);
  });
  on('pointerleave', () => {
    drag = null;
    tip(null, 0, 0);
    if (hover) ((hover = null), paint());
  });
  on('wheel', (e) => {
    const s = Math.min(2, Math.max(fitted * 0.9, view.s * Math.exp(-e.deltaY * 0.0015)));
    view.dx = e.x - ((e.x - view.dx) * s) / view.s;
    view.dy = e.y - ((e.y - view.dy) * s) / view.s;
    view.s = s;
    clamp();
    paint();
  });
  on('resize', () => (frame(), clamp(), paint()));
  frame();
  paint();
}
