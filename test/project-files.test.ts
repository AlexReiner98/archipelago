import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { reconcileJson, reconcileLines, type Entry } from "../plugins/project-files/entries.ts";
import { bringTo, safeFolder, type Ledger } from "../plugins/project-files/write.ts";

const ok = <T extends object>(r: T | { error: string }): T => {
  assert.ok(!("error" in r), JSON.stringify(r));
  return r as T;
};

test("a JSON file: list items and keys added beside the person's, taken out leaving it as it was", () => {
  const theirs = { model: "x", hooks: { Stop: [{ hooks: [{ type: "command", command: "mine" }] }] }, mcpServers: { other: { url: "o" } } };
  const want: Entry[] = [
    { at: ["hooks", "Stop"], item: { hooks: [{ type: "http", url: "h" }] } },
    { at: ["hooks", "SessionStart"], item: { hooks: [{ type: "http", url: "h" }] } },
    { at: ["mcpServers"], key: "archipelago", value: { url: "m" } },
  ];
  const a = ok(reconcileJson(JSON.stringify(theirs), undefined, want));
  const on = JSON.parse(a.text!);
  assert.equal(on.hooks.Stop.length, 2, "beside the person's own");
  assert.deepEqual(Object.keys(on.mcpServers), ["other", "archipelago"]);
  assert.equal(a.ours.entries.length, 3);
  assert.ok(ok(reconcileJson(a.text, a.ours, want)).same, "again: nothing changes");
  const b = ok(reconcileJson(a.text, a.ours, []));
  assert.deepEqual(JSON.parse(b.text!), theirs, "back to what it was, an emptied list gone");
});

test("what the person already had, or changed by hand, is theirs: never claimed, never taken out", () => {
  const want: Entry[] = [{ at: ["mcpServers"], key: "archipelago", value: { url: "m" } }, { at: ["enabledMcpjsonServers"], item: "archipelago" }];
  const had = ok(reconcileJson(JSON.stringify({ enabledMcpjsonServers: ["archipelago"], mcpServers: { archipelago: { url: "theirs" } } }), undefined, want));
  assert.deepEqual(had.ours.entries, [], "both were theirs: the key's value too");
  const a = ok(reconcileJson(undefined, undefined, want));
  const edited = JSON.parse(a.text!);
  edited.mcpServers.archipelago.url = "changed";
  const b = ok(reconcileJson(JSON.stringify(edited), a.ours, []));
  assert.equal(JSON.parse(b.text!).mcpServers.archipelago.url, "changed", "changed by hand: theirs now, kept");
});

test("a file it made goes when nothing is left; a file that isn't JSON is refused", () => {
  const a = ok(reconcileJson(undefined, undefined, [{ at: ["x"], item: 1 }]));
  assert.ok(a.ours.created);
  const b = ok(reconcileJson(a.text, a.ours, []));
  assert.equal(b.text, undefined);
  assert.deepEqual(reconcileJson("[1]", undefined, []), { error: "it is not a JSON object" });
});

test("lines: added at the end, taken out leaving the rest; a file it made goes", () => {
  const want: Entry[] = [{ line: "# mark" }, { line: ".mcp.json" }];
  const a = ok(reconcileLines("*.log\n.mcp.json\n", undefined, want));
  assert.equal(a.text, "*.log\n.mcp.json\n# mark\n");
  assert.deepEqual(a.ours.entries, [{ line: "# mark" }], ".mcp.json was there already");
  assert.equal(ok(reconcileLines(a.text, a.ours, [])).text, "*.log\n.mcp.json\n");
  const made = ok(reconcileLines(undefined, undefined, want));
  assert.equal(ok(reconcileLines(made.text, made.ours, [])).text, undefined);
});

test("bringTo: writes, keeps the ledger, takes out exactly what it added, and its folder when it made it", async () => {
  const dir = await mkdtemp(join(tmpdir(), "project-files-"));
  try {
    const file = join(dir, "proj", ".claude", "settings.local.json");
    await mkdir(join(dir, "proj"));
    const ledger: Ledger = {};
    const errors: Error[] = [];
    await bringTo(ledger, new Map([[file, [{ at: ["a"], item: 1 }]]]), (e) => errors.push(e), "t");
    assert.deepEqual(JSON.parse(await readFile(file, "utf8")), { a: [1] });
    assert.ok(ledger[file]?.dir, "it made the .claude folder");
    await bringTo(ledger, new Map(), (e) => errors.push(e), "t");
    await assert.rejects(readFile(file), "the file goes");
    assert.ok(!existsSync(join(dir, "proj", ".claude")), "and the folder it made");
    assert.deepEqual(ledger, {});
    const bad = join(dir, "proj", "bad.json");
    await writeFile(bad, "not json");
    await bringTo(ledger, new Map([[bad, [{ at: ["a"], item: 1 }]]]), (e) => errors.push(e), "t");
    assert.equal(await readFile(bad, "utf8"), "not json", "left as it is");
    assert.match(errors[0]!.message, /bad\.json is left as it is/);
    assert.equal(await safeFolder(join(dir, "proj"), join(dir, "home")), true);
    assert.equal(await safeFolder(dir, join(dir, "home")), false, "a folder above the home folder");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
