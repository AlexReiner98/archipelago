/**
 * Tree: each particle that has a place in a tree (`g.target`, set while the
 * Landscape is arranged into a context profile, plugins/arrange) is pulled to
 * it by a spring of its own, so the map's items fly from where they stood
 * into the tree the profile makes of them. A particle with no place feels
 * nothing; with no tree, nothing does.
 */
import { weight, type Behaviour } from "../behaviour.ts";

const tree: Behaviour = {
  name: "tree",
  doc: "While the Landscape is arranged into a profile, its items are pulled to their places in its tree.",
  on: true,
  dials: () => [
    weight("tree", 1, 5),
    { key: "tree_scale", label: "size", min: 0.3, max: 5, step: 0.05, value: 1.4, doc: "How big the tree is on the Landscape, against the Context interface's own units." },
    { key: "tree_text", label: "names px", min: 4, max: 30, step: 0.5, value: 11, then: "paint", doc: "How big the tree's own names are (its boughs' and the nodes no item holds), before its size." },
    { key: "tree_ghost_text", label: "unheld names px", min: 3, max: 20, step: 0.5, value: 7, then: "paint", doc: "How big the names of nodes no item on the map holds are, before its size." },
    { key: "tree_in_ms", label: "tree comes in after ms", min: 0, max: 3000, step: 50, value: 600, then: "paint", doc: "How long the tree's branches and names wait once the map is arranged, while what left the map fades out, so the old map and the tree are never drawn over each other (0: together)." },
    { key: "tree_ms", label: "flight ms", min: 0, max: 8000, step: 100, value: 2400, doc: "How long the items take to fly from where they stand into the tree, eased in and out (0: the pull alone, as fast as it settles)." },
    { key: "tree_k", label: "pull", min: 0, max: 0.5, step: 0.005, value: 0.08, doc: "How hard each item is pulled to its place in the tree, by its distance from it." },
  ],
  energy(g, S) {
    const t = g.target;
    if (!t) return 0;
    let u = 0;
    for (let i = 0; i < g.n; i++) if (t.on[i]) u += (g.x[i]! - t.x[i]!) ** 2 + (g.y[i]! - t.y[i]!) ** 2;
    return (S.tree_k! * u) / 2;
  },
  apply(g, f, S) {
    const t = g.target;
    if (!t) return;
    const k = S.tree_k!;
    for (let i = 0; i < g.n; i++) {
      if (!t.on[i]) continue;
      f.x[i]! -= (g.x[i]! - t.x[i]!) * k;
      f.y[i]! -= (g.y[i]! - t.y[i]!) * k;
    }
  },
};

export default tree;
