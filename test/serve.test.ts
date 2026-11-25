import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { serve } from "../runtime/serve.ts";

const root = mkdtempSync(join(tmpdir(), "cordis-serve-"));
mkdirSync(join(root, "plugins"));
writeFileSync(join(root, "plugins/word.ts"), `export const word: string = "hello";\n`);
writeFileSync(
  join(root, "plugins/provider.ts"),
  `import type { X } from "./types.ts";\nimport { word } from "./word.ts";\nexport default { id: "p", apply(ctx: any): void { ctx.provide("k", () => word); } };\n`,
);

const server = await serve({ root });
after(() => server.close().then(() => rmSync(root, { recursive: true, force: true })));

test("serves TypeScript with its types stripped and its imports recorded", async () => {
  const res = await fetch(new URL("plugins/provider.ts", server.url));
  assert.equal(res.headers.get("content-type"), "text/javascript");
  const code = await res.text();
  assert.doesNotMatch(code, /: any|: void|import type/);
  assert.match(code, /from "\/plugins\/word\.ts"/);
  assert.deepEqual(server.graph.classify(["/plugins/word.ts"], () => false).accepted, new Set(["/plugins/word.ts", "/plugins/provider.ts"]));
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
  writeFileSync(join(root, "plugins/word.ts"), `export const word: string = "hej";\n`);
  const event = await next();
  assert.deepEqual(event.accepted.sort(), ["/plugins/provider.ts", "/plugins/word.ts"]);
  assert.deepEqual(event.versions, { "/plugins/provider.ts": 1, "/plugins/word.ts": 1 });
  const code = await (await fetch(new URL("plugins/provider.ts?v=1", server.url))).text();
  assert.match(code, /from "\/plugins\/word\.ts\?v=1"/);
  await reader.cancel();
});

test("files: a raster image in the folder is served at /files/; nothing else is", async () => {
  const dir = mkdtempSync(join(tmpdir(), "cordis-files-"));
  mkdirSync(join(dir, "files"));
  // A 1x1 PNG: neutral bytes, enough for the type.
  writeFileSync(join(dir, "files", "dot.png"), Buffer.from("89504e470d0a1a0a", "hex"));
  writeFileSync(join(dir, "files", "draw.svg"), "<svg/>");
  writeFileSync(join(dir, "secret.png"), "x");
  const s = await serve({ root, files: join(dir, "files"), watch: false });
  try {
    const ok = await fetch(new URL("files/dot.png", s.url));
    assert.equal(ok.status, 200);
    assert.equal(ok.headers.get("content-type"), "image/png");
    assert.equal((await ok.arrayBuffer()).byteLength, 8);
    assert.equal((await fetch(new URL("files/none.png", s.url))).status, 404);
    assert.equal((await fetch(new URL("files/draw.svg", s.url))).status, 403);
    assert.equal((await fetch(new URL("files/..%2Fsecret.png", s.url))).status, 403);
    // Without the option, /files/ is the repository's like any path.
    assert.equal((await fetch(new URL("files/dot.png", server.url))).status, 404);
  } finally {
    await s.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
