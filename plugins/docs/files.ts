/**
 * The guide, read from the repository's own Markdown as it is in the
 * running build: the path in the order `guide/README.md` lists it, the
 * spec's contract docs, then every plugin folder's README. Server side (it reads files); the docs plugin
 * serves it as `docs.read.guide()` and `docs.read.chapter(path)`.
 *
 * Only the files it lists can be read: `chapter` refuses any other path.
 */
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { chapter, links, parse, resolve, type Block } from "./markdown.ts";
import type { GuideEntry } from "./read.ts";

export type { GuideEntry } from "./read.ts";

/** Where the guide's order is kept. */
export const INDEX = "guide/README.md";
/** The spec's own README, whose links give its contracts' order. */
const SPEC = "spec/README.md";

/** The path's files, in the order the index's numbered list gives them. */
function ordered(blocks: Block[]): { path: string; title: string }[] {
  const list = blocks.find((b) => b.t === "list" && b.ordered);
  if (!list || list.t !== "list") return [];
  const out: { path: string; title: string }[] = [];
  for (const item of list.items) {
    const p = item.find((b) => b.t === "p");
    const m = p && p.t === "p" ? /\[([^\]]+)\]\(([^)#\s]+)/.exec(p.text) : undefined;
    const to = m && resolve(INDEX, m[2]!);
    if (m && to) out.push({ path: to.path.endsWith("/") ? `${to.path}README.md` : to.path, title: m[1]! });
  }
  return out;
}

/** The spec's contract docs: in the order `spec/README.md` links them, then any it doesn't. */
async function contracts(root: string, skip: Set<string>): Promise<GuideEntry[]> {
  const readme = await readFile(join(root, SPEC), "utf8").catch(() => "");
  const files = (await readdir(join(root, "spec")).catch(() => [] as string[])).filter((f) => f.endsWith(".md")).map((f) => `spec/${f}`);
  const linked = links(parse(readme))
    .map((href) => resolve(SPEC, href)?.path)
    .filter((p): p is string => !!p && files.includes(p));
  const out: GuideEntry[] = [];
  for (const path of [...new Set([...linked, ...files.sort()])]) {
    if (skip.has(path)) continue;
    const text = await readFile(join(root, path), "utf8");
    out.push({ path, title: chapter(text).title ?? path, part: "spec" });
  }
  return out;
}

/** Every chapter, in order: the path, the spec's contracts, then each plugin folder's README by name. */
export async function guide(root: string): Promise<GuideEntry[]> {
  const index = await readFile(join(root, INDEX), "utf8").catch(() => "");
  const path: GuideEntry[] = ordered(parse(index)).map((e) => ({ ...e, part: "path" }));
  const spec = await contracts(root, new Set(path.map((e) => e.path)));
  const folders = await readdir(join(root, "plugins"), { withFileTypes: true }).catch(() => []);
  const plugins: GuideEntry[] = [];
  for (const f of folders.filter((f) => f.isDirectory()).map((f) => f.name).sort()) {
    const file = `plugins/${f}/README.md`;
    const text = await readFile(join(root, file), "utf8").catch(() => undefined);
    if (text !== undefined) plugins.push({ path: file, title: chapter(text).title ?? f, part: "plugin", plugin: f });
  }
  return [...path, ...spec, ...plugins];
}

/** One chapter's Markdown, as the file holds it now. Only a file the guide lists, or its index. */
export async function read(root: string, path: string): Promise<string> {
  const known = path === INDEX || (await guide(root)).some((e) => e.path === path);
  if (!known) throw new Error(`${path} is not in the guide`);
  return readFile(join(root, path), "utf8");
}
