import assert from "node:assert/strict";
import { test } from "node:test";
import type { AgentNode, AgentRun, NodeDef } from "../spec/agent.ts";
import type { ExchangeEvent } from "../spec/exchange.ts";
import { Runtime, type Pack } from "../runtime/core.ts";
import { Loader, type Entry } from "../runtime/loader.ts";
import agent from "../packs/agent/index.ts";
import exchange from "../packs/exchange/index.ts";
import graph from "../packs/graph/index.ts";
import verdict, { type VerdictRead } from "../packs/verdict/index.ts";
import { covers, judgeRun, listeningOf, namesMiss, placeMatches, records } from "../packs/verdict/judge.ts";

const BASE = "mem:/packs/";
const T = (s: number) => `2026-11-20T14:00:${String(s).padStart(2, "0")}.000Z`;

// ---------- judge.ts, apart from the runtime ----------

function ev(run: string, seq: number, e: Partial<ExchangeEvent>): ExchangeEvent {
  return { id: `${run}:${seq}`, run, seq, time: T(seq), direction: "to_agent", kind: "say", ...e } as ExchangeEvent;
}
const said = (run: string, seq: number, node: string, place: string) => ev(run, seq, { kind: "say", node, place, text: `${node} speaks` });
const refusedBy = (run: string, seq: number, node: string, place: string) => ev(run, seq, { kind: "refuse", node, place, text: "no" });
/** What a failed call answers by default: the schema's refusal, which a/schema's misses name. */
const SCHEMA_REFUSED = "Refused by the schema: a task needs a status.";
const failedAct = (run: string, seq: number, place: string, input?: Record<string, string>, output: string = SCHEMA_REFUSED) =>
  ev(run, seq, { kind: "act", direction: "from_agent", place, act: { kind: "tool", by: "agent", ok: false, output, ...(input ? { input } : {}) } });
const okAct = (run: string, seq: number, place: string) =>
  ev(run, seq, { kind: "act", direction: "from_agent", place, act: { kind: "tool", by: "agent", ok: true } });

const listening = listeningOf([
  { id: "a/trap", at: ["file:packs/*/page/*.js"] },
  { id: "a/schema", at: ["tool:change"], misses: "The schema refused a task without a status" },
  { id: "a/rule", at: ["tool:Bash"], misses: "Bash curl to the map instead of the change tool" },
]);

test("places match like the agent pack's", () => {
  assert.ok(placeMatches("tool:*", "tool:Bash"));
  assert.ok(!placeMatches("tool:*", "tool_result:Bash"));
  assert.ok(placeMatches("file:packs/*/page/*.js", "file:packs/surface/page/a.js"));
  assert.ok(!placeMatches("file:packs/*.js", "file:packs/surface/page/a.js"));
  assert.ok(placeMatches("file:packs/**", "file:packs/surface/page/a.js"));
});

test("failed: the miss came back after the node was said", () => {
  const v = judgeRun("r", [failedAct("r", 1, "tool:change"), said("r", 2, "a/schema", "tool:change"), failedAct("r", 3, "tool:change")], listening);
  assert.deepEqual(v.map((x) => [x.node, x.verdict, x.before, x.after, x.failed_by]), [["a/schema", "failed", 1, 1, [3]]]);
});

test("held: a miss before, none after", () => {
  const v = judgeRun("r", [failedAct("r", 1, "tool:change"), said("r", 2, "a/schema", "tool:change"), okAct("r", 3, "tool:change")], listening);
  assert.equal(v[0]!.verdict, "held");
});

test("quiet: said, and nothing went wrong where it listens", () => {
  const v = judgeRun("r", [said("r", 1, "a/schema", "tool:change"), failedAct("r", 2, "tool:Edit"), okAct("r", 3, "tool:change")], listening);
  assert.equal(v[0]!.verdict, "quiet");
});

test("a node not said in a run isn't judged there", () => {
  assert.deepEqual(judgeRun("r", [failedAct("r", 1, "tool:change")], listening), []);
});

test("a failed edit of a file the node is said for is its miss", () => {
  const v = judgeRun(
    "r",
    [said("r", 1, "a/trap", "file:packs/surface/page/a.js"), failedAct("r", 2, "tool:Edit", { file_path: "packs/surface/page/b.js" })],
    listening,
  );
  assert.equal(v[0]!.verdict, "failed");
  const other = judgeRun("r", [said("r", 1, "a/trap", "file:packs/surface/page/a.js"), failedAct("r", 2, "tool:Edit", { file_path: "spec/agent.ts" })], listening);
  assert.equal(other[0]!.verdict, "quiet");
});

test("another node's refusal is a miss; the node's own refusals are its saying", () => {
  const own = judgeRun("r", [refusedBy("r", 1, "a/rule", "tool:Bash"), refusedBy("r", 2, "a/rule", "tool:Bash")], listening);
  assert.deepEqual(own.map((x) => [x.verdict, x.said]), [["held", 2]]);
  const other = judgeRun("r", [said("r", 1, "a/schema", "tool:change"), ev("r", 2, { kind: "refuse", node: "b/check", place: "tool:change", text: "A task needs a status (schema)." })], listening);
  assert.equal(other.find((x) => x.node === "a/schema")!.verdict, "failed");
});

test("an exchange miss (a node threw) judges nothing", () => {
  const v = judgeRun("r", [said("r", 1, "a/schema", "tool:change"), ev("r", 2, { kind: "miss", node: "b/x", place: "tool:change", text: "threw" })], listening);
  assert.equal(v[0]!.verdict, "quiet");
});

test("a node no longer in the tree is judged at the places it was said", () => {
  const v = judgeRun("r", [said("r", 1, "gone/x", "file:a.ts"), failedAct("r", 2, "tool:Write", { file_path: "a.ts" })], listening);
  assert.equal(v[0]!.verdict, "failed");
});

test("a node covers a miss only when it would plausibly have prevented it", () => {
  const bash = ["tool:Bash"];
  const testFails = "npm test: 3 failing, exit code 1";
  // A broad place alone covers nothing: a tool:Bash node isn't every Bash failure's.
  assert.equal(covers({ at: ["tool:Bash"] }, bash, testFails), false);
  assert.equal(covers({ at: ["tool:*"] }, bash, testFails), false);
  // Its misses naming the miss's words do.
  assert.equal(covers({ at: ["tool:Bash"], misses: "npm test failing" }, bash, testFails), true);
  assert.equal(covers({ at: ["tool:Bash"], misses: "git push rejected by the remote" }, bash, testFails), false);
  // Words without the place don't.
  assert.equal(covers({ at: ["tool:Edit"], misses: "npm test failing" }, bash, testFails), false);
  // A file: pattern matching the miss's file is as narrow as the miss allows; file:** is not.
  const edit = ["tool:Edit", "file:packs/grow/miss.ts"];
  assert.equal(covers({ at: ["file:packs/grow/*.ts"] }, edit, "String to replace not found in file."), true);
  assert.equal(covers({ at: ["file:**"] }, edit, "String to replace not found in file."), false);
  assert.equal(covers({ at: ["tool:Edit"] }, edit, "String to replace not found in file."), false);
  assert.equal(covers({ at: ["tool:Edit"], misses: "Edit: string to replace not found" }, edit, "String to replace not found in file."), true);
  // Common words don't count: half of the node's own words must be there.
  assert.equal(namesMiss("the tool failed with an error", "Error: the tool failed"), false);
  assert.equal(namesMiss("port 5181 already in use", "listen EADDRINUSE: address already in use 127.0.0.1:5181"), true);
});

test("a broad node isn't failed by every failed call at its place", () => {
  const nodes = listeningOf([{ id: "w/read", at: ["tool:Bash"] }, { id: "w/port", at: ["tool:Bash"], misses: "the server's port 5181 is already in use" }]);
  const v = judgeRun(
    "b",
    [said("b", 1, "w/read", "tool:Bash"), said("b", 2, "w/port", "tool:Bash"), failedAct("b", 3, "tool:Bash", { command: "npm run serve" }, "Error: listen EADDRINUSE: address already in use 127.0.0.1:5181")],
    nodes,
  );
  assert.deepEqual(v.map((x) => [x.node, x.verdict]), [["w/read", "quiet"], ["w/port", "failed"]]);
});

test("records add up runs, sayings and verdicts, with the last time said", () => {
  const r1 = [failedAct("r1", 1, "tool:change"), said("r1", 2, "a/schema", "tool:change"), said("r1", 3, "a/schema", "tool:change")];
  const r2 = [said("r2", 1, "a/schema", "tool:change"), failedAct("r2", 2, "tool:change")];
  const r3 = [said("r3", 1, "a/schema", "tool:change"), said("r3", 2, "a/rule", "tool:Bash")];
  const recs = records([r1, r2, r3].map((events) => ({ events, verdicts: judgeRun(events[0]!.run, events, listening) })));
  const schema = recs.find((r) => r.node === "a/schema")!;
  assert.deepEqual(
    { said: schema.said, runs: schema.runs, held: schema.held, failed: schema.failed, quiet: schema.quiet, last: schema.last, places: schema.places },
    { said: 4, runs: 3, held: 1, failed: 1, quiet: 1, last: T(3), places: { "tool:change": 4 } },
  );
  assert.equal(recs.find((r) => r.node === "a/rule")!.quiet, 1);
});

// A Claude Code run as the adapter records it: `begin` carries the RunInfo,
// and a PreToolUse refusal is followed by the denied call as its own act.
const CWD = "C:\\Users\\me\\Documents\\Github\\archipelago-next";
const begin = (run: string, seq: number, cwd = CWD) =>
  ev(run, seq, { kind: "begin", direction: "from_agent", detail: { run, agent: "agent:claude", harness: "claude-code", reaches: [], cwd, started: T(seq) } });
const refusedHere = (run: string, seq: number, node: string, place: string) =>
  ev(run, seq, { kind: "refuse", node, pack: "rules", place, text: "Use the change tool, not Bash, for the map.", detail: { code: "use-change" } });
const deniedAct = (run: string, seq: number, node: string, tool: string, input: Record<string, string>) =>
  ev(run, seq, {
    kind: "act",
    direction: "from_agent",
    place: `tool:${tool}`,
    act: { kind: "tool", by: "agent", input, output: { refused: node, text: "Use the change tool, not Bash, for the map." }, ok: false },
  });

test("a blocked call is held: the denied act it caused is not its miss", () => {
  const v = judgeRun(
    "s",
    [
      begin("s", 1),
      refusedHere("s", 2, "a/rule", "tool:Bash"),
      deniedAct("s", 3, "a/rule", "Bash", { command: "curl -X POST https://example.test/map" }),
      okAct("s", 4, "tool:Bash"),
    ],
    listening,
  );
  assert.deepEqual(v.map((x) => [x.node, x.verdict, x.after, x.failed_by]), [["a/rule", "held", 0, []]]);
  // A call that fails at its place later, not the one it denied, still fails it.
  const again = judgeRun(
    "s",
    [begin("s", 1), refusedHere("s", 2, "a/rule", "tool:Bash"), deniedAct("s", 3, "a/rule", "Bash", { command: "x" }), failedAct("s", 4, "tool:Bash", undefined, "curl: the map refused the change")],
    listening,
  );
  assert.deepEqual(again.map((x) => [x.verdict, x.failed_by]), [["failed", [4]]]);
  // Another node listening there still counts the refusal as its miss.
  const other = judgeRun(
    "s",
    [begin("s", 1), said("s", 2, "b/hint", "tool:Bash"), refusedHere("s", 3, "a/rule", "tool:Bash"), deniedAct("s", 4, "a/rule", "Bash", { command: "x" })],
    listeningOf([{ id: "b/hint", at: ["tool:Bash"], misses: "Bash writes to the map instead of the change tool" }, { id: "a/rule", at: ["tool:Bash"] }]),
  );
  assert.equal(other.find((x) => x.node === "b/hint")!.verdict, "failed");
});

test("absolute paths from Claude Code match file: places, relative to the run's cwd", () => {
  const spec = listeningOf([{ id: "a/spec", at: ["file:spec/**"] }]);
  const read = (seq: number, file_path: string) => failedAct("w", seq, "tool:Read", { file_path });
  // Windows: backslashes, and a drive letter cased differently from the cwd.
  const win = judgeRun("w", [begin("w", 1), said("w", 2, "a/spec", "file:spec/agent.ts"), read(3, "c:\\Users\\me\\Documents\\Github\\archipelago-next\\spec\\agent.md")], spec);
  assert.deepEqual(win.map((x) => [x.verdict, x.failed_by]), [["failed", [3]]]);
  // POSIX.
  const posix = judgeRun(
    "w",
    [begin("w", 1, "/home/me/archipelago-next/"), said("w", 2, "a/spec", "file:spec/agent.ts"), read(3, "/home/me/archipelago-next/spec/exchange.ts")],
    spec,
  );
  assert.equal(posix[0]!.verdict, "failed");
  // A file outside the cwd stays absolute and doesn't match.
  const outside = judgeRun("w", [begin("w", 1), said("w", 2, "a/spec", "file:spec/agent.ts"), read(3, "C:\\Users\\me\\other\\spec\\agent.md")], spec);
  assert.equal(outside[0]!.verdict, "quiet");
  // A sibling folder that shares the cwd's prefix is outside it.
  const sibling = judgeRun("w", [begin("w", 1), said("w", 2, "a/spec", "file:spec/agent.ts"), read(3, `${CWD}-old\\spec\\agent.md`)], spec);
  assert.equal(sibling[0]!.verdict, "quiet");
});

// ---------- the pack, live on the runtime with agent and exchange ----------

interface NodeSpec {
  name: string;
  at: string[];
  say?: string;
  refuse?: string;
}

const nodes: Pack<{ nodes: NodeSpec[] }> = {
  id: "nodes",
  inject: ["agent.node"],
  apply(ctx, config) {
    const reg = ctx.get<AgentNode>("agent.node");
    for (const s of config.nodes) {
      const def: NodeDef = {
        name: s.name,
        kind: s.refuse ? "rule" : "reflex",
        title: s.name,
        at: s.at,
        speak: () => (s.say ? { say: s.say } : s.refuse ? { refuse: s.refuse } : null),
      };
      reg.node(def);
    }
  },
};

/** The adapter's side, and apart from it the harness view's read, so runs go on while verdict is out. */
const probe: Pack = { id: "probe", inject: ["agent.run"], apply() {} };
const view: Pack = { id: "view", inject: ["verdict.read"], apply() {} };

function setup() {
  const rt = new Runtime();
  const errors: unknown[] = [];
  rt.onError = (_f, e) => errors.push(e);
  const modules: Record<string, Pack> = { "graph.ts": graph, "agent.ts": agent, "exchange.ts": exchange, "nodes.ts": nodes, "verdict.ts": verdict, "probe.ts": probe, "view.ts": view };
  const loader = new Loader(rt, {
    base: BASE,
    import: async (url) => {
      const m = modules[url.slice(BASE.length)];
      if (!m) throw new Error(`no module ${url}`);
      return { default: m };
    },
  });
  const as = (run: string) => {
    const ctx = loader.fiber("probe")!.ctx.intercept({ actor: { id: "e_agent", kind: "agent" }, run });
    return { run: ctx.get<AgentRun>("agent.run") };
  };
  const read = () => loader.fiber("view")!.ctx.get<VerdictRead>("verdict.read");
  return { rt, loader, errors, as, read };
}

const entries = (withVerdict = true): Entry[] => [
  { id: "graph", pack: "graph.ts" },
  { id: "exchange", pack: "exchange.ts" },
  { id: "agent", pack: "agent.ts" },
  {
    id: "nodes",
    pack: "nodes.ts",
    config: {
      nodes: [
        { name: "trap", at: ["file:packs/*/page/*.js"], say: "Restart the server after adding a page module." },
        { name: "brief", at: ["session_start"], say: "Read the brief." },
      ],
    },
  },
  ...(withVerdict ? [{ id: "verdict", pack: "verdict.ts" }] : []),
  { id: "probe", pack: "probe.ts" },
  { id: "view", pack: "view.ts" },
];

const start = (run: string) => ({ run, agent: { id: "e_agent", kind: "agent" as const }, harness: "test", reaches: ["session_start", "tool:*", "file:*"] });

/** A run through the agent service: the trap is said at an edit, then the edit fails or not. */
async function aRun(as: ReturnType<typeof setup>["as"], run: string, editFails: boolean, failBefore = false) {
  const { run: agentRun } = as(run);
  await agentRun.begin(start(run));
  await agentRun.reach({ run, places: ["session_start"], time: T(1) });
  if (failBefore) await agentRun.act({ run, place: "tool:Edit", time: T(2), kind: "tool", by: "agent", input: { file_path: "packs/x/page/a.js" }, ok: false });
  await agentRun.reach({ run, places: ["tool:Edit", "file:packs/x/page/a.js"], time: T(3), input: { file_path: "packs/x/page/a.js" } });
  await agentRun.act({ run, place: "tool:Edit", time: T(4), kind: "tool", by: "agent", input: { file_path: "packs/x/page/a.js" }, ok: !editFails });
  await agentRun.end(run, T(5));
}

test("live: runs through the agent service come out as verdicts and records", async () => {
  const { loader, errors, as, read } = setup();
  await loader.apply(entries());
  const changes: (string | undefined)[] = [];
  const verdicts = read();
  verdicts.watch((c) => changes.push(c.run));

  await aRun(as, "r1", true);
  await aRun(as, "r2", false, true);
  await aRun(as, "r3", false);

  assert.deepEqual((await verdicts.run("r1")).map((v) => [v.node, v.verdict]), [["nodes/brief", "quiet"], ["nodes/trap", "failed"]]);
  assert.equal((await verdicts.run("r2")).find((v) => v.node === "nodes/trap")!.verdict, "held");
  assert.equal((await verdicts.run("r3")).find((v) => v.node === "nodes/trap")!.verdict, "quiet");

  const trap = (await verdicts.record("nodes/trap"))!;
  assert.deepEqual(
    { said: trap.said, runs: trap.runs, held: trap.held, failed: trap.failed, quiet: trap.quiet, last: trap.last },
    { said: 3, runs: 3, held: 1, failed: 1, quiet: 1, last: T(3) },
  );
  assert.deepEqual((await verdicts.verdicts("nodes/trap")).items.map((v) => v.run), ["r3", "r2", "r1"]);
  assert.equal((await verdicts.records()).items.length, 2);
  assert.ok(changes.includes("r1") && changes.includes("r3"));
  assert.deepEqual(errors, []);
});

test("loaded after the runs, it reads the record back; unloaded, its read and watchers go", async () => {
  const { loader, errors, as, rt, read } = setup();
  await loader.apply(entries(false));
  await aRun(as, "r1", true);
  await aRun(as, "r2", false, true);

  await loader.apply(entries(true));
  const verdicts = read();
  const trap = (await verdicts.record("nodes/trap"))!;
  assert.deepEqual([trap.runs, trap.failed, trap.held], [2, 1, 1]);

  let calls = 0;
  verdicts.watch(() => calls++);
  await aRun(as, "r3", true);
  assert.ok(calls > 0);
  assert.equal((await verdicts.record("nodes/trap"))!.failed, 2);

  await loader.apply(entries(false));
  assert.equal(loader.fiber("verdict"), undefined);
  assert.ok(!rt.keys().includes("verdict.read"));
  const before = calls;
  await aRun(as, "r4", true);
  assert.equal(calls, before);
  assert.deepEqual(errors, []);
});
