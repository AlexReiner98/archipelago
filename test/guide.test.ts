import assert from "node:assert/strict";
import { readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { guide, INDEX, read } from "../packs/docs/files.ts";
import { sectionOf, short, target } from "../packs/docs/guide.ts";
import { chapter, external, inline, links, parse, resolve, slug } from "../packs/docs/markdown.ts";

const ROOT = fileURLToPath(new URL("../", import.meta.url));

test("markdown: headings, paragraphs, nested lists, code, tables and quotes", () => {
  const md = [
    "# Title",
    "<!-- dropped -->",
    "Lead line one",
    "and two.",
    "",
    "## A `code` part",
    "",
    "- one",
    "  - inner",
    "- two",
    "  still two",
    "",
    "1. first",
    "2. second",
    "",
    "```ts",
    "const x = 1;",
    "```",
    "",
    "| a | b |",
    "|---|---|",
    "| 1 | x \\| y |",
    "",
    "> quoted",
  ].join("\n");
  const bs = parse(md);
  assert.deepEqual(bs.map((b) => b.t), ["h", "p", "h", "list", "list", "code", "table", "quote"]);
  assert.deepEqual(bs[1], { t: "p", text: "Lead line one and two." });
  assert.equal((bs[2] as any).id, "a-code-part");
  const list = bs[3] as any;
  assert.equal(list.items.length, 2);
  assert.equal(list.items[0][1].t, "list");
  assert.deepEqual(list.items[1], [{ t: "p", text: "two still two" }]);
  assert.equal((bs[4] as any).ordered, true);
  assert.deepEqual(bs[5], { t: "code", lang: "ts", text: "const x = 1;" });
  assert.deepEqual((bs[6] as any).rows, [["1", "x | y"]]);
});

test("markdown: inline marks, and no markup passed through", () => {
  assert.deepEqual(inline("a `b` **c** *d* [e](f.md) <x>"), [
    { t: "text", text: "a " },
    { t: "code", text: "b" },
    { t: "text", text: " " },
    { t: "b", parts: [{ t: "text", text: "c" }] },
    { t: "text", text: " " },
    { t: "i", parts: [{ t: "text", text: "d" }] },
    { t: "text", text: " " },
    { t: "a", href: "f.md", parts: [{ t: "text", text: "e" }] },
    { t: "text", text: " <x>" },
  ]);
  assert.equal(inline("snake_case_word").length, 1);
  assert.equal(inline("see https://example.org.")[1]?.t, "a");
});

test("markdown: a chapter's title and its sections; anchors as GitHub makes them", () => {
  const c = chapter("# T\n\nlead\n\n## One\n\nx\n\n### Deep\n\ny\n\n## One\n\nz");
  assert.equal(c.title, "T");
  assert.deepEqual(c.sections.map((s) => s.head?.id), [undefined, "one", "one-1"]);
  assert.equal(sectionOf(c.sections, "deep"), 1);
  assert.equal(sectionOf(c.sections, "nope"), -1);
  assert.equal(slug("The `docs.read` key, (8)"), "the-docsread-key-8");
});

test("markdown: links resolve from the file they're in", () => {
  assert.deepEqual(resolve("packs/docs/README.md", "../../spec/graph.md#reads"), { path: "spec/graph.md", anchor: "reads" });
  assert.deepEqual(resolve("guide/README.md", "../README.md"), { path: "README.md" });
  assert.deepEqual(resolve("guide/README.md", "../packs/"), { path: "packs/" });
  assert.deepEqual(resolve("spec/agent.md", "#gates"), { path: "spec/agent.md", anchor: "gates" });
  assert.equal(resolve("README.md", "../outside.md"), undefined);
  assert.equal(external("https://example.org"), true);
  const entries = [{ path: "spec/README.md", title: "The spec", part: "path" as const }];
  assert.deepEqual(target(entries, "guide/README.md", "../spec/"), { path: "spec/README.md" });
  assert.deepEqual(target(entries, "README.md", "spec#x"), { path: "spec/README.md", anchor: "x" });
  assert.equal(target(entries, "README.md", "app/boot.ts"), undefined);
});

test("guide: the path in the index's order, the spec's contracts in its README's order, then every pack's README", async () => {
  const all = await guide(ROOT);
  const path = all.filter((e) => e.part === "path").map((e) => e.path);
  assert.deepEqual(path, ["README.md", "guide/first-run.md", "guide/concepts.md", "guide/writing-a-pack.md", "guide/profiles-and-the-harness.md", "spec/README.md"]);
  const spec = all.filter((e) => e.part === "spec").map((e) => e.path);
  assert.deepEqual(spec.slice(0, 3), ["spec/graph.md", "spec/action.md", "spec/agent.md"]);
  assert.ok(!spec.includes("spec/README.md"));
  assert.deepEqual(all.map((e) => e.part), [...all.map((e) => e.part)].sort((a, b) => ["path", "spec", "pack"].indexOf(a) - ["path", "spec", "pack"].indexOf(b)));
  const packs = all.filter((e) => e.part === "pack");
  assert.ok(packs.some((e) => e.pack === "docs" && e.path === "packs/docs/README.md" && e.title === "docs"));
  assert.deepEqual(packs.map((e) => e.pack), [...packs.map((e) => e.pack)].sort());
  assert.equal(await read(ROOT, "guide/first-run.md"), await readFile(join(ROOT, "guide/first-run.md"), "utf8"));
  assert.ok((await read(ROOT, INDEX)).startsWith("# The guide"));
  await assert.rejects(read(ROOT, "package.json"), /not in the guide/);
  await assert.rejects(read(ROOT, "../secret.md"), /not in the guide/);
});

test("guide: every link in every chapter resolves, its heading included", async () => {
  const all = [{ path: INDEX }, ...(await guide(ROOT))];
  const anchors = new Map<string, Set<string>>();
  const headings = async (path: string) => {
    if (!anchors.has(path)) {
      const text = await readFile(join(ROOT, path), "utf8");
      anchors.set(path, new Set(parse(text).flatMap(function ids(b: any): string[] {
        return b.t === "h" ? [b.id] : b.t === "list" ? b.items.flat().flatMap(ids) : b.t === "quote" ? b.blocks.flatMap(ids) : [];
      })));
    }
    return anchors.get(path)!;
  };
  const broken: string[] = [];
  for (const e of all) {
    for (const href of links(parse(await readFile(join(ROOT, e.path), "utf8")))) {
      if (external(href)) continue;
      const to = resolve(e.path, href);
      if (!to) {
        broken.push(`${e.path}: ${href} leaves the repository`);
        continue;
      }
      const file = join(ROOT, to.path);
      const st = await stat(file).catch(() => undefined);
      if (!st) {
        broken.push(`${e.path}: ${href} (no ${to.path})`);
        continue;
      }
      if (to.anchor) {
        const md = st.isDirectory() ? join(to.path, "README.md") : to.path;
        if (!md.endsWith(".md") || !(await headings(md)).has(to.anchor)) broken.push(`${e.path}: ${href} (no heading #${to.anchor})`);
      }
    }
  }
  assert.deepEqual(broken, []);
});

test("guide: its own chapters are short and sectioned, and name nothing private", async () => {
  const all = (await guide(ROOT)).filter((e) => e.path.startsWith("guide/"));
  for (const e of [{ path: INDEX }, ...all]) {
    const text = await readFile(join(ROOT, e.path), "utf8");
    const c = chapter(text);
    assert.ok(c.title, `${e.path} has a title`);
    assert.ok(c.sections.filter((s) => s.head).length >= 2, `${e.path} is in sections`);
    assert.ok(text.split("\n").length <= 120, `${e.path} is short`);
    assert.doesNotMatch(text, /[A-Z]:\\|\/Users\/|\/home\/|github\.com\/|token=|sk-[a-z0-9]/i, `${e.path} names nothing private`);
  }
});

test("guide: a section of one short paragraph starts open, a longer one folded", () => {
  const [one, two, three] = chapter("# T\n\n## A\n\nShort.\n\n## B\n\nOne.\n\nTwo.\n\n## C\n\n" + "word ".repeat(80)).sections;
  assert.equal(short(one!), true);
  assert.equal(short(two!), false);
  assert.equal(short(three!), false);
});
