import assert from "node:assert/strict";
import { test } from "node:test";
import type { ActionContext, ActionInvoke, ActionRegister, Outcome } from "../spec/action.ts";
import type { Fact } from "../spec/changeset.ts";
import type { Json, Page } from "../spec/common.ts";
import type { GraphRead } from "../spec/graph.ts";
import { COMMON, type LinkInfo, type TypeInfo, type TypesRead } from "../spec/types.ts";
import { Runtime, type Pack } from "../runtime/core.ts";
import { Loader, type Entry as TreeEntry } from "../runtime/loader.ts";
import action from "../packs/action/index.ts";
import graph from "../packs/graph/index.ts";
import history from "../packs/history/index.ts";
import schema from "../packs/schema/index.ts";
import type { Held } from "../packs/schema/quarantine.ts";
import type { Entry } from "../packs/history/journal.ts";

const BASE = "mem:/packs/";

const work: TypeInfo = {
  name: "work",
  base: "work",
  statuses: { open: ["todo", "doing"], closed: ["done"] },
  fields: { ...COMMON, due: { kind: "date" }, owner: { kind: "id" } },
  trial: false,
  pack: "types",
};
const bug: TypeInfo = { ...work, name: "bug", fields: { ...work.fields, severity: { kind: "choice", values: ["low", "high"] } }, trial: true };
const question: TypeInfo = { ...work, name: "question", base: "question", statuses: { open: ["open"], closed: ["decided"] }, fields: { ...COMMON } };
const dependsOn: LinkInfo = { name: "depends_on", from: ["work"], to: ["work"], pack: "types" };

/** Stands in for the types broker: what it holds can change while the test runs. */
const defined = new Map<string, TypeInfo | LinkInfo>();
const types: Pack = {
  id: "types",
  apply(ctx) {
    ctx.provide<TypesRead>("types.read", () => ({
      all: () => ({ types: [...defined.values()].filter((t): t is TypeInfo => "statuses" in t), links: [...defined.values()].filter((t): t is LinkInfo => !("statuses" in t)) }),
      get: (name) => defined.get(name),
      watch: () => () => {},
    }));
  },
};

const probe: Pack = {
  id: "probe",
  inject: ["action.invoke", "action.register", "graph.read"],
  apply(ctx) {
    ctx.get<ActionRegister>("action.register").register({
      name: "probe.write",
      title: "Write facts",
      input: { type: "object", required: ["facts"] },
      async run(input: { facts: Fact[] }, call: ActionContext) {
        call.write(input.facts);
        return null;
      },
    });
  },
};

async function setup(strict = false) {
  defined.clear();
  for (const t of [work, bug, question, dependsOn]) defined.set(t.name, t);
  const rt = new Runtime();
  const errors: unknown[] = [];
  rt.onError = (_f, e) => errors.push(e);
  const modules: Record<string, Pack> = { "graph.ts": graph, "action.ts": action, "types.ts": types, "schema.ts": schema, "history.ts": history, "probe.ts": probe };
  const loader = new Loader(rt, { base: BASE, import: async (url) => ({ default: modules[url.slice(BASE.length)] }) });
  const tree: TreeEntry[] = [
    { id: "graph", pack: "graph.ts" },
    { id: "action", pack: "action.ts" },
    { id: "types", pack: "types.ts" },
    { id: "schema", pack: "schema.ts", config: { strict } },
    { id: "history", pack: "history.ts" },
    { id: "probe", pack: "probe.ts" },
  ];
  await loader.apply(tree);
  const ctx = loader.fiber("probe")!.ctx.intercept({ actor: { id: "agent:test", kind: "agent" }, run: "r1" });
  const invoke = ctx.get<ActionInvoke>("action.invoke");
  const read = ctx.get<GraphRead>("graph.read");
  const call = <O extends Json = Json>(name: string, input: Json, reason = "a test"): Promise<Outcome<O>> =>
    invoke.invoke<O>({ action: name, input, authority: { of: "agent", basis: "test" }, reason });
  const write = (...facts: Fact[]) => call("probe.write", { facts } as unknown as Json);
  const ok = async <O extends Json>(p: Promise<Outcome<O>>) => {
    const o = await p;
    if (!o.ok) assert.fail(`refused: ${o.refused.code} ${o.refused.message}`);
    return o;
  };
  const refused = async (p: Promise<Outcome>) => {
    const o = await p;
    if (o.ok) assert.fail("applied, but should have been refused");
    return o.refused;
  };
  const held = async (state?: string) => ((await ok(call<Json>("schema.quarantined", state ? { state } : {}))).output as unknown as Page<Held>).items;
  const journal = async () => ((await ok(call<Json>("history.list", {}))).output as unknown as Page<Entry>).items;
  return { loader, errors, call, write, ok, refused, held, journal, read, stop: () => loader.apply([]) };
}

const task = (id: string, extra: Fact[] = []): Fact[] => [["+", id, "type", "work"], ["+", id, "title", id.toUpperCase()], ["+", id, "status", "todo"], ...extra];

test("a set that fits applies and is journalled; flavours take their base's statuses", async () => {
  const s = await setup();
  try {
    await s.ok(s.write(...task("a"), ...task("b"), ["+", "l1", "type", "depends_on"], ["+", "l1", "from", "a"], ["+", "l1", "to", "b"]));
    await s.ok(s.write(["+", "c", "type", "bug"], ["+", "c", "status", "done"], ["+", "c", "severity", "high"], ["+", "c", "owner", "a"], ["+", "c", "due", "2026-12-01"]));
    assert.equal((await s.read.get(["c"]))[0]?.fields.severity, "high");
    assert.equal((await s.journal()).length, 2);
    assert.deepEqual(await s.held(), []);
  } finally {
    await s.stop();
  }
});

test("a set that doesn't fit is quarantined: refused whole, kept with what was wrong, not journalled", async () => {
  const s = await setup();
  try {
    await s.ok(s.write(...task("a"), ["+", "q", "type", "question"], ["+", "q", "status", "open"]));
    const cases: [Fact[], string][] = [
      [[["+", "x", "type", "work"], ["+", "x", "colour", "red"]], "schema.field_unknown"],
      [[["+", "x", "type", "work"], ["+", "x", "status", "decided"]], "schema.status"],
      [[["+", "x", "type", "work"], ["+", "x", "title", 7]], "schema.field_kind"],
      [[["+", "x", "type", "bug"], ["+", "x", "severity", "mild"]], "schema.field_kind"],
      [[["+", "x", "type", "work"], ["+", "x", "owner", "nobody"]], "schema.id_missing"],
      [[["+", "l", "type", "depends_on"], ["+", "l", "from", "a"], ["+", "l", "to", "q"]], "schema.link_end"],
      [[["+", "l", "type", "depends_on"], ["+", "l", "from", "a"]], "schema.link_end"],
      [[["+", "x", "type", "work"], ["+", "x", "from", "a"], ["+", "x", "to", "a"]], "schema.not_a_link"],
      [[["+", "x", "title", "no type"]], "schema.type_missing"],
    ];
    for (const [facts, code] of cases) {
      const r = await s.refused(s.write(...facts));
      assert.equal(r.code, "schema.quarantined", JSON.stringify(facts));
      const problems = (r.detail as { problems: { code: string }[] }).problems;
      assert.ok(problems.some((p) => p.code === code), `${code} for ${JSON.stringify(facts)}: ${r.message}`);
    }
    // Refused whole: the fitting half of a set isn't applied either.
    await s.refused(s.write(...task("y"), ["+", "a", "colour", "red"]));
    assert.deepEqual(await s.read.get(["x", "l", "y"]), [null, null, null]);
    assert.equal((await s.journal()).length, 1);
    const held = await s.held("held");
    assert.equal(held.length, cases.length + 1);
    assert.equal(held[0]!.change.header.actor.id, "agent:test");
    assert.ok(held[0]!.problems.length);
  } finally {
    await s.stop();
  }
});

test("only what a set says is checked on an item already there", async () => {
  const s = await setup();
  try {
    // Written before its type was defined: no check then, and its odd field stays.
    defined.delete("work");
    await s.ok(s.write(...task("a"), ["+", "a", "colour", "red"]));
    defined.set("work", work);
    await s.ok(s.write(["-", "a", "status", "todo"], ["+", "a", "status", "doing"]));
    await s.refused(s.write(["+", "a", "size", 3]));
    // Given a new type, it is checked whole.
    await s.refused(s.write(["-", "a", "type", "work"], ["+", "a", "type", "bug"]));
  } finally {
    await s.stop();
  }
});

test("types nobody defines pass, unless strict", async () => {
  let s = await setup();
  try {
    await s.ok(s.write(["+", "e1", "type", "event"], ["+", "e1", "anything", 1]));
  } finally {
    await s.stop();
  }
  s = await setup(true);
  try {
    const r = await s.refused(s.write(["+", "e1", "type", "event"]));
    assert.match(r.message, /No pack defines the type event/);
  } finally {
    await s.stop();
  }
});

test("release sends a held set again: applied once it fits, and marked; still held if not", async () => {
  const s = await setup(true);
  try {
    const r = await s.refused(s.write(["+", "e1", "type", "event"], ["+", "e1", "title", "Launch"]));
    const q = (r.detail as { quarantine: string }).quarantine;
    const again = await s.refused(s.call("schema.release", { quarantine: q }));
    assert.equal(again.code, "schema.misfit");
    assert.equal((await s.held("held")).length, 1, "a failed release holds nothing new");

    defined.set("event", { ...question, name: "event", base: "question" });
    const out = await s.ok(s.call("schema.release", { quarantine: q }, "event is defined now"));
    assert.equal(out.committed!.header.action, "schema.release");
    assert.equal((await s.read.get(["e1"]))[0]?.fields.title, "Launch");
    const [rel] = await s.held("released");
    assert.equal(rel!.id, q);
    assert.equal(rel!.released, out.change);
    const twice = await s.refused(s.call("schema.release", { quarantine: q }));
    assert.equal(twice.code, "schema.not_held");
  } finally {
    await s.stop();
  }
});

test("drop stops holding a set and keeps the record; check says whether facts fit without writing", async () => {
  const s = await setup();
  try {
    const r = await s.refused(s.write(["+", "x", "type", "work"], ["+", "x", "colour", "red"]));
    const q = (r.detail as { quarantine: string }).quarantine;
    await s.ok(s.call("schema.drop", { quarantine: q }, "a typo"));
    assert.deepEqual(await s.held("held"), []);
    const [d] = await s.held("dropped");
    assert.deepEqual(d!.dropped, { reason: "a typo", by: "agent:test" });

    const fits = (await s.ok(s.call<Json>("schema.check", { facts: task("n") as unknown as Json }))).output as { fits: boolean };
    assert.equal(fits.fits, true);
    const not = (await s.ok(s.call<Json>("schema.check", { facts: [["+", "n", "type", "work"], ["+", "n", "status", "maybe"]] }))).output as { fits: boolean; problems: { code: string }[] };
    assert.equal(not.fits, false);
    assert.equal(not.problems[0]!.code, "schema.status");
    assert.deepEqual(await s.read.get(["n"]), [null]);
  } finally {
    await s.stop();
  }
});

test("unloading the schema pack takes its stage: writes are no longer checked", async () => {
  const s = await setup();
  try {
    await s.refused(s.write(["+", "x", "type", "work"], ["+", "x", "colour", "red"]));
    await s.loader.edit((t) => t.filter((e) => e.id !== "schema"));
    await s.ok(s.write(["+", "x", "type", "work"], ["+", "x", "colour", "red"]));
    assert.deepEqual(s.errors, []);
  } finally {
    await s.stop();
  }
});
