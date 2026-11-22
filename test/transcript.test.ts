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
import { GivenIndex, hookPlace, hookWho, isOurs, partOf, readLine, readPage, shown, type Line } from "../packs/transcript/read.ts";
import { givenNodes, isGiven, parseGiven } from "../packs/harness/given.ts";
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
  assert.ok(isOurs('node "C:/x/archipelago-next-hosted/hook.ts" https://app.example.tools/hook'));
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
