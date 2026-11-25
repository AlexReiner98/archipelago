/**
 * The typed plugin: a typed call. A plugin asks a model for items of one type
 * and gets back facts that fit the map's types, or a clear failure.
 *
 * `typed.ask(start)`: the type, as `types.read` resolves it, and the kinds
 * of link that may go out of it give the JSON Schema the model is held to
 * (shape.ts). The model is asked through an adapter (model.ts), its reply
 * made into facts, and the facts checked by the schema plugin
 * (`schema.check`, writing nothing). A misfit's problems go back to the
 * model, in its reply's words, `retries` times (default 1); then the call
 * fails with them. A fit comes back as proposed facts: nothing is written
 * until the caller writes them through an action of its own, or a person
 * through `typed.apply`.
 *
 * Every typed call is a call (`call.ask`): a run under its parent, said to
 * at its places, each attempt a `reply` act at `typed:attempt` (the schema
 * on the first, the retry's words on the next) and each check a `tool` act
 * at `typed:check` (the facts, fits, the problems), then the answer at
 * `reply_end`. `typed.get` reads one back from the exchange.
 *
 * Provides `typed.ask`; injects `call.ask`, `types.read`, `action.invoke`,
 * `action.register` and `exchange.read`, and `agent.run` to record attempts.
 */
import type { ActionContext, ActionInvoke, ActionRegister, JsonSchema } from "../../spec/action.ts";
import type { AgentRun, Facts, Place, RunId } from "../../spec/agent.ts";
import type { Fact } from "../../spec/changeset.ts";
import type { Id, Json } from "../../spec/common.ts";
import { Refused } from "../../spec/common.ts";
import type { ExchangeRead } from "../../spec/exchange.ts";
import { LIMIT_MAX } from "../../spec/graph.ts";
import type { TypeInfo, TypesRead } from "../../spec/types.ts";
import type { Context, Plugin } from "../../runtime/core.ts";
import type { CallAsk } from "../call/index.ts";
import { modelOf, type Message, type Model, type ModelConfig, type Usage } from "./model.ts";
import { factsOf, inReplyWords, schemaOf } from "./shape.ts";
import { readTyped, TYPED, ATTEMPT_AT, CHECK_AT, type TypedRecord } from "./read.ts";

export { readTyped, type TypedRecord } from "./read.ts";

export interface TypedConfig {
  /** The model `typed.ask` uses when its caller gives none. */
  model?: ModelConfig | string;
  /** How many times a misfit is sent back before the call fails. Default 1. */
  retries?: number;
}

export interface TypedStart {
  /** The type of the items asked for: a base or a flavour. */
  type: string;
  /** What to make: the request in words, with what the model should know (ids it may link to). */
  prompt: string;
  /** More for the system prompt. */
  system?: string;
  /** A name for the call. Default `<type> items`. */
  title?: string;
  /** The run that made it (see call.ask). */
  parent?: RunId;
  /** Where the map speaks to it. Default `typed:<type>`. */
  places?: Place[];
  /** Kinds of link the model may give each item. Absent: every kind allowed out of the type's base. */
  links?: string[];
  /** Links the caller adds to every item, not the model: `{ type: "part_of", to: <hub> }`. */
  attach?: { type: string; to: Id }[];
  /** Only these of the type's fields go into the schema the model sees; the caller fills the others (`set`). Absent: every field. */
  fields?: string[];
  /** Fields the caller sets on every item, over the reply's, before any check: bookkeeping the model is never offered. */
  set?: Record<string, Json>;
  /**
   * An item whose decision at this version judges the call (see call.ask).
   * `{ made: true, version }`: the item the call makes, followed once the
   * reply fits; the call then asks for exactly one item.
   */
  follow?: { item: Id; version: string } | { made: true; version: string };
  /** The caller's own context in the prompt, by its kind and size only (call.ask's `subject`): the context plugin counts it as `subject:<type>`. */
  subject?: { type: string; tokens: number };
  /** How many items, at least and at most. */
  min?: number;
  max?: number;
  /** How many times a misfit is sent back. Default the config's, else 1. */
  retries?: number;
  /** The model. Default the configured one. */
  model?: Model;
  /** More facts on the call's run. */
  facts?: Facts;
  /**
   * The caller's own check, for a rule the schema can't say (a field must
   * name these numbers). Runs once schema.check finds nothing, on the items
   * as they would be made; its problems (marked `by: "caller"`) are sent
   * back and fail the call like the schema's. A throw fails the call like
   * the model's. Programmatic only: not in the `typed.ask` action's input.
   */
  check?: (made: Made) => Problem[] | Promise<Problem[]>;
}

/** What a caller's check is given: each item as it would be made, and every fact. */
export interface Made {
  items: { ref: string; id: Id; type: string; title?: string; fields: Record<string, Json> }[];
  facts: Fact[];
}

export interface Problem {
  code: string;
  message: string;
  /** Where in the reply, when known: `item "a"`, `items[2].title`. */
  at?: string;
  field?: string;
  /** Whose problem: absent for the schema's and the reply's shape, `caller` for the caller's own check. */
  by?: "caller";
}

export type TypedResult =
  | { ok: true; run: RunId; type: string; facts: Fact[]; ids: Record<string, Id>; attempts: number; usage: Usage }
  | { ok: false; run: RunId; type: string; problems: Problem[]; attempts: number; usage: Usage };

/** `typed.ask`, this plugin's own key. */
export interface TypedAsk {
  ask(start: TypedStart): Promise<TypedResult>;
}

const by = { plugin: "typed" };
const refuse = (code: string, message: string): never => {
  throw new Refused({ code: `typed.${code}`, message, by });
};
const newId = () => `i_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
const now = () => new Date().toISOString();
const isType = (t: unknown): t is TypeInfo => !!t && typeof t === "object" && "statuses" in t;

/** The system prompt: what is asked, then what the map said at the call's places. */
export function systemOf(t: TypeInfo, extra: string | undefined, said: { text: string }[]): string {
  return [
    `You make items for a map. Each is a ${t.name}${t.base !== t.name ? ` (a kind of ${t.base})` : ""}${t.doc ? `: ${t.doc}` : "."} Reply with one JSON object that matches the schema you are given, and nothing else.`,
    extra,
    ...said.map((s) => s.text),
  ]
    .filter(Boolean)
    .join("\n\n");
}

/** What is sent back to the model after a misfit. */
export function retryOf(problems: Problem[]): string {
  return `That reply doesn't fit${problems.some((p) => p.by === "caller") ? "" : " the map's types"}:\n${problems.map((p) => `- ${p.message}`).join("\n")}\nGive the whole reply again, fixed.`;
}

class Misfit extends Error {
  readonly problems: Problem[];
  constructor(problems: Problem[]) {
    super(problems.map((p) => p.message).join(" "));
    this.problems = problems;
  }
}

const sum = (a: Usage, b?: Usage): Usage => (b ? { input: a.input + b.input, output: a.output + b.output, ...(b.model ? { model: b.model } : a.model ? { model: a.model } : {}) } : a);

const typed: Plugin<TypedConfig> = {
  id: "typed",
  about: "A typed call: asks a model for items of a type, and gives back facts that fit the map, or the problems.",
  inject: ["call.ask", "types.read", "action.invoke", "action.register", "exchange.read", "agent.run"],
  apply(ctx: Context, config: TypedConfig = {}) {
    const calls = ctx.get<CallAsk>("call.ask");
    const types = ctx.get<TypesRead>("types.read");
    const invoke = ctx.get<ActionInvoke>("action.invoke");
    const agentRun = ctx.get<AgentRun>("agent.run");
    const exchange = ctx.get<ExchangeRead>("exchange.read");
    let configured: Model | undefined;
    let unconfigured: string | undefined;
    try {
      configured = modelOf(config.model);
    } catch (e) {
      unconfigured = String((e as Error).message ?? e);
    }

    const ask = async (start: TypedStart, plugin: string): Promise<TypedResult> => {
      const t = types.get(start.type);
      if (!isType(t)) return refuse("type_unknown", `There is no type ${start.type} now: a base or a flavour of one.`);
      const model = start.model ?? configured;
      if (!model) return refuse("no_model", unconfigured ?? "No model is configured for typed calls: set the typed plugin's `model`.");
      const made1 = !!start.follow && "made" in start.follow && start.follow.made === true;
      if (start.follow && !made1 && !("item" in start.follow && typeof start.follow.item === "string")) return refuse("follow", "follow is { item, version } or { made: true, version }.");
      const followItem = start.follow && "item" in start.follow ? start.follow : undefined;
      const shape = {
        ...(start.links ? { links: start.links } : {}),
        ...(made1 ? { min: 1, max: 1 } : { ...(start.min !== undefined ? { min: start.min } : {}), ...(start.max !== undefined ? { max: start.max } : {}) }),
        ...(start.fields ? { fields: start.fields } : {}),
      };
      const schema: JsonSchema = schemaOf(t, types.all().links, shape);
      const retries = Math.max(0, start.retries ?? config.retries ?? 1);
      let run = "";
      let attempts = 0;
      let usage: Usage = { input: 0, output: 0 };
      let result: { facts: Fact[]; ids: Record<string, Id> } | undefined;
      const act = (place: string, kind: "reply" | "tool", ok: boolean, input: Json, output: Json) =>
        agentRun.act({ run, place, time: now(), kind, by: "agent", ok, input, output });
      try {
        await calls.ask(
          {
            title: start.title ?? `${t.name} items`,
            places: start.places ?? [`typed:${t.name}`],
            ...(start.parent ? { parent: start.parent } : {}),
            ...(followItem ? { follow: followItem } : {}),
            facts: { ...(start.facts ?? {}), [TYPED]: t.name, model: model.id, caller: plugin },
          },
          async ({ run: r, said }) => {
            run = r;
            const system = systemOf(t, start.system, said);
            const messages: Message[] = [{ role: "user", content: start.prompt }];
            let retry: string | undefined;
            for (let n = 1; ; n++) {
              attempts = n;
              const description = n === 1 ? `attempt 1 · ${model.id}, held to ${t.name}'s schema` : `attempt ${n} · ${model.id}, after a misfit sent back`;
              const input = { description, attempt: n, model: model.id, ...(n === 1 ? { type: t.name, schema } : { retry: retry! }) } as unknown as Json;
              let reply;
              try {
                reply = await model.ask({ system, messages, schema, name: t.name });
              } catch (e) {
                await act(ATTEMPT_AT, "reply", false, input, { error: String((e as Error)?.message ?? e) });
                throw e;
              }
              usage = sum(usage, reply.usage);
              const made = reply.json === undefined ? undefined : factsOf(reply.json, t, newId, { ...shape, ...(start.attach ? { attach: start.attach } : {}), ...(start.set ? { set: start.set } : {}) });
              let problems: Problem[] = made ? made.problems.map((p) => ({ ...p })) : [{ code: "typed.not_json", message: "The reply held no JSON: give only one JSON object." }];
              if (made && !problems.length) {
                const out = await invoke.invoke<{ fits: boolean; problems: { code: string; message: string; id: Id; field?: string }[] }>({
                  action: "schema.check",
                  input: { facts: made.facts as unknown as Json },
                  authority: { of: "agent", basis: `typed call ${run}` },
                  reason: `Would a typed call's reply fit ${t.name}?`,
                });
                if (!out.ok) throw new Error(`schema.check is not there to check a typed call: ${out.refused.message}`);
                problems = out.output.problems.map((p) => ({
                  code: p.code,
                  message: made.names[p.id] && !p.message.includes(p.id) ? `${made.names[p.id]}: ${p.message}` : inReplyWords(p.message, made.names),
                  ...(made.names[p.id] ? { at: made.names[p.id] } : {}),
                  ...(p.field ? { field: p.field } : {}),
                }));
              }
              if (made && !problems.length && start.check) {
                const items = Object.entries(made.ids).map(([ref, id]) => {
                  const fields: Record<string, Json> = {};
                  for (const [op, fid, field, value] of made.facts) if (op === "+" && fid === id && field !== "type") fields[field] = value;
                  return { ref, id, type: t.name, ...(typeof fields.title === "string" ? { title: fields.title } : {}), fields };
                });
                let theirs: Problem[];
                try {
                  theirs = await start.check({ items, facts: made.facts });
                } catch (e) {
                  await act(ATTEMPT_AT, "reply", false, input, { ...(reply.json !== undefined ? { json: reply.json as Json } : { text: reply.text }), error: `the caller's check threw: ${String((e as Error)?.message ?? e)}` });
                  throw e;
                }
                problems = (theirs ?? []).map((p) => ({ ...p, by: "caller" as const }));
              }
              const fits = problems.length === 0;
              const again = !fits && n <= retries;
              retry = again ? retryOf(problems) : undefined;
              await act(ATTEMPT_AT, "reply", fits, input, { ...(reply.json !== undefined ? { json: reply.json as Json } : { text: reply.text }), ...(reply.usage ? { usage: reply.usage as unknown as Json } : {}) });
              const facts = made?.facts ?? [];
              await act(CHECK_AT, "tool", fits, { description: `${start.check ? "schema.check and the caller's check" : "schema.check"}, attempt ${n}: ${fits ? "fits" : `${problems.length} problem${problems.length === 1 ? "" : "s"}`} in ${facts.length} facts of ${t.name}`, facts: facts as unknown as Json }, {
                fits,
                problems: problems as unknown as Json,
                ...(retry ? { retry } : !fits ? { failed: `no retries left (${retries})` } : {}),
              });
              if (fits) {
                result = { facts, ids: made!.ids };
                const count = Object.keys(made!.ids).length;
                const one = Object.values(made!.ids);
                return {
                  text: `${count} ${t.name} item${count === 1 ? "" : "s"} fit, on attempt ${n}.`,
                  ...(reply.usage ? { usage: reply.usage } : {}),
                  ...(start.subject ? { subject: { type: start.subject.type, tokens: start.subject.tokens } } : {}),
                  ...(made1 && one.length === 1 ? { follow: { item: one[0]!, version: (start.follow as { version: string }).version } } : {}),
                };
              }
              if (!again) throw new Misfit(problems);
              messages.push({ role: "assistant", content: reply.text }, { role: "user", content: retry! });
            }
          },
        );
      } catch (e) {
        if (e instanceof Misfit) return { ok: false, run, type: t.name, problems: e.problems, attempts, usage };
        throw e;
      }
      return { ok: true, run, type: t.name, facts: result!.facts, ids: result!.ids, attempts, usage };
    };

    ctx.provide<TypedAsk>("typed.ask", (caller) => ({ ask: (start) => ask(start, caller.plugin) }));

    const register = ctx.get<ActionRegister>("action.register");
    const one = async (run: string): Promise<TypedRecord> => {
      const rec = await readTyped(exchange, run);
      if (!rec) return refuse("no_call", `There is no typed call ${run}.`);
      return rec;
    };

    register.register({
      name: "typed.ask",
      title: "Ask a model for items of a type",
      doc: "Builds the JSON Schema from the type and the links allowed out of it, asks the configured model, checks the reply with schema.check, sends the problems back `retries` times, and answers the proposed facts (ok) or the problems. Recorded as a call. Writes nothing: `typed.apply` writes a fitting call's facts.",
      input: {
        type: "object",
        properties: {
          type: { type: "string", description: "A base or a flavour" },
          prompt: { type: "string" },
          system: { type: "string" },
          title: { type: "string" },
          parent: { type: "string", description: "The run that made it" },
          links: { type: "array", items: { type: "string" } },
          attach: { type: "array", items: { type: "object", properties: { type: { type: "string" }, to: { type: "string" } }, required: ["type", "to"] } },
          fields: { type: "array", items: { type: "string" }, description: "Only these of the type's fields are offered to the model" },
          set: { type: "object", description: "Fields set on every item by the caller, never offered to the model" },
          follow: { type: "object", description: "{item, version}, or {made: true, version}: the item the call makes", properties: { item: { type: "string" }, made: { type: "boolean" }, version: { type: "string" } }, required: ["version"] },
          subject: { type: "object", description: "The caller's context by kind and size only", properties: { type: { type: "string" }, tokens: { type: "number" } }, required: ["type", "tokens"] },
          min: { type: "number" },
          max: { type: "number" },
          retries: { type: "number" },
        },
        required: ["type", "prompt"],
      },
      async run(input: Omit<TypedStart, "model" | "facts">, call: ActionContext) {
        return (await ask(input, call.caller.plugin)) as unknown as Json;
      },
    });

    register.register({
      name: "typed.get",
      title: "A typed call, as it went",
      doc: "From the exchange: its type and model, the schema it was held to, each attempt (the reply, its usage, the check's problems, the retry sent back), and the proposed facts when it fit. Writes nothing.",
      input: { type: "object", properties: { run: { type: "string" } }, required: ["run"] },
      async run(input: { run: string }) {
        return (await one(input.run)) as unknown as Json;
      },
    });

    register.register({
      name: "typed.calls",
      title: "The newest typed calls",
      doc: "Newest first, each with its type, model, outcome and how many attempts; `limit` (at most 50) and `after` (the cursor given). Writes nothing.",
      input: { type: "object", properties: { limit: { type: "number" }, after: { type: "string" } } },
      async run(input: { limit?: number; after?: string }) {
        const want = Math.min(Math.max(1, input.limit ?? 20), 50);
        const out: Json[] = [];
        let after = input.after;
        for (let pages = 0; pages < 5 && out.length < want; pages++) {
          const p = await exchange.runs({ limit: LIMIT_MAX, ...(after ? { after } : {}) });
          for (const r of p.items) {
            if (out.length >= want) break;
            if (typeof r.facts?.[TYPED] !== "string") continue;
            const rec = await readTyped(exchange, r.run, r);
            if (rec) out.push({ run: rec.run, title: rec.title ?? null, type: rec.type, model: rec.model ?? null, outcome: rec.outcome, attempts: rec.attempts.length, started: rec.started, ...(rec.parent ? { parent: rec.parent } : {}) });
          }
          after = p.next;
          if (!after) break;
        }
        return { items: out, ...(after ? { next: after } : {}) };
      },
    });

    register.register({
      name: "typed.apply",
      title: "Write a typed call's proposed facts",
      doc: "Writes the facts a typed call proposed, as the caller's change, through the write chain (the schema plugin checks them again: the map may have changed since). Refused for a call that didn't fit.",
      input: { type: "object", properties: { run: { type: "string" } }, required: ["run"] },
      async run(input: { run: string }, call: ActionContext) {
        const rec = await one(input.run);
        if (!rec.proposed) return refuse("not_fit", `Typed call ${input.run} didn't fit, so it proposes nothing.`);
        call.write(rec.proposed);
        const items = rec.proposed.filter(([op, , f, v]) => op === "+" && f === "type" && v === rec.type).map((f) => f[1]);
        return { run: rec.run, items } as Json;
      },
    });
  },
};

export default typed;
