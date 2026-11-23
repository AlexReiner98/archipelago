import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { serve } from "../runtime/serve.ts";

const root = mkdtempSync(join(tmpdir(), "cordis-serve-"));
mkdirSync(join(root, "packs"));
writeFileSync(join(root, "packs/word.ts"), `export const word: string = "hello";\n`);
writeFileSync(
  join(root, "packs/provider.ts"),
  `import type { X } from "./types.ts";\nimport { word } from "./word.ts";\nexport default { id: "p", apply(ctx: any): void { ctx.provide("k", () => word); } };\n`,
);

const server = await serve({ root });
after(() => server.close().then(() => rmSync(root, { recursive: true, force: true })));

test("serves TypeScript with its types stripped and its imports recorded", async () => {
  const res = await fetch(new URL("packs/provider.ts", server.url));
  assert.equal(res.headers.get("content-type"), "text/javascript");
  const code = await res.text();
  assert.doesNotMatch(code, /: any|: void|import type/);
  assert.match(code, /from "\/packs\/word\.ts"/);
  assert.deepEqual(server.graph.classify(["/packs/word.ts"], () => false).accepted, new Set(["/packs/word.ts", "/packs/provider.ts"]));
});

test("the root sends the browser to the app", async () => {
  const res = await fetch(server.url, { redirect: "manual" });
  assert.equal(res.status, 302);
  assert.equal(res.headers.get("location"), "/app/");
});

test("a change is pushed to pages, and importers then ask for the new version", async () => {
  const res = await fetch(new URL("@hmr", server.url));
  const reader = res.body!.getReader();
  const next = async () => {
    for (let text = ""; ; ) {
      const { value } = await reader.read();
      text += new TextDecoder().decode(value);
      const m = text.match(/data: (.*)\n\n/);
      if (m) return JSON.parse(m[1]!);
    }
  };
  await reader.read(); // the greeting comment
  writeFileSync(join(root, "packs/word.ts"), `export const word: string = "hej";\n`);
  const event = await next();
  assert.deepEqual(event.accepted.sort(), ["/packs/provider.ts", "/packs/word.ts"]);
  assert.deepEqual(event.versions, { "/packs/provider.ts": 1, "/packs/word.ts": 1 });
  const code = await (await fetch(new URL("packs/provider.ts?v=1", server.url))).text();
  assert.match(code, /from "\/packs\/word\.ts\?v=1"/);
  await reader.cancel();
});
