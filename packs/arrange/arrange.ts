/**
 * The arrangement, pure: a context profile's tree (the Context interface's
 * own layout, packs/harness/layout.ts) as places for the map's items. Each
 * node a run in the profile hears hangs where that view hangs it; a node
 * that is an item on the map gives its item that place, and one that isn't
 * (a node no item holds) is drawn as a ghost with its name. The branches
 * and the boughs' names come too, so the Landscape can draw the tree the
 * items fly into.
 */
import type { NodeInfo } from "../../spec/agent.ts";
import type { Id } from "../../spec/common.ts";
import { nameOf, radial, treeOf } from "../harness/layout.ts";

export const ARRANGE = "arrange.tree";

/** A spot in the tree's own units, rounded to a tenth. */
export type Spot = [number, number];

export interface Arrangement {
  /** The profile's title, as the find line named it. */
  profile: string;
  /** Each item on the map the profile's tree holds, and its place. */
  items: Record<Id, Spot>;
  /** Every branch, root first, as points. */
  wires: Spot[][];
  /** Each bough (a place, a channel, a folder) and its name. */
  boughs: { at: Spot; text: string }[];
  /** Nodes in the tree that no item on the map holds, and their names. */
  ghosts: { at: Spot; text: string }[];
}

const r1 = (n: number) => Math.round(n * 10) / 10;
const spot = (p: { x: number; y: number }): Spot => [r1(p.x), r1(p.y)];

/** The `profile:<title>` term on a find line: its title, underscores as spaces; none, undefined. */
export function profileTerm(line: string): string | undefined {
  const m = /(?:^|\s)profile:(\S+)/i.exec(line);
  return m ? m[1]!.replace(/_/g, " ") : undefined;
}

/** The tree of the nodes heard, as places for the items `onMap` says are on the map (by a node's `source`). */
export function arrange(profile: string, heard: NodeInfo[], onMap: (id: Id) => boolean, nameMost = 28): Arrangement {
  const tree = treeOf(heard, { by: "place" });
  const placed = radial(tree, { nameMost });
  const out: Arrangement = { profile, items: {}, wires: [], boughs: [], ghosts: [] };
  for (const t of tree.order) {
    if (!t.parent) continue;
    const at = placed.xy.get(t.id);
    if (!at) continue;
    const along = placed.along.get(t.id);
    if (along) out.wires.push(along.map(([x, y]) => [r1(x), r1(y)] as Spot));
    if (t.kids.length) out.boughs.push({ at: spot(at), text: nameOf(t.title) });
    else if (t.node?.source && onMap(t.node.source) && !out.items[t.node.source]) out.items[t.node.source] = spot(at);
    else out.ghosts.push({ at: spot(at), text: nameOf(t.title) });
  }
  return out;
}
