/**
 * spec/README.md's contract table is the spec's, written by
 * scripts/contracts.ts: when a contract, a capability or the edition
 * changes, this fails until the table is written again.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { capabilities } from "../spec/index.ts";
import { README, contracts, written } from "../scripts/contracts.ts";

test("spec/README.md's contract table is the spec's", async () => {
  const now = readFileSync(README, "utf8").replace(/\r\n/g, "\n");
  assert.equal(now, await written(), "spec/README.md's table is stale: run node scripts/contracts.ts --write");
});

test("every contract's capabilities are declared in spec/index.ts", async () => {
  const keys = (await contracts()).flatMap((c) => c.keys.map((k) => k.key));
  assert.deepEqual([...keys].sort(), capabilities.map((c) => c.key).sort());
});
