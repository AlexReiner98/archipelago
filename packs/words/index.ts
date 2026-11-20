/**
 * The words pack: agent nodes whose words are on the map. Each graph item
 * of type `node` becomes a node (spec/agent.md) with that item as its
 * `source`. Its words are read from the item at every say, so changing them
 * through `words.set` takes effect the next time the node speaks.
 *
 * An item `node` has: `title`, `kind` (instruction, reflex, rule, …), `at`
 * (a list of places), `words`, and `refuse` (true: the words are a
 * refusal). Injects graph.read and graph.watch to follow them, agent.node
 * to register them, and action.register and action.invoke for its actions.
 */
import type { ActionContext, ActionInvoke, ActionRegister } from "../../spec/action.ts";
import type { AgentNode } from "../../spec/agent.ts";
import type { Fact } from "../../spec/changeset.ts";
import type { Dispose, Id, Json } from "../../spec/common.ts";
import { Refused } from "../../spec/common.ts";
import type { GraphRead, GraphWatch, Item } from "../../spec/graph.ts";
import { LIMIT_MAX } from "../../spec/graph.ts";
import type { Context, Pack } from "../../runtime/core.ts";

export const TYPE = "node";

export interface NodeSeed {
  title: string;
  kind: string;
  at: string[];
  words: string;
  refuse?: boolean;
}

export interface WordsConfig {
  /** Nodes made through `words.add` when the graph has none yet. */
  seed?: NodeSeed[];
}

const shape = (i: Item) => JSON.stringify([i.fields.title, i.fields.kind, i.fields.at]);

const words: Pack<WordsConfig> = {
  id: "words",
  inject: ["graph.read", "graph.watch", "agent.node", "action.register", "action.invoke"],
  async apply(ctx: Context, config: WordsConfig = {}) {
    const graph = ctx.get<GraphRead>("graph.read");
    const agent = ctx.get<AgentNode>("agent.node");
    const register = ctx.get<ActionRegister>("action.register");
    const registered = new Map<Id, { dispose: Dispose; shape: string }>();

    const sync = (id: Id, item: Item | null) => {
      const had = registered.get(id);
      if (had && item && had.shape === shape(item)) return;
      if (had) {
        void had.dispose();
        registered.delete(id);
      }
      if (!item || item.type !== TYPE) return;
      const at = Array.isArray(item.fields.at) ? (item.fields.at as string[]) : [];
      const dispose = agent.node({
        name: id,
        kind: String(item.fields.kind ?? "reflex"),
        title: String(item.fields.title ?? id),
        at,
        source: id,
        async speak() {
          const [now] = await graph.get([id]);
          const text = typeof now?.fields.words === "string" ? now.fields.words.trim() : "";
          if (!text) return null;
          return now!.fields.refuse === true ? { refuse: text, code: "words.refuse" } : { say: text };
        },
      });
      registered.set(id, { dispose, shape: shape(item) });
    };

    register.register({
      name: "words.set",
      title: "Change what a node says",
      input: {
        type: "object",
        properties: { node: { type: "string", description: "The node's item id" }, words: { type: "string" } },
        required: ["node", "words"],
      },
      async run(input: { node: Id; words: string }, call: ActionContext) {
        const [item] = await graph.get([input.node]);
        if (!item || item.type !== TYPE) {
          throw new Refused({ code: "words.not_a_node", message: `${input.node} is not a node on the map.`, by: { pack: "words" } });
        }
        const facts: Fact[] = [];
        if (item.fields.words !== undefined) facts.push(["-", input.node, "words", item.fields.words]);
        facts.push(["+", input.node, "words", input.words]);
        call.write(facts);
        return { node: input.node };
      },
    });

    register.register({
      name: "words.add",
      title: "Add a node whose words are on the map",
      input: {
        type: "object",
        properties: {
          title: { type: "string" },
          kind: { type: "string" },
          at: { type: "array", items: { type: "string" } },
          words: { type: "string" },
          refuse: { type: "boolean" },
        },
        required: ["title", "at", "words"],
      },
      async run(input: NodeSeed, call: ActionContext) {
        const id = `n_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
        const facts: Fact[] = [
          ["+", id, "type", TYPE],
          ["+", id, "title", input.title],
          ["+", id, "kind", input.kind ?? "reflex"],
          ["+", id, "at", input.at as Json],
          ["+", id, "words", input.words],
        ];
        if (input.refuse) facts.push(["+", id, "refuse", true]);
        call.write(facts);
        return { node: id };
      },
    });

    // Follow the graph first, then read what is there, so nothing is missed.
    ctx.get<GraphWatch>("graph.watch").watch({ types: [TYPE] }, async (change) => {
      const ids = [...new Set(change.facts.map((f) => f[1]))];
      const now = await graph.get(ids);
      ids.forEach((id, i) => sync(id, now[i] ?? null));
    });
    let page = await graph.of(TYPE, { limit: LIMIT_MAX });
    for (;;) {
      for (const item of page.items) sync(item.id, item);
      if (!page.next) break;
      page = await graph.of(TYPE, { limit: LIMIT_MAX, after: page.next });
    }

    if (!registered.size && config.seed?.length) {
      const invoke = ctx.get<ActionInvoke>("action.invoke");
      for (const seed of config.seed) {
        const out = await invoke.invoke({
          action: "words.add",
          input: seed as unknown as Json,
          authority: { of: "agent", basis: "the words pack's seed config" },
          reason: "Seed a node so a run has something to hear",
        });
        if (!out.ok) ctx.runtime.report(ctx.fiber, new Error(out.refused.message));
      }
    }
  },
};

export default words;
