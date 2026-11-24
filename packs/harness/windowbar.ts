/**
 * The window bar: how full the agent's context window is, under the agent in
 * focus (or one run's tree), at the playhead or live, from the context
 * pack's `context.window` (packs/context). Two thin rows share one scale,
 * the window's limit: its share by source (the map's, Claude Code's, the
 * agent's own), and by channel (hook, rule, file, context, the agent's
 * acts). A click on a share filters the tree to it, through the key's
 * filter (key.ts): a second click shows everything again.
 *
 * A third row is what the map controls alone, node by node, on a scale of
 * its own (the map's whole share): each node it said, or listed, in its
 * channel's hue (`CHANNEL_HUE`), biggest first; a click picks the node (`mapShares`).
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
import { nameOf, type Tree } from "./layout.ts";

const html: (s: TemplateStringsArray, ...v: unknown[]) => any = (htm as unknown as { bind(f: typeof h): any }).bind(h);

export const WINDOW = "context.window";
/**
 * Each channel's hue, so the channel row's shares tell apart, and the map's own row says by what channel each of
 * its nodes came in. The pack hues, minus the map's own purple; the agent's acts keep the exchange's write.
 */
export const CHANNEL_HUE: Record<WindowPart["channel"], string> = {
  hook: v("hue-1"),
  rule: v("hue-4"),
  file: v("hue-2"),
  context: v("hue-6"),
  talk: v("hue-3"),
  act: v("write"),
};

/** How long a live window is kept before it is read again. */
const AGAIN_MS = 3000;
/** The most pages of parts one read takes. */
const PAGES = 10;

export type WindowState = "start" | "said" | "listed" | "dropped";

/**
 * How sure a number is: measured (the model's own count: no mark), fitted
 * (shared out from the model's real counts by size: `~`), estimated (four
 * characters a token: `≈`), or partly fitted (`~≈`), the tooltip giving the
 * split. In the bar, a share's fitted part is solid and the rest faded.
 */
export type Sure = "measured" | "fitted" | "partly" | "estimated";
export const SURE: Record<Sure, { mark: string; text: string; tip: string }> = {
  measured: { mark: "", text: "measured", tip: "Measured: the model's own count" },
  fitted: { mark: "~", text: "fitted", tip: "Fitted: shared out from the model's real counts (each message's output, the window's growth between requests), by size" },
  partly: { mark: "~≈", text: "partly fitted", tip: "Partly fitted to the model's real counts, the rest estimated at four characters a token" },
  estimated: { mark: "≈", text: "estimated", tip: "Estimated: four characters a token" },
};
/** Within a hundredth either way reads as all or nothing. */
export const sureOf = (tokens: number, fitted = 0): Sure => (tokens <= 0 || fitted <= tokens * 0.01 ? "estimated" : fitted >= tokens * 0.99 ? "fitted" : "partly");
/** A number with its mark, and what the mark means with the split. */
export function sure(tokens: number, fitted = 0): { text: string; tip: string } {
  const s = sureOf(tokens, fitted);
  const split = fitted > 0 && fitted < tokens ? `\n${tok(fitted)} fitted, ${tok(tokens - fitted)} estimated` : "";
  return { text: `${SURE[s].mark}${tok(tokens)}`, tip: `${SURE[s].tip}${split}` };
}
/** A node's mark on the tree: in the window (said or there from the start), listed only, dropped. */
export type WindowMark = "in" | "listed" | "dropped";

export interface WindowPart {
  id: string;
  title: string;
  source: "map" | "harness" | "agent";
  channel: "hook" | "rule" | "file" | "context" | "talk" | "act";
  state: WindowState;
  tokens: number;
  count: number;
  /** Of its tokens, fitted to the model's real counts. */
  fitted?: number;
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
  /** Of those, fitted to the model's real counts. */
  fitted?: { sources: Record<WindowPart["source"], number>; channels: Record<WindowPart["channel"], number> };
  unseen: number;
  parts: WindowPart[];
}

/** Each part's mark, by tree id. The run's own acts have no tree node; their parts are left out. */
export function windowMarks(w: WindowRead | undefined): Map<string, WindowMark> {
  const out = new Map<string, WindowMark>();
  for (const p of w?.parts ?? []) {
    if (p.channel === "act" || p.id.endsWith("#dropped")) continue;
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
  /** Of its tokens, fitted; absent for what is measured (what isn't counted apart). */
  fitted?: number;
}

/** The two rows of shares: by source, by channel, each with what usage counts beyond the parts. */
export function sharesOf(w: WindowRead): { sources: Share[]; channels: Share[] } {
  const unseen: Share[] = w.unseen > 0 ? [{ key: "unseen", title: "not counted apart", tokens: w.unseen, colour: `color-mix(in srgb, ${v("dim")} 35%, transparent)`, tip: "Measured: the model's own count less what the parts account for: what the transcript doesn't show, and the estimates' error" }] : [];
  const fs = w.fitted?.sources;
  const fc = w.fitted?.channels;
  const sources: Share[] = [
    { filter: "map" as Filter, key: "map", title: "the map's", tokens: w.sources.map, fitted: fs?.map ?? 0, colour: v("owner"), tip: "What the map said: its nodes' words, rules' refusals" },
    { filter: "harness" as Filter, key: "harness", title: "Claude Code's", tokens: w.sources.harness, fitted: fs?.harness ?? 0, colour: v("harness"), tip: "What Claude Code gave: system prompt, tools, MCP instructions, listings, other hooks" },
    w.channels.talk > 0
      ? { filter: "talk" as Filter, key: "agent", title: "the conversation", tokens: w.sources.agent, fitted: fs?.agent ?? 0, colour: v("write"), tip: "The conversation since the start: your prompts, Claude's replies and thinking, tool calls and results, Claude Code's notes" }
      : { key: "agent", title: "the agent's", tokens: w.sources.agent, fitted: fs?.agent ?? 0, colour: v("write"), tip: "What the agent did: tool calls and results, replies, a person's prompts" },
  ];
  const channels: Share[] = [
    ...CHANNELS.map((c, i) => ({ filter: c.channel as Filter, key: c.channel, title: `${GLYPH[shapeOf(c.channel)]} ${c.title}`, tokens: w.channels[c.channel], fitted: fc?.[c.channel] ?? 0, colour: CHANNEL_HUE[c.channel], tip: `${c.title}: ${c.doc}` })),
    { key: "act", title: "acts", tokens: w.channels.act, fitted: 0, colour: CHANNEL_HUE.act, tip: "The agent's own acts" },
  ];
  return { sources: [...sources.filter((s) => s.tokens > 0), ...unseen], channels: [...channels.filter((s) => s.tokens > 0), ...unseen] };
}

const GLYPH: Record<string, string> = { circle: "●", diamond: "◆", square: "■", triangle: "▲", hexagon: "⬢" };

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
        const out = await invoke.invoke({ action: WINDOW, input: { run, limit: LIMIT_MAX, ...(at ? { at } : {}), ...(after ? { after } : {}) }, authority: { of: "human", basis: "read in the context interface" }, reason: "Show what is in the agent's window" });
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
.hv-win { padding:var(--space-2) var(--space-4) var(--space-3); display:grid; gap:3px; min-width:0; border-top:1px solid var(--line); }
.hv-win .t { display:flex; gap:var(--space-3); align-items:baseline; white-space:nowrap; color:var(--dim); font-size:var(--text-s); min-width:0; overflow:hidden; }
.hv-win .hv-whead { font:inherit; background:none; border:0; color:inherit; padding:0; cursor:pointer; }
.hv-win .hv-whead:hover { color:var(--fg); }
.hv-win .t b { color:var(--fg); font-weight:var(--bold); font-variant-numeric:tabular-nums; }
.hv-win .row { display:flex; height:6px; border-radius:2px; overflow:hidden; background:color-mix(in srgb, var(--line) 30%, transparent); }
.hv-win .row > button { height:100%; padding:0; border:0; margin:0; min-width:0; flex:none; cursor:pointer; font:inherit; }
.hv-win .row > button + button { box-shadow:inset 1px 0 0 var(--bg); }
.hv-win .row > button.plain { cursor:default; }
.hv-win .row > button:hover:not(.plain) { filter:brightness(1.25); }
.hv-win .row > button.off { opacity:.25; }
.hv-win .t.mine { margin-top:var(--space-1); }
.hv-win .row > button.listed { opacity:.45; }
.hv-win .row > button.on { box-shadow:inset 0 0 0 1.5px var(--fg); }
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
  // Its fitted part solid, the estimated rest faded; what is measured, solid.
  const fill = (s: Share) => {
    if (s.fitted === undefined || s.tokens <= 0) return s.colour;
    const f = Math.min(100, (s.fitted / s.tokens) * 100).toFixed(1);
    const faded = `color-mix(in srgb, ${s.colour} 40%, transparent)`;
    return `linear-gradient(to right, ${s.colour} 0 ${f}%, ${faded} ${f}% 100%)`;
  };
  const num = (s: Share) => (s.fitted === undefined ? { text: tok(s.tokens), tip: SURE.measured.tip } : sure(s.tokens, s.fitted));
  const tip = (s: Share) => `${s.title}: ${num(s).text} tokens, ${pct(s.tokens, limit).toFixed(1)}% of the window\n${s.tip}\n${num(s).tip}${s.filter && filter?.set ? "\nA click shows only these on the tree; again, everything" : ""}`;
  return html`
    <div class="row" role="group" aria-label=${label}>
      ${shares.map((s) => html`<button key=${s.key} class=${`${s.filter && filter?.set ? "" : "plain"}${shown(s) ? "" : " off"}`} style=${`width:${pct(s.tokens, limit)}%;background:${fill(s)}`} title=${tip(s)} onClick=${click(s)}></button>`)}
    </div>
    <div class="lg">
      ${shares.map((s) => html`<button key=${s.key} class=${`${s.filter && filter?.set ? "" : "plain"}${shown(s) ? "" : " off"}`} title=${tip(s)} onClick=${click(s)}><i style=${`background:${s.colour}`}></i>${s.title} ${num(s).text}</button>`)}
    </div>`;
};

/** The bar: how full, then the two rows. Nothing while the window isn't read. */
/** One of the map's nodes in the window: its tokens, its pack, and the channel it came in by (its hue). */
export interface MapShare {
  id: string;
  title: string;
  pack: string;
  channel: WindowPart["channel"];
  tokens: number;
  state: WindowState;
}

/** What the map controls in the window, node by node, biggest first: said or listed, never dropped. Named as the tree names them, never a path. */
export function mapShares(w: WindowRead): MapShare[] {
  return w.parts
    .filter((p) => p.source === "map" && p.state !== "dropped" && p.tokens > 0)
    .map((p) => ({ id: p.id, title: nameOf(p.title), pack: p.id.includes("/") ? p.id.slice(0, p.id.indexOf("/")) : p.id, channel: p.channel, tokens: p.tokens, state: p.state }))
    .sort((a, b) => b.tokens - a.tokens || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

/** How many of the biggest are named under the row; the rest are counted. */
const NAMED = 4;

/** The map's own row: its nodes on the scale of its whole share, each a click to pick it. */
const MapRow = ({ w, picked, onPick }: { w: WindowRead; hues?: Map<string, string>; picked?: string; onPick?(id: string): void }) => {
  const shares = mapShares(w);
  if (!shares.length) return "";
  const all = shares.reduce((n, s) => n + s.tokens, 0);
  // Each node in its channel's hue; one beside another of the same hue is a shade darker, so every node shows.
  const shade: number[] = shares.map((s, i) => (i > 0 && shares[i - 1]!.channel === s.channel ? 1 : 0));
  for (let i = 1; i < shares.length; i++) if (shade[i]) shade[i] = 1 - shade[i - 1]!;
  const hue = (s: MapShare, i = -1) => (i >= 0 && shade[i] ? `color-mix(in srgb, ${CHANNEL_HUE[s.channel]} 65%, ${v("bg")})` : CHANNEL_HUE[s.channel]);
  const tip = (s: MapShare) =>
    `${s.title} (${s.channel}): ${sure(s.tokens).text} tokens, ${pct(s.tokens, all).toFixed(1)}% of what the map put in, ${pct(s.tokens, w.total.tokens).toFixed(2)}% of the window\n${s.state === "listed" ? "Only named in a listing" : "Said, in the window now"}\n${SURE.estimated.tip}${onPick ? "\nA click picks it" : ""}`;
  const click = (s: MapShare) => (e: Event) => {
    e.stopPropagation();
    onPick?.(s.id);
  };
  const rest = shares.length - NAMED;
  return html`
    <div class="t mine" title="What the map controls: its own nodes in the window, each by its size, on a scale of their own">
      <span>the map's own</span><span><b>${sure(all).text}</b> · ${pct(all, w.total.tokens).toFixed(1)}% of the window · ${shares.length} node${shares.length === 1 ? "" : "s"}</span>
    </div>
    <div class="row" role="group" aria-label="the map's nodes">
      ${shares.map((s, i) => html`<button key=${s.id} class=${`${onPick ? "" : "plain"}${s.state === "listed" ? " listed" : ""}${picked === s.id ? " on" : ""}`} style=${`width:${pct(s.tokens, all)}%;background:${hue(s, i)}`} title=${tip(s)} onClick=${click(s)}></button>`)}
    </div>
    <div class="lg">
      ${shares.slice(0, NAMED).map((s) => html`<button key=${s.id} class=${onPick ? "" : "plain"} title=${tip(s)} onClick=${click(s)}><i style=${`background:${hue(s)}`}></i>${s.title} ${sure(s.tokens).text}</button>`)}
      ${rest > 0 && html`<span title=${shares.slice(NAMED).map((s) => `${s.title} ${sure(s.tokens).text}`).join("\n")}>and ${rest} more</span>`}
    </div>`;
};

/** The browser's memory of whether the window bar is open: open until folded to its one line. */
const WINDOW_OPEN = "harness.window-open";
function windowOpen(): boolean {
  try {
    return localStorage.getItem(WINDOW_OPEN) !== "0";
  } catch {
    return true;
  }
}

export const WindowBar = ({ w, filter, hues, picked, onPick }: { w?: WindowRead; filter?: KeyFilter; hues?: Map<string, string>; picked?: string; onPick?(id: string): void }) => {
  const [open, setOpen] = useState(windowOpen);
  if (!w) return "";
  const { sources, channels } = sharesOf(w);
  const full = pct(w.total.tokens, w.limit.tokens);
  const limitTip = w.limit.from === "model" ? `the window of ${w.model ?? "the model"}` : w.limit.from === "seen" ? "the long window: more than 200k was seen in it" : "the usual window; the model doesn't say";
  const totalTip = w.total.from === "usage" ? "The model's own count: the latest message's input, cache and output tokens" : "An estimate: what the parts hold, at four characters a token. The transcript has no usage yet";
  const toggle = (e: Event) => {
    e.stopPropagation();
    setOpen(!open);
    try {
      localStorage.setItem(WINDOW_OPEN, open ? "0" : "1");
    } catch {}
  };
  return html`<div class="hv-win" onPointerDown=${(e: Event) => e.stopPropagation()}>
    <div class="t">
      <button class="hv-whead" title=${open ? "Fold the window to one line" : "Open the window: its share by source, by channel, and the map's own"} onClick=${toggle}>window ${open ? "▾" : "▸"}</button>
      <span title=${totalTip}>${w.total.from === "estimate" ? "≈ " : ""}<b>${tok(w.total.tokens)}</b> of <span title=${limitTip}>${tok(w.limit.tokens)}</span> · ${full.toFixed(full < 10 ? 1 : 0)}%</span>
      ${w.compactions > 0 && html`<span title=${w.compacted?.pre !== undefined ? `The last: ${tok(w.compacted.pre)} → ${tok(w.compacted.post ?? 0)} tokens${w.compacted.trigger ? `, ${w.compacted.trigger}` : ""}` : "Compacted"}>${w.compactions} compaction${w.compactions === 1 ? "" : "s"}</span>`}
    </div>
    ${open && html`<${Row} shares=${sources} limit=${w.limit.tokens} filter=${filter} label="by source" />
    <${Row} shares=${channels} limit=${w.limit.tokens} filter=${filter} label="by channel" />
    <${MapRow} w=${w} hues=${hues} picked=${picked} onPick=${onPick} />`}
  </div>`;
};
