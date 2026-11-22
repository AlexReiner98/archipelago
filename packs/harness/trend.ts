/**
 * One node's share of the agent's window over the run, in the node pane:
 * from the context pack's `context.node` (packs/context). A step chart of
 * its tokens in the window across the run, with each compaction a dashed
 * line and the playhead a solid one; how much is in it now, its peak, what
 * compactions dropped; and its latest pieces, each in the window or not.
 * Without that pack, nothing shows.
 */
import { h } from "preact";
import { useEffect, useState } from "preact/hooks";
import htm from "htm";
import type { ActionInvoke } from "../../spec/action.ts";
import { sheet } from "../../spec/style.ts";
import { sure, SURE, tok } from "./windowbar.ts";

const html: (s: TemplateStringsArray, ...v: unknown[]) => any = (htm as unknown as { bind(f: typeof h): any }).bind(h);

export const NODE = "context.node";

export interface NodePoint {
  time: string;
  tokens: number;
  peak: number;
}

/** What `context.node` answers. */
export interface NodeWindow {
  id: string;
  time?: string;
  stays: "start" | "listed" | "said";
  now: number;
  /** Of `now`, fitted to the model's real counts. */
  nowFitted?: number;
  peak: number;
  total: number;
  count: number;
  inWindow: number;
  dropped: number;
  first?: string;
  points: NodePoint[];
  compactions: string[];
  pieces: { n: number; time?: string; tokens: number; in: boolean; fit?: boolean }[];
}

const STAYS: Record<NodeWindow["stays"], string> = {
  start: "there from the start: every request carries its latest text",
  listed: "only named in a listing: kept through a compaction",
  said: "said at moments: each stays until a compaction sums it up",
};

const ask = async (invoke: ActionInvoke, run: string, id: string, at?: string) => {
  const out = await invoke.invoke({ action: NODE, input: { run, id, limit: 12, ...(at ? { at } : {}) }, authority: { of: "human", basis: "read in the sensory interface" }, reason: "Show one node's share of the window" });
  return out.ok ? (out.output as unknown as NodeWindow) : undefined;
};

/** The node's window over the whole run, and as of the playhead `at`; read again as `tick` moves. */
export function useNodeWindow(invoke: ActionInvoke, has: boolean, run: string | undefined, id: string | undefined, at: string | undefined, tick: unknown) {
  const [got, setGot] = useState<{ key: string; whole?: NodeWindow; then?: NodeWindow }>();
  const key = `${run}|${id}|${at ?? ""}`;
  useEffect(() => {
    if (!has || !run || !id) return;
    let gone = false;
    void Promise.all([ask(invoke, run, id), at ? ask(invoke, run, id, at) : Promise.resolve(undefined)]).then(
      ([whole, then]) => !gone && setGot({ key, ...(whole ? { whole } : {}), ...(then ? { then } : {}) }),
      () => undefined,
    );
    return () => {
      gone = true;
    };
  }, [has, key, tick]);
  return got?.key === key ? got : undefined;
}

export const TREND_STYLE = sheet(`
.hv-trend { padding:var(--space-1) var(--space-4) var(--space-2); }
.hv-trend svg { width:100%; height:56px; display:block; overflow:visible; }
.hv-trend .ax { display:flex; justify-content:space-between; color:var(--dim); font-size:var(--text-xs); }
.hv-piece { display:flex; gap:var(--space-3); padding:0 var(--space-4); font-size:var(--text-s); white-space:nowrap; }
.hv-piece .w { width:5.5em; color:var(--dim); flex:none; }
.hv-piece .n { font-variant-numeric:tabular-nums; }
.hv-piece.out { opacity:.5; text-decoration:line-through; }
`);

const W = 300;
const H = 56;
const hm = (t?: string) => (t ? new Date(t).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "");

/** The step chart: its tokens in the window, the peak in each stretch faint behind. */
const Chart = ({ w, at, colour }: { w: NodeWindow; at?: string; colour: string }) => {
  const pts = w.points;
  if (!pts.length) return "";
  const t0 = Date.parse(pts[0]!.time);
  const t1 = Math.max(Date.parse(pts[pts.length - 1]!.time), at ? Date.parse(at) : 0, t0 + 1);
  const top = Math.max(1, ...pts.map((p) => p.peak));
  const x = (t: string) => ((Date.parse(t) - t0) / (t1 - t0)) * W;
  const y = (n: number) => H - (n / top) * (H - 4);
  const step = (v: (p: NodePoint) => number) => {
    let d = `M0 ${H}`;
    let last = H;
    for (const p of pts) {
      d += `L${x(p.time).toFixed(1)} ${last.toFixed(1)}L${x(p.time).toFixed(1)} ${y(v(p)).toFixed(1)}`;
      last = y(v(p));
    }
    return `${d}L${W} ${last.toFixed(1)}L${W} ${H}Z`;
  };
  return html`<div class="hv-trend">
    <svg viewBox=${`0 0 ${W} ${H}`} preserveAspectRatio="none" role="img" aria-label="its tokens in the window over the run">
      <path d=${step((p) => p.peak)} fill=${colour} opacity="0.18" />
      <path d=${step((p) => p.tokens)} fill=${colour} opacity="0.55" />
      ${w.compactions.filter((c) => Date.parse(c) >= t0 && Date.parse(c) <= t1).map((c) => html`<line x1=${x(c)} x2=${x(c)} y1="0" y2=${H} stroke="var(--dim)" stroke-dasharray="2 2" vector-effect="non-scaling-stroke"><title>${`compacted ${hm(c)}`}</title></line>`)}
      ${at && html`<line x1=${x(at)} x2=${x(at)} y1="0" y2=${H} stroke="var(--fg)" vector-effect="non-scaling-stroke"><title>the playhead</title></line>`}
    </svg>
    <div class="ax"><span>${hm(pts[0]!.time)}</span><span>${tok(top)} at most</span><span>${hm(new Date(t1).toISOString())}</span></div>
  </div>`;
};

/** The pane's section: in the window now, over time, and its latest pieces. */
export const NodeWindowPart = ({ got, colour }: { got?: { whole?: NodeWindow; then?: NodeWindow }; colour: string }) => {
  const w = got?.then ?? got?.whole;
  if (!w || !got?.whole) return "";
  const now = got.then ? "then" : "now";
  return html`
    <div class="hv-group" title=${STAYS[w.stays]}>in the window · ${w.stays === "start" ? "from the start" : w.stays === "listed" ? "listed" : "said at moments"}</div>
    <div class="hv-kv"><span class="k" title=${got.then ? "At the playhead" : "Now, live"}>${now}</span><span class="v" title=${sure(w.now, w.nowFitted ?? 0).tip}>${sure(w.now, w.nowFitted ?? 0).text} tokens · ${w.inWindow} of ${w.count} piece${w.count === 1 ? "" : "s"}</span></div>
    <div class="hv-kv"><span class="k">put in</span><span class="v">${tok(w.total)} in all · peak ${tok(w.peak)}${w.dropped ? ` · ${tok(w.dropped)} dropped by compactions` : ""}</span></div>
    <${Chart} w=${got.whole} at=${got.then?.time} colour=${colour} />
    ${w.pieces.map((p) => html`<div class=${`hv-piece ${p.in ? "" : "out"}`} title=${`${p.in ? "in the window" : w.stays === "start" ? "an earlier copy: the latest is sent" : "dropped by a compaction"}\n${SURE[p.fit ? "fitted" : "estimated"].tip}`}><span class="w">${hm(p.time)}</span><span class="n">#${p.n} · ${SURE[p.fit ? "fitted" : "estimated"].mark}${tok(p.tokens)}</span></div>`)}
    ${w.count > w.pieces.length && html`<div class="hv-piece"><span class="w"></span><span class="n" style="color:var(--dim)">and ${w.count - w.pieces.length} earlier</span></div>`}`;
};
