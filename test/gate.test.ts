import assert from "node:assert/strict";
import { test } from "node:test";
import type { ActionInvoke } from "../spec/action.ts";
import { Runtime, type Pack } from "../runtime/core.ts";
import { Loader, type Entry } from "../runtime/loader.ts";
import action from "../packs/action/index.ts";
import graph from "../packs/graph/index.ts";
import gate, { SETUP } from "../packs/gate/index.ts";
import { goOf, offerOf, screenOf } from "../packs/gate/offer.ts";

const BASE = "mem:/packs/";
const probe: Pack = { id: "probe", inject: ["action.invoke"], apply() {} };

async function setupOf(config?: Record<string, unknown>) {
  const rt = new Runtime();
  const modules: Record<string, Pack> = { "graph.ts": graph, "action.ts": action, "gate.ts": gate, "probe.ts": probe };
  const loader = new Loader(rt, { base: BASE, import: async (url) => ({ default: modules[url.slice(BASE.length)] }) });
  const tree: Entry[] = [
    { id: "graph", pack: "graph.ts" },
    { id: "action", pack: "action.ts" },
    { id: "gate", pack: "gate.ts", ...(config ? { config } : {}) },
    { id: "probe", pack: "probe.ts" },
  ];
  await loader.apply(tree);
  await rt.settle();
  const invoke = loader.fiber("probe")!.ctx.intercept({ actor: { id: "person:1", kind: "person" } }).get<ActionInvoke>("action.invoke");
  const o = await invoke.invoke({ action: SETUP, input: {}, authority: { of: "human", basis: "test" }, reason: "test" });
  assert.ok(o.ok);
  return o.output;
}

test("the gate is off until config names a path on this origin", async () => {
  assert.deepEqual(await setupOf(), {});
  assert.deepEqual(await setupOf({ at: "/gate" }), { at: "/gate" });
  assert.deepEqual(await setupOf({ at: "https://elsewhere.example/gate" }), {}, "never another site");
  assert.deepEqual(await setupOf({ at: "//elsewhere.example/gate" }), {});
});

test("the address opens a screen, with why a provider sent the person back", () => {
  assert.deepEqual(screenOf("#gate/sign-up"), { screen: "sign-up" });
  assert.deepEqual(screenOf("#gate/sign-in?failed=Signing%20in%20was%20cancelled."), { screen: "sign-in", failed: "Signing in was cancelled." });
  assert.equal(screenOf("#gate/delete-everything"), undefined);
  assert.equal(screenOf("#field"), undefined);
  assert.equal(screenOf(""), undefined);
});

test("an offer keeps what the gate draws, and drops what would lead off this origin", () => {
  const o = offerOf({
    title: "Sign up",
    emblem: "/emblem.png",
    agree: { text: "I agree to the", docs: [{ title: "Terms", url: "https://archipelago.tools/legal/terms" }, { title: "Bad", url: "javascript:alert(1)" }] },
    providers: [{ id: "google", label: "Sign up with Google", mark: "/google.svg" }, { id: "x", label: "Elsewhere", mark: "https://evil.example/x.png" }, { label: "no id" }],
    email: { code: true, password: "yes" },
    passkey: true,
    before: [{ id: "0", label: "kim@example.com" }],
    foot: [{ text: "Have an account?", links: [{ label: "Sign in", href: "#gate/sign-in" }, { label: "Off", href: "https://evil.example" }] }],
    secret: "never drawn",
  });
  assert.equal(o.title, "Sign up");
  assert.equal(o.emblem, "/emblem.png");
  assert.deepEqual(o.agree?.docs.map((d) => d.title), ["Terms"]);
  assert.deepEqual(o.providers, [{ id: "google", label: "Sign up with Google", mark: "/google.svg" }, { id: "x", label: "Elsewhere" }]);
  assert.deepEqual(o.email, { code: true, password: false });
  assert.equal(o.passkey, true);
  assert.deepEqual(o.foot, [{ text: "Have an account?", links: [{ label: "Sign in", href: "#gate/sign-in" }] }]);
  assert.ok(!("secret" in o));
  assert.equal(offerOf(null).title, "Sign in", "nothing offered: a title and no ways in");
});

test("go leads to this origin or a provider over https, nothing else", () => {
  assert.equal(goOf("/app/"), "/app/");
  assert.equal(goOf("https://accounts.google.com/o/oauth2/v2/auth?x=1"), "https://accounts.google.com/o/oauth2/v2/auth?x=1");
  assert.equal(goOf("http://plain.example/"), undefined);
  assert.equal(goOf("javascript:alert(1)"), undefined);
  assert.equal(goOf("//evil.example/"), undefined);
});
