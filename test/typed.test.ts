import assert from "node:assert/strict";
import { test } from "node:test";
import type { ActionInvoke } from "../spec/action.ts";
import type { NodeDef, AgentNode } from "../spec/agent.ts";
import type { Json } from "../spec/common.ts";
import type { ExchangeRead } from "../spec/exchange.ts";
import type { GraphRead } from "../spec/graph.ts";
import { COMMON, type TypeInfo, type TypesDefine } from "../spec/types.ts";
import { Runtime, type Pack } from "../runtime/core.ts";
import { Loader, type Entry } from "../runtime/loader.ts";
import action from "../packs/action/index.ts";
import agent from "../packs/agent/index.ts";
import call from "../packs/call/index.ts";
import exchange from "../packs/exchange/index.ts";
import graph from "../packs/graph/index.ts";
import schema from "../packs/schema/index.ts";
import types from "../packs/types/index.ts";
import typed, { retryOf, systemOf, type TypedAsk, type TypedRecord } from "../packs/typed/index.ts";
import { factsOf, inReplyWords, schemaOf, strictSubset } from "../packs/typed/shape.ts";
import { jsonIn, modelOf, scripted, textPrompt } from "../packs/typed/model.ts";

// ---------- apart from the runtime ----------

const work: TypeInfo = {
  name: "work",
  base: "work",
  statuses: { open: ["todo", "doing"], closed: ["done"] },
  fields: { ...COMMON, size: { kind: "number", doc: "Hours." } },
  trial: false,
  pack: "fixture",
};
const chore: TypeInfo = { ...work, name: "chore", fields: { ...work.fields, room: { kind: "choice", values: ["kitchen", "hall"] } }, trial: true };
const LINKS = [
  { name: "depends_on", from: ["work"], to: ["work"], pack: "fixture" },
  { name: "about", pack: "fixture" },
  { name: "waits_on", from: ["work"], to: ["actor"], pack: "fixture" },
  { name: "answers", from: ["question"], pack: "fixture" },
];

test("a schema from a base: its fields by kind, its statuses, the links allowed out of it", () => {
  const s = schemaOf(work, LINKS) as any;
  const item = s.properties.items.items;
  assert.deepEqual(Object.keys(item.properties), ["ref", "title", "note", "status", "size", "links"]);
  assert.deepEqual(item.properties.status.enum, ["todo", "doing", "done"]);
  assert.equal(item.properties.size.type, "number");
  assert.deepEqual(item.properties.links.items.properties.type.enum, ["depends_on", "about", "waits_on"], "answers goes out of a question only");
  assert.deepEqual(item.required, ["ref", "title"]);
  assert.equal(item.additionalProperties, false);
  assert.equal((schemaOf(work, LINKS, { links: [] }) as any).properties.items.items.properties.links, undefined);
  assert.deepEqual((schemaOf(work, LINKS, { min: 1, max: 3 }) as any).properties.items.minItems, 1);
});

test("a schema from a flavour of a base: the base's fields and statuses, and its own", () => {
  const item = (schemaOf(chore, LINKS) as any).properties.items.items;
  assert.deepEqual(Object.keys(item.properties), ["ref", "title", "note", "status", "size", "room", "links"]);
  assert.deepEqual(item.properties.room.enum, ["kitchen", "hall"]);
  assert.deepEqual(item.properties.status.enum, ["todo", "doing", "done"]);
  assert.deepEqual(item.properties.links.items.properties.type.enum, ["depends_on", "about", "waits_on"], "a flavour's links are its base's");
  assert.match(String((schemaOf(chore, LINKS) as any).description), /chore, a work/);
});

test("strict subset: every property required, the optional ones nullable", () => {
  const item = (strictSubset(schemaOf(work, LINKS)) as any).properties.items.items;
  assert.deepEqual(item.required, ["ref", "title", "note", "status", "size", "links"]);
  assert.deepEqual(item.properties.title, { type: "string", description: "A name of a few words." });
  assert.deepEqual(item.properties.size.anyOf[1], { type: "null" });
  assert.deepEqual(item.properties.links.anyOf[0].items.required, ["type", "to"]);
});

test("facts of a reply: items with their first open status, links to refs or ids, the caller's links, nulls absent", () => {
  let n = 0;
  const made = factsOf(
    { items: [{ ref: "a", title: "Sweep", size: 1, note: null, links: [{ type: "depends_on", to: "b" }] }, { ref: "b", title: "Buy a broom", status: "doing" }] },
    work,
    () => `n${++n}`,
    { attach: [{ type: "about", to: "hub" }] },
  );
  assert.deepEqual(made.problems, []);
  assert.deepEqual(made.ids, { a: "n1", b: "n2" });
  assert.deepEqual(made.facts, [
    ["+", "n1", "type", "work"], ["+", "n1", "status", "todo"], ["+", "n1", "title", "Sweep"], ["+", "n1", "size", 1],
    ["+", "n3", "type", "depends_on"], ["+", "n3", "from", "n1"], ["+", "n3", "to", "n2"],
    ["+", "n4", "type", "about"], ["+", "n4", "from", "n1"], ["+", "n4", "to", "hub"],
    ["+", "n2", "type", "work"], ["+", "n2", "title", "Buy a broom"], ["+", "n2", "status", "doing"],
    ["+", "n5", "type", "about"], ["+", "n5", "from", "n2"], ["+", "n5", "to", "hub"],
  ]);
  assert.equal(inReplyWords("depends_on's to is n9; n1 has no field x.", made.names), "depends_on's to is n9; item \"a\" has no field x.");
});

test("facts of a reply: what is wrong with its shape", () => {
  let n = 0;
  const id = () => `n${++n}`;
  assert.deepEqual(factsOf([1], work, id).problems.map((p) => p.code), ["typed.shape"]);
  const made = factsOf({ items: [{ ref: "a" }, { ref: "a", title: "x" }, "no", { ref: "c", title: "y", type: "question", links: "b" }] }, work, id, { max: 2 });
  assert.deepEqual(made.problems.map((p) => [p.code, p.at]), [
    ["typed.count", "items"],
    ["typed.ref", "items[1].ref"],
    ["typed.shape", "items[0].title"],
    ["typed.shape", "items[2]"],
    ["typed.shape", "items[3].type"],
    ["typed.shape", "items[3].links"],
  ]);
});

test("JSON in a model's words: whole, fenced, or between braces", () => {
  assert.deepEqual(jsonIn('{"items": []}'), { items: [] });
  assert.deepEqual(jsonIn('Here:\n```json\n{"items": [1]}\n```\nDone.'), { items: [1] });
  assert.deepEqual(jsonIn('Sure. {"items": [2]} Hope that helps.'), { items: [2] });
  assert.equal(jsonIn("no json here"), undefined);
});

test("a text prompt carries the system, the schema and the turns; config names a model, never a key", () => {
  const p = textPrompt({ system: "SYS", schema: { type: "object" }, name: "work", messages: [{ role: "user", content: "make" }, { role: "assistant", content: "{}" }, { role: "user", content: "again" }] });
  assert.match(p, /^SYS\n\nReply with only one JSON value.*\{"type":"object"\}\n\nUser:\nmake\n\nYou answered:\n\{\}\n\nUser:\nagain$/s);
  assert.equal(modelOf(undefined), undefined);
  assert.equal(modelOf("claude:haiku")!.id, "command:claude");
  assert.equal(modelOf("openai:some-model", {})!.id, "openai:some-model");
  assert.throws(() => modelOf("anthropic:some-model", {}), /set ANTHROPIC_API_KEY/);
  assert.equal(modelOf("anthropic:some-model", { ANTHROPIC_API_KEY: "test-key" })!.id, "anthropic:some-model");
});

test("adapters: the schema as a forced tool (Anthropic), as response_format (OpenAI-compatible); usage read back", async () => {
  const { anthropic, openai } = await import("../packs/typed/model.ts");
  const sent: any[] = [];
  const fake = (body: unknown) => (async (url: string, init: any) => {
    sent.push({ url, body: JSON.parse(init.body), headers: init.headers });
    return new Response(JSON.stringify(body));
  }) as unknown as typeof fetch;
  const ask = { system: "S", messages: [{ role: "user" as const, content: "m" }], schema: schemaOf(work, LINKS), name: "work" };
  const a = await anthropic({ model: "m1", key: "test-key", fetch: fake({ content: [{ type: "tool_use", name: "work", input: { items: [] } }], usage: { input_tokens: 10, output_tokens: 2 }, model: "m1" }) }).ask(ask);
  assert.deepEqual(a.json, { items: [] });
  assert.deepEqual(a.usage, { input: 10, output: 2, model: "m1" });
  assert.deepEqual(sent[0].body.tool_choice, { type: "tool", name: "work" });
  assert.deepEqual(sent[0].body.tools[0].input_schema, ask.schema);
  assert.equal(sent[0].headers["x-api-key"], "test-key");
  const o = await openai({ model: "m2", mode: "strict", url: "http://127.0.0.1:1/v1", fetch: fake({ choices: [{ message: { content: '{"items":[{"ref":"a","title":"t"}]}' } }], usage: { prompt_tokens: 5, completion_tokens: 3 } }) }).ask(ask);
  assert.deepEqual(o.json, { items: [{ ref: "a", title: "t" }] });
  assert.equal(sent[1].url, "http://127.0.0.1:1/v1/chat/completions");
  assert.equal(sent[1].body.response_format.json_schema.strict, true);
  assert.deepEqual(sent[1].body.messages[0], { role: "system", content: "S" });
});

// ---------- through the runtime ----------

/** The map's types, as a domain's packs would define them: a base, a flavour of it, kinds of link. */
const defs: Pack = {
  id: "defs",
  inject: ["types.define"],
  apply(ctx) {
    const d = ctx.get<TypesDefine>("types.define");
    d.base({ name: "work", statuses: { open: ["todo", "doing"], closed: ["done"] }, fields: { size: { kind: "number", doc: "Hours." } } });
    d.base({ name: "question", statuses: { open: ["open"], closed: ["answered"] }, fields: {} });
    d.flavour({ name: "chore", base: "work", fields: { room: { kind: "choice", values: ["kitchen", "hall"] } } });
    d.link({ name: "depends_on", from: ["work"], to: ["work"] });
    d.link({ name: "bears_on", from: ["work"], to: ["question"] });
  },
};
const nodes: Pack = {
  id: "nodes",
  inject: ["agent.node"],
  apply(ctx) {
    const def: NodeDef = { name: "chores", kind: "rule", title: "chores", at: ["typed:chore"], speak: () => ({ say: "A chore is one room's job." }) };
    ctx.get<AgentNode>("agent.node").node(def);
  },
};
const domain: Pack = { id: "domain", inject: ["typed.ask", "exchange.read", "action.invoke", "graph.read"], apply() {} };

async function setup(config: Record<string, unknown> = {}) {
  const rt = new Runtime();
  const errors: unknown[] = [];
  rt.onError = (_f, e) => errors.push(e);
  const modules: Record<string, Pack> = { graph, action, types, defs, schema, exchange, agent, nodes, call, typed, domain };
  const BASE = "mem:/packs/";
  const loader = new Loader(rt, { base: BASE, import: async (url) => ({ default: modules[url.slice(BASE.length)]! }) });
  const tree: Entry[] = Object.keys(modules).map((id) => ({ id, pack: id, ...(id === "typed" ? { config } : {}) }));
  await loader.apply(tree);
  await rt.settle();
  const ctx = loader.fiber("domain")!.ctx;
  const ask = ctx.get<TypedAsk>("typed.ask");
  const read = ctx.get<ExchangeRead>("exchange.read");
  const g = ctx.get<GraphRead>("graph.read");
  const invoke = ctx.get<ActionInvoke>("action.invoke");
  const act = (name: string, input: unknown) => invoke.invoke({ action: name, input: input as Json, authority: { of: "human", basis: "test" }, reason: "test" });
  return { rt, errors, ask, read, g, act };
}

const chores = { items: [{ ref: "sweep", title: "Sweep the hall", room: "hall", size: 1 }, { ref: "mop", title: "Mop the hall", room: "hall", links: [{ type: "depends_on", to: "sweep" }] }] };

test("fit first time: proposed facts, nothing written, the call recorded with its schema and check", async () => {
  const { errors, ask, read, g, act } = await setup();
  const model = scripted([chores]);
  const out = await ask.ask({ type: "chore", prompt: "Plan cleaning the hall.", parent: "planner", model });
  assert.ok(out.ok, JSON.stringify(out));
  assert.equal(out.attempts, 1);
  assert.deepEqual(Object.keys(out.ids), ["sweep", "mop"]);
  assert.equal(out.facts.filter((f) => f[2] === "type").length, 3, "two chores and a link");
  assert.deepEqual(await g.get([out.ids.sweep!]), [null], "nothing is written");
  // The model was held to the flavour's schema, and heard what the map says at typed:chore.
  assert.deepEqual(model.asked[0]!.schema, (await act("typed.get", { run: out.run }) as any).output.schema);
  assert.match(model.asked[0]!.system, /A chore is one room's job\./);
  assert.match(model.asked[0]!.system, /chore \(a kind of work\)/);
  const evs = (await read.events(out.run)).items;
  assert.deepEqual(evs.map((e) => [e.kind, e.place ?? "", e.act?.kind ?? ""]), [
    ["begin", "", ""], ["say", "typed:chore", ""], ["act", "typed:attempt", "reply"], ["act", "typed:check", "tool"], ["act", "reply_end", "reply"], ["end", "", ""],
  ]);
  const run = (await read.runs()).items.find((r) => r.run === out.run)!;
  assert.deepEqual([run.facts?.harness, run.facts?.parent, run.facts?.typed, run.facts?.model, run.facts?.caller], ["call", "planner", "chore", "scripted", "domain"]);
  const rec = ((await act("typed.get", { run: out.run })) as any).output as TypedRecord;
  assert.equal(rec.outcome, "fit");
  assert.deepEqual(rec.proposed, out.facts);
  assert.equal(rec.attempts.length, 1);
  assert.deepEqual(rec.attempts[0]!.problems, []);
  // Written when a person says so.
  const applied = await act("typed.apply", { run: out.run });
  assert.ok(applied.ok, JSON.stringify(applied));
  const [sweep] = await g.get([out.ids.sweep!]);
  assert.deepEqual([sweep?.type, sweep?.fields.status, sweep?.fields.room], ["chore", "todo", "hall"]);
  assert.deepEqual(errors, []);
});

test("fit after one retry: the check's problems go back in the reply's words, and the second answer fits", async () => {
  const { errors, ask, act } = await setup();
  const model = scripted([
    { items: [{ ref: "sweep", title: "Sweep", room: "attic", size: "an hour" }, { ref: "mop", title: "Mop", status: "half done" }] },
    chores,
  ]);
  const out = await ask.ask({ type: "chore", prompt: "Plan cleaning the hall.", model });
  assert.ok(out.ok, JSON.stringify(out));
  assert.equal(out.attempts, 2);
  const sent = model.asked[1]!.messages;
  assert.equal(sent.length, 3);
  assert.equal(sent[1]!.role, "assistant");
  assert.match(sent[2]!.content, /^That reply doesn't fit the map's types:/);
  assert.match(sent[2]!.content, /chore\.room is one of kitchen, hall, not "attic"/);
  assert.match(sent[2]!.content, /chore\.size is a number, not "an hour"/);
  assert.match(sent[2]!.content, /statuses are todo, doing, done, not "half done"/);
  assert.doesNotMatch(sent[2]!.content, /i_/, "no id the model never saw");
  const rec = ((await act("typed.get", { run: out.run })) as any).output as TypedRecord;
  assert.equal(rec.outcome, "fit");
  assert.equal(rec.attempts.length, 2);
  assert.equal(rec.attempts[0]!.fits, false);
  assert.deepEqual(rec.attempts[0]!.problems!.map((p) => [p.code, p.at]), [
    ["schema.field_kind", 'item "sweep"'],
    ["schema.field_kind", 'item "sweep"'],
    ["schema.status", 'item "mop"'],
  ]);
  assert.equal(rec.attempts[0]!.retry, sent[2]!.content, "the retry and its reason are recorded");
  assert.equal(rec.attempts[1]!.sent, sent[2]!.content);
  assert.equal(rec.usage.input, model.asked.reduce((n, a) => n + Math.ceil(textPrompt(a).length / 4), 0));
  assert.deepEqual(errors, []);
});

test("failure after retries: the problems come back, nothing is proposed, the answer is a failed reply", async () => {
  const { errors, ask, read, act } = await setup({ retries: 2 });
  const model = scripted(["I can't do JSON today.", { items: [{ ref: "a", title: "A", links: [{ type: "bears_on", to: "nowhere" }] }] }]);
  const out = await ask.ask({ type: "work", prompt: "Plan.", model });
  assert.equal(out.ok, false);
  assert.equal(out.attempts, 3);
  if (out.ok) return;
  assert.deepEqual(out.problems.map((p) => p.code), ["schema.link_end"]);
  assert.match(out.problems[0]!.message, /^item "a"'s bears_on link 1: bears_on's to is nowhere, which isn't on the graph\.$/);
  assert.match(model.asked[1]!.messages[2]!.content, /The reply held no JSON/);
  const evs = (await read.events(out.run)).items;
  const last = evs[evs.length - 2]!;
  assert.deepEqual([last.place, last.act?.kind, last.act?.ok], ["reply_end", "reply", false]);
  const rec = ((await act("typed.get", { run: out.run })) as any).output as TypedRecord;
  assert.equal(rec.outcome, "misfit");
  assert.equal(rec.proposed, undefined);
  assert.equal(rec.attempts[0]!.text, "I can't do JSON today.");
  assert.equal(rec.attempts[2]!.failed, "no retries left (2)");
  const apply = await act("typed.apply", { run: out.run });
  assert.equal(!apply.ok && apply.refused.code, "typed.not_fit");
  const list = ((await act("typed.calls", {})) as any).output;
  assert.deepEqual(list.items.map((c: any) => [c.type, c.outcome, c.attempts]), [["work", "misfit", 3]]);
  assert.deepEqual(errors, []);
});

test("a model that throws fails the call, recorded; an unknown type or no model is refused", async () => {
  const { ask, act } = await setup();
  const broken = { id: "broken", ask: async () => { throw new Error("service down"); } };
  await assert.rejects(ask.ask({ type: "work", prompt: "x", model: broken }), /service down/);
  const list = ((await act("typed.calls", {})) as any).output;
  assert.equal(list.items[0].outcome, "failed");
  await assert.rejects(ask.ask({ type: "nothing", prompt: "x", model: broken }), /no type nothing/);
  await assert.rejects(ask.ask({ type: "depends_on", prompt: "x", model: broken }), /no type depends_on/);
  await assert.rejects(ask.ask({ type: "work", prompt: "x" }), /No model is configured/);
  const viaAction = await act("typed.ask", { type: "work", prompt: "x" });
  assert.equal(!viaAction.ok && viaAction.refused.code, "typed.no_model");
});

test("system and retry words", () => {
  assert.equal(systemOf(work, undefined, []), "You make items for a map. Each is a work. Reply with one JSON object that matches the schema you are given, and nothing else.");
  assert.equal(retryOf([{ code: "x", message: "One." }, { code: "y", message: "Two." }]), "That reply doesn't fit the map's types:\n- One.\n- Two.\nGive the whole reply again, fixed.");
});
