/**
 * The arrangement, pure: a context filter's tree (the Context interface's own
 * layout, packs/harness/layout.ts) as places for the map's items. Each node
 * a run in the context filter hears hangs where that view hangs it; a node whose
 * source is an item on the map (or a context filter link bringing one: its `from`)
 * gives that item its place, and one that isn't (a node no item holds) is
 * drawn as a ghost with its name. The branches
 * and the boughs' names come too, so the Landscape can draw the tree the
 * items fly into.
 */
import type { NodeInfo } from "../../spec/agent.ts";
import type { Id } from "../../spec/common.ts";
import { branchAt, nameOf, radial, STYLE, treeOf, type Label } from "../harness/layout.ts";

export const ARRANGE = "arrange.tree";

/** A spot in the tree's own units, rounded to a tenth. */
export type Spot = [number, number];

export interface Arrangement {
  /** The context filter's title, as the find line named it. */
  profile: string;
  /** Each item on the map the context filter's tree holds, and its place. */
  items: Record<Id, Spot>;
  /** Every branch, root first, as points. */
  wires: Spot[][];
  /** Every branch as the context view draws it: its curve (SVG path, the tree's units), stroke width and strength by depth. */
  branches: { d: string; width: number; ink: number }[];
  /** Each bough (a place, a channel, a folder) and its name, placed as the context view places it. */
  boughs: { at: Spot; text: string; label?: Label }[];
  /** Nodes in the tree that no item on the map holds, and their names, placed as the context view places them. */
  ghosts: { at: Spot; text: string; label?: Label }[];
  /** The size the names were placed for, in the tree's units. */
  nameText?: number;
}

const r1 = (n: number) => Math.round(n * 10) / 10;
const spot = (p: { x: number; y: number }): Spot => [r1(p.x), r1(p.y)];

/** The `context:<title>` term on a find line (`umwelt:` still read): its title, underscores as spaces; none, undefined. */
export function contextTerm(line: string): string | undefined {
  const m = /(?:^|\s)(?:context|umwelt):(\S+)/i.exec(line);
  return m ? m[1]!.replace(/_/g, " ") : undefined;
}

/**
 * The tree of the nodes heard, as places for the items on the map: `item`
 * gives the item a node's `source` brings onto the map (the source itself,
 * or the item a context filter link brings), or nothing.
 */
export function arrange(profile: string, heard: NodeInfo[], item: (source: Id) => Id | undefined, nameMost = 28): Arrangement {
  const tree = treeOf(heard, { by: "place" });
  const placed = radial(tree, { nameMost });
  const out: Arrangement = { profile, items: {}, wires: [], branches: [], boughs: [], ghosts: [], nameText: STYLE.nameText };
  for (const t of tree.order) {
    if (!t.parent) continue;
    const at = placed.xy.get(t.id);
    if (!at) continue;
    const along = placed.along.get(t.id);
    if (along) out.wires.push(along.map(([x, y]) => [r1(x), r1(y)] as Spot));
    const d = placed.branch.get(t.id);
    if (d) out.branches.push({ d, ...branchAt(t.depth) });
    // Each name where the context view puts it (along its ray, the root's boughs level), so the two read alike.
    const label = placed.labels.get(t.id);
    const named = (text: string) => ({ at: spot(at), text: label?.text ?? text, ...(label ? { label } : {}) });
    if (t.kids.length) out.boughs.push(named(nameOf(t.title)));
    else {
      const id = t.node?.source ? item(t.node.source) : undefined;
      if (id && !out.items[id]) out.items[id] = spot(at);
      else out.ghosts.push(named(nameOf(t.title)));
    }
  }
  return out;
}
