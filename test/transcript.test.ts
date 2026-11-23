import assert from "node:assert/strict";
import { appendFile, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import type { ActionInvoke } from "../spec/action.ts";
import type { AgentNode } from "../spec/agent.ts";
import { Runtime, type Pack } from "../runtime/core.ts";
import { Loader } from "../runtime/loader.ts";
import action from "../packs/action/index.ts";
import agent from "../packs/agent/index.ts";
import claudeCode from "../packs/claude-code/index.ts";
import exchange from "../packs/exchange/index.ts";
import graph from "../packs/graph/index.ts";
import transcript, { transcriptOf } from "../packs/transcript/index.ts";
import { GivenIndex, hookPlace, hookWho, isOurs, partOf, readLine, readPage, shown, slim, TokenIndex, tokensPage, windowOf, type Line } from "../packs/transcript/read.ts";
import { givenNodes, givenOnly, isGiven, parseGiven } from "../packs/harness/given.ts";
import { treeOf } from "../packs/harness/layout.ts";

const line = (o: object) => JSON.stringify(o);
const att = (attachment: object) => line({ type: "attachment", attachment });

/** A small transcript: what Claude Code wrote down that it gave the agent, and what it doesn't. */
const FIXTURE = [
  line({ type: "queue-operation", operation: "enqueue", content: "x" }),
  att({ type: "session_context", context: "user email: pat@example.org, git status: clean" }),
  att({ type: "environment", snapshot: { workingDirectory: "C:\\Users\\me\\proj" } }),
  att({ type: "hook_success", hookName: "SessionStart:startup", toolUseID: "ss", hookEvent: "SessionStart", stdout: '{"hookSpecificOutput":{"additionalContext":"Stay on the branch."}}', command: 'node "C:/Users/me/.claude/plugins/cache/mkt/guard-plugin/1.0/start.mjs"' }),
  att({ type: "hook_additional_context", hookName: "SessionStart", toolUseID: "ss", hookEvent: "SessionStart", content: ["Stay on the branch."] }),
  att({ type: "hook_success", hookName: "PreToolUse:Bash", toolUseID: "t1", hookEvent: "PreToolUse", stdout: '{"hookSpecificOutput":{"additionalContext":"The map says hello."}}', command: 'node "C:/x/archipelago-next/packs/claude-code/hook.ts" http://127.0.0.1:5281/hook' }),
  att({ type: "hook_additional_context", hookName: "PreToolUse:Bash", toolUseID: "t1", hookEvent: "PreToolUse", content: ["The map says hello."] }),
  att({ type: "hook_success", hookName: "PreToolUse:Bash", toolUseID: "t2", hookEvent: "PreToolUse", stdout: '{"hookSpecificOutput":{"additionalContext":"Quote paths."}}', command: "node C:/Users/me/.claude/hooks/output-guard.mjs" }),
  att({ type: "hook_additional_context", hookName: "PreToolUse:Bash", toolUseID: "t2", hookEvent: "PreToolUse", content: ["Quote paths."] }),
  att({ type: "hook_success", hookName: "PreToolUse:Bash", toolUseID: "t3", hookEvent: "PreToolUse", stdout: '{"hookSpecificOutput":{"additionalContext":"Quote paths."}}', command: "node C:/Users/me/.claude/hooks/output-guard.mjs" }),
  att({ type: "hook_additional_context", hookName: "PreToolUse:Bash", toolUseID: "t3", hookEvent: "PreToolUse", content: ["Quote paths."] }),
  att({ type: "mcp_instructions_delta", addedNames: ["archipelago", "old"], addedBlocks: ["## archipelago\nRecord the run.", "## old\nGone soon."], removedNames: [] }),
  att({ type: "mcp_instructions_delta", addedNames: [], addedBlocks: [], removedNames: ["old"] }),
  att({ type: "skill_listing", content: "- docs: make a doc\n- review: read the diff", skillCount: 2 }),
  att({ type: "agent_listing_delta", addedLines: ["- Explore: search", "- Plan: plan"] }),
  att({ type: "deferred_tools_delta", addedLines: ["WebSearch", "mcp__x__y"] }),
  att({ type: "model", text: "You are powered by a model." }),
  att({ type: "a_kind_from_a_later_version", whatever: true }),
  line({ type: "api-request-shape", shape: { system: [{ type: "text", text: "You are Claude Code." }, { type: "text", text: "Write to noreply@example.com." }], tools: [{ name: "Bash", description: "Runs a command.", input_schema: { type: "object" } }, { name: "Gone", description: "x" }] } }),
  line({ type: "user", message: { content: "the person's prompt" } }),
  line({ type: "assistant", message: { content: [{ type: "text", text: "a reply" }] } }),
  "{not json",
  line({ type: "api-request-shape", shape: { system: [{ type: "text", text: "You are Claude Code." }, { type: "text", text: "Write to noreply@example.com." }], tools: [{ name: "Bash", description: "Runs a command.", input_schema: { type: "object" } }, { name: "mcp__archipelago__act", description: "Change the map.", input_schema: { type: "object", properties: { action: { type: "string" } } } }] } }),
];

async function linesOf(path: string, bytes?: number): Promise<Line[]> {
  const out: Line[] = [];
  for (let at = 0; ; ) {
    const page = await readPage(path, at, bytes);
    if (!page) return out;
    out.push(...page.lines);
    if (page.next === at || page.next >= page.size) return out;
    at = page.next;
  }
}

test("pages: whole lines from a cursor, a long line grows the read, an unfinished last line waits", async () => {
  const dir = await mkdtemp(join(tmpdir(), "transcript-"));
  const path = join(dir, "t.jsonl");
  try {
    const long = "x".repeat(5000);
    await writeFile(path, `a\r\n${long}\nb\nunfinished`);
    const small = await linesOf(path, 64);
    assert.deepEqual(small.map((l) => l.text.length), [1, 5000, 1]);
    assert.equal(await readLine(path, small[1]!), long);
    const first = await readPage(path, 0, 64);
    assert.deepEqual(first!.lines.map((l) => l.text), ["a"], "a page holds only what fits");
    const last = await readPage(path, small[2]!.offset, 64);
    assert.equal(last!.next, small[2]!.offset + 2, "the unfinished line is left for the next read");
    assert.equal(await readPage(join(dir, "none.jsonl"), 0), undefined);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("given: each node at its place, by who said it; the map's own words, the session's context and the talk left out", async () => {
  const dir = await mkdtemp(join(tmpdir(), "transcript-"));
  const path = join(dir, "t.jsonl");
  try {
    await writeFile(path, FIXTURE.join("\n") + "\n");
    const index = new GivenIndex();
    for (const l of await linesOf(path, 128)) index.add(l);
    const nodes = index.list();
    assert.deepEqual(
      nodes.map((g) => [g.name, g.at, g.by, g.count]),
      [
        ["agents", "tool:Agent", "Claude Code", 1],
        ["deferred", "tool:ToolSearch", "Claude Code", 1],
        ["hook:session_start:guard-plugin", "session_start", "guard-plugin", 1],
        ["hook:tool:Bash:output-guard", "tool:Bash", "output-guard", 2],
        ["mcp:archipelago", "tool:mcp__archipelago__*", "archipelago", 1],
        ["model", "session_start", "Claude Code", 1],
        ["skills", "skill:*", "Claude Code", 1],
        ["system", "session_start", "Claude Code", 2],
        ["tool:Bash", "tool:Bash", "Claude Code", 2],
        ["tool:mcp__archipelago__act", "tool:mcp__archipelago__act", "archipelago", 1],
      ],
    );
    // Text is read again from the file, where the index points; the same hook words count twice but show once.
    const text = async (name: string) => {
      const parts = [];
      for (const s of index.spots(name)) parts.push(partOf((await readLine(path, s))!, s.pick));
      return parts.join("|");
    };
    assert.equal(await text("system"), "You are Claude Code.\n\nWrite to noreply@example.com.");
    assert.equal(await text("tool:Bash"), 'Runs a command.\n\nInput:\n{\n  "type": "object"\n}');
    assert.equal(await text("hook:tool:Bash:output-guard"), "Quote paths.");
    assert.equal(await text("mcp:archipelago"), "## archipelago\nRecord the run.");
    assert.equal(await text("agents"), "- Explore: search\n- Plan: plan");
    // An email address is never shown.
    assert.equal(shown(await text("system")).text, "You are Claude Code.\n\nWrite to (email).");
    // What the map said in the run is its own, even from a hook the adapter didn't print.
    const ours = new GivenIndex();
    for (const l of await linesOf(path)) ours.add(l);
    assert.deepEqual(ours.list((t) => t.includes("Stay on the branch")).filter((g) => g.name.startsWith("hook:")).map((g) => g.name), ["hook:tool:Bash:output-guard"]);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("who a hook is and where it is given, from its command and event", () => {
  assert.equal(hookWho('node "C:\\Users\\me\\.claude\\plugins\\marketplaces\\m\\plugins\\lint-kit\\hooks\\a.js"'), "lint-kit");
  assert.equal(hookWho("python3 /home/me/hooks/guard.py --x"), "guard");
  assert.equal(hookWho("my-hook --flag"), "my-hook");
  assert.equal(hookWho(undefined), "unnamed");
  assert.ok(isOurs('node "$CLAUDE_PROJECT_DIR/packs/claude-code/hook.ts" http://127.0.0.1:5281/hook'));
  assert.ok(isOurs('node "C:/x/my-host/hook.ts" https://app.example.tools/hook'));
  assert.ok(!isOurs("node C:/x/other/hook.ts"));
  assert.deepEqual(
    [hookPlace("UserPromptSubmit", "UserPromptSubmit"), hookPlace("PostToolUse", "PostToolUse:Read"), hookPlace("Stop", "Stop"), hookPlace("PreCompact", "PreCompact"), hookPlace("Elsewhere", undefined)],
    ["prompt", "tool_result:Read", "reply_end", "compact", "session_start"],
  );
  assert.equal(transcriptOf({ transcript: "C:\\p\\s.jsonl" }), "C:\\p\\s.jsonl");
  assert.equal(transcriptOf({ transcript: "relative.jsonl" }), undefined);
  assert.equal(transcriptOf({ transcript: "/etc/passwd" }), undefined);
});

test("the sensory interface hangs given nodes at their places, a run's own, marked by who said them", () => {
  const nodes = givenNodes("run-1", [
    { name: "system", title: "System prompt", by: "Claude Code", at: "session_start", count: 1, size: 20 },
    { name: "tool:Bash", title: "Bash definition", by: "Claude Code", at: "tool:Bash", count: 1, size: 9 },
    { name: "mcp:archipelago", title: "archipelago instructions", by: "archipelago", at: "tool:mcp__archipelago__*", count: 1, size: 9 },
    { name: "hook:tool:Bash:output-guard", title: "output-guard hook", by: "output-guard", at: "tool:Bash", count: 2, size: 9 },
    { name: "tool:mcp__archipelago__act", title: "act definition", by: "archipelago", at: "tool:mcp__archipelago__act", count: 1, size: 9 },
  ]);
  assert.deepEqual(nodes.map((n) => n.title), ["System prompt · Claude Code", "Bash definition", "archipelago instructions", "output-guard hook", "act definition"]);
  assert.ok(nodes.every(isGiven));
  assert.deepEqual(parseGiven(nodes[1]!.id), { run: "run-1", name: "tool:Bash" });
  assert.equal(parseGiven("words/w_1"), undefined);
  const tree = treeOf(nodes);
  const pathOf = (id: string) => {
    const out: string[] = [];
    for (let t = tree.byId.get(id)?.parent; t?.parent; t = t.parent) out.unshift(t.title);
    return out.join(" / ");
  };
  assert.equal(pathOf(nodes[0]!.id), "session start");
  assert.equal(pathOf(nodes[1]!.id), "tool / Bash");
  assert.equal(pathOf(nodes[2]!.id), "tool / archipelago", "a server's instructions hang beside its tools");
  assert.equal(pathOf(nodes[3]!.id), "tool / Bash", "a hook's context at the hook's place");
  // Grey: what the harness gave, and the boughs holding nothing else; a bough the map speaks on too keeps its colour.
  const map = { id: "words/w1", name: "w1", pack: "words", kind: "instruction", title: "Quote paths", at: ["tool:Bash"] };
  const mixed = treeOf([...nodes, map]);
  const grey = givenOnly(mixed);
  assert.ok(nodes.every((n) => grey.has(n.id)));
  assert.ok(!grey.has("words/w1"));
  assert.ok(grey.has("~:session_start") && grey.has("~:tool:mcp__archipelago"));
  assert.ok(!grey.has("~:tool:Bash") && !grey.has("~:tool") && !grey.has("~root"));
});

test("the pack: a run's transcript fact from the adapter, read on demand, nothing written, the map's words left out", async () => {
  const dir = await mkdtemp(join(tmpdir(), "transcript-"));
  const path = join(dir, "sess.jsonl");
  await writeFile(path, "");
  // A node of the map's that speaks at session_start: its words come back in a hook's context.
  const said: Pack = {
    id: "said",
    inject: ["agent.node"],
    apply(ctx) {
      ctx.get<AgentNode>("agent.node").node({ name: "hello", kind: "instruction", title: "Hello", at: ["session_start"], speak: () => ({ say: "The map's own standing words for every run." }) });
    },
  };
  const probe: Pack = { id: "probe", inject: ["action.invoke"], apply() {} };
  const modules: Record<string, Pack> = { "graph.ts": graph, "action.ts": action, "exchange.ts": exchange, "agent.ts": agent, "transcript.ts": transcript, "cc.ts": claudeCode, "said.ts": said, "probe.ts": probe };
  let port = 0;
  const rt = new Runtime();
  const errors: unknown[] = [];
  rt.onError = (_f, e) => errors.push(e);
  const loader = new Loader(rt, { base: "mem:/", import: async (url) => ({ default: modules[url.slice(5)]! }) });
  await loader.apply([
    { id: "graph", pack: "graph.ts", config: { db: join(dir, "graph.sqlite") } },
    { id: "action", pack: "action.ts" },
    { id: "exchange", pack: "exchange.ts", config: { journal: join(dir, "exchange.jsonl") } },
    { id: "agent", pack: "agent.ts" },
    { id: "said", pack: "said.ts" },
    { id: "transcript", pack: "transcript.ts" },
    { id: "claude-code", pack: "cc.ts", config: { port: 0, onListen: (p: number) => (port = p) } },
    { id: "probe", pack: "probe.ts" },
  ]);
  const hook = (event: string, more: object = {}) =>
    fetch(`http://127.0.0.1:${port}/hook`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ hook_event_name: event, session_id: "sess-t", cwd: dir, transcript_path: path, ...more }) }).then((r) => r.json());
  const invoke = (action: string, input: object) =>
    loader.fiber("probe")!.ctx.get<ActionInvoke>("action.invoke").invoke({ action, input: input as never, authority: { of: "human", basis: "test" }, reason: "test" });
  try {
    await hook("SessionStart", { source: "startup" });
    // A map on this machine reads the file itself: the hook is told so, and sends nothing more.
    const asked = await fetch(`http://127.0.0.1:${port}/hook`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ hook_event_name: "Stop", session_id: "sess-t", cwd: dir, transcript_path: path }) });
    assert.equal(asked.headers.get("x-archipelago-transcript"), "own");
    await appendFile(
      path,
      [
        att({ type: "hook_additional_context", hookName: "SessionStart", toolUseID: "SessionStart", hookEvent: "SessionStart", content: ["The map's own standing words for every run."] }),
        ...FIXTURE.slice(4, 5),
        FIXTURE[FIXTURE.length - 1],
      ].join("\n") + "\n",
    );
    const out = await invoke("transcript.given", { run: "sess-t" });
    assert.ok(out.ok, JSON.stringify(out));
    const names = (out.output as { nodes: { name: string }[] }).nodes.map((n) => n.name);
    assert.deepEqual(names, ["hook:session_start:unnamed", "system", "tool:Bash", "tool:mcp__archipelago__act"]);
    assert.equal(out.change, undefined, "a read writes nothing");
    // Paged by name.
    const page = await invoke("transcript.given", { run: "sess-t", limit: 2 });
    assert.ok(page.ok);
    assert.deepEqual((page.output as { next?: string }).next, "system");
    // More is read as the transcript grows.
    await appendFile(path, FIXTURE[13] + "\n");
    const again = await invoke("transcript.given", { run: "sess-t" });
    assert.ok(again.ok && (again.output as { nodes: { name: string }[] }).nodes.some((n) => n.name === "skills"));
    const text = await invoke("transcript.text", { run: "sess-t", name: "system" });
    assert.ok(text.ok);
    assert.equal((text.output as { text: string }).text, "You are Claude Code.\n\nWrite to (email).");
    // Token use and compactions, in order, real numbers.
    await appendFile(path, [
      line({ type: "assistant", timestamp: "2026-11-01T10:00:00.000Z", message: { id: "m1", model: "claude-x", usage: { input_tokens: 3, cache_read_input_tokens: 100, cache_creation_input_tokens: 20, output_tokens: 7 } } }),
      line({ type: "system", subtype: "compact_boundary", timestamp: "2026-11-01T10:05:00.000Z", compactMetadata: { trigger: "auto", preTokens: 130, postTokens: 30, cumulativeDroppedTokens: 100 } }),
    ].join("\n") + "\n");
    const tokens = await invoke("transcript.tokens", { run: "sess-t" });
    assert.ok(tokens.ok, JSON.stringify(tokens));
    const t = tokens.output as { rows: { kind: string }[]; last?: { cacheRead: number }; compactions: number };
    assert.deepEqual(t.rows.map((r) => r.kind), ["usage", "compact"]);
    assert.equal(t.last?.cacheRead, 100);
    assert.equal(t.compactions, 1);
    const before = await invoke("transcript.tokens", { run: "sess-t", until: "2026-11-01T10:01:00.000Z" });
    assert.ok(before.ok && (before.output as { compactions: number }).compactions === 0);
    assert.ok(!(await invoke("transcript.tokens", { run: "sess-t", kind: "nope" })).ok);
    const none = await invoke("transcript.text", { run: "sess-t", name: "nothing" });
    assert.ok(!none.ok);
    const other = await invoke("transcript.given", { run: "no-such-run" });
    assert.ok(other.ok && (other.output as { none?: boolean }).none);
    assert.deepEqual(errors, []);
  } finally {
    await loader.apply([]);
    await rm(dir, { recursive: true, force: true });
  }
});

test("tokens: each message's usage once, compactions with their numbers, a page by place and time", () => {
  const ix = new TokenIndex();
  const add = (o: object, offset = 0) => ix.add({ offset, length: 0, text: line(o) });
  const usage = (id: string, time: string, u: object) => add({ type: "assistant", timestamp: time, message: { id, model: "claude-x", usage: u } });
  usage("a", "2026-11-01T10:00:00Z", { input_tokens: 2, cache_read_input_tokens: 10, cache_creation_input_tokens: 5, output_tokens: 1 });
  // The same message streamed again: counted once, its latest usage.
  usage("a", "2026-11-01T10:00:01Z", { input_tokens: 2, cache_read_input_tokens: 10, cache_creation_input_tokens: 5, output_tokens: 9 });
  add({ type: "assistant", isSidechain: true, timestamp: "2026-11-01T10:00:02Z", message: { id: "side", usage: { input_tokens: 999 } } });
  add({ type: "system", subtype: "compact_boundary", timestamp: "2026-11-01T10:01:00Z", compactMetadata: { trigger: "manual", preTokens: 26, postTokens: 4, cumulativeDroppedTokens: 22 } });
  usage("b", "2026-11-01T10:02:00Z", { input_tokens: 1, cache_read_input_tokens: 4 });
  ix.add({ offset: 0, length: 0, text: "{not json" });
  const rows = ix.rows();
  assert.deepEqual(rows.map((r) => [r.n, r.kind]), [[1, "usage"], [2, "compact"], [3, "usage"]]);
  assert.equal(rows[0]!.kind === "usage" && windowOf(rows[0]!), 26);
  assert.equal(rows[0]!.time, "2026-11-01T10:00:00Z", "its time is when it began");
  assert.deepEqual(rows[1], { n: 2, kind: "compact", time: "2026-11-01T10:01:00Z", trigger: "manual", pre: 26, post: 4, dropped: 22 });
  const all = tokensPage(rows, { limit: 2 });
  assert.equal(all.next, 2);
  assert.equal(all.last?.n, 3);
  assert.equal(all.compactions, 1);
  assert.deepEqual(tokensPage(rows, { limit: 9, after: 2 }).rows.map((r) => r.n), [3]);
  assert.deepEqual(tokensPage(rows, { limit: 9, kind: "compact" }).rows.map((r) => r.n), [2]);
  const early = tokensPage(rows, { limit: 9, until: "2026-11-01T10:00:30Z" });
  assert.deepEqual([early.rows.length, early.last?.n, early.compactions], [1, 1, 0]);
  // The given index keeps the same rows, and when each node was given.
  const g = new GivenIndex();
  g.add({ offset: 0, length: 0, text: line({ type: "attachment", timestamp: "2026-11-01T09:00:00Z", attachment: { type: "model", text: "m" } }) });
  g.add({ offset: 0, length: 0, text: line({ type: "assistant", timestamp: "2026-11-01T09:01:00Z", message: { id: "x", usage: { input_tokens: 1 } } }) });
  g.add({ offset: 0, length: 0, text: line({ type: "attachment", timestamp: "2026-11-01T09:02:00Z", attachment: { type: "model", text: "m" } }) });
  assert.deepEqual(g.list().map((n) => [n.first, n.last]), [["2026-11-01T09:00:00Z", "2026-11-01T09:02:00Z"]]);
  assert.equal(g.tokens.rows().length, 1);
});

test("talk: the conversation as nodes at their places, counted as of a moment, what came before a compaction apart", async () => {
  const { TalkIndex, imageTokens, talkOf, IMAGE_TOKENS } = await import("../packs/transcript/talk.ts");
  const T = (min: number) => new Date(Date.UTC(2026, 10, 1, 10, min)).toISOString();
  // A PNG's header, 1000 × 750: its pixels / 750 tokens.
  const png = Buffer.alloc(24);
  png.writeUInt32BE(0x89504e47, 0);
  png.writeUInt32BE(1000, 16);
  png.writeUInt32BE(750, 20);
  const recs = [
    { type: "attachment", timestamp: T(0), attachment: { type: "environment" }, rendered: [{ content: "cwd C:\\Users\\pat\\proj" }] },
    { type: "attachment", timestamp: T(0), attachment: { type: "date" }, rendered: [{ content: "Today is a day." }] },
    { type: "attachment", timestamp: T(0), attachment: { type: "skill_listing", content: "- x" }, rendered: [{ content: "- x" }] },
    { type: "attachment", timestamp: T(0), attachment: { type: "hook_success", stdout: "{}" } },
    { type: "user", timestamp: T(1), message: { content: "Fix the bug" } },
    { type: "assistant", timestamp: T(2), message: { id: "m1", content: [{ type: "thinking", thinking: "Look first." }] } },
    { type: "assistant", timestamp: T(2), message: { id: "m1", content: [{ type: "tool_use", id: "tu1", name: "Bash", input: { command: "ls" } }] } },
    { type: "user", timestamp: T(3), message: { content: [{ type: "tool_result", tool_use_id: "tu1", content: [{ type: "text", text: "a.ts in C:\\Users\\pat\\proj" }, { type: "image", source: { type: "base64", data: png.toString("base64") } }] }] } },
    { type: "assistant", timestamp: T(4), message: { content: [{ type: "tool_use", id: "tu2", name: "mcp__archipelago__get", input: { ids: ["x"] } }] } },
    { type: "user", timestamp: T(4), message: { content: [{ type: "tool_result", tool_use_id: "tu2", content: "an item" }] } },
    { type: "system", subtype: "compact_boundary", timestamp: T(5), compactMetadata: { trigger: "auto", preTokens: 900, postTokens: 90 } },
    { type: "user", timestamp: T(5), isCompactSummary: true, message: { content: "So far: a bug." } },
    { type: "user", timestamp: T(6), isMeta: true, message: { content: "A caveat." } },
    { type: "assistant", timestamp: T(7), message: { content: [{ type: "text", text: "Fixed it." }] } },
  ];
  const index = new TalkIndex();
  recs.forEach((r, i) => { const s = slim(r); if (s) index.take(s, { offset: i * 1000, length: 10 }); });
  const cut = Date.parse(T(5));
  const rows = index.rows(NaN, cut);
  assert.deepEqual(
    rows.map((r) => [r.name, r.at, r.by, r.count]),
    [
      ["talk:call:Bash", "tool:Bash", "Claude", 1],
      ["talk:call:mcp__archipelago__get", "tool:mcp__archipelago__get", "Claude", 1],
      ["talk:note:date", "prompt", "Claude Code", 1],
      ["talk:note:meta", "prompt", "Claude Code", 1],
      ["talk:note:private", "session_start", "Claude Code", 1],
      ["talk:prompt", "prompt", "you", 1],
      ["talk:reply", "reply_end", "Claude", 1],
      ["talk:result:Bash", "tool_result:Bash", "Claude Code", 1],
      ["talk:result:mcp__archipelago__get", "tool_result:mcp__archipelago__get", "archipelago", 1],
      ["talk:summary", "compact", "Claude Code", 1],
      ["talk:thinking", "reply_end", "Claude", 1],
    ],
    "a listing is given, not talk; a record the model isn't sent (no rendered) isn't counted",
  );
  const row = (name: string, rs = rows) => rs.find((r) => r.name === name)!;
  // An image by its pixels; text by characters / 4.
  assert.equal(imageTokens(png.toString("base64")), 1000);
  assert.equal(imageTokens("not an image"), IMAGE_TOKENS);
  assert.equal(row("talk:result:Bash").tokens, Math.ceil("a.ts in C:\\Users\\pat\\proj".length / 4) + 1000);
  assert.equal(row("talk:result:mcp__archipelago__get").title, "get results");
  // Before the compaction: dropped (window 0); after it: in the window.
  assert.deepEqual([row("talk:prompt").window, row("talk:reply").window, row("talk:summary").window > 0], [0, row("talk:reply").tokens, true]);
  assert.equal(row("talk:note:private").private, true);
  // As of a moment: only what was written by then, and the compaction not come yet.
  const early = index.rows(Date.parse(T(3)), -Infinity);
  assert.equal(row("talk:reply", early), undefined);
  assert.equal(row("talk:prompt", early).window, row("talk:prompt", early).tokens);
  // The text, read from the record where a spot points; images named; the private note has no spots.
  const [spot] = index.spots("talk:result:Bash");
  assert.equal(talkOf(recs[spot!.offset / 1000], spot!.pick), "a.ts in C:\\Users\\pat\\proj\n[image]");
  const [call] = index.spots("talk:call:Bash");
  assert.equal(talkOf(recs[call!.offset / 1000], call!.pick), 'Bash\n{\n  "command": "ls"\n}');
  assert.equal(index.spots("talk:note:private").length, 0);
  // A home folder is never shown: whose it is stays out.
  assert.equal(shown("a.ts in C:\\Users\\pat\\proj and /home/sam/x and C:/Users/pat/y").text, "a.ts in ~\\proj and ~/x and ~/y");
});

test("talk sums to the model's own count: thinking from its real output, what reached it scaled to the window's growth", async () => {
  const { TalkIndex } = await import("../packs/transcript/talk.ts");
  const T = (s: number) => new Date(Date.UTC(2026, 10, 1, 10, 0, s)).toISOString();
  const recs = [
    { type: "attachment", timestamp: T(0), attachment: { type: "skill_listing" }, rendered: [{ content: "s".repeat(80) }] },
    { type: "user", timestamp: T(1), message: { content: "p".repeat(40) } },
    { type: "assistant", timestamp: T(2), message: { id: "m1", content: [{ type: "thinking", thinking: "", signature: "sig" }], usage: { input_tokens: 1000, output_tokens: 5 } } },
    { type: "assistant", timestamp: T(2), message: { id: "m1", content: [{ type: "text", text: "x".repeat(40) }], usage: { input_tokens: 1000, output_tokens: 60 } } },
    { type: "assistant", timestamp: T(2), message: { id: "m1", content: [{ type: "tool_use", id: "tu1", name: "Bash", input: {} }], usage: { input_tokens: 1000, output_tokens: 100 } } },
    { type: "user", timestamp: T(3), message: { content: [{ type: "tool_result", tool_use_id: "tu1", content: "y".repeat(400) }] } },
    { type: "assistant", timestamp: T(4), message: { id: "m2", content: [{ type: "text", text: "done" }], usage: { input_tokens: 10, cache_read_input_tokens: 1290, output_tokens: 3 } } },
  ];
  const index = new TalkIndex();
  recs.forEach((r, i) => { const s = slim(r); if (s) index.take(s, { offset: i, length: 1 }); });
  const row = (name: string) => index.rows().find((r) => r.name === name)!;
  // m1 put out 100: its reply is 10, its call 1, so its thinking is the other 89, though its text isn't kept.
  assert.equal(row("talk:thinking").tokens, 89);
  // The window grew 1300 - (1000 + 100) = 200 from m1 to m2: the result, estimated at 100, is 200.
  assert.equal(row("talk:result:Bash").tokens, 200);
  // The first message: its real input, the given words (a listing) and the conversation (a prompt) that reached it.
  assert.deepEqual(index.first, { time: T(2), input: 1000, given: 20, talk: 10 });
  // Fitted: the thinking (from real output) and the result (from real growth); the prompt before the first message stays an estimate.
  assert.deepEqual([row("talk:thinking").fitted, row("talk:result:Bash").fitted, row("talk:prompt").fitted, row("talk:reply").fitted], [89, 200, 0, 0]);
});

test("a server elsewhere: the hook sends its transcript as numbers, the tree has Claude Code's nodes, their words stay where the run ran", async () => {
  const { spawn } = await import("node:child_process");
  const { readFile } = await import("node:fs/promises");
  const dir = await mkdtemp(join(tmpdir(), "transcript-sent-"));
  const path = join(dir, "sess.jsonl");
  await writeFile(path, "");
  const probe: Pack = { id: "probe", inject: ["action.invoke"], apply() {} };
  const modules: Record<string, Pack> = { "graph.ts": graph, "action.ts": action, "exchange.ts": exchange, "agent.ts": agent, "transcript.ts": transcript, "cc.ts": claudeCode, "probe.ts": probe };
  let port = 0;
  const rt = new Runtime();
  const errors: unknown[] = [];
  rt.onError = (_f, e) => errors.push(e);
  const loader = new Loader(rt, { base: "mem:/", import: async (url) => ({ default: modules[url.slice(5)]! }) });
  // A server elsewhere: it never opens a path a hook names, even one on its own disk.
  await loader.apply([
    { id: "graph", pack: "graph.ts", config: { db: join(dir, "graph.sqlite") } },
    { id: "action", pack: "action.ts" },
    { id: "exchange", pack: "exchange.ts", config: { journal: join(dir, "exchange.jsonl") } },
    { id: "agent", pack: "agent.ts" },
    { id: "transcript", pack: "transcript.ts", config: { files: false } },
    { id: "claude-code", pack: "cc.ts", config: { port: 0, files: false, onListen: (p: number) => (port = p) } },
    { id: "probe", pack: "probe.ts" },
  ]);
  const env: Record<string, string | undefined> = { ...process.env, ARCHIPELAGO_HOOK_STATE: join(dir, "state"), ARCHIPELAGO_TOKEN_FILE: join(dir, "no-token") };
  delete env.ARCHIPELAGO_TOKEN;
  const hook = async (event: string) => {
    const child = spawn(process.execPath, ["packs/claude-code/hook.ts", `http://127.0.0.1:${port}/hook`], { env });
    child.stdin.end(JSON.stringify({ hook_event_name: event, session_id: "sess-far", cwd: dir, transcript_path: path, source: "startup" }));
    return new Promise((ok) => child.on("close", ok));
  };
  const invoke = (a: string, input: object) =>
    loader.fiber("probe")!.ctx.get<ActionInvoke>("action.invoke").invoke({ action: a, input: input as never, authority: { of: "human", basis: "test" }, reason: "test" });
  try {
    await appendFile(path, FIXTURE.join("\n") + "\n");
    await hook("SessionStart");
    // The next hook goes on from where the server says it is: the talk added since joins.
    await appendFile(path, [line({ type: "user", timestamp: "2026-11-01T10:01:00Z", message: { content: "Fix the parser, please." } })].join("\n") + "\n");
    await hook("UserPromptSubmit");
    const out = await invoke("transcript.given", { run: "sess-far" });
    assert.ok(out.ok, JSON.stringify(out));
    const o = out.output as { nodes: { name: string; by: string }[]; elsewhere?: boolean; none?: boolean };
    assert.equal(o.elsewhere, true);
    assert.equal(o.none, undefined);
    const names = o.nodes.map((n) => n.name);
    for (const n of ["system", "tool:Bash", "tool:mcp__archipelago__act", "mcp:archipelago", "skills", "agents", "deferred", "model", "hook:session_start:guard-plugin", "hook:tool:Bash:output-guard", "talk:prompt", "talk:reply"]) assert.ok(names.includes(n), `${n} came`);
    assert.ok(!names.some((n) => n.startsWith("hook:tool:Bash:hook")), "the map's own hook context is left out, by its command");
    // Its words stay where it ran.
    const text = await invoke("transcript.text", { run: "sess-far", name: "system" });
    assert.ok(!text.ok && text.refused.code === "transcript.elsewhere");
    const pieces = await invoke("transcript.pieces", { run: "sess-far", name: "talk:prompt" });
    assert.ok(pieces.ok && (pieces.output as { count: number }).count === 2);
    // Nothing of the text reached the server: not the record, not the journal.
    const journal = await readFile(join(dir, "exchange.jsonl"), "utf8");
    assert.ok(!journal.includes("archipelago_transcript") && !journal.includes("You are Claude Code") && !journal.includes("Fix the parser"));
    assert.ok(!journal.includes("sess.jsonl"), "a path on the session's machine isn't kept here");
    // A page past where the run is (one lost) is left, and the hook told where to go on from; one from 0 begins it again.
    const at = await invoke("transcript.take", { run: "sess-far", from: 10_000_000, to: 10_000_100, lines: [] });
    assert.ok(at.ok && (at.output as { at: number }).at < 10_000_000);
    const again = await invoke("transcript.take", { run: "sess-far", from: 0, to: 5, lines: [] });
    assert.ok(again.ok && (again.output as { at: number }).at === 5);
    assert.ok(!(await invoke("transcript.take", { run: "sess-far", from: 5, to: 1, lines: [] })).ok);
    assert.deepEqual(errors, []);
  } finally {
    await loader.apply([]);
    await rm(dir, { recursive: true, force: true });
  }
});
