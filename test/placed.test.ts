import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import type { ActionInvoke } from "../spec/action.ts";
import type { AgentRun } from "../spec/agent.ts";
import { Runtime, type Pack } from "../runtime/core.ts";
import { Loader, type Entry } from "../runtime/loader.ts";
import action from "../packs/action/index.ts";
import agent from "../packs/agent/index.ts";
import exchange from "../packs/exchange/index.ts";
import graph from "../packs/graph/index.ts";
import types from "../packs/types/index.ts";
import record from "../packs/record/index.ts";
import links from "../packs/links/index.ts";
import items from "../packs/items/index.ts";
import words from "../packs/words/index.ts";
import written from "../packs/written/index.ts";
import profile from "../packs/profile/index.ts";
import placed, { skillName } from "../packs/placed/index.ts";

const BASE = "mem:/packs/";
const probe: Pack = { id: "probe", inject: ["agent.run", "action.invoke"], apply() {} };

const text = (f: string) => readFile(f, "utf8").catch(() => undefined);
async function until(check: () => Promise<boolean>, what: string) {
  for (let i = 0; i < 150; i++) {
    if (await check()) return;
    await new Promise((r) => setTimeout(r, 20));
  }
  assert.fail(`never: ${what}`);
}

test("skill names come from SKILL.md paths", () => {
  assert.equal(skillName("C:\\Users\\a\\.claude\\skills\\rhinocommon\\SKILL.md"), "rhinocommon");
  assert.equal(skillName("/x/CLAUDE.md"), undefined);
});

test("a profile's skill moves from home into the folders of the runs it holds it for, once the profile is on; unloading puts it back", async () => {
  const root = await mkdtemp(join(tmpdir(), "placed-"));
  const home = join(root, "home");
  const studio = join(root, "Studio");
  const arch = join(root, "archipelago-next");
  const skill = join(home, ".claude", "skills", "rhino", "SKILL.md");
  const exclude = join(studio, ".git", "info", "exclude");
  await mkdir(dirname(skill), { recursive: true });
  await mkdir(dirname(exclude), { recursive: true });
  await mkdir(arch, { recursive: true });
  await writeFile(skill, "# Rhino\n", "utf8");
  await writeFile(exclude, "# git ls-files --others --exclude-from=.git/info/exclude\n", "utf8");
  const git = async (cwd: string, args: string[]) => (cwd === studio && args[0] === "rev-parse" ? ".git/info/exclude" : undefined);

  const rt = new Runtime();
  const errors: unknown[] = [];
  rt.onError = (_f, e) => errors.push(e);
  const modules: Record<string, Pack> = { graph, action, types, record, links, items, exchange, agent, words: words as Pack, written: written as Pack, profile, placed: placed as Pack, probe };
  const loader = new Loader(rt, { base: BASE, import: async (url) => ({ default: modules[url.slice(BASE.length)] }) });
  const tree = (withPlaced = true): Entry[] => [
    ...["graph", "action", "types", "record", "links", "items", "exchange", "agent", "words"].map((id) => ({ id, pack: id })),
    { id: "written", pack: "written", config: { home } },
    { id: "profile", pack: "profile" },
    ...(withPlaced ? [{ id: "placed", pack: "placed", config: { git } }] : []),
    { id: "probe", pack: "probe" },
  ];
  try {
    await loader.apply(tree());
    await rt.settle();
    const ctx = (run: string) => loader.fiber("probe")!.ctx.intercept({ actor: { id: "e_agent", kind: "agent" }, run });
    const act = async (name: string, input: Record<string, unknown>) => {
      const out = await ctx("r0").get<ActionInvoke>("action.invoke").invoke({ action: name, input: input as never, authority: { of: "human", basis: "test" }, reason: "test" });
      assert.ok(out.ok, JSON.stringify(out));
      return (out.ok ? out.output : {}) as Record<string, unknown>;
    };
    const adopted = (await act("written.adopt", { paths: [skill] })) as { adopted: { node: string }[] };
    const node = adopted.adopted[0]!.node;
    const rA = String((await act("items.create", { type: "record", title: "Studio repo" })).id);
    const rB = String((await act("items.create", { type: "record", title: "Archipelago repo" })).id);
    const pA = String((await act("items.create", { type: "context_filter", title: "Studio" })).id);
    const pB = String((await act("items.create", { type: "context_filter", title: "Archipelago" })).id);
    await act("items.link", { type: "in_context_filter", from: node, to: pA });
    await act("items.link", { type: "uses", from: rA, to: pA });
    await act("items.link", { type: "uses", from: rB, to: pB });
    const start = (run: string, cwd: string, repo: string) => ctx(run).get<AgentRun>("agent.run").begin({ run, agent: { id: "e_agent", kind: "agent" }, harness: "test", reaches: [], cwd, facts: { repo } });
    await start("rA", studio, rA);
    await start("rB", arch, rB);
    const copyA = join(studio, ".claude", "skills", "rhino", "SKILL.md");
    const copyB = join(arch, ".claude", "skills", "rhino", "SKILL.md");

    // In shadow nothing moves.
    await new Promise((r) => setTimeout(r, 150));
    assert.equal(await text(skill), "# Rhino\n");
    assert.equal(await text(copyA), undefined);

    await act("items.set", { id: pA, fields: { status: "on" } });
    await act("items.set", { id: pB, fields: { status: "on" } });
    await until(async () => (await text(copyA)) === "# Rhino\n" && (await text(skill)) === undefined, "the skill moved to Studio");
    assert.equal(await text(copyB), undefined, "Archipelago's runs don't get it");
    assert.match(String(await text(exclude)), /^\/\.claude\/skills\/rhino\/$/m);

    // Its words change: the copy follows.
    await act("words.set", { node, words: "# Rhino, again\n" }).catch(() => undefined);
    await act("written.rule", { node, refine: "open" });
    await act("words.set", { node, words: "# Rhino, again\n" });
    await until(async () => (await text(copyA)) === "# Rhino, again\n", "the copy has the new words");

    // The placer goes: the skill is home again, the copy gone.
    await loader.apply(tree(false));
    await until(async () => (await text(skill)) === "# Rhino, again\n" && (await text(copyA)) === undefined, "the skill went home");
    assert.deepEqual(errors, []);
    await loader.apply([]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
