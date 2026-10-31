// The picture pulled tight and its wires gone over, each stage in turn, a box and what hangs on it moving as one. Layer:
// metrics. These stages go when one solver writes every coordinate. Pure: places and lines in, changed in place.

import { centre, evenRuns, spreadPorts } from './centre.js';
import { reroute } from './reroute.js';
import { settle, square } from './settle.js';
import { shelve } from './shelves.js';
import { solve } from './solve.js';

/** Past this many wires the pull takes fewer rounds: a drawing that takes too long is stopped by the page. */
const PULL_MOST = 150;

/** Every stage over `routes`, with `rigid` moved in place. `stage` is told each as it ends; answers with how the first two went. */
export function pullTight({ shelves, routes, rigid, x, y, nodes, ways, holder, gap, margin, aspect, sizes, z, watch, stage }) {
  const zw = { room: z.room, join: z.join, run: z.run, corner: z.corner }, moving = [];
  const standing = new Set(shelves.filter((c) => c.drawn.set).flatMap((c) => [...c.drawn.places.keys()])), pulled = new Map([...rigid].filter(([id]) => !standing.has(id)));
  for (const r of routes.values()) if (r.to !== undefined && rigid.has(r.from) && rigid.has(r.to)) {
    Object.assign(r, { a: r.from, b: r.to, down: ways.has(`${r.from} ${r.to}`) });
    if (!r.set) moving.push(r);
  }
  stage?.('bars and combs', routes);
  // A trial: one solve in place of every stage below.
  if (sizes.plane_solve) {
    solve({ nodes, x, y, routes, wire: z.turn, room: z.room, run: z.run, corner: z.corner, apart: gap / 2 });
    stage?.('solve', routes);
    return { settled: null, wired: null };
  }
  if (!moving.length || !square(moving)) return { settled: null, wired: null };
  const big = moving.length > PULL_MOST;
  const settled = settle(pulled, moving, { gap: gap / 2, track: z.turn, ...zw, blocks: big ? sizes.plane_block_rounds_big : sizes.plane_block_rounds, watch, ...(big && { rounds: sizes.plane_pull_rounds_big, sweeps: sizes.plane_pull_sweeps_big }) });
  stage?.('pull', routes);
  // The parts have pulled in, so they are set again, closer.
  const sets = shelves.map((c) => {
    const ids = [...c.drawn.places.keys()].filter((id) => rigid.has(id)), rs = ids.map((id) => rigid.get(id));
    const own = new Set(ids), lines = [...routes.values()].filter((w) => w.to !== undefined && own.has(w.a));
    const xs = [...rs.flatMap((b) => [b.at[0] - b.size[0] / 2, b.at[0] + b.size[0] / 2]), ...lines.flatMap((w) => w.points.map((q) => q[0]))];
    const ys = [...rs.flatMap((b) => [b.at[1] - b.size[1] / 2, b.at[1] + b.size[1] / 2]), ...lines.flatMap((w) => w.points.map((q) => q[1]))];
    const [l, t] = [Math.min(...xs), Math.min(...ys)];
    return { rs, lines, l, t, w: Math.max(...xs) - l, h: Math.max(...ys) - t };
  }).filter((c) => c.rs.length).sort((p, q) => q.h - p.h || q.w - p.w);
  shelve(sets, { gap, margin, aspect }, (c, dx, dy) => {
    for (const b of c.rs) ((b.at[0] += dx), (b.at[1] += dy));
    for (const w of c.lines) w.points = w.points.map(([p, q]) => [p + dx, q + dy]);
  });
  for (const [id, b] of rigid) {
    const dx = b.at[0] - b.was[0], dy = b.at[1] - b.was[1];
    for (const it of [id, ...b.hangs]) (x.set(it, x.get(it) + dx), y.set(it, y.get(it) + dy));
  }
  for (const r of routes.values()) if (r.to === undefined) {
    const b = rigid.get(holder(r.from));
    r.points = r.points.map(([p, q]) => [p + b.at[0] - b.was[0], q + b.at[1] - b.was[1]]);
  }
  for (const [id, b] of rigid) b.pointed = nodes.get(id).shape === 'diamond';
  const combLines = () => [...routes.values()].filter((r) => r.to === undefined).map((r) => r.points);
  const routing = { track: z.turn, room: z.room, run: z.run, gap: z.turn, corner: z.corner, ports: sizes.plane_reroute_ports, shorter: sizes.plane_reroute_shorter, rounds: big ? 1 : sizes.plane_reroute_rounds };
  const wired = reroute(pulled, moving, combLines(), routing);
  stage?.('reroute', routes);
  // Boxes joined by straight wires stand in line, and what lands on one side spreads about its middle.
  const shift = (id, dx) => {
    const b = rigid.get(id);
    b.at[0] += dx;
    for (const it of [id, ...b.hangs]) x.set(it, x.get(it) + dx);
    for (const r of routes.values()) if (r.to === undefined && holder(r.from) === id) r.points = r.points.map(([p, q]) => [p + dx, q]);
  };
  const spaced = { track: z.turn, gap: z.turn, corner: z.corner };
  const moved = centre(pulled, moving, combLines(), { ...spaced, room: z.room, shift });
  if (moved.length) reroute(pulled, moved, [...combLines(), ...moving.filter((w) => !moved.includes(w)).map((w) => w.points)], routing);
  stage?.('centre', routes);
  spreadPorts(pulled, moving, combLines(), spaced);
  stage?.('ports', routes);
  evenRuns(pulled, moving, combLines(), spaced);
  stage?.('runs', routes);
  return { settled, wired };
}
