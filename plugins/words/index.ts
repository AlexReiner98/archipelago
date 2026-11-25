/**
 * The words plugin: agent nodes whose words are on the map. Each graph item
 * of type `node` becomes a node (spec/agent.md) with that item as its
 * `source`; so does any item an `in_context_filter` link gives places (`said`), with
 * the link as its source. Its words are read from the item at every say, so changing them
 * through `words.set` takes effect the next time the node speaks.
 *
 * An item `node` has: `title`, `kind` (instruction, reflex, rule, …), `at`
 * (a list of places), `words`, and `refuse` (true: the words are a
 * refusal), `when` (said only when the moment's input holds that text: a
 * reflex's condition), `repeat` (`every`: said each time, not once per
 * context), `voice` (the wording of a code-made node, which says it: this
 * plugin registers nothing for it; `words.voice` makes it), and `status`: absent for a kept node (`words.promote` keeps one), `trial` for one on trial
 * (its words are said marked as a trial), `retired` for one no longer said.
 * `held` (a reason): held as written, so `words.set` and `words.retire`
 * refuse, saying why (the written plugin's rule, plugins/written). `say`:
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
import type { Context, Plugin } from "../../runtime/core.ts";
import { changes, Hearing, HEARD, listing, SAY_HOW, sayHow, wholeWords, type SayHow, type WordsHeard } from "./heard.ts";

export { HEARD, listing, TOOL } from "./heard.ts";

export const TYPE = "node";
/** A link that brings any item into a context filter; with places (`at`) it is said there (the profile plugin defines it). */
export const LINK = "in_context_filter";

/**
 * What a link with places says, as a node item would: the item it brings
 * (`from`) with its words (or its note), and the link's own `at`, `kind`,
 * `when`, `refuse`, `say`, `repeat`, and `trial` or `retired` as its status.
 * The node's kind is how it is said (the link's `kind`: `instruction` is
 * standing), else what the item is (its `kind`, else its type). Its id is
 * the link's, the node's source. Null when it has no places or no item.
 */
export function said(link: Item, item: Item | null | undefined): Item | null {
  const at = link.fields.at;
  if (!item || !Array.isArray(at) || !at.length) return null;
  const f = item.fields;
  const words = typeof f.words === "string" && f.words.trim() ? f.words : typeof f.note === "string" ? f.note : "";
  const text = (v: Json | undefined) => (typeof v === "string" && v ? v : undefined);
  const fields: Record<string, Json> = { title: f.title ?? item.id, kind: text(link.fields.kind) ?? text(f.kind) ?? item.type, at, words, of: item.id };
  for (const k of ["when", "refuse", "say", "repeat"]) if (link.fields[k] !== undefined) fields[k] = link.fields[k]!;
  if (link.fields.retired === true) fields.status = "retired";
  else if (link.fields.trial === true) fields.status = "trial";
  if (f.held !== undefined) fields.held = f.held;
  return { id: link.id, type: LINK, fields };
}

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
    by: { plugin: "words" },
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

const words: Plugin<WordsConfig> = {
  id: "words",
  about: "Nodes whose words live on the map, so they can be edited there.",
  inject: ["graph.read", "graph.watch", "agent.node", "action.register", "action.invoke"],
  async apply(ctx: Context, config: WordsConfig = {}) {
    const graph = ctx.get<GraphRead>("graph.read");
    const agent = ctx.get<AgentNode>("agent.node");
    const register = ctx.get<ActionRegister>("action.register");
    const registered = new Map<Id, { dispose: Dispose; shape: string }>();
    const hearing = new Hearing();
    /** Each item a context filter link says, and the links that say it, so a change to the item is followed. */
    const sayers = new Map<Id, Set<Id>>();

    /** What each id says now: a node item as it is, a link with places as `said` makes it, else null. At most LIMIT_MAX ids. */
    const view = async (ids: Id[], moved = false): Promise<(Item | null)[]> => {
      const got = await graph.get(ids);
      const from = [...new Set(got.flatMap((i) => (i?.type === LINK && typeof i.fields.from === "string" ? [i.fields.from] : [])))];
      const items = new Map<Id, Item | null>();
      for (let i = 0; i < from.length; i += LIMIT_MAX) {
        const part = from.slice(i, i + LIMIT_MAX);
        (await graph.get(part)).forEach((it, j) => items.set(part[j]!, it));
      }
      const out = got.map((i) => (!i ? null : i.type === TYPE ? i : i.type === LINK ? said(i, items.get(String(i.fields.from))) : null));
      // A node item moved to an ordinary type (record, …) is said by its context filter link now: what a run heard from it
      // is what that link says, so the move isn't told as a retirement.
      for (const [k, i] of got.entries()) {
        if (!moved || !i || out[k] || i.type === TYPE || i.type === LINK) continue;
        const page = await graph.links(i.id, { type: LINK, dir: "out" }, { limit: LIMIT_MAX });
        for (const l of page.items) {
          const s = said(l, i);
          if (s && s.fields.status !== "retired") {
            out[k] = s;
            break;
          }
        }
      }
      return out;
    };

    ctx.provide<WordsHeard>(HEARD, () => ({
      async heard(run, node) {
        const [item] = await view([node], true);
        if (!item) return;
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
      if (!item || (item.type !== TYPE && item.type !== LINK) || item.fields.status === "retired") return;
      // A voice item is the wording of a code-made node (words.voice): that node says it, not this plugin.
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
          const [now] = await view([id]);
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
          throw new Refused({ code: "words.not_a_node", message: `${input.node} is not a node on the map.`, by: { plugin: "words" } });
        }
        heldCheck(item);
        const facts: Fact[] = [];
        if (item.fields.words !== undefined) facts.push(["-", input.node, "words", item.fields.words]);
        facts.push(["+", input.node, "words", input.words]);
        call.write(facts);
        return { node: input.node };
      },
    });

    // A node's name: items.set can't change it, since `node` is not a type the items plugin edits.
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
          throw new Refused({ code: "words.not_a_node", message: `${input.node} is not a node on the map.`, by: { plugin: "words" } });
        }
        const title = typeof input.title === "string" ? input.title.trim() : "";
        if (!title) throw new Refused({ code: "words.title", message: "A node needs a name: title can't be empty.", by: { plugin: "words" } });
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
          throw new Refused({ code: "words.not_a_node", message: `${input.node} is not a node on the map.`, by: { plugin: "words" } });
        }
        if (!SAY_HOW.includes(input.say)) {
          throw new Refused({ code: "words.say", message: `say is ${SAY_HOW.join(" or ")}.`, by: { plugin: "words" } });
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
          throw new Refused({ code: "words.not_a_node", message: `${input.node} is not a node on the map.`, by: { plugin: "words" } });
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
          throw new Refused({ code: "words.not_a_node", message: `${input.node} is not a node on the map.`, by: { plugin: "words" } });
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
          voice: { type: "string", description: "The node's id: plugin/name." },
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
    // A context filter link's node follows the link and the item it brings: a new title or kind registers it again.
    const linkFrom = new Map<Id, Id>();
    const follow = (id: Id, item: Item | null) => {
      const was = linkFrom.get(id);
      if (was !== undefined) {
        linkFrom.delete(id);
        const s = sayers.get(was);
        if (s && s.delete(id) && !s.size) sayers.delete(was);
      }
      if (item?.type === LINK && typeof item.fields.from === "string") {
        linkFrom.set(id, item.fields.from);
        (sayers.get(item.fields.from) ?? sayers.set(item.fields.from, new Set()).get(item.fields.from)!).add(id);
      }
    };
    const resync = async (ids: Id[]) => {
      for (let i = 0; i < ids.length; i += LIMIT_MAX) {
        const part = ids.slice(i, i + LIMIT_MAX);
        const [raw, now] = await Promise.all([graph.get(part), view(part)]);
        part.forEach((id, j) => {
          follow(id, raw[j] ?? null);
          sync(id, now[j] ?? null);
        });
      }
    };
    ctx.get<GraphWatch>("graph.watch").watch({}, async (change) => {
      const touched = [...new Set(change.facts.map((f) => f[1]))];
      const ids = new Set<Id>();
      for (const id of touched) {
        if (registered.has(id) || linkFrom.has(id)) ids.add(id);
        for (const l of sayers.get(id) ?? []) ids.add(l);
      }
      for (const [, id, field, value] of change.facts) if (field === "type" && (value === TYPE || value === LINK)) ids.add(id);
      if (ids.size) await resync([...ids]);
    });
    for (const type of [TYPE, LINK]) {
      let page = await graph.of(type, { limit: LIMIT_MAX });
      for (;;) {
        if (type === TYPE) for (const item of page.items) sync(item.id, item);
        else await resync(page.items.map((i) => i.id));
        if (!page.next) break;
        page = await graph.of(type, { limit: LIMIT_MAX, after: page.next });
      }
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
          (await view(part, true)).forEach((it, j) => now.set(part[j]!, it ?? null));
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
          authority: { of: "agent", basis: "the words plugin's seed config" },
          reason: "Seed a node so a run has something to hear",
        });
        if (!out.ok) ctx.runtime.report(ctx.fiber, new Error(out.refused.message));
      }
    }
  },
};

export default words;
