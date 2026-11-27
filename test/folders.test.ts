/**
 * Plugin folders (runtime/folders.ts): a folder outside this repository
 * names its server and page entries in archipelago.json, and the page
 * server serves its files at /ext/<name>/, with this repository's package
 * name rewritten to rooted paths.
 */
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { pathToFileURL } from "node:url";
import { after, test } from "node:test";
import { foldersOf, mounts, pageEntries, readFolder, readFolders, serverEntries } from "../runtime/folders.ts";
import { serve } from "../runtime/serve.ts";
import { NodeHost } from "../runtime/node.ts";
import { Refused } from "../spec/common.ts";

const tmp = mkdtempSync(join(tmpdir(), "folders-"));
after(() => rmSync(tmp, { recursive: true, force: true }));

const folder = (name: string, manifest: unknown, files: Record<string, string> = {}) => {
  const dir = join(tmp, name);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "archipelago.json"), JSON.stringify(manifest));
  for (const [f, body] of Object.entries(files)) {
    mkdirSync(join(dir, f, ".."), { recursive: true });
    writeFileSync(join(dir, f), body);
  }
  return dir;
};

test("a folder's entries: the server's as file URLs, the page's at /ext/<name>/", () => {
  const dir = folder("design", {
    name: "design",
    server: [{ id: "solver", plugin: "solver/map.ts" }],
    page: [{ id: "solver", plugin: "solver/index.ts", config: { a: 1 } }],
  });
  const f = readFolder(dir);
  assert.equal(f.name, "design");
  assert.deepEqual(serverEntries([f]), [{ id: "solver", plugin: pathToFileURL(join(dir, "solver/map.ts")).href }]);
  assert.deepEqual(pageEntries([f]), [{ id: "solver", plugin: "/ext/design/solver/index.ts", config: { a: 1 } }]);
  assert.deepEqual(mounts([f]), { design: f.dir });
});

test("a manifest that won't do is refused, saying what to fix", () => {
  assert.throws(() => readFolder(join(tmp, "nothing-here")), /no readable archipelago\.json/);
  assert.throws(() => readFolder(folder("bad-name", { name: "Not OK" })), /"name" is lowercase/);
  assert.throws(() => readFolder(folder("escape", { name: "escape", server: [{ id: "x", plugin: "../elsewhere.ts" }] })), /not inside the folder/);
  assert.throws(() => readFolder(folder("shape", { name: "shape", page: [{ plugin: "a.ts" }] })), /an entry is \{ id, plugin \}/);
  const a = folder("one", { name: "same" }), b = folder("two", { name: "same" });
  assert.throws(() => readFolders([a, b]), /both named same/);
});

test("ARCHIPELAGO_PLUGINS names folders split by the path delimiter", () => {
  assert.deepEqual(foldersOf(undefined), []);
  assert.deepEqual(foldersOf(["/a", "/b", ""].join(delimiter)), ["/a", "/b"]);
});

test("the page server serves a folder at /ext/<name>/, lists its page entries, and serves nothing outside it", async () => {
  const root = folder("core", { name: "core" }, { "spec/thing.ts": "export const thing = 1;\n" });
  const dir = folder("apps", { name: "apps", page: [{ id: "v", plugin: "v/view.ts" }] }, {
    "v/view.ts": 'import { thing } from "archipelago/spec/thing.ts";\nimport { near } from "./near.ts";\nexport const v: number = thing + near;\n',
    "v/near.ts": "export const near = 2;\n",
  });
  writeFileSync(join(tmp, "secret.txt"), "no");
  const f = readFolder(dir);
  const s = await serve({ root, watch: false, mounts: mounts([f]), plugins: pageEntries([f]) });
  try {
    const list = await (await fetch(new URL("app/plugins.json", s.url))).json();
    assert.deepEqual(list, [{ id: "v", plugin: "/ext/apps/v/view.ts" }]);
    const view = await fetch(new URL("ext/apps/v/view.ts", s.url));
    assert.equal(view.status, 200);
    const code = await view.text();
    // The package name is served from the root; relative imports stay in the folder; types are stripped.
    assert.match(code, /from "\/spec\/thing\.ts"/);
    assert.match(code, /from "\/ext\/apps\/v\/near\.ts"/);
    assert.doesNotMatch(code, /: number/);
    assert.equal((await fetch(new URL("spec/thing.ts", s.url))).status, 200);
    assert.equal((await fetch(new URL("ext/apps/..%2F..%2Fsecret.txt", s.url))).status, 403);
    assert.equal((await fetch(new URL("ext/nobody/v/view.ts", s.url))).status, 404);
  } finally {
    await s.close();
  }
});

test("on the server, a folder's plugin imports this checkout by package name: one copy of each module", async () => {
  const dir = folder("shared", { name: "shared", server: [{ id: "probe", plugin: "probe.ts" }] }, {
    "probe.ts": 'import { Refused } from "archipelago/spec/common.ts";\nexport default { id: "probe", apply() { (globalThis as any).__folderRefused = Refused; } };\n',
  });
  const host = new NodeHost({ tree: serverEntries(readFolders([dir])), base: pathToFileURL(dir + "/").href });
  await host.start();
  await host.runtime.settle();
  try {
    assert.equal(host.loader.status().find((s) => s.id === "probe")?.state, "active");
    assert.equal((globalThis as { __folderRefused?: unknown }).__folderRefused, Refused);
  } finally {
    await host.stop();
  }
});

test("a server with no folders lists none", async () => {
  const s = await serve({ root: folder("bare", { name: "bare" }), watch: false });
  try {
    assert.deepEqual(await (await fetch(new URL("app/plugins.json", s.url))).json(), []);
  } finally {
    await s.close();
  }
});
