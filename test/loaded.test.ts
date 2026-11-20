import assert from "node:assert/strict";
import { appendFile, mkdtemp, rm, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import type { AgentTree } from "../spec/agent.ts";
import type { ExchangeRead } from "../spec/exchange.ts";
import { Runtime, type Pack } from "../runtime/core.ts";
import { Loader } from "../runtime/loader.ts";
import action from "../packs/action/index.ts";
import agent from "../packs/agent/index.ts";
import claudeCode from "../packs/claude-code/index.ts";
import exchange from "../packs/exchange/index.ts";
import graph from "../packs/graph/index.ts";
import loaded from "../packs/loaded/index.ts";
import verdict, { type VerdictRead } from "../packs/verdict/index.ts";
import { homePath, loadsIn } from "../packs/claude-code/mapping.ts";

const line = (o: object) => JSON.stringify(o);
const HOME = "C:\\Users\\me";

const instructions = (files: { path: string; type: string; content: string }[]) => line({ type: "attachment", attachment: { type: "instructions", files } });
const skillCall = (id: string, skill: string) => line({ type: "assistant", message: { content: [{ type: "tool_use", id, name: "Skill", input: { skill } }] } });
const skillText = (dir: string, body: string, source?: string) =>
  line({ type: "user", isMeta: true, ...(source ? { sourceToolUseID: source } : {}), message: { content: [{ type: "text", text: `Base directory for this skill: ${dir}\n\n${body}` }] } });

test("loads: memory files from instructions, a skill's text by its call or its folder, skills loaded again after a compaction", () => {
  const transcript = [
    instructions([
      { path: "C:\\Users\\me\\proj\\CLAUDE.md", type: "Project", content: "# Rules" },
      { path: "c:\\users\\me\\.claude\\projects\\p\\memory\\MEMORY.md", type: "AutoMem", content: "- a memory" },
      { path: "D:\\shared\\CLAUDE.md", type: "Managed", content: "managed" },
    ]),
    skillCall("t1", "anthropic-skills:docs"),
    line({ type: "user", message: { content: [{ type: "tool_result", tool_use_id: "t1", content: "Launching skill" }] } }),
    skillText("C:\\Users\\me\\.claude\\plugins\\x\\skills\\docs", "# Docs", "t1"),
    skillText("C:\\Users\\me\\.claude\\skills\\lattice-keep\\", "# Keep"),
    line({ type: "attachment", attachment: { type: "invoked_skills", skills: [{ name: "pelago-bump", path: "projectSettings:pelago-bump", content: "# Bump" }] } }),
    line({ type: "user", isMeta: true, isSidechain: true, message: { content: "Base directory for this skill: C:\\x\\sub" } }),
    "{not json",
  ].join("\n");
  const loads = loadsIn(transcript, new Map(), HOME);
  assert.deepEqual(
    loads.map((l) => [l.place, l.kind, l.title]),
    [
      ["memory:project/~/proj/CLAUDE.md", "memory", "project memory ~/proj/CLAUDE.md"],
      ["memory:auto/~/.claude/projects/p/memory/MEMORY.md", "memory", "auto memory ~/.claude/projects/p/memory/MEMORY.md"],
      ["memory:managed/D:/shared/CLAUDE.md", "memory", "managed memory D:/shared/CLAUDE.md"],
      ["skill:anthropic-skills:docs", "skill", "skill anthropic-skills:docs"],
      ["skill:lattice-keep", "skill", "skill lattice-keep"],
      ["skill:pelago-bump", "skill", "skill pelago-bump"],
    ],
  );
  assert.equal(loads[0]!.text, "# Rules");
  assert.match(loads[3]!.text, /# Docs/);
  // A Skill call read earlier names the text read later.
  const skills = new Map<string, string>();
  assert.deepEqual(loadsIn(skillCall("t9", "review"), skills), []);
  assert.deepEqual(loadsIn(skillText("/x/skills/other", "#", "t9"), skills).map((l) => l.place), ["skill:review"]);
  assert.equal(homePath("/home/me2/x", "/home/me"), "/home/me2/x");
});

test("what Claude Code loads is said at skill: and memory: places by a node per file, judged per run, and never twice across a restart", async () => {
  const dir = await mkdtemp(join(tmpdir(), "loaded-"));
  const transcriptPath = join(dir, "t.jsonl");
  const claudeMd = join(homedir(), "proj-loaded-test", "CLAUDE.md");
  const MEMORY = "memory:project/~/proj-loaded-test/CLAUDE.md";
  await writeFile(transcriptPath, "");
  const probe: Pack = { id: "probe", inject: ["exchange.read", "agent.tree", "verdict.read"], apply() {} };
  const modules: Record<string, Pack> = {
    "graph.ts": graph, "action.ts": action, "exchange.ts": exchange, "agent.ts": agent, "verdict.ts": verdict,
    "loaded.ts": loaded, "cc.ts": claudeCode, "probe.ts": probe,
  };
  let port = 0;
  const tree = [
    { id: "graph", pack: "graph.ts", config: { file: join(dir, "graph.json") } },
    { id: "action", pack: "action.ts" },
    { id: "exchange", pack: "exchange.ts", config: { journal: join(dir, "exchange.jsonl") } },
    { id: "agent", pack: "agent.ts" },
    { id: "verdict", pack: "verdict.ts" },
    { id: "loaded", pack: "loaded.ts" },
    { id: "claude-code", pack: "cc.ts", config: { port: 0, onListen: (p: number) => (port = p) } },
    { id: "probe", pack: "probe.ts" },
  ];
  const start = async () => {
    const rt = new Runtime();
    const errors: unknown[] = [];
    rt.onError = (_f, e) => errors.push(e);
    const loader = new Loader(rt, { base: "mem:/", import: async (url) => ({ default: modules[url.slice(5)]! }) });
    await loader.apply(tree);
    return { loader, errors };
  };
  const hook = (event: string, more: object = {}) =>
    fetch(`http://127.0.0.1:${port}/hook`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ hook_event_name: event, session_id: "sess-l", cwd: dir, transcript_path: transcriptPath, ...more }),
    }).then((r) => r.json());
  const append = (...lines: string[]) => appendFile(transcriptPath, lines.join("\n") + "\n");
  let { loader, errors } = await start();
  const read = () => loader.fiber("probe")!.ctx.get<ExchangeRead>("exchange.read");
  const events = async () => (await read().events("sess-l")).items;
  try {
    await hook("SessionStart", { source: "startup" });
    // Claude Code writes the memory files with the first prompt.
    await append(instructions([{ path: claudeMd, type: "Project", content: "# Rules\nRun npm run check." }]), line({ type: "user", message: { content: "go" } }));
    assert.deepEqual(await hook("UserPromptSubmit", { prompt: "go" }), {}, "what is said at a load isn't handed back");
    await hook("PreToolUse", { tool_name: "Bash", tool_input: { command: "npm test" }, tool_use_id: "b1" });
    await hook("PostToolUseFailure", { tool_name: "Bash", tool_input: { command: "npm test" }, error: "npm test: 2 failing", tool_use_id: "b1" });
    // A skill is called, and its text follows the call's result.
    await append(skillCall("s1", "review"), line({ type: "user", message: { content: [{ type: "tool_result", tool_use_id: "s1", content: "Launching skill: review" }] } }), skillText(join(dir, "skills", "review"), "# Review\nRead the diff first.", "s1"));
    await hook("PreToolUse", { tool_name: "Read", tool_input: { file_path: join(dir, "a.ts") }, tool_use_id: "r1" });

    const nodes = loader.fiber("probe")!.ctx.get<AgentTree>("agent.tree").nodes().filter((n) => n.pack === "loaded");
    assert.deepEqual(nodes.map((n) => [n.kind, n.at, n.title]), [
      ["memory", [MEMORY], "project memory ~/proj-loaded-test/CLAUDE.md"],
      ["skill", ["skill:review"], "skill review"],
    ]);
    const said = (await events()).filter((e) => e.kind === "say");
    assert.deepEqual(said.map((e) => [e.place, e.node]), [
      [MEMORY, nodes[0]!.id],
      ["skill:review", nodes[1]!.id],
    ]);
    assert.equal(said[0]!.text, "# Rules\nRun npm run check.");
    assert.match(said[1]!.text!, /Read the diff first/);
    // Said before the turn's first tool call.
    const firstAct = (await events()).find((e) => e.kind === "act" && e.act?.kind === "tool")!;
    assert.ok(said[0]!.seq < firstAct.seq);
    // Judged per run like any node: no misses words, so the failed test is no one's.
    const v = await loader.fiber("probe")!.ctx.get<VerdictRead>("verdict.read").run("sess-l");
    assert.deepEqual(v.filter((x) => x.node.startsWith("loaded/")).map((x) => x.verdict), ["quiet", "quiet"]);

    // A restart: the transcript is read again from its start, and nothing is said twice; the nodes come back from the map.
    await loader.apply([]);
    assert.deepEqual(errors, []);
    ({ loader, errors } = await start());
    await hook("PreToolUse", { tool_name: "Read", tool_input: { file_path: join(dir, "b.ts") }, tool_use_id: "r2" });
    // A second load of the same file (after a compaction) is said again, by the same node.
    await append(instructions([{ path: claudeMd, type: "Project", content: "# Rules\nRun npm run check." }]));
    await hook("Stop", { last_assistant_message: "Done." });
    await hook("Stop", { last_assistant_message: "Done." });
    const again = (await events()).filter((e) => e.kind === "say");
    assert.deepEqual(again.map((e) => e.place), [MEMORY, "skill:review", MEMORY]);
    const back = loader.fiber("probe")!.ctx.get<AgentTree>("agent.tree").nodes().filter((n) => n.pack === "loaded");
    assert.deepEqual(back.map((n) => n.id), nodes.map((n) => n.id));
    assert.deepEqual(errors, []);
  } finally {
    await loader.apply([]);
    await rm(dir, { recursive: true, force: true });
  }
});
