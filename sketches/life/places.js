// Four archipelagos, each a palette by role and the life drawn from it: species cards, hand-written for now.
// Later these numbers come from photos of each place, fitted offline; only the numbers ship.
// A range is [lo, hi]; weight says how often a species is drawn.

export const PLACES = {
  faroe: {
    title: 'Faroe',
    palette: { paper: '#ece8dc', ink: '#1f2a2c', leaf: '#4f6b54', leaf2: '#93a98a', accent: '#d27a92', warm: '#c0612f', earth: '#7b5b40', pale: '#f6f2e6', cool: '#5f7f95' },
    bird: { name: 'wren', len: [22, 26], legs: 0.18, head: 0.82, tail: 0.42, tailUp: 1.25, fan: 0.25, beak: 0.2, thick: 0.25, hook: 0.08, body: 'earth', wing: 'earth', breast: 'warm' },
    life: [
      { kind: 'moss', weight: 4, g: { width: [28, 46], stalks: [3, 8], capsule: 'warm' } },
      { kind: 'sprig', weight: 3, g: { len: [40, 60], leaves: [3, 5], leaf: 0.22, wide: 0.12, head: 'pompom', colour: 'accent' } },
      { kind: 'fern', weight: 2, g: { len: [55, 80], pairs: [9, 14], pinna: 0.32, wide: 0.22, lobes: 4, depth: 0.3, sweep: 0.35, curl: true } },
      { kind: 'mushrooms', weight: 2, g: { cluster: [1, 3], size: [26, 34], stem: 0.9, girth: 1, capW: 0.55, capH: 0.38, cap: 'cone', colour: 'warm' } },
      { kind: 'snail', weight: 1, g: { size: [16, 20], body: 'leaf2', shell: 'earth' } },
      { kind: 'filler', weight: 5, g: { kinds: ['seed', 'leaf', 'tuft'] } },
    ],
  },
  galapagos: {
    title: 'Galápagos',
    palette: { paper: '#efe3c8', ink: '#2a241f', leaf: '#6f7d3e', leaf2: '#a9ad6c', accent: '#e2b13c', warm: '#c9512c', earth: '#4a3f38', pale: '#fbf3e0', cool: '#3f8f8a' },
    bird: { name: 'finch', len: [24, 28], legs: 0.2, head: 0.95, tail: 0.38, tailUp: -0.1, fan: 0.2, beak: 0.2, thick: 0.6, hook: 0.12, body: 'earth', wing: 'ink', bill: 'ink' },
    life: [
      { kind: 'sprig', weight: 4, g: { len: [45, 70], leaves: [4, 7], leaf: 0.2, wide: 0.28, head: 'flowers', many: 3, petals: 5, colour: 'accent', eye: 'warm' } },
      { kind: 'sprig', weight: 2, g: { len: [35, 50], leaves: [3, 5], leaf: 0.18, wide: 0.15, head: 'berries', many: 5, colour: 'warm', stem: 'earth' } },
      { kind: 'beetle', weight: 2, g: { len: [14, 18], wide: 0.7, shell: 'cool', thorax: 'ink' } },
      { kind: 'moss', weight: 1, g: { width: [22, 32], stalks: [0, 3], capsule: 'accent' } },
      { kind: 'filler', weight: 5, g: { kinds: ['seed', 'dots', 'tuft'] } },
    ],
  },
  rajaAmpat: {
    title: 'Raja Ampat',
    palette: { paper: '#e9eee2', ink: '#14262b', leaf: '#2f7a5a', leaf2: '#7fb38a', accent: '#d9487a', warm: '#ef8a3c', earth: '#5b4636', pale: '#fbf7ec', cool: '#2a7fb8' },
    bird: { name: 'kingfisher', len: [28, 32], legs: 0.12, head: 1.05, tail: 0.3, tailUp: -0.25, fan: 0.1, beak: 0.48, thick: 0.38, hook: 0, body: 'cool', wing: 'cool', breast: 'warm', cheek: 'pale', bill: 'ink' },
    life: [
      { kind: 'fern', weight: 4, g: { len: [65, 95], pairs: [10, 16], pinna: 0.34, wide: 0.18, lobes: 0, depth: 0, sweep: 0.15, curl: true } },
      { kind: 'sprig', weight: 3, g: { len: [45, 70], leaves: [2, 4], leaf: 0.35, wide: 0.3, head: 'flowers', many: 4, petals: 6, colour: 'accent', eye: 'pale' } },
      { kind: 'mushrooms', weight: 1, g: { cluster: [2, 4], size: [18, 24], stem: 1.1, girth: 0.7, capW: 0.5, capH: 0.25, cap: 'dome', colour: 'warm' } },
      { kind: 'beetle', weight: 2, g: { len: [14, 20], wide: 0.62, shell: 'leaf', thorax: 'cool' } },
      { kind: 'moss', weight: 2, g: { width: [26, 40], stalks: [2, 6], capsule: 'warm' } },
      { kind: 'filler', weight: 5, g: { kinds: ['leaf', 'dots', 'tuft'] } },
    ],
  },
  haidaGwaii: {
    title: 'Haida Gwaii',
    palette: { paper: '#e8e4d8', ink: '#1b2420', leaf: '#3e5c45', leaf2: '#7c9575', accent: '#4a3354', warm: '#d9a03a', earth: '#8a4b33', pale: '#f6f1e4', cool: '#7d8f90' },
    bird: { name: 'chickadee', len: [22, 25], legs: 0.18, head: 1.0, tail: 0.5, tailUp: 0.05, fan: 0.15, beak: 0.12, thick: 0.25, hook: 0.05, body: 'earth', wing: 'cool', breast: 'pale', cap: 'ink', cheek: 'pale' },
    life: [
      { kind: 'moss', weight: 4, g: { width: [32, 52], stalks: [4, 10], capsule: 'earth' } },
      { kind: 'mushrooms', weight: 3, g: { cluster: [1, 3], size: [26, 34], stem: 0.7, girth: 1.2, capW: 0.7, capH: 0.32, cap: 'funnel', colour: 'warm' } },
      { kind: 'fern', weight: 3, g: { len: [65, 90], pairs: [12, 18], pinna: 0.3, wide: 0.16, lobes: 0, depth: 0, sweep: 0.3, curl: false } },
      { kind: 'sprig', weight: 2, g: { len: [40, 55], leaves: [3, 5], leaf: 0.3, wide: 0.42, head: 'berries', many: 7, colour: 'accent' } },
      { kind: 'snail', weight: 2, g: { size: [20, 26], body: 'warm', shell: null } },
      { kind: 'filler', weight: 5, g: { kinds: ['seed', 'leaf', 'tuft'] } },
    ],
  },
};
