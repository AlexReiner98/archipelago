/**
 * Edges: items are kept off the edges of their panel. The picture gets a
 * frame of the panel's shape (`g.view.aspect`), as big as its items need
 * (each `edges_room` across, so a frame's area grows with their count),
 * centred where gather pulls; an item further out than `edges_margin` inside
 * the frame is pushed back in, the harder the further, like a soft wall.
 * While it is on the camera fits the items with that margin round them (no
 * wider than the frame), so no mark or title runs off the panel's side.
 *
 * Its energy is half the stiffness times how far each item is past the
 * margin, squared, across and up and down: nothing inside the margin feels it.
 */
import { weight, type Behaviour } from "../behaviour.ts";
import type { G, Settings } from "../graph.ts";

/** The frame, about the middle: its half width and half height, for the items there are and the panel's shape. */
export function frame(g: G, S: Settings): { w: number; h: number } {
  const aspect = Math.max(0.05, g.view?.aspect ?? 1);
  const area = Math.max(1, g.n) * S.edges_room! ** 2;
  return { w: Math.sqrt(area * aspect) / 2, h: Math.sqrt(area / aspect) / 2 };
}

/** How far past the margin a coordinate is, signed (0 inside it). */
const past = (v: number, half: number, margin: number) => {
  const wall = Math.max(0, half - margin);
  return v > wall ? v - wall : v < -wall ? v + wall : 0;
};

const edges: Behaviour = {
  name: "edges",
  doc: "Items are kept off the panel's edges: the picture fills a frame of the panel's shape, with room at its sides.",
  // Off unless a view asks for it (on_edges): the Landscape fits its items as before.
  on: false,
  dials: () => [
    weight("edges"),
    { key: "edges_k", label: "stiffness", min: 0, max: 1, step: 0.01, value: 0.5, doc: "How hard an item past the margin is pushed back in, by how far past it is." },
    { key: "edges_room", label: "room each", min: 5, max: 200, step: 1, value: 80, doc: "How much room each item gets, across: the frame's area is this squared times the items there are." },
    { key: "edges_margin", label: "margin", min: 0, max: 200, step: 1, value: 30, doc: "How far inside the frame's edges items are kept: room for their marks and titles." },
  ],
  energy(g, S) {
    const { w, h } = frame(g, S), m = S.edges_margin!;
    let u = 0;
    for (let i = 0; i < g.n; i++) u += past(g.x[i]!, w, m) ** 2 + past(g.y[i]!, h, m) ** 2;
    return (S.edges_k! * u) / 2;
  },
  apply(g, f, S) {
    const { w, h } = frame(g, S), m = S.edges_margin!, k = S.edges_k!;
    for (let i = 0; i < g.n; i++) {
      f.x[i]! -= k * past(g.x[i]!, w, m);
      f.y[i]! -= k * past(g.y[i]!, h, m);
    }
  },
};

export default edges;
