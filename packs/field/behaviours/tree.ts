/**
 * Tree: each particle that has a place in a tree (`g.target`, set while the
 * Landscape is arranged into a context profile, packs/arrange) is pulled to
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
