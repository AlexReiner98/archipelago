import assert from "node:assert/strict";
import { test } from "node:test";
import { Runtime } from "../runtime/core.ts";
import { Loader } from "../runtime/loader.ts";
import operate, { operateSheet } from "../plugins/operate/view.ts";

/** Each rule's selector list, outside @media lines: what the sheet styles. */
const selectors = (css: string) =>
  [...css.matchAll(/([^{}]+)\{/g)].map((m) => m[1]!.trim()).filter((s) => s && !s.startsWith("@"));

test("every rule stays inside its scope", () => {
  const css = operateSheet(".gm");
  const sel = selectors(css);
  assert.ok(sel.length > 20, "it styles the page");
  for (const list of sel) for (const one of list.split(",")) assert.match(one.trim(), /^body \.gm(\s|$|::|:)/, `outside the scope: ${one.trim()}`);
  // Another scope moves all of it.
  assert.ok(selectors(operateSheet(".other")).every((l) => l.split(",").every((s) => s.trim().startsWith("body .other"))));
});

test("a scope that isn't one class selector is refused", () => {
  for (const bad of ["body", ".gm, .x", ".gm }", "*", "#id"]) assert.throws(() => operateSheet(bad), /one class selector/);
});

test("colours are the style's tokens or mixes of them, and motion is short and for state", () => {
  const css = operateSheet();
  assert.doesNotMatch(css, /#[0-9a-f]{3,8}\b|rgba?\(|hsla?\(/i, "no colour of its own");
  for (const [, ms] of css.matchAll(/(\d+)ms/g)) assert.ok(Number(ms) >= 150 && Number(ms) <= 250, `${ms}ms`);
  assert.match(css, /prefers-reduced-motion: reduce\)[^}]*\{[^}]*transition: none/);
  assert.match(css, /:focus-visible[^{]*\{\s*outline: 2px solid var\(--pick\)/, "a visible keyboard focus");
  assert.match(css, /\.gm-h \{ text-transform: none/, "no all-caps label");
});

test("loaded, its sheet is on the page; unloaded, it is gone", async () => {
  const g = globalThis as Record<string, unknown>;
  const was = g.document;
  const head: { children: { remove(): void; textContent: string; dataset: Record<string, string> }[]; append(el: never): void } = {
    children: [],
    append(el) {
      head.children.push(el);
    },
  };
  g.document = {
    head,
    createElement: () => {
      const el = { textContent: "", dataset: {} as Record<string, string>, remove: () => head.children.splice(head.children.indexOf(el), 1) };
      return el;
    },
  };
  const rt = new Runtime();
  const loader = new Loader(rt, { base: "mem:/", import: async () => ({ default: operate }) });
  try {
    await loader.apply([{ id: "operate", plugin: "operate.ts", config: { scope: ".gm" } }]);
    await rt.settle();
    assert.equal(head.children.length, 1);
    assert.equal(head.children[0]!.dataset.plugin, "operate");
    assert.match(head.children[0]!.textContent, /^\s*body \.gm \{/);
    await loader.apply([]);
    assert.equal(head.children.length, 0, "unloading takes it out");
  } finally {
    await loader.apply([]);
    g.document = was;
  }
});
