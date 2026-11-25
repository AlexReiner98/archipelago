import assert from "node:assert/strict";
import { test } from "node:test";
import type { AgentNode, NodeDef } from "../spec/agent.ts";
import type { ExchangeEvent, ExchangeRead } from "../spec/exchange.ts";
import { Runtime, type Pack } from "../runtime/core.ts";
import { Loader, type Entry } from "../runtime/loader.ts";
import agent from "../packs/agent/index.ts";
import exchange from "../packs/exchange/index.ts";
import graph from "../packs/graph/index.ts";
import verdict, { type VerdictRead } from "../packs/verdict/index.ts";
import scripted, { eventsOf, playAs, scriptOf, type ScriptedPlay, type Script } from "../packs/scripted/index.ts";

const T = (s: number) => `2026-11-24T10:00:${String(s).padStart(2, "0")}.000Z`;
const CWD = "C:\\Users\\me\\repo";

interface NodeSpec {
  name: string;
  at: string[];
  say?: string;
  refuse?: string;
}

const nodesPack = (id: string): Pack<{ nodes: NodeSpec[] }> => ({
  id,
  inject: ["agent.node"],
  apply(ctx, config) {
    const reg = ctx.get<AgentNode>("agent.node");
    for (const s of config.nodes) {
      const def: NodeDef = { name: s.name, kind: s.refuse ? "rule" : "reflex", title: s.name, at: s.at, speak: () => (s.say ? { say: s.say } : s.refuse ? { refuse: s.refuse } : null) };
      reg.node(def);
    }
  },
});

const probe: Pack = { id: "probe", inject: ["agent.run", "exchange.read", "verdict.read", "scripted.play"], apply() {} };

const NODES: NodeSpec[] = [
  { name: "brief", at: ["session_start"], say: "Read the brief." },
  { name: "trap", at: ["file:packs/*/page/*.js"], say: "Restart the server after adding a page module." },
  { name: "curl", at: ["tool:Bash"], refuse: "Use the change tool, not curl." },
  { name: "check", at: ["reply_end"], say: "Did you run the checks?" },
];

async function setup(extra: NodeSpec[] = []) {
  const rt = new Runtime();
  const errors: unknown[] = [];
  rt.onError = (_f, e) => errors.push(e);
  const modules: Record<string, Pack<any>> = {
    "graph.ts": graph, "exchange.ts": exchange, "agent.ts": agent, "nodes.ts": nodesPack("nodes"), "later.ts": nodesPack("later"),
    "verdict.ts": verdict, "scripted.ts": scripted, "probe.ts": probe,
  };
  const loader = new Loader(rt, { base: "mem:/", import: async (url) => ({ default: modules[url.slice(5)]! }) });
  const entries = (more: NodeSpec[]): Entry[] => [
    { id: "graph", pack: "graph.ts" },
    { id: "exchange", pack: "exchange.ts" },
    { id: "agent", pack: "agent.ts" },
    { id: "nodes", pack: "nodes.ts", config: { nodes: NODES } },
    ...(more.length ? [{ id: "later", pack: "later.ts", config: { nodes: more } }] : []),
    { id: "verdict", pack: "verdict.ts" },
    { id: "scripted", pack: "scripted.ts" },
    { id: "probe", pack: "probe.ts" },
  ];
  await loader.apply(entries(extra));
  const p = () => loader.fiber("probe")!.ctx;
  return {
    loader, errors, entries, p,
    play: () => p().get<ScriptedPlay>("scripted.play"),
    read: () => p().get<ExchangeRead>("exchange.read"),
    verdicts: () => p().get<VerdictRead>("verdict.read"),
  };
}

/** A run that edits a page module, which fails; tries curl, refused; and replies. */
const SCRIPT: Script = {
  start: { title: "Edit a page", cwd: CWD },
  steps: [
    { prompt: "Add a page module.", time: T(1) },
    { tool: "Edit", input: { file_path: `${CWD}\\packs\\x\\page\\a.js`, old_string: "a" }, output: "String to replace not found in file.", ok: false, time: T(2) },
    { tool: "Bash", input: { command: "curl -X POST https://example.test/map" }, time: T(3) },
    { tool: "Read", input: { file_path: `${CWD}\\spec\\agent.ts` }, output: "…", time: T(4) },
    { tool: "Write", input: { file_path: `${CWD}\\docs\\a.md` }, output: "EACCES: permission denied", ok: false, time: T(4) },
    { reply: "Done.", time: T(5) },
  ],
};

/** An event without what a replay changes: its id, run and seq. */
const shape = (e: ExchangeEvent) => [e.kind, e.place ?? "", e.node ?? "", e.text ?? "", e.act ? JSON.stringify(e.act) : ""].join(" | ");

test("a script plays a whole run on agent.run: what was said, refused and judged comes out", async () => {
  const { errors, play, read, verdicts } = await setup();
  const played = await play().play(SCRIPT, { run: "s1" });

  assert.equal(played.info.harness, "scripted");
  assert.deepEqual(played.said.map((s) => [s.places, s.node]), [
    [["session_start"], "nodes/brief"],
    [["tool:Edit", "file:packs/x/page/a.js"], "nodes/trap"],
    [["reply_end"], "nodes/check"],
  ]);
  assert.deepEqual(played.refused.map((r) => [r.places, r.node, r.text]), [[["tool:Bash"], "nodes/curl", "Use the change tool, not curl."]]);

  // On the exchange as the Claude Code adapter would record it: a refused call is a denied act, with no result.
  const events = (await read().events("s1")).items;
  assert.deepEqual(events.map((e) => `${e.kind} ${e.place ?? ""}`.trim()), [
    "begin", "say session_start",
    "act prompt",
    "say file:packs/x/page/a.js", "act tool:Edit",
    "refuse tool:Bash", "act tool:Bash",
    "act tool:Read",
    "act tool:Write",
    "say reply_end", "act reply_end",
    "end",
  ]);
  const denied = events.find((e) => e.kind === "act" && e.place === "tool:Bash")!;
  assert.deepEqual([denied.act!.ok, denied.act!.output], [false, { refused: "nodes/curl", text: "Use the change tool, not curl." }]);
  assert.equal(events.find((e) => e.kind === "act" && e.place === "prompt")!.act!.by, "person");

  const v = await verdicts().run("s1");
  assert.deepEqual(v.map((x) => [x.node, x.verdict]), [["nodes/brief", "quiet"], ["nodes/trap", "failed"], ["nodes/curl", "held"], ["nodes/check", "quiet"]]);
  assert.deepEqual(errors, []);
});

test("a refused reply is held back, a denied act, and the agent goes on to the next step", async () => {
  const { errors, play, read } = await setup([{ name: "stop", at: ["reply_end"], refuse: "Not yet." }]);
  await play().play({ steps: [{ reply: "Done." }] }, { run: "s2" });
  const reply = (await read().events("s2")).items.filter((e) => e.kind === "act");
  assert.deepEqual(reply.map((e) => [e.place, e.act!.ok, e.act!.input, e.act!.output]), [["reply_end", false, "Done.", { refused: "later/stop", text: "Not yet." }]]);
  assert.deepEqual(errors, []);
});

test("scriptOf rebuilds the quiet reaches of a run the Claude Code adapter recorded", () => {
  const ev = (seq: number, e: Partial<ExchangeEvent>): ExchangeEvent => ({ id: `r:${seq}`, run: "r", seq, time: T(seq), direction: "from_agent", kind: "act", ...e }) as ExchangeEvent;
  const say = (seq: number, node: string, place: string, time = T(seq)) => ev(seq, { kind: "say", direction: "to_agent", node, place, text: "w", time });
  const act = (seq: number, place: string, a: object) => ev(seq, { place, act: { by: "agent", kind: "tool", ok: true, ...a } as any });
  const events = [
    ev(1, { kind: "begin", detail: { run: "r", agent: { id: "e_x", kind: "agent" }, harness: "claude-code", reaches: [], cwd: CWD, title: "First", parent: "p", started: T(1), facts: { cwd: CWD, remote: "x" } } }),
    act(2, "prompt", { kind: "prompt", by: "person", input: "Go." }),
    // A file node spoke at the Edit, the tool: place was quiet; the result was quiet.
    say(3, "n/file", "file:a/b.ts"),
    act(4, "tool:Edit", { input: { file_path: `${CWD}\\a\\b.ts` }, output: "ok" }),
    // Two nodes in one reach: one moment, one reach.
    say(5, "n/g1", "tool:Grep"),
    say(6, "n/g2", "file:x", T(5)),
    act(7, "tool:Grep", { input: { pattern: "x" }, output: "none" }),
    // A denied call: its refusal is its reach, and it reached no result.
    ev(8, { kind: "refuse", direction: "to_agent", node: "n/no", place: "tool:Bash", text: "no" }),
    act(9, "tool:Bash", { input: { command: "curl" }, output: { refused: "n/no", text: "no" }, ok: false }),
    act(10, "tool:Bash", { input: { command: "ls" }, output: "a" }),
    say(11, "n/res", "tool_result:Bash"),
    ev(12, { kind: "compact", direction: "from_agent", place: "compact", detail: { trigger: "auto" } }),
    say(13, "n/brief", "session_start"),
    act(14, "reply_end", { kind: "reply", output: "Done." }),
    ev(15, { kind: "begin", detail: { run: "r", agent: { id: "e_x", kind: "agent" }, harness: "claude-code", reaches: [], cwd: CWD, title: "Second", started: T(1) } }),
    ev(16, { kind: "end" }),
  ];
  const script = scriptOf(events);
  assert.deepEqual(script.start, { harness: "claude-code", reaches: [], cwd: CWD, title: "Second", parent: "p" });
  assert.equal(script.opening, false);
  const steps = script.steps.map((s) => ("reach" in s ? `reach ${s.reach.join(",")}${s.input !== undefined ? ` <- ${JSON.stringify(s.input)}` : ""}` : "act" in s ? `act ${s.act.place}` : "?"));
  assert.deepEqual(steps, [
    "reach session_start",
    'reach prompt <- "Go."',
    "act prompt",
    'reach tool:Edit,file:a/b.ts <- {"file_path":"C:\\\\Users\\\\me\\\\repo\\\\a\\\\b.ts"}',
    "act tool:Edit",
    'reach tool_result:Edit <- "ok"',
    'reach tool:Grep,file:x <- {"pattern":"x"}',
    "act tool:Grep",
    'reach tool_result:Grep <- "none"',
    'reach tool:Bash <- {"command":"curl"}',
    "act tool:Bash",
    'reach tool:Bash <- {"command":"ls"}',
    "act tool:Bash",
    'reach tool_result:Bash <- "a"',
    'reach compact <- {"trigger":"auto"}',
    "reach session_start",
    "reach reply_end <- \"Done.\"",
    "act reply_end",
  ]);
});

test("a played run, replayed, records the same exchange under a new run", async () => {
  const { errors, play, read, verdicts } = await setup();
  await play().play(SCRIPT, { run: "s1" });
  const replay = await play().replay("s1", { run: "s1-replay" });
  assert.equal(replay.info.title, "Replay of Edit a page");
  assert.equal(replay.info.facts?.replay_of, "s1");

  const [was, now] = await Promise.all([eventsOf(read(), "s1"), eventsOf(read(), "s1-replay")]);
  const body = (es: ExchangeEvent[]) => es.filter((e) => e.kind !== "begin" && e.kind !== "end").map(shape);
  assert.deepEqual(body(now), body(was));
  assert.deepEqual(
    (await verdicts().run("s1-replay")).map((x) => [x.node, x.verdict]),
    (await verdicts().run("s1")).map((x) => [x.node, x.verdict]),
  );
  // Replaying the replay changes nothing either.
  await play().replay("s1-replay", { run: "s1-again" });
  assert.deepEqual(body(await eventsOf(read(), "s1-again")), body(was));
  await assert.rejects(play().replay("none"), /No run none/);
  assert.deepEqual(errors, []);
});

test("a recorded run replayed with a node added since: it is heard where the run went quiet, and judged", async () => {
  const first = await setup();
  await first.play().play(SCRIPT, { run: "s1" });
  const recorded = await eventsOf(first.read(), "s1");
  await first.loader.apply([]);

  // Another map, with a node at the Write's file, where nothing spoke in the recorded run.
  const { errors, p, read, verdicts } = await setup([{ name: "docs", at: ["file:docs/*.md"], say: "The docs folder is read only here." }]);
  const played = await playAs(p(), scriptOf(recorded), { run: "r2" });
  assert.deepEqual(played.said.find((s) => s.node === "later/docs")?.places, ["tool:Write", "file:docs/a.md"]);
  const v = await verdicts().run("r2");
  assert.equal(v.find((x) => x.node === "later/docs")?.verdict, "failed", "the Write still failed after it was said");
  // The recorded acts are played as they were.
  const acts = (es: ExchangeEvent[]) => es.filter((e) => e.kind === "act").map((e) => [e.place, e.time, JSON.stringify(e.act)]);
  assert.deepEqual(acts((await read().events("r2")).items), acts(recorded));
  assert.deepEqual(errors, []);
});

test("unloaded, scripted.play goes", async () => {
  const { loader, entries } = await setup();
  await loader.apply(entries([]).filter((e) => e.id !== "scripted" && e.id !== "probe"));
  assert.equal(loader.fiber("scripted"), undefined);
});
