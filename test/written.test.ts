import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import type { ActionInvoke } from "../spec/action.ts";
import type { AgentRun, AgentTree } from "../spec/agent.ts";
import type { Json } from "../spec/common.ts";
import type { GraphRead } from "../spec/graph.ts";
import { PLACES } from "../spec/agent.ts";
import { Runtime, type Pack } from "../runtime/core.ts";
import { Loader, type Entry } from "../runtime/loader.ts";
import action from "../packs/action/index.ts";
import agent from "../packs/agent/index.ts";
import exchange from "../packs/exchange/index.ts";
import graph from "../packs/graph/index.ts";
import loaded from "../packs/loaded/index.ts";
import words from "../packs/words/index.ts";
import written from "../packs/written/index.ts";
import { discover, placeOf, projectSlug } from "../packs/written/files.ts";
import { REACHES } from "../packs/claude-code/mapping.ts";

const BASE = "mem:/packs/";
const T = "2026-11-20T16:00:00.000Z";
const probe: Pack = { id: "probe", inject: ["agent.run", "agent.tree", "action.invoke", "graph.read"], apply() {} };

async function put(file: string, text: string) {
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, text, "utf8");
}

/** A home and a project, laid out as Claude Code keeps them. */
async function layout() {
  const root = await mkdtemp(join(tmpdir(), "written-"));
  const home = join(root, "home");
  const project = join(root, "proj");
  const f = {
    userSkill: join(home, ".claude", "skills", "keep", "SKILL.md"),
    userMemory: join(home, ".claude", "CLAUDE.md"),
    pluginSkill: join(home, ".claude", "plugins", "cache", "market", "tools", "1.0.0", "skills", "lint", "SKILL.md"),
    project: join(project, "CLAUDE.md"),
    local: join(project, "CLAUDE.local.md"),
    projectSkill: join(project, ".claude", "skills", "review", "SKILL.md"),
    auto: join(home, ".claude", "projects", projectSlug(project), "memory", "MEMORY.md"),
    settings: join(project, ".claude", "settings.json"),
    old: join(root, "old", "CLAUDE.md"),
  };
  await put(f.userSkill, "---\nname: keep\ndescription: Keep it.\n---\r\n# Keep\r\nKeep what holds.\r\n");
  await put(f.userMemory, "# Mine\n");
  await put(join(home, ".claude", "plugins", "cache", "market", "tools", "1.0.0", ".claude-plugin", "plugin.json"), JSON.stringify({ name: "tools" }));
  await put(f.pluginSkill, "# Lint\n");
  await put(f.project, "# Rules\n\nRun npm run check.\n");
  await put(f.local, "# Local\n");
  await put(f.projectSkill, "# Review\nRead the diff first.\n");
  await put(f.auto, "- a memory\n");
  await put(f.settings, "{}");
  await put(f.old, "<!-- Written from the map: change the instructions for written:CLAUDE.md there; each session start writes this file again. -->\n\n# Old\n");
  return { root, home, project, f };
}

function setup(home: string, graphFile: string) {
  const rt = new Runtime();
  const errors: unknown[] = [];
  rt.onError = (_f, e) => errors.push(e);
  const modules: Record<string, Pack> = { "graph.ts": graph, "action.ts": action, "exchange.ts": exchange, "agent.ts": agent, "words.ts": words, "loaded.ts": loaded, "written.ts": written, "probe.ts": probe };
  const loader = new Loader(rt, { base: BASE, import: async (url) => ({ default: modules[url.slice(BASE.length)] }) });
  const tree: Entry[] = [
    { id: "graph", pack: "graph.ts", config: { db: graphFile } },
    { id: "action", pack: "action.ts" },
    { id: "exchange", pack: "exchange.ts" },
    { id: "agent", pack: "agent.ts" },
    { id: "words", pack: "words.ts" },
    { id: "loaded", pack: "loaded.ts" },
    { id: "written", pack: "written.ts", config: { home } },
    { id: "probe", pack: "probe.ts" },
  ];
  const as = (actor: { id: string; kind: "person" | "agent" } = { id: "person:alex", kind: "person" }) => {
    const ctx = loader.fiber("probe")!.ctx.intercept({ actor, run: "r1" });
    return {
      invoke: ctx.get<ActionInvoke>("action.invoke"),
      run: ctx.get<AgentRun>("agent.run"),
      tree: ctx.get<AgentTree>("agent.tree"),
      read: ctx.get<GraphRead>("graph.read"),
    };
  };
  const call = async (who: ReturnType<typeof as>, name: string, input: Json, authority: "human" | "agent" = "human") =>
    who.invoke.invoke({ action: name, input, authority: { of: authority, basis: "test" }, reason: `test ${name}` });
  return { rt, loader, errors, tree, as, call };
}

/** The pack writes as each change commits; wait until the file says what it should. */
async function settles(file: string, want: string) {
  for (let i = 0; i < 100; i++) {
    if ((await readFile(file, "utf8").catch(() => undefined)) === want) return;
    await new Promise((r) => setTimeout(r, 20));
  }
  assert.equal(await readFile(file, "utf8"), want, `${file} never came to say it`);
}
const quiet = () => new Promise((r) => setTimeout(r, 120));

test("skill: and memory: are edition 2 places, not refusable, and the Claude Code adapter reaches them", () => {
  const two = PLACES.filter((p) => p.since === 2);
  assert.deepEqual(two.map((p) => [p.term, p.refusable]), [["skill:<name>", false], ["memory:<scope>/<path>", false]]);
  for (const p of two) assert.ok(REACHES.includes(p.term));
});

test("the files the map may write, and the place each is said at: the adapter's places", async () => {
  const { root, home, project, f } = await layout();
  try {
    const found = await discover({ user: true, plugins: true, project }, home);
    const places = [];
    for (const file of found) {
      const p = await placeOf(file, home);
      assert.ok(!("why" in p), file);
      places.push(p.place);
    }
    const rel = (p: string) => p.replace(root.replaceAll("\\", "/"), "<root>");
    assert.deepEqual(places.map(rel), [
      "skill:keep",
      "memory:user/~/.claude/CLAUDE.md",
      "skill:tools:lint",
      "memory:project/<root>/proj/CLAUDE.md",
      "memory:local/<root>/proj/CLAUDE.local.md",
      "skill:review",
      `memory:auto/~/.claude/projects/${projectSlug(project)}/memory/MEMORY.md`,
    ]);
    // A skill folder names its SKILL.md; settings are never the map's to write.
    assert.equal(((await placeOf(dirname(f.projectSkill), home)) as { place: string }).place, "skill:review");
    assert.match(((await placeOf(f.settings, home)) as { why: string }).why, /Only SKILL.md/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("adopt imports skills and memory as nodes at their places, through an action; the old map's file stays its own", async () => {
  const { root, home, project, f } = await layout();
  const { loader, errors, tree, as, call } = setup(home, join(root, "graph.sqlite"));
  await loader.apply(tree);
  try {
    const alex = as();
    // A load seen before adoption: the loaded pack says it until the map does.
    const seen = await call(alex, "loaded.note", { place: "skill:review", kind: "skill", title: "skill review", path: f.projectSkill });
    assert.ok(seen.ok);
    assert.deepEqual(alex.tree.nodes().filter((n) => n.pack === "loaded").map((n) => n.at), [["skill:review"]]);

    const out = await call(alex, "written.adopt", { scan: { user: true, plugins: true, project }, paths: [f.old, f.settings] });
    assert.ok(out.ok, JSON.stringify(out));
    const o = (out as unknown as { output: { adopted: { node: string; place: string; held?: string }[]; skipped: { file: string; why: string }[] } }).output;
    assert.equal(o.adopted.length, 7);
    assert.ok(o.adopted.every((a) => typeof a.held === "string"), "held as written unless asked otherwise");
    assert.deepEqual(o.skipped.map((s) => [s.file, s.why.slice(0, 14)]), [
      [f.old, "The old map wr"],
      [f.settings, "Only SKILL.md,"],
    ]);

    // Each is a words node said at its place, with the file's text as its words, exactly.
    const nodes = alex.tree.nodes();
    const review = o.adopted.find((a) => a.place === "skill:review")!;
    assert.ok(nodes.some((n) => n.id === `words/${review.node}` && n.kind === "skill" && n.at[0] === "skill:review"));
    const keep = o.adopted.find((a) => a.place === "skill:keep")!;
    const [item] = await alex.read.get([keep.node]);
    assert.equal(item!.fields.words, await readFile(f.userSkill, "utf8"));
    assert.equal(item!.fields.file, f.userSkill);
    // The loaded record steps aside, and a later note answers the map's node.
    assert.deepEqual(alex.tree.nodes().filter((n) => n.pack === "loaded"), []);
    const again = await call(alex, "loaded.note", { place: "skill:review", kind: "skill", title: "skill review" });
    assert.deepEqual(again.ok && again.output, { node: review.node });
    const said = await alex.run.reach({ run: "r1", places: ["skill:review"], time: T, input: { text: "# Review" } });
    assert.deepEqual(said.said.map((s) => [s.node, s.text]), [[`words/${review.node}`, "# Review\nRead the diff first."]]);

    // Nothing was written: every file is as it was.
    assert.equal(await readFile(f.userSkill, "utf8"), "---\nname: keep\ndescription: Keep it.\n---\r\n# Keep\r\nKeep what holds.\r\n");
    // Adopting again changes nothing.
    const twice = await call(alex, "written.adopt", { paths: [f.project] });
    assert.ok(twice.ok && !twice.change);
    await quiet();
    assert.deepEqual(errors, []);
  } finally {
    await loader.apply([]);
    await rm(root, { recursive: true, force: true });
  }
});

test("a held node refuses refinement and says why; opened, words.set writes the file the next session loads, round trip intact", async () => {
  const { root, home, project, f } = await layout();
  const graphFile = join(root, "graph.sqlite");
  let { loader, errors, tree, as, call } = setup(home, graphFile);
  await loader.apply(tree);
  const ORIGINAL = await readFile(f.project, "utf8");
  try {
    const alex = as();
    const agentRun = as({ id: "agent:claude", kind: "agent" });
    const out = await call(alex, "written.adopt", { paths: [f.project, f.projectSkill], why: "Alex's working rules: prose is his." });
    assert.ok(out.ok);
    const [md, skill] = (out as unknown as { output: { adopted: { node: string }[] } }).output.adopted;

    // Held: the learning loop or an agent can't refine it, and the refusal names why.
    const no = await call(agentRun, "words.set", { node: md!.node, words: "# Rules\n\nSomething else.\n" }, "agent");
    assert.ok(!no.ok);
    assert.equal(no.refused.code, "words.held");
    assert.match(no.refused.message, /held as written: Alex's working rules: prose is his\./);
    assert.ok(!(await call(agentRun, "words.retire", { node: md!.node }, "agent")).ok);
    assert.equal(await readFile(f.project, "utf8"), ORIGINAL);

    // Opened by its rule: refinement applies and reaches the file.
    assert.ok((await call(alex, "written.rule", { node: md!.node, refine: "open" })).ok);
    const NEW = "# Rules\r\n\r\nRun npm run check, then the full suite.\r\n";
    assert.ok((await call(agentRun, "words.set", { node: md!.node, words: NEW }, "agent")).ok);
    await settles(f.project, NEW);
    // Held again, it refuses again.
    assert.ok((await call(alex, "written.rule", { node: md!.node, refine: "held", why: "Settled." })).ok);
    assert.match((await call(agentRun, "words.set", { node: md!.node, words: "x" }, "agent") as { refused: { message: string } }).refused.message, /Settled\./);

    // Undo: the words it had are written back.
    assert.ok((await call(alex, "written.rule", { node: skill!.node, refine: "open" })).ok);
    const SKILL = await readFile(f.projectSkill, "utf8");
    assert.ok((await call(alex, "words.set", { node: skill!.node, words: "# Review\nRead the tests first.\n" })).ok);
    await settles(f.projectSkill, "# Review\nRead the tests first.\n");
    assert.ok((await call(alex, "words.set", { node: skill!.node, words: SKILL })).ok);
    await settles(f.projectSkill, SKILL);

    // A hand edit: the map no longer writes over it, and says so, until it is adopted again.
    await writeFile(f.projectSkill, "# Review\nBy hand.\n");
    assert.ok((await call(alex, "words.set", { node: skill!.node, words: "# Review\nFrom the map.\n" })).ok);
    await quiet();
    assert.equal(await readFile(f.projectSkill, "utf8"), "# Review\nBy hand.\n");
    assert.match(String(errors.pop()), /changed outside the map/);
    const re = await call(alex, "written.adopt", { paths: [f.projectSkill] });
    assert.ok(re.ok && (re.output as { updated: unknown[] }).updated.length === 1);
    const [back] = await alex.read.get([skill!.node]);
    assert.equal(back!.fields.words, "# Review\nBy hand.\n");
    assert.ok((await call(alex, "words.set", { node: skill!.node, words: "# Review\nFrom the map.\n" })).ok);
    await settles(f.projectSkill, "# Review\nFrom the map.\n");

    // Unloading undoes the writes: each file goes back to what was adopted. Loading writes the map's words again.
    await loader.apply([]);
    assert.equal(await readFile(f.project, "utf8"), ORIGINAL);
    assert.equal(await readFile(f.projectSkill, "utf8"), "# Review\nBy hand.\n");
    ({ loader, errors, tree, as, call } = setup(home, graphFile));
    await loader.apply(tree);
    await settles(f.project, NEW);
    await settles(f.projectSkill, "# Review\nFrom the map.\n");
    // What the next session loads is the map's: the node says it at its place.
    const said = await as().run.reach({ run: "r2", places: [`memory:project/${f.project.replaceAll("\\", "/")}`], time: T });
    assert.deepEqual(said.said.map((s) => s.text), [NEW.trim()]);
    assert.deepEqual(errors, []);
    void project;
  } finally {
    await loader.apply([]);
    await rm(root, { recursive: true, force: true });
  }
});
