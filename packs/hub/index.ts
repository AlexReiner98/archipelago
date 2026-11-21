/**
 * The hub pack: the items a run's task is part of, as the run's `hub` fact
 * (spec/agent.md, edition 5). A link from a hub (packs/profile: `uses`) then
 * says something about every run that works under it, wherever it runs.
 *
 * Walks `part_of` out from the task, at most DEPTH steps, one bounded page
 * per step. Injects agent.facts and graph.read.
 */
import type { AgentFacts } from "../../spec/agent.ts";
import type { Id } from "../../spec/common.ts";
import type { GraphRead } from "../../spec/graph.ts";
import { LIMIT_MAX } from "../../spec/graph.ts";
import type { Context, Pack } from "../../runtime/core.ts";

export const DEPTH = 8;

const hub: Pack = {
  id: "hub",
  about: "Finds the larger work an agent's task is part of.",
  inject: ["agent.facts", "graph.read"],
  apply(ctx: Context) {
    const graph = ctx.get<GraphRead>("graph.read");
    ctx.get<AgentFacts>("agent.facts").source({
      name: "hub",
      async facts(run) {
        const task = typeof run.facts?.task === "string" ? run.facts.task : run.task;
        if (!task) return null;
        const seen = new Set<Id>([task]);
        const out: Id[] = [];
        let front: Id[] = [task];
        for (let d = 0; d < DEPTH && front.length; d++) {
          const next: Id[] = [];
          for (const id of front) {
            const page = await graph.links(id, { type: "part_of", dir: "out" }, { limit: LIMIT_MAX });
            for (const l of page.items) {
              if (seen.has(l.to)) continue;
              seen.add(l.to);
              out.push(l.to);
              next.push(l.to);
            }
          }
          front = next;
        }
        return out.length ? { hub: out } : null;
      },
    });
  },
};

export default hub;
