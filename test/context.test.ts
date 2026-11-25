import assert from "node:assert/strict";
import { appendFile, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import type { ActionInvoke } from "../spec/action.ts";
import type { AgentNode, NodeInfo } from "../spec/agent.ts";
import { Runtime, type Plugin } from "../runtime/core.ts";
import { Loader } from "../runtime/loader.ts";
import action from "../plugins/action/index.ts";
import agent from "../plugins/agent/index.ts";
import claudeCode from "../plugins/claude-code/index.ts";
import exchange from "../plugins/exchange/index.ts";
import graph from "../plugins/graph/index.ts";
import transcript from "../plugins/transcript/index.ts";
import context, { sizeOf } from "../plugins/context/index.ts";
import { DEFAULT_LIMIT, LONG_LIMIT, limitOf, tokensOf, windowAt, type Ev, type GivenRow, type Window } from "../plugins/context/window.ts";

const T = (min: number) => new Date(Date.UTC(2026, 10, 1, 10, min)).toISOString();
let seq = 0;
const ev = (min: number, kind: string, more: Partial<Ev> = {}): Ev => ({ seq: ++seq, id: `e${seq}`, time: T(min), kind, size: 0, ...more });

/** A small run: the map says two things, the agent works, a compaction, one said again. */
const nodes: NodeInfo[] = [
  { id: "words/branch", plugin: "words", name: "branch", kind: "instruction", title: "Stay on the branch", at: ["session_start"] },
  { id: "words/paths", plugin: "words", name: "paths", kind: "instruction", title: "Quote paths", at: ["tool:Bash"] },
  { id: "schema/check", plugin: "schema", name: "check", kind: "rule", title: "Fits its type", at: ["tool:mcp__archipelago__act"] },
  { id: "loaded/docs", plugin: "loaded", name: "docs", kind: "skill", title: "docs", at: ["skill:docs"] },
];
seq = 0;
const events: Ev[] = [
  ev(0, "begin"),
  ev(0, "say", { node: "words/branch", place: "session_start", size: 400 }),
  ev(1, "act", { place: "prompt", size: 80 }),
  ev(2, "say", { node: "words/paths", place: "tool:Bash", size: 40 }),
  ev(2, "act", { place: "tool:Bash", size: 4000 }),
  ev(3, "refuse", { node: "schema/check", place: "tool:mcp__archipelago__act", size: 120 }),
  ev(5, "compact", { place: "compact" }),
  ev(6, "say", { node: "words/branch", place: "session_start", size: 400 }),
  ev(7, "act", { place: "tool:Bash", size: 800 }),
];
const given: GivenRow[] = [
  { name: "system", title: "System prompt", by: "Claude Code", at: "session_start", count: 3, size: 40_000, first: T(0), last: T(7) },
  { name: "tool:Bash", title: "Bash definition", by: "Claude Code", at: "tool:Bash", count: 3, size: 8_000, first: T(0), last: T(7) },
  { name: "skills", title: "Skill listing", by: "Claude Code", at: "skill:*", count: 1, size: 400, first: T(0), last: T(0) },
  { name: "hook:tool:Bash:guard", title: "guard hook", by: "guard", at: "tool:Bash", count: 1, size: 200, first: T(2), last: T(2) },
  { name: "hook:prompt:late", title: "late hook", by: "late", at: "prompt", count: 1, size: 100, first: T(8), last: T(8) },
];
const part = (w: Window, id: string) => w.parts.find((p) => p.id === id);

test("the window at the end: start, said, listed and dropped, by source and channel, against the model's real usage", () => {
  const w = windowAt({
    run: "r",
    events,
    given,
    usage: { n: 9, time: T(7), model: "claude-x", input: 5, cacheRead: 30_000, cacheWrite: 1_000, output: 500 },
    compactions: [{ n: 4, time: T(5), trigger: "auto", pre: 180_000, post: 12_000 }],
    nodes,
  });
  assert.deepEqual(w.total, { tokens: 31_505, from: "usage" });
  assert.deepEqual(w.limit, { tokens: DEFAULT_LIMIT, from: "default" });
  assert.equal(w.compactions, 1);
  assert.deepEqual(w.compacted, { time: T(5), trigger: "auto", pre: 180_000, post: 12_000 });
  assert.equal(w.time, T(7));
  assert.equal(w.at, undefined, "no event asked for: the run's end");
  // The map: said again after the compaction is in; said only before it is dropped; a refusal is a rule's words.
  assert.deepEqual(part(w, "words/branch"), { id: "words/branch", title: "Stay on the branch", source: "map", channel: "hook", state: "said", tokens: 100, count: 1, fitted: 0 });
  assert.equal(part(w, "words/paths")?.state, "dropped");
  assert.deepEqual([part(w, "schema/check")?.channel, part(w, "schema/check")?.state], ["rule", "dropped"]);
  // A skill of the map's never loaded is only named in the listing.
  assert.deepEqual([part(w, "loaded/docs")?.state, part(w, "loaded/docs")?.channel], ["listed", "file"]);
  // Claude Code's: there from the start, a listing, a hook's words dropped, one not given yet absent.
  assert.equal(part(w, "transcript/r#system")?.state, "start");
  assert.equal(part(w, "transcript/r#system")?.tokens, 10_000);
  assert.equal(part(w, "transcript/r#skills")?.state, "listed");
  assert.deepEqual([part(w, "transcript/r#hook:tool:Bash:guard")?.state, part(w, "transcript/r#hook:tool:Bash:guard")?.channel], ["dropped", "hook"]);
  assert.equal(part(w, "transcript/r#hook:prompt:late"), undefined);
  // The agent's acts by place, before and after the compaction apart.
  assert.deepEqual(part(w, "act:tool:Bash"), { id: "act:tool:Bash", title: "tool:Bash", source: "agent", channel: "act", state: "said", tokens: 200, count: 1, fitted: 0 });
  assert.deepEqual([part(w, "act:tool:Bash#dropped")?.tokens, part(w, "act:prompt#dropped")?.state], [1000, "dropped"]);
  // Shares count only what is in the window; biggest first.
  assert.equal(w.sources.harness, 10_000 + 2_000 + 100);
  assert.equal(w.sources.agent, 200);
  assert.equal(w.sources.map, 100 + tokensOf("docs".length + 4));
  assert.equal(w.channels.context, 12_100);
  assert.equal(w.channels.rule, 0);
  assert.equal(w.unseen, w.total.tokens - (w.sources.map + w.sources.harness + w.sources.agent));
  assert.equal(w.parts[0]!.id, "transcript/r#system");
});

test("the window at a moment before the compaction: nothing dropped yet, an estimate without usage", () => {
  const w = windowAt({ run: "r", events, at: "e5", given, nodes });
  assert.equal(w.at, "e5");
  assert.equal(w.compactions, 0, "the run's own compact event comes later");
  assert.ok(w.parts.every((p) => p.state !== "dropped"));
  assert.equal(part(w, "transcript/r#hook:tool:Bash:guard")?.state, "said");
  assert.equal(part(w, "schema/check"), undefined, "the refusal comes after the playhead");
  assert.equal(w.total.from, "estimate");
  assert.equal(w.total.tokens, w.sources.map + w.sources.harness + w.sources.agent);
  assert.equal(w.unseen, 0);
  // Without a transcript, the run's compact events stand in.
  const late = windowAt({ run: "r", events, given: [], nodes });
  assert.equal(late.compactions, 1);
  assert.equal(part(late, "words/paths")?.state, "dropped");
  // A compaction after the last usage: what it left is the total.
  const left = windowAt({ run: "r", events, at: "e7", given, usage: { n: 1, time: T(4), input: 1, cacheRead: 150_000, cacheWrite: 0, output: 0 }, compactions: [{ n: 2, time: T(5), post: 9_000 }], nodes });
  assert.deepEqual(left.total, { tokens: 9_000, from: "usage" });
});

test("the window's limit: from the model's name, or from more seen than the usual size", () => {
  assert.deepEqual(limitOf("claude-sonnet-4-5[1m]", 0), { tokens: LONG_LIMIT, from: "model" });
  assert.deepEqual(limitOf("claude-opus-5-5", 0), { tokens: LONG_LIMIT, from: "model" });
  assert.deepEqual(limitOf("claude-haiku-4-5", 250_000), { tokens: LONG_LIMIT, from: "seen" });
  assert.deepEqual(limitOf(undefined, 10), { tokens: DEFAULT_LIMIT, from: "default" });
  assert.equal(sizeOf({ id: "x", run: "r", seq: 1, time: T(0), direction: "from_agent", kind: "act", act: { kind: "tool", by: "agent", input: { a: 1 }, output: "ok" } }), 7 + 4);
  assert.equal(sizeOf({ id: "x", run: "r", seq: 1, time: T(0), direction: "to_agent", kind: "say", text: "hello" }), 5);
});

test("the plugin: context.window from the run's events and its transcript, paged, nothing written", async () => {
  const dir = await mkdtemp(join(tmpdir(), "context-"));
  const path = join(dir, "sess.jsonl");
  await writeFile(path, "");
  const said: Plugin = {
    id: "said",
    inject: ["agent.node"],
    apply(ctx) {
      ctx.get<AgentNode>("agent.node").node({ name: "hello", kind: "instruction", title: "Hello", at: ["session_start"], speak: () => ({ say: "Hello from the map, at the start of every run." }) });
    },
  };
  const probe: Plugin = { id: "probe", inject: ["action.invoke"], apply() {} };
  const modules: Record<string, Plugin> = { "graph.ts": graph, "action.ts": action, "exchange.ts": exchange, "agent.ts": agent, "transcript.ts": transcript, "context.ts": context, "cc.ts": claudeCode, "said.ts": said, "probe.ts": probe };
  let port = 0;
  const rt = new Runtime();
  const errors: unknown[] = [];
  rt.onError = (_f, e) => errors.push(e);
  const loader = new Loader(rt, { base: "mem:/", import: async (url) => ({ default: modules[url.slice(5)]! }) });
  await loader.apply([
    { id: "graph", plugin: "graph.ts", config: { db: join(dir, "graph.sqlite") } },
    { id: "action", plugin: "action.ts" },
    { id: "exchange", plugin: "exchange.ts", config: { journal: join(dir, "exchange.jsonl") } },
    { id: "agent", plugin: "agent.ts" },
    { id: "said", plugin: "said.ts" },
    { id: "transcript", plugin: "transcript.ts" },
    { id: "context", plugin: "context.ts" },
    { id: "claude-code", plugin: "cc.ts", config: { port: 0, onListen: (p: number) => (port = p) } },
    { id: "probe", plugin: "probe.ts" },
  ]);
  const hook = (event: string, more: object = {}) =>
    fetch(`http://127.0.0.1:${port}/hook`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ hook_event_name: event, session_id: "sess-c", cwd: dir, transcript_path: path, ...more }) }).then((r) => r.json());
  const invoke = (name: string, input: object) =>
    loader.fiber("probe")!.ctx.get<ActionInvoke>("action.invoke").invoke({ action: name, input: input as never, authority: { of: "human", basis: "test" }, reason: "test" });
  const line = (o: object) => JSON.stringify(o);
  try {
    await hook("SessionStart", { source: "startup" });
    await appendFile(
      path,
      [
        line({ type: "api-request-shape", timestamp: new Date(Date.now() - 60_000).toISOString(), shape: { system: [{ type: "text", text: "You are Claude Code." }], tools: [{ name: "Bash", description: "Runs a command.", input_schema: { type: "object" } }] } }),
        line({ type: "assistant", timestamp: new Date(Date.now() - 30_000).toISOString(), message: { id: "m1", model: "claude-x", usage: { input_tokens: 4, cache_read_input_tokens: 1200, cache_creation_input_tokens: 300, output_tokens: 20 } } }),
      ].join("\n") + "\n",
    );
    const out = await invoke("context.window", { run: "sess-c" });
    assert.ok(out.ok, JSON.stringify(out));
    assert.equal(out.change, undefined, "a read writes nothing");
    const w = out.output as unknown as Window & { next?: number };
    assert.deepEqual(w.total, { tokens: 1524, from: "usage" });
    assert.equal(w.model, "claude-x");
    assert.deepEqual(w.parts.map((p) => [p.id, p.state]).sort(), [
      ["said/hello", "said"],
      ["transcript/sess-c#system", "start"],
      ["transcript/sess-c#tool:Bash", "start"],
    ]);
    const page = await invoke("context.window", { run: "sess-c", limit: 1 });
    assert.ok(page.ok);
    const p1 = page.output as unknown as Window & { next?: number };
    assert.equal(p1.parts.length, 1);
    assert.equal(p1.next, 1);
    const rest = await invoke("context.window", { run: "sess-c", after: 1 });
    assert.ok(rest.ok && (rest.output as unknown as Window).parts.length === 2);
    assert.ok(!(await invoke("context.window", { run: "sess-c", at: "no-such-event" })).ok);
    assert.ok(!(await invoke("context.window", {})).ok);
    // Each node's share over time: the map's from its says, Claude Code's and the conversation's from the transcript.
    await appendFile(
      path,
      [
        line({ type: "user", timestamp: new Date(Date.now() - 20_000).toISOString(), message: { content: "Fix the bug, please, it is in the parser." } }),
        line({ type: "user", timestamp: new Date(Date.now() - 10_000).toISOString(), message: { content: "And add a test." } }),
      ].join("\n") + "\n",
    );
    const pieces = await invoke("transcript.pieces", { run: "sess-c", name: "talk:prompt" });
    assert.ok(pieces.ok, JSON.stringify(pieces));
    assert.deepEqual([(pieces.output as { stays: string }).stays, (pieces.output as { pieces: { n: number; tokens: number }[] }).pieces.map((p) => [p.n, p.tokens])], ["said", [[1, 11], [2, 4]]]);
    type NW = { stays: string; now: number; count: number; inWindow: number; points: unknown[]; pieces: { n: number; in: boolean }[] };
    const talkNode = (await invoke("context.node", { run: "sess-c", id: "transcript/sess-c#talk:prompt" }) as unknown as { output: NW }).output;
    assert.deepEqual([talkNode.stays, talkNode.now, talkNode.count, talkNode.inWindow, talkNode.pieces.map((p) => [p.n, p.in])], ["said", 15, 2, 2, [[2, true], [1, true]]], "latest first");
    const sys = (await invoke("context.node", { run: "sess-c", id: "transcript/sess-c#system" }) as unknown as { output: NW }).output;
    assert.deepEqual([sys.stays, sys.now, sys.count], ["start", 5, 1]);
    const mapNode = (await invoke("context.node", { run: "sess-c", id: "said/hello" }) as unknown as { output: NW }).output;
    assert.deepEqual([mapNode.stays, mapNode.count, mapNode.now > 0, mapNode.points.length], ["said", 1, true, 1]);
    assert.ok(!(await invoke("context.node", { run: "sess-c", id: "transcript/sess-c#nothing" })).ok);
    assert.ok(!(await invoke("context.node", { run: "sess-c" })).ok);
    // A run with no transcript still has the map's words, as an estimate.
    await fetch(`http://127.0.0.1:${port}/hook`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ hook_event_name: "SessionStart", session_id: "bare", cwd: dir, source: "startup" }) });
    const bare = await invoke("context.window", { run: "bare" });
    assert.ok(bare.ok);
    const b = bare.output as unknown as Window;
    assert.equal(b.total.from, "estimate");
    assert.deepEqual(b.parts.map((p) => p.id), ["said/hello"]);
    assert.deepEqual(errors, []);
  } finally {
    await loader.apply([]);
    await rm(dir, { recursive: true, force: true });
  }
});

test("the window with the conversation: each node in the window or dropped by its tokens, the run's own acts not counted again", () => {
  const talk: GivenRow[] = [
    { name: "talk:prompt", title: "Your prompts", by: "you", at: "prompt", count: 2, size: 400, tokens: 100, window: 40, fitted: 90, fittedWindow: 30, first: T(1), last: T(6) },
    { name: "talk:result:Bash", title: "Bash results", by: "Claude Code", at: "tool_result:Bash", count: 3, size: 0, tokens: 5_000, window: 0, first: T(2), last: T(3) },
  ];
  const w = windowAt({ run: "r", events, given: [...given, ...talk], usage: { n: 9, time: T(7), input: 0, cacheRead: 20_000, cacheWrite: 0, output: 0 }, compactions: [{ n: 4, time: T(5) }], nodes });
  assert.deepEqual(part(w, "transcript/r#talk:prompt"), { id: "transcript/r#talk:prompt", title: "Your prompts", source: "agent", channel: "talk", state: "said", tokens: 40, count: 2, fitted: 30 });
  assert.deepEqual([part(w, "transcript/r#talk:prompt#dropped")?.state, part(w, "transcript/r#talk:prompt#dropped")?.tokens], ["dropped", 60]);
  assert.deepEqual([part(w, "transcript/r#talk:result:Bash")?.state, part(w, "transcript/r#talk:result:Bash")?.tokens], ["dropped", 5_000]);
  assert.ok(!w.parts.some((p) => p.channel === "act"), "the conversation holds the acts");
  assert.equal(w.channels.talk, 40);
  assert.equal(w.sources.agent, 40);
  assert.deepEqual([part(w, "transcript/r#talk:prompt#dropped")?.fitted, w.fitted.sources.agent, w.fitted.channels.talk, w.fitted.sources.map], [60, 30, 30, 0], "what is fitted, apart from what is estimated");
});

test("one node's share over time: said pieces pile up and a compaction drops them, a start node holds its latest size", async () => {
  const { trendOf } = await import("../plugins/context/trend.ts");
  const said = trendOf({ pieces: [{ time: T(1), tokens: 10 }, { time: T(2), tokens: 30 }, { time: T(6), tokens: 5 }], compactions: [T(5)], stays: "said" });
  assert.deepEqual([said.now, said.peak, said.total, said.dropped, said.count, said.inWindow], [5, 40, 45, 40, 3, 1]);
  assert.deepEqual(said.points.map((p) => p.tokens), [10, 40, 0, 5], "each piece a step up, the compaction a drop");
  const early = trendOf({ pieces: [{ time: T(1), tokens: 10 }, { time: T(2), tokens: 30 }, { time: T(6), tokens: 5 }], compactions: [T(5)], stays: "said", until: T(3) });
  assert.deepEqual([early.now, early.dropped, early.count], [40, 0, 2], "as of a moment: what came later isn't there");
  const start = trendOf({ pieces: [{ time: T(0), tokens: 100 }, { time: T(4), tokens: 120 }], compactions: [T(5)], stays: "start" });
  assert.deepEqual([start.now, start.total, start.dropped, start.inWindow], [120, 220, 0, 1], "every request carries it: the latest size, through compactions");
  // Many pieces: at most `points`, each with the peak of its stretch.
  const many = trendOf({ pieces: Array.from({ length: 50 }, (_, i) => ({ time: new Date(Date.UTC(2026, 10, 1, 10, 0, i)).toISOString(), tokens: 1 })), compactions: [new Date(Date.UTC(2026, 10, 1, 10, 0, 25, 500)).toISOString()], stays: "said", points: 5 });
  assert.equal(many.points.length, 5);
  assert.ok(many.points.some((p) => p.peak > p.tokens), "a drop inside a stretch keeps its peak");
  assert.equal(many.now, 24);
});
