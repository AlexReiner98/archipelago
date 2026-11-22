/**
 * The words pack: agent nodes whose words are on the map. Each graph item
 * of type `node` becomes a node (spec/agent.md) with that item as its
 * `source`. Its words are read from the item at every say, so changing them
 * through `words.set` takes effect the next time the node speaks.
 *
 * An item `node` has: `title`, `kind` (instruction, reflex, rule, …), `at`
 * (a list of places), `words`, and `refuse` (true: the words are a
 * refusal), `when` (said only when the moment's input holds that text: a
 * reflex's condition), `repeat` (`every`: said each time, not once per
 * context), `voice` (the wording of a code-made node, which says it: this
 * pack registers nothing for it; `words.voice` makes it), and `status`: absent for a kept node (`words.promote` keeps one), `trial` for one on trial
 * (its words are said marked as a trial), `retired` for one no longer said.
 * `held` (a reason): held as written, so `words.set` and `words.retire`
 * refuse, saying why (the written pack's rule, packs/written). `say`:
 * `listed` for a node said at `session_start` as one line, its whole words
 * at its other places or through the words tool (tool.ts); absent, whole.
 * A node a run heard that is reworded or retired is told as the change at
 * the run's next prompt, by the node `words/changed` (heard.ts).
 * Injects graph.read and graph.watch to follow them, agent.node to register
 * them, and action.register and action.invoke for its actions.
 */
import type { ActionContext, ActionInvoke, ActionRegister } from "../../spec/action.ts";
import type { AgentNode } from "../../spec/agent.ts";
import type { Fact } from "../../spec/changeset.ts";
import type { Dispose, Id, Json } from "../../spec/common.ts";
import { Refused } from "../../spec/common.ts";
import type { GraphRead, GraphWatch, Item } from "../../spec/graph.ts";
import { LIMIT_MAX } from "../../spec/graph.ts";
import type { Context, Pack } from "../../runtime/core.ts";
import { changes, Hearing, HEARD, listing, SAY_HOW, sayHow, wholeWords, type SayHow, type WordsHeard } from "./heard.ts";

export { HEARD, listing, TOOL } from "./heard.ts";

export const TYPE = "node";

/** What a trial node's words are said after, so the agent knows it is one. */
export const TRIAL_MARK = "(Trial node, written after a miss: it may be wrong.)";

export interface NodeSeed {
  title: string;
  kind: string;
  at: string[];
  words: string;
  refuse?: boolean;
  /** Said only when the moment's input holds this text. */
  when?: string;
  /** `listed`: one line at session_start, its whole words at its other places. */
  say?: SayHow;
}

export interface WordsConfig {
  /** Nodes made through `words.add` when the graph has none yet. */
  seed?: NodeSeed[];
}

/** A node held as written (its `held` says why) is not changed or retired inside the map. */
function heldCheck(item: Item) {
  const held = item.fields.held;
  if (held === undefined || held === null || held === false) return;
  throw new Refused({
    code: "words.held",
    message: `${String(item.fields.title ?? item.id)} is held as written: ${typeof held === "string" ? held : "its rule holds it."} Its rule must open it before its words change inside the map.`,
    by: { pack: "words" },
  });
}

/** A node's `when`: absent, it always speaks; else only when the moment's input holds that text. */
export function holds(when: Json | undefined, input: Json | undefined): boolean {
  if (typeof when !== "string" || !when) return true;
  if (input === undefined || input === null) return false;
  return (typeof input === "string" ? input : JSON.stringify(input)).includes(when);
}

const shape = (i: Item) => JSON.stringify([i.fields.title, i.fields.kind, i.fields.at, i.fields.status === "retired", i.fields.repeat]);

/** The change node's first line, before one line per node changed. */
export const CHANGED_HEAD = "Changed on the map since you heard them:";

/** A template's `{name}` filled from `vars`; a name it isn't given stays as it is. */
export function fill(template: string, vars: Record<string, string>): string {
  return template.replace(/\{(\w+)\}/g, (m, k: string) => (k in vars ? vars[k]! : m));
}

const words: Pack<WordsConfig> = {
  id: "words",
  about: "Nodes whose words live on the map, so they can be edited there.",
  inject: ["graph.read", "graph.watch", "agent.node", "action.register", "action.invoke"],
  async apply(ctx: Context, config: WordsConfig = {}) {
    const graph = ctx.get<GraphRead>("graph.read");
    const agent = ctx.get<AgentNode>("agent.node");
    const register = ctx.get<ActionRegister>("action.register");
    const registered = new Map<Id, { dispose: Dispose; shape: string }>();
    const hearing = new Hearing();

    ctx.provide<WordsHeard>(HEARD, () => ({
      async heard(run, node) {
        const [item] = await graph.get([node]);
        if (!item || item.type !== TYPE) return;
        const text = wholeWords(item, TRIAL_MARK);
        if (text) hearing.note(run, node, { text, title: String(item.fields.title ?? node), listed: false });
      },
    }));

    const sync = (id: Id, item: Item | null) => {
      const had = registered.get(id);
      if (had && item && had.shape === shape(item)) return;
      if (had) {
        void had.dispose();
        registered.delete(id);
      }
      if (!item || item.type !== TYPE || item.fields.status === "retired") return;
      // A voice item is the wording of a code-made node (words.voice): that node says it, not this pack.
      if (typeof item.fields.voice === "string" && item.fields.voice) return;
      const at = Array.isArray(item.fields.at) ? (item.fields.at as string[]) : [];
      const dispose = agent.node({
        name: id,
        kind: String(item.fields.kind ?? "reflex"),
        title: String(item.fields.title ?? id),
        at,
        source: id,
        ...(item.fields.repeat === "every" ? { repeat: "every" as const } : {}),
        async speak(moment) {
          const [now] = await graph.get([id]);
          const whole = now ? wholeWords(now, TRIAL_MARK) : "";
          if (!whole) return null;
          if (!holds(now!.fields.when, moment.input)) return null;
          if (now!.fields.refuse === true) return { refuse: whole, code: "words.refuse" };
          // A listed node says one line at session_start; its whole words at its other places, or through the words tool.
          const listed = sayHow(now) === "listed" && moment.places.includes("session_start");
          const said = listed ? listing(now!) : whole;
          const had = hearing.get(moment.run, id);
          // The change node already told this run these words: they are in its context.
          if (had?.told && had.text === said && !moment.again) return null;
          if (!(had && !had.listed && listed)) hearing.note(moment.run, id, { text: said, title: String(now!.fields.title ?? id), listed });
          return { say: said };
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
        heldCheck(item);
        const facts: Fact[] = [];
        if (item.fields.words !== undefined) facts.push(["-", input.node, "words", item.fields.words]);
        facts.push(["+", input.node, "words", input.words]);
        call.write(facts);
        return { node: input.node };
      },
    });

    // A node's name: items.set can't change it, since `node` is not a type the items pack edits.
    register.register({
      name: "words.title",
      title: "Rename a node",
      input: {
        type: "object",
        properties: { node: { type: "string", description: "The node's item id" }, title: { type: "string", description: "A name of a few words" } },
        required: ["node", "title"],
      },
      async run(input: { node: Id; title: string }, call: ActionContext) {
        const [item] = await graph.get([input.node]);
        if (!item || item.type !== TYPE) {
          throw new Refused({ code: "words.not_a_node", message: `${input.node} is not a node on the map.`, by: { pack: "words" } });
        }
        const title = typeof input.title === "string" ? input.title.trim() : "";
        if (!title) throw new Refused({ code: "words.title", message: "A node needs a name: title can't be empty.", by: { pack: "words" } });
        heldCheck(item);
        const facts: Fact[] = [];
        if (item.fields.title !== undefined) facts.push(["-", input.node, "title", item.fields.title]);
        facts.push(["+", input.node, "title", title]);
        call.write(facts);
        return { node: input.node };
      },
    });

    register.register({
      name: "words.say",
      title: "How a node says its words at session_start: whole, or listed as one line",
      doc: "listed: at session_start the node says one line (its title, where it is said in full, and how to ask the words tool for it); its whole words are said at its other places. whole (the default): its words in full.",
      input: {
        type: "object",
        properties: { node: { type: "string", description: "The node's item id" }, say: { type: "string", enum: SAY_HOW } },
        required: ["node", "say"],
      },
      async run(input: { node: Id; say: SayHow }, call: ActionContext) {
        const [item] = await graph.get([input.node]);
        if (!item || item.type !== TYPE) {
          throw new Refused({ code: "words.not_a_node", message: `${input.node} is not a node on the map.`, by: { pack: "words" } });
        }
        if (!SAY_HOW.includes(input.say)) {
          throw new Refused({ code: "words.say", message: `say is ${SAY_HOW.join(" or ")}.`, by: { pack: "words" } });
        }
        if (sayHow(item) === input.say) return { node: input.node };
        const facts: Fact[] = [];
        if (item.fields.say !== undefined) facts.push(["-", input.node, "say", item.fields.say]);
        if (input.say === "listed") facts.push(["+", input.node, "say", "listed"]);
        call.write(facts);
        return { node: input.node };
      },
    });

    register.register({
      name: "words.retire",
      title: "Retire a node: it is no longer said",
      input: {
        type: "object",
        properties: { node: { type: "string", description: "The node's item id" } },
        required: ["node"],
      },
      async run(input: { node: Id }, call: ActionContext) {
        const [item] = await graph.get([input.node]);
        if (!item || item.type !== TYPE) {
          throw new Refused({ code: "words.not_a_node", message: `${input.node} is not a node on the map.`, by: { pack: "words" } });
        }
        heldCheck(item);
        if (item.fields.status === "retired") return { node: input.node };
        const facts: Fact[] = [];
        if (item.fields.status !== undefined) facts.push(["-", input.node, "status", item.fields.status]);
        facts.push(["+", input.node, "status", "retired"]);
        call.write(facts);
        return { node: input.node };
      },
    });

    register.register({
      name: "words.promote",
      title: "Keep a node: a trial or retired one is said as kept from now on",
      input: {
        type: "object",
        properties: { node: { type: "string", description: "The node's item id" } },
        required: ["node"],
      },
      async run(input: { node: Id }, call: ActionContext) {
        const [item] = await graph.get([input.node]);
        if (!item || item.type !== TYPE) {
          throw new Refused({ code: "words.not_a_node", message: `${input.node} is not a node on the map.`, by: { pack: "words" } });
        }
        heldCheck(item);
        if (item.fields.status !== undefined) call.write([["-", input.node, "status", item.fields.status]]);
        return { node: input.node };
      },
    });

    register.register({
      name: "words.voice",
      title: "The map item a code-made node takes its wording from",
      doc: "A node whose code decides what to say about (grow/ask, since/heard) takes its wording from a node item with voice: its id. Made the first time with the given words, found after that, so words.set rewords it.",
      input: {
        type: "object",
        properties: {
          voice: { type: "string", description: "The node's id: pack/name." },
          title: { type: "string" },
          kind: { type: "string" },
          at: { type: "array", items: { type: "string" } },
          words: { type: "string", description: "The first wording; {name} marks what the code fills in." },
        },
        required: ["voice", "title", "at", "words"],
      },
      async run(input: NodeSeed & { voice: string }, call: ActionContext) {
        for (let p = await graph.of(TYPE, { limit: LIMIT_MAX }); ; p = await graph.of(TYPE, { limit: LIMIT_MAX, after: p.next })) {
          const had = p.items.find((i) => i.fields.voice === input.voice && i.fields.status !== "retired");
          if (had) return { node: had.id };
          if (!p.next) break;
        }
        const id = `n_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
        call.write([
          ["+", id, "type", TYPE],
          ["+", id, "title", input.title],
          ["+", id, "kind", input.kind ?? "reflex"],
          ["+", id, "at", input.at as Json],
          ["+", id, "words", input.words],
          ["+", id, "voice", input.voice],
        ]);
        return { node: id };
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
          when: { type: "string", description: "Said only when the moment's input holds this text." },
          say: { type: "string", enum: SAY_HOW, description: "listed: one line at session_start, its whole words at its other places." },
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
        if (input.when) facts.push(["+", id, "when", input.when]);
        if (input.say === "listed") facts.push(["+", id, "say", "listed"]);
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

    // What changed in the nodes a run heard, told at its next prompt; a compaction forgets what it heard.
    agent.node({
      name: "changed",
      kind: "reflex",
      title: "Changed since heard",
      at: ["prompt", "compact"],
      repeat: "every",
      async speak(moment) {
        if (moment.places.includes("compact")) {
          hearing.forget(moment.run);
          return null;
        }
        const heard = hearing.of(moment.run);
        if (!heard.size) return null;
        const ids = [...heard.keys()];
        const now = new Map<Id, Item | null>();
        for (let i = 0; i < ids.length; i += LIMIT_MAX) {
          const part = ids.slice(i, i + LIMIT_MAX);
          (await graph.get(part)).forEach((it, j) => now.set(part[j]!, it ?? null));
        }
        const lines = changes(heard, now, TRIAL_MARK);
        return lines.length ? { say: [CHANGED_HEAD, ...lines.map((l) => `- ${l}`)].join("\n") } : null;
      },
    });

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
