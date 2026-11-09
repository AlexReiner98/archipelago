// Hand-made shapes in step 2's format (task e_7vp7udzk), for the relaxation's tests (test/layouts-relax.test.ts) and
// its animation (scripts/relax-animate.ts), until step 2 gives real ones: a cycle with a wire up, a trunk, two islands
// with ports, a dense box, and all of them on one map. Grid units: a box 4 by 2, its sides on whole numbers.

type Node = { id: string; kind: string; x: number; y: number; w: number; h: number };
type Wire = { id: string; link: string; type: string; reversed: boolean; points: number[][]; from?: string; to?: string };
export type Shape = { nodes: Node[]; wires: Wire[]; islands: { id: string; rect: number[] }[]; ports: { id: string; island: string; side: string; at: number }[] };

const box = (id: string, x: number, y: number, w = 4): Node => ({ id, kind: 'item', x, y, w, h: 2 });
const dot = (id: string, x: number, y: number, kind = 'junction'): Node => ({ id, kind, x, y, w: 0, h: 0 });
const wire = (id: string, points: number[][], reversed = false, type = 'depends_on'): Wire => ({ id, link: `l_${id}`, type, reversed, points });

/** Three boxes in a ring: two wires down, the third back up on the right. */
export function cycle(dx = 0, dy = 0, at = 'c'): Shape {
  const m = (p: number[][]) => p.map(([x, y]) => [x + dx, y + dy]);
  return {
    nodes: [box(`${at}a`, dx, dy), box(`${at}b`, dx, dy + 6), box(`${at}c`, dx, dy + 12)],
    wires: [wire(`${at}1`, m([[0, 1], [0, 5]])), wire(`${at}2`, m([[0, 7], [0, 11]])), wire(`${at}3`, m([[2, 12], [5, 12], [5, 0], [2, 0]]), true)],
    islands: [], ports: [],
  };
}

/** A hub's three wires on one trunk, parting at a junction. */
export function trunk(dx = 0, dy = 0, at = 't'): Shape {
  const m = (p: number[][]) => p.map(([x, y]) => [x + dx, y + dy]);
  return {
    nodes: [box(`${at}h`, dx + 6, dy), box(`${at}r1`, dx, dy + 8), box(`${at}r2`, dx + 6, dy + 8), box(`${at}r3`, dx + 12, dy + 8), dot(`${at}j`, dx + 6, dy + 4)],
    wires: [wire(`${at}1`, m([[6, 1], [6, 4], [0, 4], [0, 7]])), wire(`${at}2`, m([[6, 1], [6, 7]])), wire(`${at}3`, m([[6, 1], [6, 4], [12, 4], [12, 7]]))],
    islands: [], ports: [],
  };
}

/** A wide box with five wires out of its foot and three into its head. */
export function dense(dx = 0, dy = 0, at = 'd'): Shape {
  const m = (p: number[][]) => p.map(([x, y]) => [x + dx, y + dy]);
  const nodes = [box(`${at}d`, dx + 10, dy + 8, 12)], wires: Wire[] = [];
  [4, 10, 16].forEach((x, k) => {
    nodes.push(box(`${at}u${k}`, dx + x, dy));
    const into = 7 + k * 3;
    wires.push(wire(`${at}u${k}`, m(x === into ? [[x, 1], [x, 7]] : [[x, 1], [x, 4], [into, 4], [into, 7]])));
  });
  [2, 6, 10, 14, 18].forEach((x, k) => {
    nodes.push(box(`${at}o${k}`, dx + x, dy + 18));
    const out = 6 + k * 2, turn = [11, 13, 0, 13, 11][k];
    wires.push(wire(`${at}o${k}`, m(x === out ? [[x, 9], [x, 17]] : [[out, 9], [out, turn], [x, turn], [x, 17]])));
  });
  return { nodes, wires, islands: [], ports: [] };
}

/** Two islands, a box on each, one wire between them through a port on each. */
export function islands(): Shape {
  return {
    nodes: [box('a', 4, 2), box('b', 22, 4), dot('pA', 10, 2, 'port'), dot('pB', 16, 4, 'port')],
    wires: [wire('ab', [[6, 2], [13, 2], [13, 4], [20, 4]], false, 'bears_on')],
    islands: [{ id: 'A', rect: [-2, -2, 10, 8] }, { id: 'B', rect: [16, -2, 28, 8] }],
    ports: [{ id: 'pA', island: 'A', side: 'right', at: 4 }, { id: 'pB', island: 'B', side: 'left', at: 6 }],
  };
}

/** One shape of several, side by side. */
const joined = (...parts: Shape[]): Shape => ({ nodes: parts.flatMap((p) => p.nodes), wires: parts.flatMap((p) => p.wires), islands: parts.flatMap((p) => p.islands), ports: parts.flatMap((p) => p.ports) });

/** All of them on one map: a ring on island A, a trunk and a dense box on island B, two wires between through ports. */
export function map(): Shape {
  const parts = joined(cycle(4, 4), trunk(24, 4), dense(22, 18));
  parts.nodes.push(dot('p1', 12, 20, 'port'), dot('p2', 18, 20, 'port'), dot('p3', 12, 22, 'port'), dot('p4', 18, 22, 'port'));
  // x1 leaves the ring's last box by its foot for the hub's head; x2 leaves the ring's middle box by its left for the
  // dense box's left.
  parts.wires.push(
    wire('x1', [[4, 17], [4, 20], [20, 20], [20, 2], [30, 2], [30, 3]], false, 'bears_on'),
    wire('x2', [[2, 10], [1, 10], [1, 22], [22, 22], [22, 26], [26, 26]], false, 'bears_on'),
  );
  parts.islands.push({ id: 'A', rect: [0, 0, 12, 24] }, { id: 'B', rect: [18, 0, 46, 40] });
  parts.ports.push({ id: 'p1', island: 'A', side: 'right', at: 20 }, { id: 'p2', island: 'B', side: 'left', at: 20 }, { id: 'p3', island: 'A', side: 'right', at: 22 }, { id: 'p4', island: 'B', side: 'left', at: 22 });
  return parts;
}
