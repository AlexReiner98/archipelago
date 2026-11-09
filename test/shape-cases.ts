// Small embeddings in the format step 1 hands step 2 (task e_7vp7udzk's note), made by hand: rotations clockwise on a
// screen where y runs down, faces walked with the face on their right, as step 1 walks them. Each is drawn in a comment as it should come out.

const box = (id: string, island?: string) => ({ id, kind: 'item', w: 4, h: 2, ...(island ? { island } : {}) });
const pt = (id: string, kind: string, island?: string) => ({ id, kind, w: 0, h: 0, ...(island ? { island } : {}) });
const edge = (id: string, from: string, to: string, dir = 'down', wire = id) => ({ id, from, to, wire, dir });
const wire = (id: string, edges: string[], more: Record<string, unknown> = {}) => ({ id, link: `l_${id}`, type: 'depends_on', edges, reversed: false, ...more });

/** A over B. */
export const chain = {
  nodes: [box('A'), box('B')],
  edges: [edge('e1', 'A', 'B')],
  wires: [wire('w1', ['e1'])],
  rotation: { A: ['e1'], B: ['e1'] },
  islands: [],
};

/** A over B over C, and C back up to A on the right: a ring broken at C -> A. */
export const cycle = {
  nodes: [box('A'), box('B'), box('C')],
  edges: [edge('e1', 'A', 'B'), edge('e2', 'B', 'C'), edge('e3', 'C', 'A', 'up')],
  wires: [wire('w1', ['e1']), wire('w2', ['e2']), wire('w3', ['e3'], { reversed: true })],
  rotation: { A: ['e3', 'e1'], B: ['e1', 'e2'], C: ['e2', 'e3'] },
  faces: [['e3', 'e2', 'e1'], ['e1', 'e2', 'e3']],
  outer: 1,
  islands: [],
};

/** A over a junction J, whose branches run to B (left) and C (right). */
export const trunk = {
  nodes: [box('A'), pt('J', 'junction'), box('B'), box('C')],
  edges: [edge('s', 'A', 'J', 'down', 'ws'), edge('b1', 'J', 'B', 'down', 'wb1'), edge('b2', 'J', 'C', 'down', 'wb2')],
  wires: [wire('ws', ['s'], { trunk: 't1' }), wire('wb1', ['b1'], { trunk: 't1' }), wire('wb2', ['b2'], { trunk: 't1' })],
  rotation: { A: ['s'], J: ['s', 'b2', 'b1'], B: ['b1'], C: ['b2'] },
  islands: [],
};

/** A and B crossed: A top left to D bottom right, B top right to C bottom left, through X. */
export const crossed = {
  nodes: [box('A'), box('B'), pt('X', 'cross'), box('C'), box('D')],
  edges: [edge('a1', 'A', 'X', 'down', 'wa'), edge('a2', 'X', 'D', 'down', 'wa'), edge('b1', 'B', 'X', 'down', 'wb'), edge('b2', 'X', 'C', 'down', 'wb')],
  wires: [wire('wa', ['a1', 'a2']), wire('wb', ['b1', 'b2'])],
  rotation: { A: ['a1'], B: ['b1'], X: ['a1', 'b1', 'a2', 'b2'], C: ['b2'], D: ['a2'] },
  islands: [],
};

/**
 * Island I1 holds A, island I2 below holds B, and A's wire to B leaves I1 at port P1 on its foot and comes into I2 at
 * P2 on its head. Each border: four corners and its port, clockwise.
 */
export const islands = {
  nodes: [
    box('A', 'I1'), box('B', 'I2'),
    pt('n1', 'border', 'I1'), pt('n2', 'border', 'I1'), pt('n3', 'border', 'I1'), pt('P1', 'port', 'I1'), pt('n4', 'border', 'I1'),
    pt('m1', 'border', 'I2'), pt('P2', 'port', 'I2'), pt('m2', 'border', 'I2'), pt('m3', 'border', 'I2'), pt('m4', 'border', 'I2'),
  ],
  edges: [
    edge('e1', 'A', 'P1', 'down', 'w'), edge('e2', 'P1', 'P2', 'down', 'w'), edge('e3', 'P2', 'B', 'down', 'w'),
    edge('i1a', 'n1', 'n2', 'none', ''), edge('i1b', 'n2', 'n3', 'none', ''), edge('i1c', 'n3', 'P1', 'none', ''), edge('i1d', 'P1', 'n4', 'none', ''), edge('i1e', 'n4', 'n1', 'none', ''),
    edge('i2a', 'm1', 'P2', 'none', ''), edge('i2b', 'P2', 'm2', 'none', ''), edge('i2c', 'm2', 'm3', 'none', ''), edge('i2d', 'm3', 'm4', 'none', ''), edge('i2e', 'm4', 'm1', 'none', ''),
  ],
  wires: [wire('w', ['e1', 'e2', 'e3'])],
  rotation: {
    A: ['e1'], B: ['e3'],
    n1: ['i1a', 'i1e'], n2: ['i1b', 'i1a'], n3: ['i1b', 'i1c'], P1: ['e1', 'i1c', 'e2', 'i1d'], n4: ['i1e', 'i1d'],
    m1: ['i2a', 'i2e'], P2: ['e2', 'i2b', 'e3', 'i2a'], m2: ['i2c', 'i2b'], m3: ['i2c', 'i2d'], m4: ['i2e', 'i2d'],
  },
  islands: [{ id: 'I1', border: ['n1', 'n2', 'n3', 'P1', 'n4'] }, { id: 'I2', border: ['m1', 'P2', 'm2', 'm3', 'm4'] }],
};

/** H with two wires in from above (X, Y), three out below (A, B, C) and a tie to T on its left. */
export const hub = {
  nodes: ['H', 'X', 'Y', 'A', 'B', 'C', 'T'].map((id) => box(id)),
  edges: [edge('eX', 'X', 'H'), edge('eY', 'Y', 'H'), edge('eA', 'H', 'A'), edge('eB', 'H', 'B'), edge('eC', 'H', 'C'), edge('eT', 'H', 'T', 'none')],
  wires: ['eX', 'eY', 'eA', 'eB', 'eC', 'eT'].map((e) => wire(`w${e}`, [e])),
  rotation: { H: ['eX', 'eY', 'eC', 'eB', 'eA', 'eT'], X: ['eX'], Y: ['eY'], A: ['eA'], B: ['eB'], C: ['eC'], T: ['eT'] },
  islands: [],
};

export const CASES: Record<string, any> = { chain, cycle, trunk, crossed, islands, hub };
