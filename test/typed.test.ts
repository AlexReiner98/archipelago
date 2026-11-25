import assert from "node:assert/strict";
import { test } from "node:test";
import type { ActionInvoke } from "../spec/action.ts";
import type { NodeDef, AgentNode } from "../spec/agent.ts";
import type { Json } from "../spec/common.ts";
import type { ExchangeRead } from "../spec/exchange.ts";
import type { GraphRead } from "../spec/graph.ts";
import { COMMON, type TypeInfo, type TypesDefine } from "../spec/types.ts";
import { Runtime, type Plugin } from "../runtime/core.ts";
import { Loader, type Entry } from "../runtime/loader.ts";
import action from "../plugins/action/index.ts";
import agent from "../plugins/agent/index.ts";
import call from "../plugins/call/index.ts";
import exchange from "../plugins/exchange/index.ts";
import graph from "../plugins/graph/index.ts";
import schema from "../plugins/schema/index.ts";
import types from "../plugins/types/index.ts";
import typed, { CallFailed, retryOf, systemOf, type TypedAsk, type TypedRecord } from "../plugins/typed/index.ts";
import { factsOf, inReplyWords, itemsOf, schemaOf, strictSubset } from "../plugins/typed/shape.ts";
import { jsonIn, modelOf, scripted, textPrompt } from "../plugins/typed/model.ts";

// ---------- apart from the runtime ----------

const work: TypeInfo = {
  name: "work",
  base: "work",
  statuses: { open: ["todo", "doing"], closed: ["done"] },
  fields: { ...COMMON, size: { kind: "number", doc: "Hours." } },
  trial: false,
  plugin: "fixture",
};
const chore: TypeInfo = { ...work, name: "chore", fields: { ...work.fields, room: { kind: "choice", values: ["kitchen", "hall"] } }, trial: true };
const LINKS = [
  { name: "depends_on", from: ["work"], to: ["work"], plugin: "fixture" },
  { name: "about", plugin: "fixture" },
  { name: "waits_on", from: ["work"], to: ["actor"], plugin: "fixture" },
  { name: "answers", from: ["question"], plugin: "fixture" },
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
  const { anthropic, openai } = await import("../plugins/typed/model.ts");
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

/** The map's types, as a domain's plugins would define them: a base, a flavour of it, kinds of link. */
const defs: Plugin = {
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
const nodes: Plugin = {
  id: "nodes",
  inject: ["agent.node"],
  apply(ctx) {
    const def: NodeDef = { name: "chores", kind: "rule", title: "chores", at: ["typed:chore"], speak: () => ({ say: "A chore is one room's job." }) };
    ctx.get<AgentNode>("agent.node").node(def);
  },
};
const domain: Plugin = { id: "domain", inject: ["typed.ask", "exchange.read", "action.invoke", "graph.read"], apply() {} };

async function setup(config: Record<string, unknown> = {}) {
  const rt = new Runtime();
  const errors: unknown[] = [];
  rt.onError = (_f, e) => errors.push(e);
  const modules: Record<string, Plugin> = { graph, action, types, defs, schema, exchange, agent, nodes, call, typed, domain };
  const BASE = "mem:/plugins/";
  const loader = new Loader(rt, { base: BASE, import: async (url) => ({ default: modules[url.slice(BASE.length)]! }) });
  const tree: Entry[] = Object.keys(modules).map((id) => ({ id, plugin: id, ...(id === "typed" ? { config } : {}) }));
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

test("a caller's check: a reply that fits the schema but not the caller's rule is sent back, then fits", async () => {
  const { errors, ask, act } = await setup();
  const model = scripted([{ items: [{ ref: "a", title: "Sweep", note: "About an hour." }] }, { items: [{ ref: "a", title: "Sweep", note: "Takes 2 hours." }] }]);
  const seen: unknown[] = [];
  const out = await ask.ask({
    type: "chore",
    prompt: "One chore.",
    model,
    check: (made) => {
      seen.push(made.items.map((i) => [i.ref, i.type, i.title, i.fields.status]));
      return made.items.filter((i) => !String(i.fields.note ?? "").includes("2")).map((i) => ({ code: "rule.numbers", message: `item "${i.ref}": its note must say 2.`, at: `item "${i.ref}"` }));
    },
  });
  assert.ok(out.ok, JSON.stringify(out));
  assert.equal(out.attempts, 2);
  assert.deepEqual(seen, [[["a", "chore", "Sweep", "todo"]], [["a", "chore", "Sweep", "todo"]]]);
  assert.match(model.asked[1]!.messages[2]!.content, /^That reply doesn't fit:\n- item "a": its note must say 2\./);
  const rec = ((await act("typed.get", { run: out.run })) as any).output as TypedRecord;
  assert.deepEqual(rec.attempts[0]!.problems, [{ code: "rule.numbers", message: 'item "a": its note must say 2.', at: 'item "a"', by: "caller" }]);
  assert.equal(rec.outcome, "fit");
  assert.deepEqual(errors, []);
});

test("a caller's check: never passed, the call fails with its problems; it runs only on what fits the schema; a throw fails the call", async () => {
  const { ask, act } = await setup();
  let calls = 0;
  const never = () => {
    calls++;
    return [{ code: "rule.never", message: "Never good enough." }];
  };
  const model = scripted([{ items: [{ ref: "a", title: "A", size: "big" }] }, { items: [{ ref: "a", title: "A" }] }]);
  const out = await ask.ask({ type: "work", prompt: "x", model, check: never });
  assert.equal(out.ok, false);
  if (out.ok) return;
  assert.equal(calls, 1, "not on the schema misfit");
  assert.deepEqual(out.problems, [{ code: "rule.never", message: "Never good enough.", by: "caller" }]);
  const broken = scripted([{ items: [{ ref: "a", title: "A" }] }]);
  await assert.rejects(ask.ask({ type: "work", prompt: "x", model: broken, check: () => { throw new Error("rule broke"); } }), /rule broke/);
  const list = ((await act("typed.calls", {})) as any).output;
  assert.equal(list.items[0].outcome, "failed");
});

test("fields offered and fields set: the model sees only some, the caller fills the rest", () => {
  const item = (schemaOf(chore, LINKS, { fields: ["title", "room"] }) as any).properties.items.items;
  assert.deepEqual(Object.keys(item.properties), ["ref", "title", "room", "links"]);
  assert.deepEqual(item.required, ["ref", "title"]);
  assert.deepEqual((schemaOf(chore, LINKS, { fields: ["room"] }) as any).properties.items.items.required, ["ref"], "no title offered, none required");
  let n = 0;
  const made = factsOf({ items: [{ ref: "a", title: "Sweep", room: "hall", note: "mine", size: 9 }] }, chore, () => `n${++n}`, { fields: ["title", "room"], set: { size: 2 } });
  assert.deepEqual(made.problems.map((p) => [p.code, p.at]), [["typed.shape", "items[0].note"]], "a field not offered is a problem");
  assert.ok(made.facts.some((f) => f[2] === "size" && f[3] === 2) && !made.facts.some((f) => f[3] === 9), "a set field wins over the reply's");
  const ok = factsOf({ items: [{ ref: "a", room: "hall" }] }, chore, () => `n${++n}`, { fields: ["room"], set: { title: "Set by the caller", status: "doing" } });
  assert.deepEqual(ok.problems, []);
  assert.deepEqual(ok.facts.map((f) => [f[2], f[3]]), [["type", "chore"], ["room", "hall"], ["title", "Set by the caller"], ["status", "doing"]]);
});

test("set fields reach the checks and the facts; follow reaches the call's run", async () => {
  const { errors, ask, read } = await setup();
  const model = scripted([{ items: [{ ref: "a", title: "Sweep", room: "hall" }] }]);
  let seen: unknown;
  const out = await ask.ask({
    type: "chore",
    prompt: "One chore.",
    model,
    fields: ["title", "room"],
    set: { size: 3 },
    follow: { item: "i_followed", version: "v1" },
    check: (made) => {
      seen = made.items[0]!.fields.size;
      return [];
    },
  });
  assert.ok(out.ok, JSON.stringify(out));
  assert.equal(seen, 3);
  assert.ok(out.facts.some((f) => f[2] === "size" && f[3] === 3));
  assert.deepEqual(Object.keys((model.asked[0]!.schema as any).properties.items.items.properties), ["ref", "title", "room", "links"]);
  const run = (await read.runs()).items.find((r) => r.run === out.run)!;
  assert.deepEqual([run.facts?.item, run.facts?.version], ["i_followed", "v1"]);
  // A set field the type hasn't is the schema's problem, sent back like any other.
  const bad = await ask.ask({ type: "chore", prompt: "x", model, set: { colour: "red" }, retries: 0 });
  assert.equal(!bad.ok && bad.problems[0]!.code, "schema.field_unknown");
  assert.deepEqual(errors, []);
});

test("the caller's subject by its size, never the prompt's words; follow made: the one item the call made is followed", async () => {
  const { errors, ask, read } = await setup();
  const prompt = "PRIVATE-CONTEXT: the whole of a document the caller holds.";
  const model = scripted([{ items: [{ ref: "a", title: "A", size: "x" }] }, { items: [{ ref: "a", title: "A" }] }]);
  const out = await ask.ask({ type: "work", prompt, model, subject: { type: "document", tokens: 4200 }, follow: { made: true, version: "v3" } });
  assert.ok(out.ok, JSON.stringify(out));
  assert.equal(model.asked[0]!.messages[0]!.content, prompt, "the model gets it");
  const evs = (await read.events(out.run)).items;
  assert.ok(!JSON.stringify(evs).includes("PRIVATE-CONTEXT"), "the exchange never does");
  const answer = evs.find((e) => e.place === "reply_end")!;
  assert.deepEqual(answer.act!.input, { subject: { type: "document", tokens: 4200 } });
  const schema = model.asked[0]!.schema as any;
  assert.deepEqual([schema.properties.items.minItems, schema.properties.items.maxItems], [1, 1], "follow made asks for one item");
  const run = (await read.runs()).items.find((r) => r.run === out.run)!;
  assert.deepEqual([run.facts?.item, run.facts?.version], [out.ids.a, "v3"]);
  await assert.rejects(ask.ask({ type: "work", prompt: "x", model, follow: { version: "v1" } as never }), /follow is/);
  assert.deepEqual(errors, []);
});

test("system and retry words", () => {
  assert.equal(systemOf(work, undefined, []), "You make items for a map. Each is a work. Reply with one JSON object that matches the schema you are given, and nothing else.");
  assert.equal(retryOf([{ code: "x", message: "One." }, { code: "y", message: "Two." }]), "That reply doesn't fit the map's types:\n- One.\n- Two.\nGive the whole reply again, fixed.");
});

test("a call names its model by spec: a named one, or refused saying why; typed.models offers them, keys never shown", async () => {
  const a = scripted([{ items: [{ ref: "a", title: "Sweep", room: "hall" }] }], "a");
  const { errors, ask, act } = await setup({ models: { "anthropic:fast": a }, env: { OPENAI_API_KEY: "sk-test" }, choices: ["anthropic:fast", "anthropic:slow", "openai:mini", "claude"] });
  const out = await ask.ask({ type: "chore", prompt: "Plan the hall.", model: "anthropic:fast" });
  assert.ok(out.ok, JSON.stringify(out));
  assert.equal(a.asked.length, 1);
  const viaAction = (await act("typed.ask", { type: "chore", prompt: "x", model: "nope:x" })) as any;
  assert.equal(viaAction.refused.code, "typed.model");
  assert.match(viaAction.refused.message, /No model nope:x/);
  const noKey = (await act("typed.ask", { type: "chore", prompt: "x", model: "anthropic:slow" })) as any;
  assert.match(noKey.refused.message, /set ANTHROPIC_API_KEY/);
  const models = ((await act("typed.models", {})) as any).output;
  assert.equal(models.default, null);
  assert.deepEqual(models.choices, [
    { spec: "anthropic:fast", ready: true, key: "ANTHROPIC_API_KEY" },
    { spec: "anthropic:slow", ready: false, key: "ANTHROPIC_API_KEY" },
    { spec: "openai:mini", ready: true, key: "OPENAI_API_KEY" },
    { spec: "claude", ready: true },
  ]);
  assert.ok(!JSON.stringify(models).includes("sk-test"));
  assert.deepEqual(errors, []);
});

test("a reply's wrapper slips are taken as meant, its items still checked; anything else says what the reply was", async () => {
  const one = [{ ref: "a", title: "Sweep" }];
  // Seen from a small model: wrapped under the type's name, then items as JSON text.
  assert.deepEqual(itemsOf({ chore: { items: one } }), one);
  assert.deepEqual(itemsOf({ items: JSON.stringify(one) }), one);
  assert.deepEqual(itemsOf({ chore: { items: JSON.stringify(one) } }), one);
  assert.deepEqual(itemsOf(one), one);
  assert.match(itemsOf({ items: "Sweep the hall" }) as string, /not text: give the array itself/);
  assert.match(itemsOf({ chore: one, other: 1 }) as string, /at its top level.*keys were `chore`, `other`/);
  assert.match(itemsOf("just words") as string, /this reply was string/);

  // On a call: the wrapped reply fits first time, and a wrong item inside is still a misfit.
  const { ask } = await setup();
  const ok = await ask.ask({ type: "chore", prompt: "Plan the hall.", model: scripted([{ chore: { items: JSON.stringify([{ ref: "a", title: "Sweep", room: "hall" }]) } }]) });
  assert.ok(ok.ok, JSON.stringify(ok));
  assert.equal(ok.attempts, 1);
  const bad = await ask.ask({ type: "chore", prompt: "Plan the hall.", retries: 0, model: scripted([{ chore: { items: [{ ref: "a", title: "Sweep", room: "garden" }] } }]) });
  assert.equal(bad.ok, false);
});

test("a call's run names the model as it was asked for, and a model that fails is thrown on with the call's run", async () => {
  const fast = scripted([{ items: [{ ref: "a", title: "Sweep", room: "hall" }] }], "command:claude");
  const down = scripted([() => { throw new Error("service down"); }], "command:claude");
  const { ask, read } = await setup({ models: { claude: fast, "claude:gone": down }, env: {} });
  const ok = await ask.ask({ type: "chore", prompt: "Plan the hall.", model: "claude" });
  assert.ok(ok.ok);
  const run = (await read.runs()).items.find((r) => r.run === ok.run)!;
  assert.deepEqual([run.facts?.model, run.facts?.adapter], ["claude", "command:claude"]);

  const failed = await ask.ask({ type: "chore", prompt: "Plan the hall.", model: "claude:gone" }).catch((e: unknown) => e);
  assert.ok(failed instanceof CallFailed, String(failed));
  assert.equal(failed.message, "service down");
  assert.equal(failed.model, "claude:gone");
  const last = (await read.events(failed.run)).items.at(-2)!;
  assert.deepEqual([last.place, last.act?.kind, last.act?.ok], ["reply_end", "reply", false], "the call recorded the failure on its run");
});
