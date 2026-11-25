/**
 * Whether a change set closes a loop over a kind of link held acyclic
 * (`types.acyclic`, edition 11). Given the touched items after the set, it
 * follows each new or moved link's `to` forward over links of its kind (the
 * graph's, with the set's in place of theirs) and refuses when it comes back
 * to the link's `from`. Only what the set touches is judged.
 *
 * The walk is bounded: past `limit` items it stops, and the set is refused
 * as unchecked rather than let through.
 */
import type { Id } from "../../spec/common.ts";
import type { Fields, Problem } from "./check.ts";

export interface Edge {
  id: Id;
  from: Id;
  to: Id;
}

/** Links of `kind` going out of `id` on the graph now, every page. */
export type Out = (id: Id, kind: string) => Promise<Edge[]>;

export const LIMIT = 10_000;

export async function cycles(after: Map<Id, Fields | null>, held: ReadonlySet<string>, out: Out, limit = LIMIT): Promise<Problem[]> {
  if (!held.size) return [];
  const mine = new Map<string, Edge[]>(); // the set's links of each held kind, as they will be
  for (const [id, f] of after) {
    if (!f || typeof f.type !== "string" || !held.has(f.type)) continue;
    if (typeof f.from !== "string" || typeof f.to !== "string") continue;
    (mine.get(f.type) ?? mine.set(f.type, []).get(f.type)!).push({ id, from: f.from, to: f.to });
  }
  const problems: Problem[] = [];
  for (const [kind, edges] of mine) {
    const added = new Map<Id, Edge[]>();
    for (const e of edges) (added.get(e.from) ?? added.set(e.from, []).get(e.from)!).push(e);
    const next = async (id: Id): Promise<Edge[]> => [...(await out(id, kind)).filter((e) => !after.has(e.id)), ...(added.get(id) ?? [])];

    for (const e of edges) {
      // Walk from e.to; reaching e.from closes a loop through e.
      const back = new Map<Id, Id>([[e.to, e.from]]);
      const queue: Id[] = [e.to];
      let found = e.to === e.from;
      let unchecked = false;
      while (queue.length && !found) {
        const at = queue.shift()!;
        for (const o of await next(at)) {
          if (back.has(o.to)) continue;
          back.set(o.to, at);
          if (o.to === e.from) {
            found = true;
            break;
          }
          if (back.size > limit) {
            unchecked = true;
            break;
          }
          queue.push(o.to);
        }
        if (unchecked) break;
      }
      if (found) {
        const path: Id[] = [e.from];
        for (let at = back.get(e.from); at !== undefined && at !== e.from && path.length <= back.size; at = back.get(at)) path.push(at);
        path.push(e.from);
        const loop = path.reverse();
        problems.push({
          code: "schema.cycle",
          message: `${kind} is held acyclic, and ${e.id} (${e.from} → ${e.to}) would close a loop: ${loop.join(" → ")}.`,
          id: e.id,
        });
      } else if (unchecked) {
        problems.push({
          code: "schema.cycle_unchecked",
          message: `${kind} is held acyclic, and what ${e.id} leads to is more than ${limit} items, so whether it closes a loop wasn't checked.`,
          id: e.id,
        });
      }
    }
  }
  return problems;
}
