/**
 * Which given tools runs use, and what a lean profile leaves out, on the
 * given nodes: from the used pack's `used.tools` (in how many runs a tool
 * or MCP server was given, and used) and the lean pack's `lean.plan` (what
 * each profile the run is in would leave out). Without those packs a given
 * node simply has neither.
 *
 * On the tree: a tool or server never used is a hollow orange dot
 * (`rx-unused`); one a profile would leave out is marked as a shadow's hold,
 * and as held once it is written into the run's project settings.
 */
import { h } from "preact";
import { useState } from "preact/hooks";
import htm from "htm";
import type { ActionInvoke } from "../../spec/action.ts";

const html: (s: TemplateStringsArray, ...v: unknown[]) => any = (htm as unknown as { bind(f: typeof h): any }).bind(h);

export const USED = "used.tools";
export const PLAN = "lean.plan";
export const SET = "lean.set";
export const WRITING = "lean-write.status";
/** How long a run's use and plan are kept before they are asked again. */
export const USE_MS = 20_000;

/** In how many runs it was given, and used, and its size. */
export interface Use {
  given: number;
  used: number;
  size: number;
  /** Of how many runs with a transcript. */
  runs: number;
}

/** A profile that would leave a given node out. */
export interface Out {
  profile: string;
  title: string;
  state: string;
  /** It is in the profile's `leave_out`. */
  set: boolean;
  /** Set, on, and the server writes: the run's project settings leave it out. */
  applied: boolean;
  /** What the profile leaves out in all: how many, and their letters. */
  count: number;
  letters: number;
}

/** What `lean.plan` answers per profile. */
export interface PlanRow {
  profile: string;
  title: string;
  state: string;
  runs: number;
  enough: boolean;
  leave: { name: string; given: number; size: number }[];
  letters: number;
  set: string[];
}

export interface Extras {
  use: Map<string, Use>;
  plans: PlanRow[];
  writing: boolean;
}

/** The tool and server names a run's given rows count, with each MCP tool's server. */
export function useNames(names: string[]): string[] {
  const out = new Set<string>();
  for (const n of names) {
    if (n.startsWith("mcp:")) out.add(n);
    else if (n.startsWith("tool:")) {
      out.add(n);
      const s = serverOf(n);
      if (s) out.add(`mcp:${s}`);
    }
  }
  return [...out];
}

/** A tool's MCP server (`tool:mcp__<server>__<tool>`), or nothing. */
export function serverOf(name: string): string | undefined {
  return /^tool:mcp__(.+?)__.+$/.exec(name)?.[1];
}

/** The use of a given node by name, and its server's. */
export function useOf(extras: Extras | undefined, name: string): { use?: Use; server?: Use & { name: string } } {
  if (!extras) return {};
  const use = extras.use.get(name);
  const s = serverOf(name);
  const su = s ? extras.use.get(`mcp:${s}`) : undefined;
  return { ...(use ? { use } : {}), ...(su ? { server: { ...su, name: s! } } : {}) };
}

/** The first profile that would leave the node out (itself, or its server), or nothing. */
export function outOf(extras: Extras | undefined, name: string): Out | undefined {
  if (!extras) return undefined;
  const s = serverOf(name);
  const names = [name, ...(s ? [`mcp:${s}`] : [])];
  for (const p of extras.plans) {
    const hit = names.find((n) => p.leave.some((l) => l.name === n) || p.set.includes(n));
    if (!hit) continue;
    const set = p.set.includes(hit);
    return { profile: p.profile, title: p.title, state: p.state, set, applied: set && p.state === "on" && extras.writing, count: p.leave.length, letters: p.letters };
  }
  return undefined;
}

const ask = (invoke: ActionInvoke, action: string, input: object, reason: string) =>
  invoke.invoke({ action, input: input as never, authority: { of: "human", basis: "read in the sensory interface" }, reason });

/** Reads a run's extras: the use of its tools and servers, the plans of its profiles, and whether the server writes. */
export async function readExtras(invoke: ActionInvoke, run: string, names: string[]): Promise<Extras> {
  const use = new Map<string, Use>();
  const want = useNames(names).slice(0, 500);
  const [u, p, w] = await Promise.all([
    want.length ? ask(invoke, USED, { names: want }, "Show which given tools runs use").catch(() => undefined) : undefined,
    ask(invoke, PLAN, { run }, "Show what a lean profile would leave out").catch(() => undefined),
    ask(invoke, WRITING, {}, "Show whether lean profiles are written").catch(() => undefined),
  ]);
  if (u?.ok) {
    const o = u.output as { runs: number; tools: { name: string; given: number; used: number; size: number }[] };
    for (const t of o.tools ?? []) use.set(t.name, { given: t.given, used: t.used, size: t.size, runs: o.runs });
  }
  const plans = p?.ok ? ((p.output as { plans?: PlanRow[] }).plans ?? []) : [];
  return { use, plans, writing: !!w?.ok };
}

/** Letters, short: 950, 36k, 1.2M. */
export function letters(n: number): string {
  if (n < 1000) return String(n);
  if (n < 1_000_000) return `${Math.round(n / 1000)}k`;
  return `${(n / 1_000_000).toFixed(1)}M`;
}

/** "used in 3 of 40 runs · 36k letters". */
export const useLine = (u: Use) => `used in ${u.used} of ${u.given} run${u.given === 1 ? "" : "s"} · ${letters(u.size)} letters`;

/** The given pane's rows for use and leaving out, with the click that sets or clears what the profile leaves out. */
export function UseRows({ invoke, use, server, out, canSet }: { invoke: ActionInvoke; use?: Use; server?: Use & { name: string }; out?: Out; canSet: boolean }) {
  const [said, setSaid] = useState<{ mark: string; why: string } | undefined>();
  const [isSet, setIsSet] = useState<boolean | undefined>(undefined);
  const nowSet = isSet ?? out?.set ?? false;
  const flip = () => {
    if (!out) return;
    void ask(invoke, SET, nowSet ? { profile: out.profile, leave: [] } : { profile: out.profile }, nowSet ? `Bring back what ${out.title} leaves out` : `Leave out what ${out.title}'s runs never use`).then((o) => {
      if (!o.ok) return setSaid({ mark: "not set", why: o.refused.message });
      setIsSet(!nowSet);
      setSaid(nowSet ? { mark: "brought back", why: "Nothing is left out now" } : { mark: "set", why: out.state === "on" ? "Written into its runs' project settings while the server writes" : "Written once the profile is on and the server writes" });
    });
  };
  // The point first, so a narrow pane still shows it: left out or would be, and by which profile.
  const line = out ? `${nowSet && out.applied ? "left out" : nowSet ? "set to leave out" : "would leave out"} · ${out.title} · ${out.count} in all, ${letters(out.letters)} letters` : "";
  const of = use ? `${useLine(use)}\nOf the newest ${use.runs} runs with a transcript, the ${use.given} that were given it` : "";
  return html`
    ${use && html`<div class="hv-kv"><span class="k">use</span><span class="v" title=${of}>${use.used === 0 ? html`<b>never used</b> · ${use.given} run${use.given === 1 ? "" : "s"} · ${letters(use.size)} letters` : useLine(use)}</span></div>`}
    ${server && html`<div class="hv-kv"><span class="k">server</span><span class="v" title="Its MCP server: used when any of its tools is">${server.name}: ${useLine(server)}</span></div>`}
    ${out && html`<div class="hv-kv"><span class="k">lean</span><span class="v" title=${`${line}\n${out.title} is ${out.state}${out.applied ? ", and its runs' project settings leave these out" : ""}.\nWhat a profile leaves out of Claude Code's context: the tools and servers its runs never use. Written into its runs' project settings only while it is on and the server writes.`}>${line}</span>${canSet && html`<button class="hv-fold" title=${nowSet ? "Take it out of what the profile leaves out" : "Record it as what the profile leaves out: written while the profile is on and the server writes"} onClick=${flip}>${nowSet ? "bring back" : "leave out"}</button>`}${said && html`<span class="hv-dim hv-cut" title=${said.why}>${said.mark}</span>`}</div>`}
  `;
}
