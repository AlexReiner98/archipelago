/**
 * The reference, read from a running runtime: one entry per loaded pack,
 * with what it injects and provides (and the spec contract each key is in),
 * the actions it declared, the places its nodes speak at, the slots it
 * declares and fills, its config, what it says it is for (`about`) and
 * whether it was loaded from this repository. Nothing here is typed by hand: every
 * field comes from the fibers, the registries and the spec's own lists.
 *
 * Isomorphic and pure over what it is handed, so the server pack, the page
 * and the tests read the same way.
 */
import type { ActionInfo } from "../../spec/action.ts";
import type { NodeInfo } from "../../spec/agent.ts";
import type { Capability, Dispose, Json } from "../../spec/common.ts";
import type { SlotRead } from "../../spec/slot.ts";
import type { Fiber, Runtime } from "../../runtime/core.ts";
import * as action from "../../spec/action.ts";
import * as agent from "../../spec/agent.ts";
import * as exchange from "../../spec/exchange.ts";
import * as graph from "../../spec/graph.ts";
import * as here from "../../spec/here.ts";
import * as profile from "../../spec/profile.ts";
import * as scene from "../../spec/scene.ts";
import * as slot from "../../spec/slot.ts";
import * as types from "../../spec/types.ts";

/** Each spec contract by its file name (spec/<contract>.md), with its capabilities. */
export const CONTRACTS: Record<string, Capability[]> = {
  graph: graph.capabilities,
  action: action.capabilities,
  agent: agent.capabilities,
  exchange: exchange.capabilities,
  slot: slot.capabilities,
  scene: scene.capabilities,
  here: here.capabilities,
  types: types.capabilities,
  profile: profile.capabilities,
};

/** A capability key as a pack uses it: the spec contract it is in, or none (a pack's own key). */
export interface KeyDoc {
  key: string;
  contract?: string;
  since?: number;
  doc?: string;
  retired?: boolean;
}

export interface PlaceDoc {
  place: string;
  /** How many of the pack's nodes speak there. */
  nodes: number;
}

export const KEY = "docs.read";

/** `docs.read`: the docs pack's own key, like `verdict.read`. */
export interface DocsRead {
  packs(): Promise<PackDoc[]>;
  watch(on: () => void): Dispose;
}

export interface PackDoc {
  id: string;
  /** What it is for, in one plain sentence: the pack declares it (`about`). */
  about?: string;
  /** Loaded from this repository, not added from elsewhere. */
  builtIn?: boolean;
  /** The folder its module is in (`packs/<folder>/`): packs in one folder are one to a person. */
  folder?: string;
  /** What it did in the newest run. */
  activity?: Activity;
  /** The packs it stands on, and those that use it, by card name: set when packs are joined (cards.ts). */
  uses?: string[];
  users?: string[];
  /** The kinds of item and link it defines. */
  types?: { name: string; base?: string; doc?: string; count?: number; more?: boolean }[];
  /** Which runtime it runs in. */
  side: string;
  state: string;
  position: number[];
  /** Injected keys nothing provides now. */
  missing?: string[];
  error?: string;
  inject: KeyDoc[];
  provides: KeyDoc[];
  actions: Pick<ActionInfo, "name" | "title" | "doc" | "input">[];
  places: PlaceDoc[];
  /** Slots it declares and fills, in a page. */
  slots?: { declares: { name: string; merge: string; doc?: string }[]; fills: { slot: string; name: string; title?: string }[] };
  config?: Json;
  /** Packs it loaded as its own children. */
  parts?: string[];
}

/** What a pack did in one run, from the exchange: its nodes' says and refusals, and the acts of its actions. */
export interface Activity {
  run: string;
  said: number;
  refused: number;
  acted: number;
}

/** Each pack's activity in one run's events. */
export function activityOf(run: string, events: { kind: string; pack?: string }[]): Map<string, Activity> {
  const out = new Map<string, Activity>();
  for (const e of events) {
    if (!e.pack) continue;
    const a = out.get(e.pack) ?? { run, said: 0, refused: 0, acted: 0 };
    if (e.kind === "say") a.said++;
    else if (e.kind === "refuse") a.refused++;
    else if (e.kind === "act") a.acted++;
    else continue;
    out.set(e.pack, a);
  }
  return out;
}

/** The folder a pack's module is in: `packs/<folder>/…`. */
export function folderOf(source: string | undefined): string | undefined {
  return source?.match(/\/packs\/([^/]+)\/[^/]+$/)?.[1];
}

export interface Sources {
  side: string;
  actions?: ActionInfo[];
  nodes?: NodeInfo[];
  slots?: SlotRead;
  types?: { types: { name: string; base: string; doc?: string; pack: string }[]; links: { name: string; doc?: string; pack: string }[] };
  /** This repository's root URL: a pack loaded from under it is built in. */
  root?: string;
}

const BY_KEY = new Map<string, KeyDoc>();
for (const [contract, caps] of Object.entries(CONTRACTS)) {
  for (const c of caps) BY_KEY.set(c.key, { key: c.key, contract, since: c.since, doc: c.doc, ...(c.retired ? { retired: true } : {}) });
}

/** A key with its contract, when the spec owns it. */
export const keyDoc = (key: string): KeyDoc => BY_KEY.get(key) ?? { key };

/** Config fields whose value is never shown: a secret's name says so. */
const SECRET = /token|secret|password|passphrase|api_?key|auth|cookie/i;

/** Config as JSON a page can show: functions named, secrets hidden, depth bounded. */
export function shownConfig(value: unknown, depth = 0): Json | undefined {
  if (value === undefined) return undefined;
  if (value === null || typeof value === "string" || typeof value === "number" || typeof value === "boolean") return value;
  if (typeof value === "function") return "ƒ";
  if (depth > 4) return "…";
  if (Array.isArray(value)) return value.slice(0, 50).map((v) => shownConfig(v, depth + 1) ?? null);
  if (typeof value === "object") {
    const out: { [k: string]: Json } = {};
    for (const [k, v] of Object.entries(value as object)) {
      if (SECRET.test(k)) out[k] = "•••";
      else {
        const s = shownConfig(v, depth + 1);
        if (s !== undefined) out[k] = s;
      }
    }
    return out;
  }
  return String(value);
}

const top = (f: Fiber): Fiber => {
  let at = f;
  while (at.parent && at.parent !== at.runtime.rootFiber) at = at.parent;
  return at;
};

const before = (a: number[], b: number[]) => {
  for (let i = 0; i < Math.min(a.length, b.length); i++) if (a[i] !== b[i]) return a[i]! - b[i]!;
  return a.length - b.length;
};

/** Every pack loaded in `runtime` now, in config-tree order. */
export function reference(runtime: Runtime, src: Sources): PackDoc[] {
  const groups = new Map<Fiber, Fiber[]>();
  for (const f of runtime.fibers) {
    if (f === runtime.rootFiber) continue;
    const t = top(f);
    groups.set(t, [...(groups.get(t) ?? []), f]);
  }
  const slots = src.slots?.slots() ?? [];
  const docs: PackDoc[] = [];
  for (const [f, all] of groups) {
    const ids = new Set(all.map((x) => x.pack.id));
    const missing = f.state === "inactive" && !f.disabled ? f.missing() : [];
    const state = f.disabled && f.state === "inactive" ? "off" : missing.length ? "waiting" : f.state;
    const provides = [...new Set(all.flatMap((x) => x.provided()))].sort();
    const inject = [...new Set(all.flatMap((x) => x.inject))];
    const counts = new Map<string, number>();
    for (const n of src.nodes ?? []) if (ids.has(n.pack)) for (const p of n.at) counts.set(p, (counts.get(p) ?? 0) + 1);
    const types = src.types
      ? [
          ...src.types.types.filter((t) => ids.has(t.pack)).map((t) => ({ name: t.name, ...(t.base !== t.name ? { base: t.base } : {}), ...(t.doc ? { doc: t.doc } : {}) })),
          ...src.types.links.filter((l) => ids.has(l.pack)).map((l) => ({ name: l.name, base: "link", ...(l.doc ? { doc: l.doc } : {}) })),
        ]
      : [];
    const about = f.pack.about;
    const builtIn = src.root && f.source ? f.source.startsWith(src.root) : undefined;
    const folder = folderOf(f.source);
    const doc: PackDoc = {
      id: f.pack.id,
      ...(about ? { about } : {}),
      ...(builtIn !== undefined ? { builtIn } : {}),
      ...(folder ? { folder } : {}),
      ...(types.length ? { types } : {}),
      side: src.side,
      state,
      position: f.position(),
      ...(missing.length ? { missing } : {}),
      ...(f.error ? { error: String((f.error as Error).message ?? f.error) } : {}),
      inject: inject.map(keyDoc),
      provides: provides.map(keyDoc),
      actions: (src.actions ?? [])
        .filter((a) => ids.has(a.pack))
        .map((a) => ({ name: a.name, title: a.title, ...(a.doc ? { doc: a.doc } : {}), input: a.input })),
      places: [...counts].map(([place, nodes]) => ({ place, nodes })).sort((a, b) => b.nodes - a.nodes || a.place.localeCompare(b.place)),
    };
    if (src.slots) {
      const declares = slots.filter((s) => ids.has(s.pack)).map((s) => ({ name: s.name, merge: s.merge, ...(s.doc ? { doc: s.doc } : {}) }));
      const fills = [...new Set(slots.map((s) => s.name))].flatMap((name) =>
        src.slots!.fills(name).filter((x) => ids.has(x.pack)).map((x) => ({ slot: x.slot, name: x.name, ...(x.title ? { title: x.title } : {}) })),
      );
      if (declares.length || fills.length) doc.slots = { declares, fills };
    }
    const config = shownConfig(f.config);
    if (config !== undefined) doc.config = config;
    const parts = all.filter((x) => x !== f).map((x) => x.pack.id);
    if (parts.length) doc.parts = parts;
    docs.push(doc);
  }
  return docs.sort((a, b) => before(a.position, b.position));
}

/** What `reference` gives, as a digest: changes when a pack comes, goes, or changes state or registrations. */
export const digest = (runtime: Runtime) =>
  [...runtime.fibers].map((f) => `${f.uid}:${f.state}:${f.disabled}:${f.provided().length}`).join(",");
