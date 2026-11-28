/**
 * The hub plugin: the items a run's task is part of, as the run's `hub` fact
 * (spec/agent.md, edition 5). A link from a hub (plugins/profile: `uses`) then
 * says something about every run that works under it, wherever it runs.
 *
 * Walks `part_of` out from the task, at most DEPTH steps, one bounded page
 * per step. At `compact` (edition 3) its node `hub/task` names the task and
 * what it is part of, so the summary Claude Code writes keeps them.
 * Injects agent.facts, agent.node and graph.read.
 */
import type { AgentFacts, AgentNode, RunInfo } from "../../spec/agent.ts";
import type { Id } from "../../spec/common.ts";
import type { GraphRead, Item } from "../../spec/graph.ts";
import { LIMIT_MAX } from "../../spec/graph.ts";
import type { Context, Plugin } from "../../runtime/core.ts";

export const DEPTH = 8;

/** Larger work named at most at `compact`. */
export const HUB_NAMED = 3;

/** The run's task, from its facts or its start. */
const taskOf = (run: RunInfo): Id | undefined => (typeof run.facts?.task === "string" ? run.facts.task : run.task);

/** What `hub/task` says at `compact`: the task by title, id and status, and the nearest larger work it is part of. */
export function taskWords(task: Item, hubs: Item[]): string {
  const status = typeof task.fields.status === "string" ? `, ${task.fields.status}` : "";
  const part = hubs.length ? `, part of ${hubs.map((h) => `${String(h.fields.title ?? h.id)} (${h.id})`).join(", then ")}` : "";
  return `Keep in the summary this run's task: ${String(task.fields.title ?? task.id)} (${task.id}${status})${part}.`;
}

const hub: Plugin = {
  id: "hub",
  about: "Finds the larger work an agent's task is part of.",
  inject: ["agent.facts", "agent.node", "graph.read"],
  apply(ctx: Context) {
    const graph = ctx.get<GraphRead>("graph.read");
    ctx.get<AgentFacts>("agent.facts").source({
      name: "hub",
      async facts(run) {
        const task = taskOf(run);
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

    // A compaction is coming: the task goes into the summary, so the run still knows what it took on.
    ctx.get<AgentNode>("agent.node").node({
      name: "task",
      kind: "reflex",
      title: "This run's task",
      at: ["compact"],
      repeat: "every",
      async speak(_m, run) {
        const task = taskOf(run);
        if (!task) return null;
        const hub = Array.isArray(run.facts?.hub) ? run.facts.hub.slice(0, HUB_NAMED) : [];
        const [item, ...hubs] = await graph.get([task, ...hub]);
        return item ? { say: taskWords(item, hubs.filter((h): h is Item => !!h)) } : null;
      },
    });
  },
};

export default hub;
