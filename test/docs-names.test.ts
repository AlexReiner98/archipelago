/**
 * Every name a doc gives exists. The prose docs (the READMEs, CLAUDE.md,
 * SECURITY.md, spec/*.md and the spec's comments) name files and paths,
 * plugins, actions, capabilities, places, node kinds, exports, scripts and
 * config keys. Each name is read by its shape and looked for where it
 * would live: the tracked files, package.json's scripts, or the code's own
 * words (every identifier, dotted name and `term:` string outside test/).
 * A miss names the doc, its line and the name.
 *
 * It reads names, not claims: a count, a list left short or an edition
 * line gone stale passes here, and is the generated blocks' to keep.
 */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import { basename, dirname, posix } from "node:path";
import { test } from "node:test";

const ROOT = new URL("../", import.meta.url);
const read = (path: string) => readFileSync(new URL(path, ROOT), "utf8");

/** Tracked files, from git when it is there, else from the disk. */
function tracked(): string[] {
  try {
    return execFileSync("git", ["ls-files"], { cwd: ROOT, encoding: "utf8" }).split("\n").filter(Boolean);
  } catch {
    // The deploy image has no git: walk the tree instead.
    const out: string[] = [];
    const walk = (dir: string) => {
      for (const e of readdirSync(new URL(dir || ".", ROOT), { withFileTypes: true })) {
        if (e.name === "node_modules" || e.name === ".git" || e.name === ".data") continue;
        const p = dir ? `${dir}/${e.name}` : e.name;
        e.isDirectory() ? walk(p) : out.push(p);
      }
    };
    walk("");
    return out;
  }
}

const FILES = tracked();
const FILE_SET = new Set(FILES);
const DIRS = new Set(FILES.flatMap((f) => f.split("/").slice(0, -1).map((_, i, a) => a.slice(0, i + 1).join("/"))));
const BASENAMES = new Set(FILES.map((f) => basename(f)));
const TOP = new Set(FILES.filter((f) => f.includes("/")).map((f) => f.split("/")[0]));
const SCRIPTS = new Set(Object.keys(JSON.parse(read("package.json")).scripts));
const PLUGINS = new Set(FILES.filter((f) => /^plugins\/[^/]+\/README\.md$/.test(f)).map((f) => f.split("/")[1]));

/** The docs read, and the spec's code files whose comments are read. */
const DOCS = FILES.filter((f) => f.endsWith(".md"));
const SPEC_CODE = FILES.filter((f) => /^spec\/[^/]+\.ts$/.test(f));

/** The code's words: every name chain, each prefix of it and each part. */
const WORDS = new Set<string>();
const TERMS = new Set<string>();
for (const f of FILES) {
  if (f.endsWith(".md") || f.startsWith("test/") || f === "package-lock.json" || !/\.(ts|js|json|html|css|sh)$/.test(f)) continue;
  const text = read(f);
  for (const [chain] of text.matchAll(/[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*/g)) {
    const parts = chain.split(".");
    for (let i = 0; i < parts.length; i++) {
      WORDS.add(parts[i]!);
      WORDS.add(parts.slice(0, i + 1).join("."));
    }
  }
  for (const [, term] of text.matchAll(/["'`]([a-z][\w-]*):/g)) TERMS.add(term!);
}

// The platform's own names, which no file of ours declares.
for (const g of ["customElements", "customElements.define", "window", "document", "globalThis", "process", "console"]) WORDS.add(g);

/** A source file's extension. Data files (`.log`, `.sqlite`, `.jsonl`) live in ignored folders, so a bare one is not checked. */
const EXT = /\.(ts|js|json|md|html|css|sh)$/;
/** Places a doc may name that the repo never holds: ignored or outside it (connect:here's files are kept out of git). */
const IGNORED = /(^|\/)(\.data|node_modules|\.claude\/skills)(\/|$)|^\.\.\/|^(\.mcp\.json|\.claude\/settings\.local\.json)$/;

interface Miss { line: number; name: string; kind: string }

/** A dotted name exists in the code, or is a known name with a member the code has. */
function dotted(name: string): boolean {
  if (name.endsWith(".*")) return WORDS.has(name.slice(0, -2));
  if (WORDS.has(name)) return true;
  const at = name.lastIndexOf(".");
  return at > 0 && dotted(name.slice(0, at)) && WORDS.has(name.slice(at + 1));
}

/** A path, from the repo root or the doc's folder; a bare file name may live anywhere. */
function path(name: string, doc: string): boolean {
  const p = name.replace(/\/$/, "").replace(/^\.\//, "");
  if (!p) return true;
  const here = posix.join(dirname(doc), p);
  if (FILE_SET.has(p) || DIRS.has(p) || FILE_SET.has(here) || DIRS.has(here)) return true;
  return !p.includes("/") && BASENAMES.has(p);
}

/** What one inline name is, by its shape, and whether it exists. Undefined: not a name this test reads. */
function check(name: string, doc: string): string | undefined {
  const n = name.trim();
  if (/^npm run /.test(n)) return SCRIPTS.has(n.split(/\s+/)[2]!) ? undefined : "script";
  if (/^npm test\b/.test(n)) return SCRIPTS.has("test") ? undefined : "script";
  if (/^node [\w./-]+\.ts\b/.test(n)) return path(n.split(/\s+/)[1]!, doc) ? undefined : "path";
  if (/[\s<>*~?{}[\]"'|=,]/.test(n)) return; // a pattern, a shape or a sentence: not one name
  // A place or a query term: `tool:Bash`, `file:spec/agent.ts`, `is:open`.
  const colon = /^([a-z][\w-]*):(.*)$/.exec(n);
  if (colon) {
    if (!TERMS.has(colon[1]!)) return "term";
    if (colon[1] === "file" && colon[2] && !colon[2].includes("…") && !IGNORED.test(colon[2])) return path(colon[2], doc) ? undefined : "path";
    return;
  }
  // A path: it starts in a folder the repo has, or ends in a source file's extension.
  if (!n.startsWith("/") && !IGNORED.test(n) && (TOP.has(n.split("/")[0]) && n.includes("/") || EXT.test(n))) {
    return path(n, doc) ? undefined : "path";
  }
  // An action, capability, slot, key or member: `items.set`, `graph.read`, `config.db`.
  if (/^[A-Za-z_$][\w$]*(\.([A-Za-z_$][\w$]*|\*))+$/.test(n) && !EXT.test(n)) return dotted(n) ? undefined : "name";
  // A call: `loader.status()`, `watch(filter, on)` reads as its name.
  const call = /^([A-Za-z_$][\w$.]*)\(/.exec(n);
  if (call) return dotted(call[1]!) ? undefined : "name";
  // An export, a type, a constant or an env key: `PLACES`, `SceneDelta`, `ARCHIPELAGO_LIVE`.
  if (/^[A-Z][A-Za-z0-9_]*$/.test(n) && n.length > 1) return WORDS.has(n) ? undefined : "export";
  // A snake_case term: a place, a node kind, a link: `reply_end`, `schema_check`, `part_of`.
  if (/^[a-z]+(_[a-z0-9]+)+$/.test(n)) return WORDS.has(n) || TERMS.has(n) ? undefined : "term";
  return;
}

/** Each inline code span of a text outside its fences, with the line it starts on. A span may wrap onto the next line. */
function* spans(text: string, from = 1): Generator<[number, string]> {
  let fence = false;
  const kept = text.split("\n").map((line) => {
    if (/^\s*(```|~~~)/.test(line)) { fence = !fence; return ""; }
    return fence ? "" : line;
  }).join("\n");
  for (const m of kept.matchAll(/`([^`\n]+(?:\n[^`\n]+)?)`/g)) {
    yield [from + kept.slice(0, m.index).split("\n").length - 1, m[1]!.replace(/\s*\n\s*/, " ")];
  }
}

function misses(doc: string): Miss[] {
  const text = read(doc);
  const out: Miss[] = [];
  const add = (line: number, name: string, kind: string | undefined) => { if (kind) out.push({ line, name, kind }); };
  if (doc.endsWith(".ts")) {
    // The spec's comments: each block or line comment, read as prose.
    for (const m of text.matchAll(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/g)) {
      const line = text.slice(0, m.index).split("\n").length;
      for (const [l, span] of spans(m[0].replace(/^\s*\*/gm, ""), line)) add(l, span, check(span, doc));
    }
    return out;
  }
  for (const [l, span] of spans(text)) add(l, span, check(span, doc));
  text.split("\n").forEach((lineText, i) => {
    // Links to files in the repo.
    for (const [, target = ""] of lineText.matchAll(/\]\(([^)\s]+)\)/g)) {
      if (/^(\w+:|#)/.test(target)) continue;
      // A link is relative to its doc; one that leaves the repo is not ours to check.
      const p = posix.join(dirname(doc), decodeURI(target.replace(/#.*$/, ""))).replace(/\/$/, "");
      if (IGNORED.test(p) || p === ".") continue;
      if (!FILE_SET.has(p) && !DIRS.has(p)) out.push({ line: i + 1, name: target, kind: "link" });
    }
    // A plugin named as one: "the `keep` plugin".
    for (const [, plugin = ""] of lineText.matchAll(/`([a-z][\w-]*)` plugins?\b/g)) {
      if (!PLUGINS.has(plugin)) out.push({ line: i + 1, name: plugin, kind: "plugin" });
    }
    // Scripts named in fenced blocks too.
    for (const [, script = ""] of lineText.matchAll(/npm run ([\w:-]+)/g)) {
      if (!SCRIPTS.has(script) && !out.some((m) => m.line === i + 1 && m.kind === "script")) out.push({ line: i + 1, name: `npm run ${script}`, kind: "script" });
    }
  });
  return out;
}

for (const doc of [...DOCS, ...SPEC_CODE]) {
  test(`every name ${doc} gives exists`, () => {
    const found = misses(doc).map((m) => `${doc}:${m.line} ${m.kind} \`${m.name}\``);
    assert.deepEqual(found, [], `${doc} names what does not exist`);
  });
}

test("CLAUDE.md stays short", () => {
  const lines = read("CLAUDE.md").split("\n").length;
  assert.ok(lines <= 120, `CLAUDE.md is ${lines} lines; keep it to 120 and move the rest to the map or a plugin's README`);
});
