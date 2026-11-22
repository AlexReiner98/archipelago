/**
 * The window bar: how full the agent's context window is, over the agent in
 * focus (or one run's tree), at the playhead or live, from the context
 * pack's `context.window` (packs/context). Two thin rows share one scale,
 * the window's limit: its share by source (the map's, Claude Code's, the
 * agent's own), and by channel (hook, rule, file, context, the agent's
 * acts). A click on a share filters the tree to it, through the key's
 * filter (key.ts): a second click shows everything again.
 *
 * Also each node's state at the playhead (`windowMarks`): in the window,
 * only named in a listing, or dropped by a compaction, a mark of its own on
 * the tree (canvas.ts) and in the key.
 */
import { h } from "preact";
import { useEffect, useRef, useState } from "preact/hooks";
import htm from "htm";
import type { ActionInvoke } from "../../spec/action.ts";
import { LIMIT_MAX } from "../../spec/graph.ts";
import { sheet, v } from "../../spec/style.ts";
import { CHANNELS, shapeOf, type Filter } from "./channels.ts";
import type { KeyFilter } from "./key.ts";
import type { Tree } from "./layout.ts";

const html: (s: TemplateStringsArray, ...v: unknown[]) => any = (htm as unknown as { bind(f: typeof h): any }).bind(h);

export const WINDOW = "context.window";
/** How long a live window is kept before it is read again. */
const AGAIN_MS = 3000;
/** The most pages of parts one read takes. */
const PAGES = 10;

export type WindowState = "start" | "said" | "listed" | "dropped";
/** A node's mark on the tree: in the window (said or there from the start), listed only, dropped. */
export type WindowMark = "in" | "listed" | "dropped";

export interface WindowPart {
  id: string;
  title: string;
  source: "map" | "harness" | "agent";
  channel: "hook" | "rule" | "file" | "context" | "act";
  state: WindowState;
  tokens: number;
  count: number;
}

/** What `context.window` answers. */
export interface WindowRead {
  total: { tokens: number; from: "usage" | "estimate" };
  limit: { tokens: number; from: "model" | "seen" | "default" };
  model?: string;
  compactions: number;
  compacted?: { time?: string; trigger?: string; pre?: number; post?: number };
  sources: Record<WindowPart["source"], number>;
  channels: Record<WindowPart["channel"], number>;
  unseen: number;
  parts: WindowPart[];
}

/** Each part's mark, by tree id. A map node's acts have no tree node; their parts are left out. */
export function windowMarks(w: WindowRead | undefined): Map<string, WindowMark> {
  const out = new Map<string, WindowMark>();
  for (const p of w?.parts ?? []) {
    if (p.source === "agent") continue;
    out.set(p.id, p.state === "listed" ? "listed" : p.state === "dropped" ? "dropped" : "in");
  }
  return out;
}

/** The window's marks on the nodes this tree shows: the key lists only those. */
export function windowShown(win: ReadonlyMap<string, WindowMark>, tree: Tree): Map<string, WindowMark> {
  const out = new Map<string, WindowMark>();
  for (const t of tree.order) {
    const m = t.node ? win.get(t.node.id) : undefined;
    if (m) out.set(t.node!.id, m);
  }
  return out;
}

export const WINDOW_TIP: Record<WindowMark, string> = { in: "in the window now", listed: "only named in a listing", dropped: "dropped by a compaction" };

/** Tokens, short: 950, 12.3k, 1.2M. */
export function tok(n: number): string {
  if (n < 1000) return String(Math.round(n));
  if (n < 1_000_000) return `${(n / 1000).toFixed(n < 10_000 ? 1 : 0).replace(/\.0$/, "")}k`;
  return `${(n / 1_000_000).toFixed(2).replace(/\.?0+$/, "")}M`;
}

export interface Share {
  /** What it filters the tree to; none for the agent's acts and what isn't counted apart. */
  filter?: Filter;
  key: string;
  title: string;
  tokens: number;
  colour: string;
  tip: string;
}

/** The two rows of shares: by source, by channel, each with what usage counts beyond the parts. */
export function sharesOf(w: WindowRead): { sources: Share[]; channels: Share[] } {
  const unseen: Share[] = w.unseen > 0 ? [{ key: "unseen", title: "not counted apart", tokens: w.unseen, colour: `color-mix(in srgb, ${v("dim")} 35%, transparent)`, tip: "The model's own count over what the parts account for: prompts, replies, tool results, thinking" }] : [];
  const sources: Share[] = [
    { filter: "map" as Filter, key: "map", title: "the map's", tokens: w.sources.map, colour: v("owner"), tip: "What the map said: its nodes' words, rules' refusals" },
    { filter: "harness" as Filter, key: "harness", title: "Claude Code's", tokens: w.sources.harness, colour: v("harness"), tip: "What Claude Code gave: system prompt, tools, MCP instructions, listings, other hooks" },
    { key: "agent", title: "the agent's", tokens: w.sources.agent, colour: v("write"), tip: "What the agent did: tool calls and results, replies, a person's prompts" },
  ];
  const ink = [80, 60, 44, 30];
  const channels: Share[] = [
    ...CHANNELS.map((c, i) => ({ filter: c.channel as Filter, key: c.channel, title: `${GLYPH[shapeOf(c.channel)]} ${c.title}`, tokens: w.channels[c.channel], colour: `color-mix(in srgb, ${v("fg")} ${ink[i]}%, transparent)`, tip: `${c.title}: ${c.doc}` })),
    { key: "act", title: "acts", tokens: w.channels.act, colour: v("write"), tip: "The agent's own acts" },
  ];
  return { sources: [...sources.filter((s) => s.tokens > 0), ...unseen], channels: [...channels.filter((s) => s.tokens > 0), ...unseen] };
}

const GLYPH: Record<string, string> = { circle: "●", diamond: "◆", square: "■", triangle: "▲" };

/** Filters that a share in this row stands for: a click shows only one of them. */
const SOURCE_FILTERS: Filter[] = ["map", "harness"];
const CHANNEL_FILTERS: Filter[] = CHANNELS.map((c) => c.channel);

/** The filter's `off` after a click on `f`: only `f` of its row shows, or, if that is so already, everything. */
export function only(off: ReadonlySet<string>, f: Filter): Set<string> {
  const row = SOURCE_FILTERS.includes(f) ? SOURCE_FILTERS : CHANNEL_FILTERS;
  const want = row.filter((x) => x !== f);
  const already = want.every((x) => off.has(x)) && !off.has(f);
  const next = new Set([...off].filter((x) => !row.includes(x as Filter)));
  if (!already) for (const x of want) next.add(x);
  return next;
}

/**
 * A run's window at the playhead (`at`, an event id; absent, live), read
 * through `context.window` a page at a time, and again as `tick` moves, at
 * most every few seconds while live.
 */
export function useWindow(invoke: ActionInvoke, has: boolean, run: string | undefined, at: string | undefined, tick: unknown): WindowRead | undefined {
  const [got, setGot] = useState<{ key: string; w: WindowRead }>();
  const last = useRef<{ key: string; t: number }>({ key: "", t: 0 });
  const key = `${run ?? ""}@${at ?? ""}`;
  useEffect(() => {
    if (!has || !run) return;
    // A moment looked at doesn't change; live, read again as events come, not more often than AGAIN_MS.
    if (last.current.key === key && (at || Date.now() - last.current.t < AGAIN_MS)) return;
    last.current = { key, t: Date.now() };
    let gone = false;
    void (async () => {
      let w: WindowRead | undefined;
      let after = 0;
      for (let i = 0; i < PAGES; i++) {
        const out = await invoke.invoke({ action: WINDOW, input: { run, limit: LIMIT_MAX, ...(at ? { at } : {}), ...(after ? { after } : {}) }, authority: { of: "human", basis: "read in the sensory interface" }, reason: "Show what is in the agent's window" });
        if (!out.ok) {
          last.current.t = 0;
          return;
        }
        const o = out.output as unknown as WindowRead & { next?: number };
        w = w ? { ...w, parts: [...w.parts, ...o.parts] } : o;
        if (typeof o.next !== "number") break;
        after = o.next;
      }
      if (!gone && w) setGot({ key, w });
    })().catch(() => (last.current.t = 0));
    return () => {
      gone = true;
    };
  }, [has, key, tick]);
  // The last window read stays while the next is read, so the bar doesn't blink as the playhead moves.
  return has && run && got && got.key.startsWith(`${run}@`) ? got.w : undefined;
}

export const WINDOWBAR_STYLE = sheet(`
.hv-win { padding:var(--space-1) var(--space-4) var(--space-2); display:grid; gap:3px; min-width:0; }
.hv-win .t { display:flex; gap:var(--space-3); align-items:baseline; white-space:nowrap; color:var(--dim); font-size:var(--text-s); min-width:0; overflow:hidden; }
.hv-win .t b { color:var(--fg); font-weight:var(--bold); font-variant-numeric:tabular-nums; }
.hv-win .row { display:flex; height:6px; border-radius:2px; overflow:hidden; background:color-mix(in srgb, var(--line) 30%, transparent); }
.hv-win .row > button { height:100%; padding:0; border:0; margin:0; min-width:0; flex:none; cursor:pointer; font:inherit; }
.hv-win .row > button + button { box-shadow:inset 1px 0 0 var(--bg); }
.hv-win .row > button.plain { cursor:default; }
.hv-win .row > button:hover:not(.plain) { filter:brightness(1.25); }
.hv-win .row > button.off { opacity:.25; }
.hv-win .lg { display:flex; flex-wrap:nowrap; gap:var(--space-3); font-size:var(--text-xs); color:var(--dim); overflow:hidden; white-space:nowrap; min-width:0; }
.hv-win .lg button { font:inherit; background:none; border:0; color:inherit; padding:0; cursor:pointer; white-space:nowrap; }
.hv-win .lg button:hover { color:var(--fg); }
.hv-win .lg button.plain { cursor:default; }
.hv-win .lg button.off { text-decoration:line-through; opacity:.5; }
.hv-win .lg i { display:inline-block; width:8px; height:8px; border-radius:2px; margin-right:3px; vertical-align:-1px; }
`);

const pct = (n: number, of: number) => (of > 0 ? Math.min(100, (n / of) * 100) : 0);

/** One row of shares, on the window's scale. */
const Row = ({ shares, limit, filter, label }: { shares: Share[]; limit: number; filter?: KeyFilter; label: string }) => {
  const shown = (s: Share) => !s.filter || !filter?.off.has(s.filter);
  const click = (s: Share) => (e: Event) => {
    e.stopPropagation();
    if (s.filter && filter?.set) filter.set((off) => only(off, s.filter!));
  };
  const tip = (s: Share) => `${s.title}: ${tok(s.tokens)} tokens, ${pct(s.tokens, limit).toFixed(1)}% of the window\n${s.tip}${s.filter && filter?.set ? "\nA click shows only these on the tree; again, everything" : ""}`;
  return html`
    <div class="row" role="group" aria-label=${label}>
      ${shares.map((s) => html`<button key=${s.key} class=${`${s.filter && filter?.set ? "" : "plain"}${shown(s) ? "" : " off"}`} style=${`width:${pct(s.tokens, limit)}%;background:${s.colour}`} title=${tip(s)} onClick=${click(s)}></button>`)}
    </div>
    <div class="lg">
      ${shares.map((s) => html`<button key=${s.key} class=${`${s.filter && filter?.set ? "" : "plain"}${shown(s) ? "" : " off"}`} title=${tip(s)} onClick=${click(s)}><i style=${`background:${s.colour}`}></i>${s.title} ${tok(s.tokens)}</button>`)}
    </div>`;
};

/** The bar: how full, then the two rows. Nothing while the window isn't read. */
export const WindowBar = ({ w, filter }: { w?: WindowRead; filter?: KeyFilter }) => {
  if (!w) return "";
  const { sources, channels } = sharesOf(w);
  const full = pct(w.total.tokens, w.limit.tokens);
  const limitTip = w.limit.from === "model" ? `the window of ${w.model ?? "the model"}` : w.limit.from === "seen" ? "the long window: more than 200k was seen in it" : "the usual window; the model doesn't say";
  const totalTip = w.total.from === "usage" ? "The model's own count: the latest message's input, cache and output tokens" : "An estimate: what the parts hold, at four characters a token. The transcript has no usage yet";
  return html`<div class="hv-win" onPointerDown=${(e: Event) => e.stopPropagation()}>
    <div class="t">
      <span>window</span>
      <span title=${totalTip}>${w.total.from === "estimate" ? "≈ " : ""}<b>${tok(w.total.tokens)}</b> of <span title=${limitTip}>${tok(w.limit.tokens)}</span> · ${full.toFixed(full < 10 ? 1 : 0)}%</span>
      ${w.compactions > 0 && html`<span title=${w.compacted?.pre !== undefined ? `The last: ${tok(w.compacted.pre)} → ${tok(w.compacted.post ?? 0)} tokens${w.compacted.trigger ? `, ${w.compacted.trigger}` : ""}` : "Compacted"}>${w.compactions} compaction${w.compactions === 1 ? "" : "s"}</span>`}
    </div>
    <${Row} shares=${sources} limit=${w.limit.tokens} filter=${filter} label="by source" />
    <${Row} shares=${channels} limit=${w.limit.tokens} filter=${filter} label="by channel" />
  </div>`;
};
