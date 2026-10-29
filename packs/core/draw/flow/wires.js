// Every line of a laid-out cluster (./layers.js) wired at right angles, by one rule for the order and the ties alike.
// Between two rows a line drops from the foot of its step, runs across on a track, and drops to the head of the next.
// The lines out of a step that share their waypoints (a tie's bus: its type out of one step) leave it as one, at one
// place on its foot, along one track, and part only to drop into each step they reach: a fan. Every other line is a
// fan of its own, with its own place on the steps it leaves and reaches and its own track, so lines going the same way
// run parallel, a track apart. The tracks in each gap are ordered so that as few drops as can be pass over another
// track; where one must, the drop is broken. A tie between two steps of one row runs under that row, up into each
// step's foot. Pure: places in, points out.

import { grouped, highest } from './graph.js';

/**
 * Wire `lines` (each { order, path, bundle, flat, link }) over `layers` (ids by row, placed in `x`), setting each
 * step's `y`, each line's `points`. `room(id)` is how far a waypoint may slide in its row. Answers with the breaks
 * and the height.
 */
export function wire({ nodes, x, y, lines, layers, room, z }) {
  const { LAYER_GAP, TRACK, SLOT, LEAD_OUT, LEAD_IN, BOX_H } = z;
  const layerOf = (id) => nodes.get(id).layer;
  // Each run between two rows once: lines that share their waypoints share the runs between them.
  const segs = new Map();
  for (const line of lines) {
    line.segs = line.path.slice(1).map((v, k) => {
      const u = line.path[k], key = `${u}>${v}|${line.bundle}`;
      return segs.get(key) ?? segs.set(key, { u, v, line, flat: line.flat, gap: layerOf(u) }).get(key);
    });
  }
  const list = [...segs.values()];
  // A fan: what leaves a step together. A tie's runs out of one step on one bus are one; anything else is one alone.
  const fans = [...grouped(list, (sg) => (sg.line.order || sg.flat ? sg : `${sg.u}|${sg.line.bundle}`)).values()].map((members) => {
    const fan = { u: members[0].u, members, flat: members[0].flat, gap: members[0].gap };
    for (const sg of members) sg.fan = fan;
    return fan;
  });
  const range = (id) => {
    const n = nodes.get(id), half = n.dummy ? 0 : n.w * (n.shape === 'diamond' ? 0.12 : 0.4);
    return [x.get(id) - half, x.get(id) + half];
  };
  const clampTo = (v, [lo, hi]) => Math.min(hi, Math.max(lo, v));
  // A step's places for its lines: each as near where its line would drop straight (`want`) as the step allows, in
  // the order of what is at their other ends, at least SLOT apart (closer only when the step is too narrow).
  const slots = (id, items, want) => {
    const [lo, hi] = range(id), k = items.length;
    const gap = k > 1 ? Math.min(SLOT, (hi - lo) / (k - 1)) : 0;
    const spots = items.map((it) => clampTo(want(it), [lo, hi]));
    for (let i = 1; i < k; i++) spots[i] = Math.max(spots[i], spots[i - 1] + gap);
    if (k) spots[k - 1] = Math.min(spots[k - 1], hi);
    for (let i = k - 2; i >= 0; i--) spots[i] = Math.min(spots[i], spots[i + 1] - gap);
    for (let i = 1; i < k; i++) spots[i] = Math.max(spots[i], spots[i - 1] + gap, lo + i * gap);
    return spots;
  };
  // The order's lines take their places first, as if no tie were there, so the order drops straight where it can; then
  // each tie the place nearest it wants that is a slot from every other.
  const isOrder = (it) => (it.fan ? it.fan.members[0].line.order : it.sg.line.order);
  const placed = (id, items, want, set) => {
    const first = items.filter(isOrder), rest = items.filter((it) => !isOrder(it));
    const taken = slots(id, first, want);
    first.forEach((it, i) => set(it, taken[i]));
    const [lo, hi] = range(id);
    const spots = slots(id, rest, want);
    rest.forEach((it, i) => {
      const free = (v) => v >= lo - 1e-6 && v <= hi + 1e-6 && taken.every((t) => Math.abs(t - v) >= SLOT - 1e-6);
      const tries = [spots[i], ...taken.flatMap((t) => [t - SLOT, t + SLOT])].filter(free);
      const spot = tries.length ? tries.reduce((p, q) => (Math.abs(q - want(it)) < Math.abs(p - want(it)) ? q : p)) : spots[i];
      taken.push(spot);
      set(it, spot);
    });
  };
  // On a step's foot: the fans that leave it, and the ties of its row that come up into it. On its head: what comes down.
  const feet = new Map(), heads = new Map();
  const add = (map, id, it) => (map.get(id) ?? map.set(id, []).get(id)).push(it);
  for (const fan of fans) add(feet, fan.u, { fan });
  for (const sg of list) add(sg.flat ? feet : heads, sg.v, { sg });
  const toward = (it) => (it.fan ? it.fan.members.reduce((s, sg) => s + x.get(sg.v), 0) / it.fan.members.length : x.get(it.sg.u));
  const ports = () => {
    // Feet first, each toward what it goes to; then heads, each onto the foot its line comes from.
    for (const [id, items] of feet) {
      items.sort((p, q) => toward(p) - toward(q));
      const want = (it) => {
        if (!it.fan) return toward(it);
        const ends = it.fan.members.map((sg) => sg.v);
        const arrive = (heads.get(ends[0]) ?? []).filter((o) => isOrder(o) === isOrder(it));
        const reach = ends.length === 1 && arrive.length === 1 ? range(ends[0]) : [Math.min(...ends.map((v) => x.get(v))), Math.max(...ends.map((v) => x.get(v)))];
        return clampTo(x.get(id), reach);
      };
      placed(id, items, want, (it, spot) => (it.fan ? (it.fan.fx = spot) : (it.sg.hx = spot)));
    }
    for (const [id, items] of heads) {
      items.sort((p, q) => p.sg.fan.fx - q.sg.fan.fx);
      placed(id, items, (it) => it.sg.fan.fx, (it, spot) => (it.sg.hx = spot));
    }
  };
  ports();
  // A long line runs straight between its ends: its waypoints slide, as far as the room in their rows lets them, in
  // line with the end that would not turn anyway (for the order, the step it reaches when it leaves a step that sends
  // many, else the place it leaves from; for a bus, the place it leaves its step), so it turns once rather than in
  // every gap it crosses.
  const slid = new Set();
  // A bus slides by its longest line, which passes every waypoint it has.
  for (const line of [...lines].sort((p, q) => q.segs.length - p.segs.length)) {
    if (line.segs.length < 2 || slid.has(line.bundle)) continue;
    slid.add(line.bundle);
    const toEnd = line.order && (feet.get(line.from) ?? []).length > 1;
    let at = toEnd ? clampTo(x.get(line.to), range(line.to)) : line.segs[0].fan.fx;
    for (const sg of toEnd ? [...line.segs].reverse() : line.segs) {
      const d = toEnd ? sg.u : sg.v;
      if (nodes.get(d).dummy) (x.set(d, clampTo(at, room(d))), (at = line.order ? at : x.get(d)));
    }
  }
  ports();
  // Last, a place that is its step's only one that way follows the other end of its line as far as the step allows:
  // of the order's places, the only one of the order there, as long as it stays a slot from the ties' places.
  const alone = (items, it) => items.length === 1 || (isOrder(it) && items.filter(isOrder).length === 1);
  const clearOf = (items, it, v) => items.every((o) => o === it || isOrder(o) || Math.abs((o.fan ? o.fan.fx : o.sg.hx) - v) >= SLOT - 1e-6);
  for (const sg of list) {
    const foot = (feet.get(sg.u) ?? []).find((it) => it.fan === sg.fan), head = (heads.get(sg.v) ?? []).find((it) => it.sg === sg);
    if (!sg.flat && sg.fan.members.length === 1 && alone(feet.get(sg.u), foot) && clearOf(feet.get(sg.u), foot, clampTo(sg.hx, range(sg.u)))) sg.fan.fx = clampTo(sg.hx, range(sg.u));
    if (!sg.flat && alone(heads.get(sg.v), head) && clearOf(heads.get(sg.v), head, clampTo(sg.fan.fx, range(sg.v)))) sg.hx = clampTo(sg.fan.fx, range(sg.v));
  }
  // A place a line comes into a step by (and a tie's place out of one) stands a track's width off every other line
  // dropping through the same gap, a slot at a time aside where its step has room, so no two drops run down side by
  // side as one.
  const drops = grouped(fans.flatMap((fan) => [{ gap: fan.gap, at: () => fan.fx, fan }, ...fan.members.map((sg) => ({ gap: fan.gap, at: () => sg.hx, sg }))]), (d) => d.gap);
  const clash = (d, v) => (drops.get(d.gap) ?? []).some((o) => o !== d && !(o.fan && o.fan === d.fan) && !(o.sg && d.fan && o.sg.fan === d.fan) && !(o.fan && d.sg && d.sg.fan === o.fan) && Math.abs(o.at() - v) < TRACK);
  const step = (d, id, set) => {
    if (!clash(d, d.at())) return;
    const [lo, hi] = range(id), mine = [...(feet.get(id) ?? []), ...(heads.get(id) ?? [])].map((it) => (it.fan ? it.fan.fx : it.sg.hx)).filter((v) => v !== d.at());
    const tries = Array.from({ length: 8 }, (_, k) => [d.at() - (k + 1) * SLOT, d.at() + (k + 1) * SLOT]).flat().filter((v) => v >= lo && v <= hi && mine.every((m) => Math.abs(m - v) >= SLOT - 1e-6) && !clash(d, v));
    if (tries.length) set(tries[0]);
  };
  for (const [, list] of drops)
    for (const d of list) {
      if (d.fan && !d.fan.members[0].line.order && !d.fan.flat) step(d, d.fan.u, (v) => (d.fan.fx = v));
      if (d.sg && !d.sg.flat && !nodes.get(d.sg.v).dummy) step(d, d.sg.v, (v) => (d.sg.hx = v));
    }
  for (const fan of fans) {
    const xs = [fan.fx, ...fan.members.map((sg) => sg.hx)];
    [fan.x1, fan.x2] = [Math.min(...xs), Math.max(...xs)];
  }
  // A fan's track above another's costs a crossing where one of its drops down passes the other's track, and where one
  // of the other's drops up from its step passes its own.
  const inside = (v, f) => v > f.x1 + 0.5 && v < f.x2 - 0.5;
  // Each fan's drops down and up, read once: the cost below is asked of every pair in a gap.
  for (const fan of fans) [fan.downs, fan.ups] = [fan.flat ? [] : fan.members.map((sg) => sg.hx), [fan.fx, ...(fan.flat ? fan.members.map((sg) => sg.hx) : [])]];
  const within = (vs, f) => {
    let n = 0;
    for (const v of vs) if (inside(v, f)) n++;
    return n;
  };
  const cost = (a, b) => within(a.downs, b) + within(b.ups, a);
  const tracks = layers.map(() => []);
  for (const fan of [...fans].sort((p, q) => q.x2 - q.x1 - (p.x2 - p.x1))) {
    const row = tracks[fan.gap];
    // The cost of each place, from the one before it: what goes below the new one instead of above it.
    let c = row.reduce((s, o) => s + cost(fan, o), 0), bestAt = 0, least = c;
    for (let k = 0; k < row.length; k++) {
      c += cost(row[k], fan) - cost(fan, row[k]);
      if (c < least) ((least = c), (bestAt = k + 1));
    }
    row.splice(bestAt, 0, fan);
  }
  // Fans that do not overlap across (a track's width apart) share a track: each takes the one under every fan before it
  // in that order that it overlaps, so the order stands wherever two meet, and a gap is only as tall as its busiest
  // stretch needs.
  const levels = tracks.map((row) => {
    const level = new Map();
    row.forEach((fan, i) => level.set(fan, row.slice(0, i).reduce((l, o) => (fan.x1 < o.x2 + TRACK && o.x1 < fan.x2 + TRACK ? Math.max(l, level.get(o) + 1) : l), 0)));
    return level;
  });
  // Rows: each layer as tall as its tallest step; each gap as tall as its tracks need.
  let top = 0;
  layers.forEach((row, k) => {
    const tall = highest([BOX_H, ...row.map((id) => nodes.get(id).h)]);
    for (const id of row) y.set(id, top + tall / 2);
    top += tall;
    // A line leaves its foot by LEAD_OUT at least and runs LEAD_IN at least before its head; the tracks sit between.
    const n = highest([1, ...[...levels[k].values()].map((l) => l + 1)]), gap = Math.max(LAYER_GAP / 2, LEAD_OUT + LEAD_IN + (n - 1) * TRACK);
    const first = top + LEAD_OUT + (gap - LEAD_OUT - LEAD_IN - (n - 1) * TRACK) / 2;
    tracks[k].forEach((fan) => (fan.y = first + levels[k].get(fan) * TRACK));
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
  // Each line as a path of right angles; a waypoint's own place is where its line passes.
  for (const sg of list) sg.points = [[sg.fan.fx, edgeY(sg.u, sg.fan.fx, true)], [sg.fan.fx, sg.fan.y], [sg.hx, sg.fan.y], [sg.hx, edgeY(sg.v, sg.hx, sg.flat)]];
  for (const line of lines) line.points = line.segs.flatMap((sg, k) => (k ? sg.points.slice(1) : sg.points));
  // Where a drop of the order passes over another of the order's tracks, the drop is broken: the drafting way to show
  // wires that do not meet. A tie is drawn under the wires, and breaks nothing.
  const breaks = [], seen = new Set();
  const orderTracks = tracks.map((row) => row.filter((o) => o.members[0].line.order));
  for (const sg of list.filter((sg) => sg.line.order))
    for (const [p, q] of [[sg.points[0], sg.points[1]], [sg.points[2], sg.points[3]]]) {
      const key = `${p[0]} ${p[1]} ${q[1]}`;
      if (seen.has(key)) continue;
      seen.add(key);
      for (const o of orderTracks[sg.gap]) if (o !== sg.fan && inside(p[0], o) && o.y > Math.min(p[1], q[1]) + 1 && o.y < Math.max(p[1], q[1]) - 1) breaks.push([p[0], o.y]);
    }
  return { breaks, height };
}
