import assert from "node:assert/strict";
import { test } from "node:test";
import type { AgentNode, NodeDef } from "../spec/agent.ts";
import type { ExchangeEvent } from "../spec/exchange.ts";
import { Runtime, type Plugin } from "../runtime/core.ts";
import { Loader, type Entry } from "../runtime/loader.ts";
import agent from "../plugins/agent/index.ts";
import exchange from "../plugins/exchange/index.ts";
import graph from "../plugins/graph/index.ts";
import verdict, { type VerdictRead } from "../plugins/verdict/index.ts";
import { playAs, type Script } from "../plugins/scripted/index.ts";
import { covers, digestOf, judgeDigest, judgeRun, listeningOf, mayBeNear, namesMiss, OUTPUT_KEPT, OUTPUT_KEPT_WORKED, placeMatches, records, slimEvent } from "../plugins/verdict/judge.ts";

const BASE = "mem:/plugins/";
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
  { id: "a/trap", at: ["file:plugins/*/page/*.js"] },
  { id: "a/schema", at: ["tool:change"], misses: "The schema refused a task without a status" },
  { id: "a/rule", at: ["tool:Bash"], misses: "Bash curl to the map instead of the change tool" },
]);

test("places match like the agent plugin's", () => {
  assert.ok(placeMatches("tool:*", "tool:Bash"));
  assert.ok(!placeMatches("tool:*", "tool_result:Bash"));
  assert.ok(placeMatches("file:plugins/*/page/*.js", "file:plugins/surface/page/a.js"));
  assert.ok(!placeMatches("file:plugins/*.js", "file:plugins/surface/page/a.js"));
  assert.ok(placeMatches("file:plugins/**", "file:plugins/surface/page/a.js"));
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

test("held: its miss's situation came up again after it was said, and worked (a near miss)", () => {
  const near = listeningOf([{ id: "w/retry", at: ["tool:Bash"], misses: "server answered 429 empty body" }]);
  const ok = (seq: number, output: string) => ev("r", seq, { kind: "act", place: "tool:Bash", act: { kind: "tool", by: "agent", input: { command: "curl" }, output, ok: true } });
  const v = judgeRun("r", [said("r", 1, "w/retry", "tool:Bash"), ok(2, "Server answered 429 empty body; waited and retried: 200")], near);
  assert.deepEqual(v.map((x) => [x.verdict, x.near]), [["held", 1]]);
  assert.equal(judgeRun("r", [said("r", 1, "w/retry", "tool:Bash"), ok(2, "429 from the server, empty body")], near)[0]!.verdict, "quiet", "a few words in common aren't the miss");
  const short = listeningOf([{ id: "w/retry", at: ["tool:Bash"], misses: "Unexpected end of JSON input,JSON.parse" }]);
  assert.equal(judgeRun("r", [said("r", 1, "w/retry", "tool:Bash"), ok(2, '{"input": "x", "parse": true, "end": 1}')], short)[0]!.verdict, "quiet");
});

test("a person's last decision after a node was said, where it listens or on the reply, is its verdict's label; a replay says what it replays", () => {
  const decision = (seq: number, place: string, ok: boolean) => ev("r", seq, { kind: "act", place, act: { kind: "decision", by: "person", input: {}, output: ok ? "allow" : "deny", ok } });
  const begin = ev("r", 0, { kind: "begin", detail: { facts: { replay_of: "r0" } } as never });
  const v = judgeRun("r", [begin, said("r", 1, "a/schema", "tool:change"), decision(2, "tool:change", false), decision(3, "tool:Edit", true)], listening);
  assert.deepEqual([v[0]!.label, v[0]!.replay_of], ["deny", "r0"], "the decision at tool:Edit isn't where it listens");
  assert.equal(judgeRun("r", [decision(1, "tool:change", false), said("r", 2, "a/schema", "tool:change")], listening)[0]!.label, undefined, "a decision before it was said labels nothing");
  assert.equal(judgeRun("r", [said("r", 1, "a/schema", "tool:change"), decision(2, "reply_end", true)], listening)[0]!.label, "allow");
});

test("a node not said in a run isn't judged there", () => {
  assert.deepEqual(judgeRun("r", [failedAct("r", 1, "tool:change")], listening), []);
});

test("a failed edit of a file the node is said for is its miss", () => {
  const v = judgeRun(
    "r",
    [said("r", 1, "a/trap", "file:plugins/surface/page/a.js"), failedAct("r", 2, "tool:Edit", { file_path: "plugins/surface/page/b.js" })],
    listening,
  );
  assert.equal(v[0]!.verdict, "failed");
  const other = judgeRun("r", [said("r", 1, "a/trap", "file:plugins/surface/page/a.js"), failedAct("r", 2, "tool:Edit", { file_path: "spec/agent.ts" })], listening);
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
  const edit = ["tool:Edit", "file:plugins/grow/miss.ts"];
  assert.equal(covers({ at: ["file:plugins/grow/*.ts"] }, edit, "String to replace not found in file."), true);
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
  ev(run, seq, { kind: "refuse", node, plugin: "rules", place, text: "Use the change tool, not Bash, for the map.", detail: { code: "use-change" } });
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

// ---------- the plugin, live on the runtime with agent and exchange ----------

interface NodeSpec {
  name: string;
  at: string[];
  say?: string;
  refuse?: string;
}

const nodes: Plugin<{ nodes: NodeSpec[] }> = {
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

/** The adapter's side (the scripted agent plays runs from it), and apart from it the harness view's read, so runs go on while verdict is out. */
const probe: Plugin = { id: "probe", inject: ["agent.run"], apply() {} };
const view: Plugin = { id: "view", inject: ["verdict.read"], apply() {} };

function setup() {
  const rt = new Runtime();
  const errors: unknown[] = [];
  rt.onError = (_f, e) => errors.push(e);
  const modules: Record<string, Plugin> = { "graph.ts": graph, "agent.ts": agent, "exchange.ts": exchange, "nodes.ts": nodes, "verdict.ts": verdict, "probe.ts": probe, "view.ts": view };
  const loader = new Loader(rt, {
    base: BASE,
    import: async (url) => {
      const m = modules[url.slice(BASE.length)];
      if (!m) throw new Error(`no module ${url}`);
      return { default: m };
    },
  });
  const as = (run: string) => ({ play: (script: Script) => playAs(loader.fiber("probe")!.ctx, script, { run, actor: { id: "e_agent", kind: "agent" } }) });
  const read = () => loader.fiber("view")!.ctx.get<VerdictRead>("verdict.read");
  return { rt, loader, errors, as, read };
}

const entries = (withVerdict = true): Entry[] => [
  { id: "graph", plugin: "graph.ts" },
  { id: "exchange", plugin: "exchange.ts" },
  { id: "agent", plugin: "agent.ts" },
  {
    id: "nodes",
    plugin: "nodes.ts",
    config: {
      nodes: [
        { name: "trap", at: ["file:plugins/*/page/*.js"], say: "Restart the server after adding a page module." },
        { name: "brief", at: ["session_start"], say: "Read the brief." },
      ],
    },
  },
  ...(withVerdict ? [{ id: "verdict", plugin: "verdict.ts" }] : []),
  { id: "probe", plugin: "probe.ts" },
  { id: "view", plugin: "view.ts" },
];

/** A run played by the scripted agent: the trap is said at an edit, then the edit fails or not. */
async function aRun(as: ReturnType<typeof setup>["as"], run: string, editFails: boolean, failBefore = false) {
  const input = { file_path: "plugins/x/page/a.js" };
  await as(run).play({
    start: { harness: "test", reaches: ["session_start", "tool:*", "file:*"] },
    steps: [
      ...(failBefore ? [{ act: { place: "tool:Edit", kind: "tool" as const, by: "agent" as const, input, ok: false }, time: T(2) }] : []),
      { tool: "Edit", input, ok: !editFails, time: T(3) },
    ],
  });
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

test("the verdict keeps a slim copy of each act: path fields, refusal fields and the start of its output, never a whole body", () => {
  const base = { id: "r:1", seq: 1, run: "r", time: "2026-11-27T10:00:00Z", direction: "from_agent", kind: "act", place: "tool:Read" } as const;
  const shot = slimEvent({ ...base, act: { kind: "tool", ok: true, input: { file_path: "a/b.png", limit: 5 }, output: { file: { base64: "/9j/".padEnd(2_000_000, "A") } } } } as never);
  assert.deepEqual((shot.act as { input: object }).input, { file_path: "a/b.png" }, "only the path fields of the input");
  assert.equal(typeof shot.act!.output, "string");
  assert.equal((shot.act!.output as string).length, OUTPUT_KEPT_WORKED, "a working act's output as text, cut short");
  const failed = slimEvent({ ...base, act: { kind: "tool", ok: false, input: {}, output: "e".repeat(20_000) } } as never);
  assert.equal((failed.act!.output as string).length, OUTPUT_KEPT, "a failed act keeps more: its words are the miss");
  const refused = slimEvent({ ...base, act: { kind: "tool", ok: false, input: { command: "x".repeat(50_000) }, output: { refused: "words/a", code: "rule", text: "No.", extra: "y".repeat(50_000) } } } as never);
  assert.deepEqual(refused.act!.output, { refused: "words/a", code: "rule", text: "No." });
  assert.equal((refused.act as { input?: object }).input, undefined, "no path field: no input");
  const say = { ...base, kind: "say", node: "words/a", text: "Said." } as never;
  assert.equal(slimEvent(say), say, "an event with no act is kept as it is");
});

// ---------- what it holds: a digest per run, and reading a run again only where a changed node listens ----------

test("a run's digest keeps no act's output: its near misses are found as it comes in", () => {
  const near = listeningOf([{ id: "w/retry", at: ["tool:Bash"], misses: "server answered 429 empty body" }]);
  const events = [
    begin("d", 1),
    said("d", 2, "w/retry", "tool:Bash"),
    ev("d", 3, { kind: "act", place: "tool:Bash", act: { kind: "tool", by: "agent", input: { command: "curl" }, output: "Server answered 429 empty body; retried: 200 ".padEnd(5000, "x"), ok: true } }),
    failedAct("d", 4, "tool:Edit", { file_path: `${CWD}\\a.ts` }, "Error: ".padEnd(9000, "y")),
  ];
  const d = digestOf("d", events, near);
  assert.deepEqual(d.near.get("w/retry"), [3]);
  assert.deepEqual([...d.worked], ["tool:Bash"]);
  assert.deepEqual(d.misses.map((m) => [m.seq, m.paths, m.words]), [[4, [`${CWD}\\a.ts`], "".padEnd(OUTPUT_KEPT - 7, "y")]], "a miss keeps its words once each, from its slim output");
  assert.ok(!JSON.stringify([[...d.said], d.misses, d.decisions]).includes("retried"), "nothing of a working act's output");
  assert.deepEqual(judgeDigest(d, near), judgeRun("d", events, near));
  assert.equal(mayBeNear(d, { at: ["tool:Bash"], misses: "server answered 429 empty body" }), true);
  assert.equal(mayBeNear(d, { at: ["tool:Edit"], misses: "server answered 429 empty body" }), false, "no act worked there");
  assert.equal(mayBeNear(d, { at: ["tool:Bash"], misses: "short" }), false, "no phrase to look for");
});

/**
 * The verdict's world, stubbed: an exchange that counts each run's reads,
 * a tree of nodes made from map items, and the items' `misses`.
 */
function world(runs: Record<string, ExchangeEvent[]>) {
  const reads: Record<string, number> = {};
  const live = new Set<(e: ExchangeEvent) => void>();
  const treeOn = new Set<() => void>();
  const graphOn = new Set<() => void>();
  const items = new Map<string, Record<string, string>>();
  const nodeList: { id: string; at: string[]; source?: string }[] = [];
  let duringRead: ((run: string) => void) | undefined;
  const append = (e: ExchangeEvent) => {
    (runs[e.run] ??= []).push(e);
    for (const on of live) on(e);
  };
  const stub: Plugin = {
    id: "world",
    apply(ctx) {
      ctx.provide("exchange.read", () => ({
        async runs() {
          return { items: Object.keys(runs).reverse().map((run) => ({ run })) };
        },
        async events(run: string, page?: { after?: string; limit?: number }) {
          reads[run] = (reads[run] ?? 0) + 1;
          const start = Number(page?.after ?? 0);
          const all = runs[run] ?? [];
          const items = all.slice(start, start + (page?.limit ?? 100));
          duringRead?.(run);
          return start + items.length < all.length ? { items, next: String(start + items.length) } : { items };
        },
        async said() {
          return { items: [] };
        },
      }));
      ctx.provide("exchange.watch", () => ({
        watch(_f: unknown, on: (e: ExchangeEvent) => void) {
          live.add(on);
          return () => live.delete(on);
        },
      }));
      ctx.provide("agent.tree", () => ({
        nodes: () => nodeList.map((n) => ({ ...n, plugin: "words", name: n.id, kind: "reflex", title: n.id })),
        watch(on: () => void) {
          treeOn.add(on);
          return () => treeOn.delete(on);
        },
      }));
      ctx.provide("graph.read", () => ({
        async get(ids: string[]) {
          return ids.map((id) => (items.has(id) ? { id, type: "note", fields: items.get(id)! } : null));
        },
      }));
      ctx.provide("graph.watch", () => ({
        watch(_f: unknown, on: () => void) {
          graphOn.add(on);
          return () => graphOn.delete(on);
        },
      }));
    },
  };
  const rt = new Runtime();
  const errors: unknown[] = [];
  rt.onError = (_f, e) => errors.push(e);
  const modules: Record<string, Plugin> = { "world.ts": stub, "verdict.ts": verdict, "view.ts": view };
  const loader = new Loader(rt, { base: BASE, import: async (url) => ({ default: modules[url.slice(BASE.length)]! }) });
  return {
    errors,
    reads,
    items,
    nodeList,
    append,
    onRead: (f: (run: string) => void) => (duringRead = f),
    load: () => loader.apply(["world", "verdict", "view"].map((id) => ({ id, plugin: `${id}.ts` }))),
    read: () => loader.fiber("view")!.ctx.get<VerdictRead>("verdict.read"),
    misses: (source: string, misses: string) => {
      items.set(source, { misses });
      for (const on of [...graphOn]) on();
    },
    treeChanged: () => {
      for (const on of [...treeOn]) on();
    },
  };
}

const bashOk = (run: string, seq: number, output: string) =>
  ev(run, seq, { kind: "act", direction: "from_agent", place: "tool:Bash", act: { kind: "tool", by: "agent", input: { command: "curl" }, output, ok: true } });

test("a node's change reads again only the runs it was said in where an act worked at its place", async () => {
  const w = world({
    r1: [begin("r1", 1), said("r1", 2, "w/retry", "tool:Bash"), bashOk("r1", 3, "Server answered 429 empty body; waited and retried: 200")],
    r2: [begin("r2", 1), said("r2", 2, "w/retry", "tool:Bash"), okAct("r2", 3, "tool:Edit")],
    r3: [begin("r3", 1), said("r3", 2, "w/other", "tool:Bash"), bashOk("r3", 3, "Server answered 429 empty body")],
  });
  w.nodeList.push({ id: "w/retry", at: ["tool:Bash"], source: "i_retry" }, { id: "w/other", at: ["tool:Bash"] });
  w.items.set("i_retry", { misses: "zebra" });
  await w.load();
  const verdicts = w.read();
  assert.deepEqual(w.reads, { r1: 1, r2: 1, r3: 1 }, "each run read once on load");
  assert.equal((await verdicts.run("r1"))[0]!.verdict, "quiet");

  // Its misses now name a phrase the Bash call in r1 answered: r1 is read again, and only r1.
  w.misses("i_retry", "server answered 429 empty body");
  assert.deepEqual((await verdicts.run("r1")).map((v) => [v.verdict, v.near]), [["held", 1]]);
  assert.equal((await verdicts.run("r2"))[0]!.verdict, "quiet");
  assert.deepEqual(w.reads, { r1: 2, r2: 1, r3: 1 }, "r2 had no act at its place that worked; r3 never said it");

  // The tree changing with no node's places or misses changing reads nothing.
  w.treeChanged();
  await verdicts.records();
  assert.deepEqual(w.reads, { r1: 2, r2: 1, r3: 1 });

  // Misses with no phrase long enough clear its near misses without reading.
  w.misses("i_retry", "429");
  assert.equal((await verdicts.run("r1"))[0]!.verdict, "quiet");
  assert.deepEqual(w.reads, { r1: 2, r2: 1, r3: 1 });

  // Live, a near miss is found as the act comes in.
  w.misses("i_retry", "server answered 429 empty body");
  await verdicts.records();
  w.append(bashOk("r2", 4, "server answered 429 empty body, then 200"));
  assert.deepEqual((await verdicts.run("r2")).map((v) => [v.verdict, v.near]), [["held", 1]]);
  assert.deepEqual(w.errors, []);
});

test("an event that comes live while a run is read back counts once; a begin after a path is read again with its cwd", async () => {
  const read = (seq: number) =>
    ev("r2", seq, { kind: "act", direction: "from_agent", place: "tool:Read", act: { kind: "tool", by: "agent", input: { file_path: `${CWD}\\spec\\agent.md` }, output: "String to replace not found in file.", ok: true } });
  // The begin comes after the act that names a path: that act's place is relative to the cwd only once it is known.
  const r2 = [said("r2", 1, "w/spec", "file:spec/agent.ts"), read(2), begin("r2", 3)];
  const w = world({ r1: [begin("r1", 1), said("r1", 2, "w/other", "tool:Bash")], r2: [...r2] });
  w.nodeList.push({ id: "w/spec", at: ["file:spec/**"], source: "i_spec" }, { id: "w/other", at: ["tool:Bash"] });
  w.items.set("i_spec", { misses: "string to replace not found" });
  let once = false;
  w.onRead((run) => {
    if (run !== "r1" || once) return;
    once = true;
    w.append(said("r1", 3, "w/other", "tool:Bash"));
  });
  await w.load();
  const verdicts = w.read();
  assert.equal((await verdicts.run("r1"))[0]!.said, 2, "the live one is taken after the read back, and once");
  const want = judgeRun("r2", r2, listeningOf([{ id: "w/spec", at: ["file:spec/**"], misses: "string to replace not found" }]));
  assert.deepEqual(want.map((v) => [v.verdict, v.near]), [["held", 1]]);
  assert.deepEqual(await verdicts.run("r2"), want);
  assert.deepEqual(w.errors, []);
});
