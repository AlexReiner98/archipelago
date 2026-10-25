// A process map’s layout, apart from its drawing (the core pack's flow drawing, index.js): which items of a lens answer are steps, the wires between them,
// and where each sits. A step leads to another when the other depends on it; the steps are laid out by Sugiyama’s
// method (layers by longest path, a waypoint where a wire passes a layer, barycentre sweeps and sifting for the
// order, a step with room to sit lower moved down where that takes crossings away) and the wires routed at right
// angles, each on a track of its own. What follows an open question is a scenario, and a choice nothing follows yet
// ends in a step of its own. Pure: an answer in, geometry out; `measure(text, px)` gives a title’s width at a size.

const FLOW = new Set(['depends_on']);
/** Past this many steps the layer search and the sifting are skipped: they grow with the square of the steps. */
export const LARGE = 60;

/**
 * The steps (each with its place x, y and size w, h), the wires (each with its points), the breaks and the whole size.
 * Every length and count it lays out by is the style's (`sizes` and `numbers`, flow_*): the house style in
 * packs/core/pack.json names each, and a nearer style may change any.
 */
export function layout({ items, links, rootId, measure, sizes, numbers }) {
  const need = (set, name) => {
    if (typeof set?.[name] !== 'number') throw new Error(`The style names no "${name}": the house style names every one the flow lays out by`);
    return set[name];
  };
  const [LAYER_GAP, NODE_GAP, MARGIN, MAX_TEXT, TRACK, SLOT, LEAD_OUT, LEAD_IN] = ['flow_layer_gap', 'flow_node_gap', 'flow_margin', 'flow_max_text', 'flow_track', 'flow_slot', 'flow_lead_out', 'flow_lead_in'].map((n) => need(sizes, n));
  const [LIST_HEAD, LIST_ROW, LIST_PAD, LIST_TEXT_MORE] = ['flow_list_head', 'flow_list_row', 'flow_list_pad', 'flow_list_text_more'].map((n) => need(sizes, n));
  const [TEXT, STUB_TEXT, ROW_TEXT] = ['flow_text', 'flow_stub_text', 'flow_row_text'].map((n) => need(sizes, n));
  const [DIAMOND_PAD, DIAMOND_H, END_PAD, END_H, BOX_PAD, BOX_H, SHEET_H] = ['flow_diamond_pad', 'flow_diamond_height', 'flow_end_pad', 'flow_end_height', 'flow_box_pad', 'flow_box_height', 'flow_sheet_height'].map((n) => need(sizes, n));
  const FOLD_AT = need(numbers, 'flow_fold_at');
  // ---- Steps: everything in the picture; the item it is of too, when it is a step of the process (a release that
  // waits on the work before it), not only what holds it (a project).
  const shapeOf = (i) => (i.kind === 'question' ? 'diamond' : i.kind === 'occurrence' ? 'pill' : i.kind === 'record' ? 'sheet' : 'box');
  const nodes = new Map();
  const ids = new Set(items.map((i) => i.id));
  const rootIsStep = links.some((l) => FLOW.has(l.kind) && (l.from === rootId ? ids.has(l.to) : l.to === rootId && ids.has(l.from)));
  for (const i of [...items].sort((a, b) => a.place - b.place)) if (i.id !== rootId || rootIsStep) nodes.set(i.id, { id: i.id, item: i, shape: shapeOf(i) });
  if (!nodes.size) return { nodes, all: [], chains: [], breaks: [], potential: new Set(), x: new Map(), y: new Map(), width: 0, height: 0 };
  const large = nodes.size > LARGE;

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
  // A step many plain steps lead into (each follows nothing and leads only there: a release's prerequisites) has
  // them as checklists, one for each type of thing, each a single step that names its items in rows. Thirty
  // independent things before a gate are a checklist, not a process; only the chains between them stay steps.
  for (const b of new Set(edges.map((e) => e.b))) {
    const plain = edges.filter((e) => e.b === b && nodes.get(e.a)?.shape === 'box' && !edges.some((f) => f.b === e.a) && edges.every((f) => f.a !== e.a || f.b === b)).map((e) => e.a);
    if (plain.length < FOLD_AT) continue;
    const kinds = new Map();
    for (const a of plain) kinds.set(nodes.get(a).item.root ?? nodes.get(a).item.type, [...(kinds.get(nodes.get(a).item.root ?? nodes.get(a).item.type) ?? []), nodes.get(a).item]);
    for (const [type, list] of kinds) {
      if (list.length < 2) continue;
      const id = `list:${b}:${type}`;
      const folded = new Set(list.map((i) => i.id));
      for (const i of list) nodes.delete(i.id);
      edges = edges.filter((e) => !folded.has(e.a));
      edges.push({ a: id, b });
      nodes.set(id, { id, shape: 'list', list, type, item: { id, title: type, open: list.some((i) => i.open), state: { blocked: list.some((i) => i.state.blocked), waits_on: [...new Set(list.flatMap((i) => i.state.waits_on))], sessions: list.reduce((s, i) => s + i.state.sessions, 0) } } });
    }
  }
  // Work about a step rather than a step of the process (nothing leads to it or from it) is not drawn as a step: it
  // is a mark on the step it is part of, there when that step is. What is loose (in nothing, holding nothing, tied
  // by nothing: started on the canvas, not yet wired up) has no step to be a mark on, so it stays a step of its own.
  const wired = new Set(edges.flatMap((e) => [e.a, e.b]));
  const tied = new Set([...items.map((i) => i.inside).filter(Boolean), ...links.flatMap((l) => [l.from, l.to])]);
  const loose = (n) => !n.item.inside && !tied.has(n.id);
  if (wired.size)
    for (const n of [...nodes.values()]) {
      if (wired.has(n.id) || loose(n)) continue;
      nodes.delete(n.id);
      const host = nodes.get(n.item.inside);
      if (host) (host.notes ??= []).push(n.item);
    }

  // An open question's choices: each one no wire follows yet ends in a pill of its own.
  const decisions = [...nodes.values()].filter((n) => n.shape === 'diamond' && n.item.open);
  for (const d of decisions) {
    const options = Array.isArray(d.item.choices) ? d.item.choices : [];
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
    const text = Math.min(measure(n.item.title, n.stub ? STUB_TEXT : TEXT), MAX_TEXT);
    if (n.shape === 'diamond') [n.w, n.h] = [text + DIAMOND_PAD, DIAMOND_H];
    else if (n.shape === 'end') [n.w, n.h] = [text + END_PAD, END_H];
    else if (n.shape === 'list') [n.w, n.h] = [Math.max(...n.list.map((i) => Math.min(measure(i.title, ROW_TEXT), MAX_TEXT + LIST_TEXT_MORE))) + LIST_TEXT_MORE, LIST_HEAD + n.list.length * LIST_ROW + LIST_PAD];
    else [n.w, n.h] = [text + BOX_PAD, n.shape === 'sheet' ? SHEET_H : BOX_H];
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
    for (let better = fewest > 0 && !large; better; ) {
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
  for (let pass = 0; pass < 2 && chosen.crossings > 0 && !large; pass++)
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
