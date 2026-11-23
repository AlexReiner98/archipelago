import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { ACCEPTED, EDITION } from "../spec/common.ts";
import { readFrozen, surface } from "../scripts/spec-surface.ts";

const HOW =
  "An accepted meaning never changes (spec/README.md). Make the change a new capability with a new key, " +
  "or a new term, and retire the old one (`retired` on its entry); accept the edition with " +
  "`node scripts/spec-surface.ts --accept`, which adds entries and never rewrites one.";

test("every accepted part of the spec is as it was accepted", () => {
  const frozen = readFrozen();
  const now = surface();
  const changed = Object.keys(frozen.entries).filter((k) => k in now && now[k] !== frozen.entries[k]);
  const gone = Object.keys(frozen.entries).filter((k) => !(k in now));
  for (const k of changed) assert.equal(now[k], frozen.entries[k], `${k} changed. ${HOW}`);
  assert.deepEqual(gone, [], `gone from the spec: ${gone.join(", ")}. ${HOW}`);
});

test("the frozen surface is the accepted edition's, and nothing past it is accepted silently", () => {
  const frozen = readFrozen();
  assert.equal(frozen.accepted, ACCEPTED, "spec/common.ts ACCEPTED and test/spec-frozen.json disagree: accept with the script");
  assert.ok(ACCEPTED <= EDITION);
  // Entries beyond the frozen ones are an edition not accepted yet: only allowed while EDITION is past ACCEPTED.
  const fresh = Object.keys(surface()).filter((k) => !(k in frozen.entries));
  if (EDITION === ACCEPTED) assert.deepEqual(fresh, [], `new in the spec while edition ${EDITION} is accepted: raise EDITION for them (${fresh.join(", ")})`);
});

test("an edition may add a capability or retire one; changing one, or a type, shows", () => {
  const dir = mkdtempSync(join(tmpdir(), "spec-"));
  const write = (s: string) => writeFileSync(join(dir, "a.ts"), s);
  try {
    write(`/** doc */\nexport interface A { x: number }\nexport const capabilities = [{ key: "a.read", since: 1, doc: "Reads." }];\n`);
    const was = surface(dir + "/");
    // A comment, a new capability and a retirement change nothing that was there.
    write(`/** other words */\nexport interface A { x: number }\nexport const capabilities = [{ key: "a.read", since: 1, doc: "Reads.", retired: { in: 10, by: "a.read2" } }, { key: "a.read2", since: 10, doc: "Reads more." }];\n`);
    const now = surface(dir + "/");
    for (const k of Object.keys(was)) assert.equal(now[k], was[k], k);
    assert.ok("a.ts:capabilities[a.read2]" in now);
    // Widening a type, or a capability's words, is a change.
    write(`export interface A { x: number; y?: string }\nexport const capabilities = [{ key: "a.read", since: 1, doc: "Reads and more." }];\n`);
    const widened = surface(dir + "/");
    assert.notEqual(widened["a.ts:A"], was["a.ts:A"]);
    assert.notEqual(widened["a.ts:capabilities[a.read]"], was["a.ts:capabilities[a.read]"]);
    // A contract's map of capabilities grows by a key; changing a key's interface shows.
    write(`export interface Capabilities { "a.read": A }\n`);
    const map = surface(dir + "/");
    write(`export interface Capabilities { "a.read": A; "a.mark": B }\n`);
    const grown = surface(dir + "/");
    assert.equal(grown["a.ts:Capabilities[a.read]"], map["a.ts:Capabilities[a.read]"]);
    assert.ok("a.ts:Capabilities[a.mark]" in grown);
    write(`export interface Capabilities { "a.read": C }\n`);
    assert.notEqual(surface(dir + "/")["a.ts:Capabilities[a.read]"], map["a.ts:Capabilities[a.read]"]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
