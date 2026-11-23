/**
 * The mcp pack: the tools every harness gives an agent to work with the
 * map, added to the adapter's MCP server through `mcp.host`. Generic: they
 * know bases and field kinds, never a type's name.
 *
 * - `hear`: what the nodes say at a place, before the agent gets there.
 * - `act`: any declared action, as the agent in its run (`items.*`,
 *   `history.undo`, ...). The only way it writes.
 * - `get`: items by id, whole, with their links.
 * - `query`: the find line (packs/find/query.ts), a walk along links, a limit.
 * - `tell`: what the agent concluded, as a record about the items it concerns
 *   (the action `mcp.tell`).
 * - `run`: what the run is (title, task, parent), or that it is over.
 *
 * `get` and `query` read another map when given its name (`map`): one a
 * pack added through `mcp.maps` (maps.ts), such as an old map kept as a
 * read-only archive. Nothing writes to those.
 *
 * Each tool's description is a node: a `tool_text` node item at the tool's
 * place (`tool:mcp__archipelago__get`), made through `words.add` when there
 * is none, so the sensory interface shows it, the verdicts judge it and
 * `words.set` refines it. The list says its words now; without the words
 * pack, the defaults here.
 *
 * Each kind of refusal an action gives through `act` or `tell` (its code)
 * is a node too: `schema_check` for the schema's, `rule` for the rest, at
 * the tools' results (`tool_result:mcp__archipelago__*`) with `when`
 * `Refused (<code>)`, made the first time the code is seen. The adapter
 * reaches the result with the refusal in it, so the node is said there,
 * the verdicts judge it and `words.set` rewords it.
 */
import type { ActionContext, ActionInvoke, ActionList, ActionRegister } from "../../spec/action.ts";
import type { Facts, Place, RunInfo } from "../../spec/agent.ts";
import { PLACES } from "../../spec/agent.ts";
import type { Committed } from "../../spec/changeset.ts";
import type { Authority, Dispose, Id, Json } from "../../spec/common.ts";
import { Refused } from "../../spec/common.ts";
import type { ExchangeRead } from "../../spec/exchange.ts";
import type { Direction, GraphRead, GraphWatch, Item } from "../../spec/graph.ts";
import { LIMIT_MAX } from "../../spec/graph.ts";
import type { LinkInfo, TypeInfo, TypesRead } from "../../spec/types.ts";
import type { Context, Pack } from "../../runtime/core.ts";
import { run as find, type Index, type Row, type Wire } from "../find/query.ts";
import type { McpHost, ToolDef, ToolResult, ToolRun } from "./host.ts";
import { HOST } from "./host.ts";
import type { MapDef, MapRead, McpMaps } from "./maps.ts";
import { MAPS } from "./maps.ts";

/** What each tool says when its node has no words (or there is no words pack). */
export const DESCRIPTIONS: Record<string, string> = {
  hear: "What the map says at a place before you get there: file:<path> or tool:<name>.",
  act:
    "Change the map through a declared action, as yourself in this run. Each call is one change set; history.undo {change} takes it back. " +
    "Leave input out to see what an action takes.",
  get: "Items by id: every field, and their links with the item at the other end.",
  query:
    "Find items. find: words match titles; is:open, is:closed, type:<type or base>, status:<s>, in:<id> (what is part of it), near:<id>. " +
    "walk follows links from what is found. At most limit come back.",
  tell: "Say what you concluded, in one short line, about the items it concerns. It is kept as a record; replaces supersedes an earlier one.",
  run: "Say what this run is: its title, the task it took on, the run that started it; end: true when it is over.",
};

/** A refusal's node kind: the schema's are `schema_check`, every other action's a `rule`. */
export const refusalKind = (code: string) => (code.startsWith("schema.") ? "schema_check" : "rule");

/** What a refusal's node says the first time, beside the refusal's own message; `words.set` rewords it. */
export function refusalWords(code: string): string {
  if (code.startsWith("schema.")) {
    return `The schema held that change (${code}): something in it doesn't fit its type, and its problems are in the refusal. Fix the fields it names and act again; schema.check tries a change without writing it.`;
  }
  if (code === "action.input") return "That action needs fields it wasn't given; the refusal lists its shape. Send them all in one act.";
  if (code === "action.unknown") return "That action isn't declared now. The act tool's description lists those that are.";
  return `The map refused that act (${code}). Its reason is in the refusal: change what it names and act again, or tell what stopped you.`;
}

export const GET_MAX = 50;
/** What `map` says, on get and query. */
const MAP_DOC = "Another map by name: an old map kept read only. Absent, the living map. A name not known is answered with the names there are.";
export const QUERY_LIMIT = 30;
export const QUERY_MAX = 200;
export const WALK_MAX = 5;

const ok = (value: unknown): ToolResult => ({ text: JSON.stringify(value) });
const no = (text: string): ToolResult => ({ text, isError: true });
const NO_RUN = "No run is known here yet: the harness hasn't said whose call this is.";

const FAMILIES = PLACES.map((p) => p.term.replace(/<.*>$/, ""));
/** Whether a place is one of the spec's, with an argument where its family takes one. */
export function knownPlace(place: string): boolean {
  return FAMILIES.some((f) => (f.endsWith(":") ? place.startsWith(f) && place.length > f.length : place === f));
}

const isObject = (v: Json | undefined): v is { [key: string]: Json } => !!v && typeof v === "object" && !Array.isArray(v);
const ids = (v: Json | undefined): Id[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : typeof v === "string" ? [v] : []);
const brief = (r: { id: Id; type: string; fields: Record<string, Json> } | null | undefined) =>
  r ? { id: r.id, type: r.type, title: r.fields.title ?? null, ...(r.fields.status !== undefined ? { status: r.fields.status } : {}) } : null;

/** Items reached from `start` along links (of one type, if `over`), up to `steps` away. */
export function walk(index: Index, start: Id[], opts: { over?: string; dir?: Direction; steps?: number }): Id[] {
  const dir = opts.dir ?? "both";
  const seen = new Set(start);
  let edge = [...start];
  for (let step = 0; step < Math.min(opts.steps ?? 1, WALK_MAX) && edge.length; step++) {
    const at = new Set(edge);
    edge = [];
    for (const l of index.links.values()) {
      if (opts.over && l.type !== opts.over) continue;
      const next = dir !== "in" && at.has(l.from) ? l.to : dir !== "out" && at.has(l.to) ? l.from : undefined;
      if (next && !seen.has(next) && index.items.has(next)) {
        seen.add(next);
        edge.push(next);
      }
    }
  }
  return [...seen].filter((id) => !start.includes(id));
}

export interface McpConfig {
  /** Names a description node's item says it is for: `tool_text`. */
  kind?: string;
}

const mcp: Pack<McpConfig> = {
  id: "mcp",
  about: "The tools an agent uses to read and change the map.",
  inject: [HOST, "graph.read", "graph.watch", "types.read", "action.register", "action.list", "action.invoke", "exchange.read"],
  async apply(ctx: Context, config: McpConfig = {}) {
    const host = ctx.get<McpHost>(HOST);
    const graph = ctx.get<GraphRead>("graph.read");
    const live = ctx.get<GraphWatch>("graph.watch");
    const typesRead = ctx.get<TypesRead>("types.read");
    const actions = ctx.get<ActionList>("action.list");
    const invoke = ctx.get<ActionInvoke>("action.invoke");
    const exchange = ctx.get<ExchangeRead>("exchange.read");
    const KIND = config.kind ?? "tool_text";

    // ---- Other maps, by name, read only (maps.ts).
    const maps = new Map<string, { def: MapDef; index?: Promise<Index> }>();
    ctx.provide<McpMaps>(MAPS, (_caller, from) => ({
      add(def): Dispose {
        if (!def.name || maps.has(def.name)) {
          throw new Refused({ code: "mcp.map_taken", message: `A map ${def.name} is already there.`, by: { pack: "mcp" } });
        }
        return from.effect(() => {
          const entry = { def };
          maps.set(def.name, entry);
          return () => {
            if (maps.get(def.name) === entry) maps.delete(def.name);
          };
        });
      },
    }));
    /** The map a call names: absent or empty, the living one. */
    const mapOf = (name: Json | undefined): { read: MapRead | null; entry?: { def: MapDef; index?: Promise<Index> } } | string => {
      if (name === undefined || name === null || name === "") return { read: null };
      const entry = typeof name === "string" ? maps.get(name) : undefined;
      if (!entry) return `No map ${String(name)}. ${maps.size ? `The others are: ${[...maps.keys()].join(", ")}.` : "There is no other map."} Leave map out for the living one.`;
      return { read: entry.def.read, entry };
    };
    /** A map's whole index, read once: nothing writes to it. */
    const indexOf = (entry: { def: MapDef; index?: Promise<Index> }): Promise<Index> =>
      (entry.index ??= (async () => {
        const its: Index = { items: new Map(), links: new Map(), type: (n) => byType.get(n) };
        for (let p = await entry.def.read.all({ limit: LIMIT_MAX }); ; p = await entry.def.read.all({ limit: LIMIT_MAX, after: p.next })) {
          for (const it of p.items) {
            const f = it.fields;
            if (typeof f.from === "string" && typeof f.to === "string") its.links.set(it.id, { id: it.id, type: it.type, fields: f, from: f.from, to: f.to });
            else its.items.set(it.id, { id: it.id, type: it.type, fields: f });
          }
          if (!p.next) break;
        }
        return its;
      })());

    // ---- The map, held for query: every item and link of a type defined now.
    const items = new Map<Id, Row>();
    const links = new Map<Id, Wire>();
    let byType = new Map<string, TypeInfo>();
    let linkTypes: LinkInfo[] = [];
    const current: Index = { items, links, type: (n) => byType.get(n) };
    const put = (id: Id, type: string, f: Record<string, Json>) => {
      if (typeof f.from === "string" && typeof f.to === "string") links.set(id, { id, type, fields: f, from: f.from, to: f.to });
      else items.set(id, { id, type, fields: f });
    };
    const known = (t: Json | undefined) => typeof t === "string" && (byType.has(t) || linkTypes.some((l) => l.name === t));
    const apply = (c: Committed) => {
      const touched = new Map<Id, Record<string, Json>>();
      // An item the index didn't hold (its type wasn't shown) that this set gives a shown type: read it whole, since
      // the set holds only what changed (a node moved to a record keeps its title).
      const unseen = new Set<Id>();
      for (const [op, id, field, value] of c.facts) {
        if (!touched.has(id)) {
          const had = items.get(id) ?? links.get(id);
          if (!had) unseen.add(id);
          touched.set(id, had ? { type: had.type, ...had.fields } : {});
        }
        const f = touched.get(id)!;
        if (op === "+") f[field] = value;
        else delete f[field];
      }
      const whole: Id[] = [];
      for (const [id, f] of touched) {
        items.delete(id);
        links.delete(id);
        if (!known(f.type)) continue;
        const { type, ...fields } = f;
        put(id, String(type), fields);
        if (unseen.has(id)) whole.push(id);
      }
      for (let i = 0; i < whole.length; i += LIMIT_MAX) {
        const part = whole.slice(i, i + LIMIT_MAX);
        void graph.get(part).then((got) => {
          for (const it of got) if (it && known(it.type) && (items.has(it.id) || links.has(it.id))) put(it.id, it.type, it.fields);
        });
      }
    };
    let stopLive: Dispose | undefined;
    const follow = async () => {
      const cursor = await graph.now();
      const all = typesRead.all();
      byType = new Map(all.types.map((t) => [t.name, t]));
      linkTypes = all.links;
      const names = [...byType.keys(), ...linkTypes.map((l) => l.name)];
      const fresh: Item[] = [];
      for (const name of names) {
        for (let p = await graph.of(name, { limit: LIMIT_MAX }); ; p = await graph.of(name, { limit: LIMIT_MAX, after: p.next })) {
          fresh.push(...p.items);
          if (!p.next) break;
        }
      }
      items.clear();
      links.clear();
      for (const it of fresh) put(it.id, it.type, it.fields);
      await stopLive?.();
      stopLive = live.watch({ types: names, after: cursor }, apply);
    };
    ctx.effect(() => () => void stopLive?.());
    typesRead.watch(() => void follow().catch((err) => ctx.runtime.report(ctx.fiber, err)));
    await follow();

    // ---- Each tool's description, a node on the map at the tool's place.
    const nodeOf = new Map<string, Id>();
    const placeOf = (tool: string): Place => host.place(tool);
    const toolAt = (item: Item): string | undefined => {
      if (item.fields.kind !== KIND || item.fields.status === "retired" || !Array.isArray(item.fields.at)) return undefined;
      return Object.keys(DESCRIPTIONS).find((t) => (item.fields.at as Json[]).includes(placeOf(t)));
    };
    const learn = (item: Item | null, id: Id) => {
      for (const [t, n] of nodeOf) if (n === id && (!item || toolAt(item) !== t)) nodeOf.delete(t);
      const t = item && toolAt(item);
      if (t && !nodeOf.has(t)) nodeOf.set(t, item!.id);
    };
    live.watch({ types: ["node"] }, async (c) => {
      const touched = [...new Set(c.facts.map((f) => f[1]))];
      const now = await graph.get(touched);
      touched.forEach((id, i) => learn(now[i] ?? null, id));
    });
    for (let p = await graph.of("node", { limit: LIMIT_MAX }); ; p = await graph.of("node", { limit: LIMIT_MAX, after: p.next })) {
      for (const item of p.items) learn(item, item.id);
      if (!p.next) break;
    }
    /** Makes the description nodes that are missing, once `words.add` is declared. */
    let making = Promise.resolve();
    const makeNodes = () => {
      making = making.then(async () => {
        if (!actions.list().some((a) => a.name === "words.add")) return;
        for (const [tool, words] of Object.entries(DESCRIPTIONS)) {
          if (nodeOf.has(tool)) continue;
          const out = await invoke.invoke<{ node: Id }>({
            action: "words.add",
            input: { title: `The ${tool} tool`, kind: KIND, at: [placeOf(tool)], words },
            authority: { of: "agent", basis: "the mcp pack's tool descriptions" },
            reason: `Say the ${tool} tool's description as a node`,
          });
          if (out.ok) nodeOf.set(tool, out.output.node);
          else ctx.runtime.report(ctx.fiber, new Error(out.refused.message));
        }
      });
      return making;
    };
    actions.watch(() => void makeNodes());
    await makeNodes();
    // ---- Each kind of refusal an action gives, a node: said at the tool's result when the
    // result holds it, so it is judged and reworded like any instruction (refusalNode).
    const refusalAt = `tool_result:${placeOf("*").slice("tool:".length)}`;
    const refusals = new Map<string, Id>();
    const refusalOf = (item: Item): string | undefined => {
      const when = item.fields.when;
      if (item.fields.status === "retired" || typeof when !== "string" || !Array.isArray(item.fields.at) || !(item.fields.at as Json[]).includes(refusalAt)) return undefined;
      return /^Refused \((.+)\)$/.exec(when)?.[1];
    };
    const learnRefusal = (item: Item | null, id: Id) => {
      for (const [code, n] of refusals) if (n === id && (!item || refusalOf(item) !== code)) refusals.delete(code);
      const code = item && refusalOf(item);
      if (code && !refusals.has(code)) refusals.set(code, item!.id);
    };
    live.watch({ types: ["node"] }, async (c) => {
      const touched = [...new Set(c.facts.map((f) => f[1]))];
      const now = await graph.get(touched);
      touched.forEach((id, i) => learnRefusal(now[i] ?? null, id));
    });
    for (let p = await graph.of("node", { limit: LIMIT_MAX }); ; p = await graph.of("node", { limit: LIMIT_MAX, after: p.next })) {
      for (const item of p.items) learnRefusal(item, item.id);
      if (!p.next) break;
    }
    /** Makes sure a node says this kind of refusal; the first time a code is seen, through `words.add`. */
    const refusalNode = (code: string) => {
      making = making.then(async () => {
        if (refusals.has(code) || !actions.list().some((a) => a.name === "words.add")) return;
        const out = await invoke.invoke<{ node: Id }>({
          action: "words.add",
          input: { title: `Refused: ${code}`, kind: refusalKind(code), at: [refusalAt], when: `Refused (${code})`, words: refusalWords(code) },
          authority: { of: "agent", basis: "the mcp pack: each kind of refusal is a node" },
          reason: `Say the ${code} refusal as a node`,
        });
        if (out.ok) refusals.set(code, out.output.node);
        else ctx.runtime.report(ctx.fiber, new Error(out.refused.message));
      });
      return making;
    };

    const describe = async (tool: string): Promise<string> => {
      const id = nodeOf.get(tool);
      const [item] = id ? await graph.get([id]) : [null];
      const words = item && item.fields.status !== "retired" && typeof item.fields.words === "string" ? item.fields.words.trim() : "";
      return words || DESCRIPTIONS[tool]!;
    };

    // ---- tell, as an action: a record and its links, one change set.
    ctx.get<ActionRegister>("action.register").register({
      name: "mcp.tell",
      title: "Say what you concluded",
      input: {
        type: "object",
        properties: {
          said: { type: "string", description: "One short line." },
          about: { type: "array", items: { type: "string" }, description: "The items it concerns." },
          replaces: { type: "string", description: "An earlier record it supersedes." },
        },
        required: ["said"],
      },
      async run(input: { said: string; about?: Id[]; replaces?: Id }, call: ActionContext) {
        const said = typeof input.said === "string" ? input.said.trim() : "";
        if (!said) throw new Refused({ code: "mcp.said", message: "Say something: said can't be empty.", by: { pack: "mcp" } });
        const about = [...new Set([...(input.about ?? []), ...(input.replaces ? [input.replaces] : [])])].slice(0, GET_MAX);
        const there = await graph.get(about);
        const gone = about.filter((_, i) => !there[i]);
        if (gone.length) throw new Refused({ code: "mcp.missing", message: `There is no item ${gone.join(", ")}.`, by: { pack: "mcp" } });
        const { id } = await call.call<{ id: Id }>("items.create", { type: "record", title: said, fields: { kind: "said" } });
        if (input.replaces) await call.call("items.set", { id: input.replaces, fields: { status: "superseded" } });
        // items.link reads its ends from the graph, where the new record isn't yet: its links are written here.
        for (const to of about) {
          const link = `i_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
          call.write([["+", link, "type", "about"], ["+", link, "from", id], ["+", link, "to", to]]);
        }
        return { id };
      },
    });

    const asAgent = (run: ToolRun, given?: Json): Authority => {
      if (isObject(given) && (given.of === "human" || given.of === "agent") && typeof given.basis === "string" && given.basis) {
        return { of: given.of, basis: given.basis };
      }
      return { of: "agent", basis: `asked for in run ${run.run}` };
    };

    // ---- The tools.
    const tools: Omit<ToolDef, "description">[] = [
      {
        name: "hear",
        inputSchema: {
          type: "object",
          properties: { place: { type: "string", description: "Such as file:spec/agent.ts or tool:Bash." } },
          required: ["place"],
        },
        async call(args, run) {
          const place = args.place;
          if (typeof place !== "string" || !knownPlace(place)) return no(`Not a place: ${String(place)}. Use file:<path>, tool:<name>, or another place of the agent spec.`);
          if (!run) return no(NO_RUN);
          // The agent asked: say everything there, heard in this context or not.
          const answer = await run.agent.reach({ run: run.run, places: [place], time: new Date().toISOString(), again: true });
          const said = answer.said.map((s) => s.text).join("\n\n");
          if (answer.refused) return no(said ? `${answer.refused.text}\n\n${said}` : answer.refused.text);
          return { text: said || "Nothing is said here." };
        },
      },
      {
        name: "act",
        inputSchema: {
          type: "object",
          properties: {
            action: { type: "string", description: "Such as items.create." },
            input: { type: "object", description: "The action's input." },
            reason: { type: "string", description: "Why, in one line: it is recorded with the change." },
            authority: {
              type: "object",
              description: "When a person told you: { of: \"human\", basis: what they said }. Else your own judgment.",
              properties: { of: { type: "string", enum: ["human", "agent"] }, basis: { type: "string" } },
            },
          },
          required: ["action"],
        },
        async call(args, run) {
          const name = args.action;
          if (typeof name !== "string" || !name) return no("Say which action, as action.");
          const declared = actions.list().find((a) => a.name === name);
          if (!declared) return no(`No action ${name} is declared now. Declared: ${actions.list().map((a) => a.name).join(", ")}.`);
          if (args.input === undefined) return ok({ action: declared.name, title: declared.title, ...(declared.doc ? { doc: declared.doc } : {}), input: declared.input });
          if (!run) return no(NO_RUN);
          const out = await run.invoke.invoke({
            action: name,
            input: isObject(args.input) ? args.input : {},
            authority: asAgent(run, args.authority),
            reason: typeof args.reason === "string" && args.reason ? args.reason : `${name}, by the agent`,
          });
          if (!out.ok) {
            await refusalNode(out.refused.code);
            // An input that doesn't fit the action's shape: say the shape.
            const shape = out.refused.code === "action.input" ? ` It takes: ${JSON.stringify(declared.input.properties ?? declared.input)}` : "";
            return no(`Refused (${out.refused.code}): ${out.refused.message}${shape}`);
          }
          return ok({ output: out.output, ...(out.change ? { change: out.change } : {}) });
        },
      },
      {
        name: "get",
        inputSchema: {
          type: "object",
          properties: {
            ids: { type: "array", items: { type: "string" }, description: `At most ${GET_MAX}.` },
            links: { type: "boolean", description: "With their links (default true)." },
            map: { type: "string", description: MAP_DOC },
          },
          required: ["ids"],
        },
        async call(args) {
          const want = [...new Set(ids(args.ids))].slice(0, GET_MAX);
          if (!want.length) return no("Give ids.");
          const on = mapOf(args.map);
          if (typeof on === "string") return no(on);
          const read: Pick<MapRead, "get" | "links"> = on.read ?? graph;
          const found = await read.get(want);
          const out: Json[] = [];
          const missing: Id[] = [];
          for (let i = 0; i < want.length; i++) {
            const item = found[i];
            if (!item) {
              missing.push(want[i]!);
              continue;
            }
            const t = typesRead.get(item.type);
            const base: { [key: string]: Json } = t && "base" in t ? { base: t.base } : {};
            if (args.links === false || typeof item.fields.from === "string") {
              out.push({ id: item.id, type: item.type, ...base, ...item.fields });
              continue;
            }
            const page = await read.links(item.id, { dir: "both" }, { limit: GET_MAX });
            const ends = await read.get(page.items.map((l) => (l.from === item.id ? l.to : l.from)));
            const ls = page.items.map((l, j) => {
              const { from: _f, to: _t, ...fields } = l.fields;
              const end = brief(ends[j]) ?? { id: l.from === item.id ? l.to : l.from };
              return { id: l.id, type: l.type, ...(l.from === item.id ? { to: end } : { from: end }), ...fields };
            });
            out.push({ id: item.id, type: item.type, ...base, ...item.fields, links: ls, ...(page.next ? { more_links: true } : {}) } as Json);
          }
          return ok({ ...(on.entry ? { map: on.entry.def.name } : {}), items: out, ...(missing.length ? { missing } : {}) });
        },
      },
      {
        name: "query",
        inputSchema: {
          type: "object",
          properties: {
            find: { type: "string", description: "Words and terms, as in the map's find line. Empty: is:open." },
            walk: {
              type: "object",
              description: "From what is found, along links.",
              properties: {
                over: { type: "string", description: "One kind of link; absent, any." },
                dir: { type: "string", enum: ["out", "in", "both"] },
                steps: { type: "number", description: `1 to ${WALK_MAX}.` },
              },
            },
            limit: { type: "number", description: `Default ${QUERY_LIMIT}, at most ${QUERY_MAX}.` },
            map: { type: "string", description: MAP_DOC },
          },
        },
        async call(args) {
          const on = mapOf(args.map);
          if (typeof on === "string") return no(on);
          const index: Index = on.entry ? await indexOf(on.entry) : current;
          const { items, links } = index;
          const limit = Math.max(1, Math.min(typeof args.limit === "number" ? Math.floor(args.limit) : QUERY_LIMIT, QUERY_MAX));
          const q = typeof args.find === "string" ? args.find : "";
          const found = find(index, q, QUERY_MAX * 10);
          let rows = found.items;
          let more = found.more;
          if (isObject(args.walk)) {
            const w = args.walk;
            const dir = w.dir === "out" || w.dir === "in" ? w.dir : "both";
            const reached = walk(index, rows.map((r) => r.id), {
              ...(typeof w.over === "string" ? { over: w.over } : {}),
              dir,
              steps: typeof w.steps === "number" ? Math.max(1, Math.floor(w.steps)) : 1,
            });
            rows = [...rows, ...reached.map((id) => items.get(id)!)];
          }
          more += Math.max(0, rows.length - limit);
          rows = rows.slice(0, limit);
          const kept = new Set(rows.map((r) => r.id));
          const ls = [...links.values()].filter((l) => kept.has(l.from) && kept.has(l.to)).map((l) => ({ id: l.id, type: l.type, from: l.from, to: l.to }));
          return ok({ ...(on.entry ? { map: on.entry.def.name } : {}), items: rows.map(brief), links: ls, ...(more ? { more } : {}) });
        },
      },
      {
        name: "tell",
        inputSchema: {
          type: "object",
          properties: {
            said: { type: "string", description: "One short line." },
            about: { type: "array", items: { type: "string" }, description: "Ids of the items it concerns." },
            replaces: { type: "string", description: "An earlier record of yours it supersedes." },
          },
          required: ["said"],
        },
        async call(args, run) {
          if (!run) return no(NO_RUN);
          const input: { [key: string]: Json } = { said: typeof args.said === "string" ? args.said : "" };
          const about = ids(args.about);
          if (about.length) input.about = about;
          if (typeof args.replaces === "string") input.replaces = args.replaces;
          const out = await run.invoke.invoke<{ id: Id }>({ action: "mcp.tell", input, authority: asAgent(run), reason: `Told: ${String(input.said).slice(0, 120)}` });
          if (!out.ok) {
            await refusalNode(out.refused.code);
            return no(`Refused (${out.refused.code}): ${out.refused.message}`);
          }
          return ok({ id: out.output.id, ...(out.change ? { change: out.change } : {}) });
        },
      },
      {
        name: "run",
        inputSchema: {
          type: "object",
          properties: {
            title: { type: "string", description: "What the chat is called." },
            task: { type: "string", description: "The id of the item this run took on." },
            parent: { type: "string", description: "The run that started this one." },
            profiles: { type: "array", items: { type: "string" }, description: "Ids of profiles this run is in, beyond what its facts give." },
            drop: { type: "array", items: { type: "string" }, description: "Ids of profiles this run is not in, whatever its facts give." },
            end: { type: "boolean", description: "The run is over." },
          },
        },
        async call(args, run) {
          if (!run) return no(NO_RUN);
          const now = new Date().toISOString();
          if (args.end === true) {
            await run.agent.end(run.run, now);
            return ok({ run: run.run, ended: now });
          }
          if (typeof args.task === "string") {
            const [task] = await graph.get([args.task]);
            if (!task) return no(`There is no item ${args.task}.`);
          }
          let info: RunInfo | undefined;
          for (let p = await exchange.runs({ limit: LIMIT_MAX }); !info; p = await exchange.runs({ limit: LIMIT_MAX, after: p.next })) {
            info = p.items.find((r) => r.run === run.run);
            if (!p.next) break;
          }
          // Facts are made again at begin; only what this call says is given (edition 5).
          const { started: _s, ended: _e, facts: _f, ...was } = info ?? { run: run.run, agent: run.actor, harness: host.harness, reaches: [] };
          const said = Object.fromEntries((["title", "task", "parent"] as const).filter((k) => typeof args[k] === "string" && args[k]).map((k) => [k, args[k] as string]));
          const facts: Facts = {};
          if (ids(args.profiles).length) facts.profiles = ids(args.profiles);
          if (ids(args.drop).length) facts.profiles_drop = ids(args.drop);
          const begun = await run.agent.begin({ ...was, ...said, ...(Object.keys(facts).length ? { facts } : {}) });
          return ok({ run: begun.run, ...(begun.title ? { title: begun.title } : {}), ...(begun.task ? { task: begun.task } : {}), ...(begun.parent ? { parent: begun.parent } : {}) });
        },
      },
    ];
    for (const t of tools) host.add({ ...t, description: () => describe(t.name).then((d) => (t.name === "act" ? `${d} Declared now: ${actions.list().map((a) => a.name).join(", ")}.` : d)) });
  },
};

export default mcp;
