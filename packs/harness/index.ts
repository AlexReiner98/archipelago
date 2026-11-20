/**
 * The harness view: what the map says to an agent, what the agent does,
 * and whether each thing said works. Three panes in `shell.main`, linked
 * through `here`:
 *
 * - Tree: every node that can be said, by place or by pack, each with its
 *   verdict in the run looked at.
 * - Run: one run live, map → agent beside agent → map.
 * - Node: its words, places, pack and record. Words made from a map item
 *   are edited through the `words.set` action, and the next say uses them.
 *
 * A click on a node sets `here.node`, and the run lights its firings; a
 * click on an event sets `here.event` and `here.node`, and the tree lights
 * the node. Everything it shows, and its styles, go when it unloads.
 */
import { h } from "preact";
import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import htm from "htm";
import type { ActionInvoke, ActionList } from "../../spec/action.ts";
import type { AgentTree, NodeInfo, RunInfo } from "../../spec/agent.ts";
import type { Json } from "../../spec/common.ts";
import type { ExchangeEvent, ExchangeRead, ExchangeWatch } from "../../spec/exchange.ts";
import type { GraphRead, GraphWatch, Item } from "../../spec/graph.ts";
import type { HereRead, HereSet } from "../../spec/here.ts";
import { KEYS } from "../../spec/here.ts";
import type { SlotFill } from "../../spec/slot.ts";
import type { Context, Pack } from "../../runtime/core.ts";

// htm ships CommonJS types; in the page its module export is the function itself.
const html: (s: TemplateStringsArray, ...v: unknown[]) => any = (htm as unknown as { bind(f: typeof h): any }).bind(h);

/** What `verdict.read` answers (the verdict pack's own key). */
type Verdict = "held" | "failed" | "quiet";
interface RunVerdict {
  run: string;
  node: string;
  verdict: Verdict;
  said: number;
  first: number;
  said_at: string;
  failed_by: number[];
}
interface NodeRecord {
  node: string;
  said: number;
  runs: number;
  held: number;
  failed: number;
  quiet: number;
  last?: string;
}
interface VerdictRead {
  run(run: string): Promise<RunVerdict[]>;
  records(page?: { limit?: number }): Promise<{ items: NodeRecord[] }>;
  record(node: string): Promise<NodeRecord | undefined>;
  verdicts(node: string, page?: { limit?: number }): Promise<{ items: RunVerdict[] }>;
  watch(on: (c: { run?: string }) => void): () => void;
}

/** The action that changes a node's words, when a pack provides it. */
const EDIT = "words.set";

const MARK: Record<Verdict | "none", string> = { held: "✓", failed: "✕", quiet: "○", none: "·" };

const STYLE = `
.hv { display:grid; grid-template-columns:minmax(220px,26%) 1fr minmax(260px,28%); height:100%; }
.hv-pane { display:flex; flex-direction:column; min-width:0; min-height:0; border-right:1px solid var(--line); }
.hv-pane:last-child { border-right:0; }
.hv-head { display:flex; gap:8px; align-items:center; padding:6px 10px; border-bottom:1px solid var(--line); white-space:nowrap; min-height:20px; }
.hv-head .t { font-weight:600; }
.hv-head .sp { flex:1; }
.hv-body { flex:1; overflow:auto; min-height:0; }
.hv-row { display:flex; gap:6px; align-items:baseline; padding:1px 10px; white-space:nowrap; cursor:pointer; }
.hv-row:hover { background:color-mix(in srgb, var(--line) 50%, transparent); }
.hv-row .x { overflow:hidden; text-overflow:ellipsis; flex:1; min-width:0; }
.hv-row .n { color:var(--dim); font-variant-numeric:tabular-nums; }
.hv-group { padding:6px 10px 1px; color:var(--dim); font-size:11px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
.hv-lit { background:var(--lit) !important; }
.hv-pick { box-shadow:inset 3px 0 0 var(--pick); }
.hv-m { width:1em; text-align:center; flex:none; }
.m-held { color:var(--held); } .m-failed { color:var(--failed); } .m-quiet, .m-none { color:var(--quiet); }
.hv-tabs button, .hv-btn { font:inherit; background:none; border:1px solid var(--line); color:var(--dim); padding:0 6px; border-radius:3px; cursor:pointer; }
.hv-tabs button.on { color:var(--fg); border-color:var(--dim); }
.hv-select { font:inherit; background:var(--panel); color:var(--fg); border:1px solid var(--line); max-width:240px; }
.hv-cols { display:grid; grid-template-columns:1fr 1fr; position:sticky; top:0; background:var(--bg); color:var(--dim); font-size:11px; border-bottom:1px solid var(--line); }
.hv-cols div { padding:2px 10px; }
.hv-ev { display:grid; grid-template-columns:1fr 1fr; cursor:pointer; }
.hv-ev > div { display:flex; gap:6px; align-items:baseline; padding:1px 10px; white-space:nowrap; min-width:0; }
.hv-ev:hover { background:color-mix(in srgb, var(--line) 50%, transparent); }
.hv-ev .x { overflow:hidden; text-overflow:ellipsis; min-width:0; }
.hv-ev .p { color:var(--dim); flex:none; max-width:40%; overflow:hidden; text-overflow:ellipsis; }
.hv-ev .s { color:var(--dim); flex:none; font-variant-numeric:tabular-nums; width:2.5em; text-align:right; }
.hv-ev.broke { box-shadow:inset -3px 0 0 var(--failed); }
.hv-kv { display:flex; gap:8px; padding:1px 10px; white-space:nowrap; }
.hv-kv .k { color:var(--dim); width:4.5em; flex:none; }
.hv-kv .v { overflow:hidden; text-overflow:ellipsis; }
.hv-words { margin:6px 10px; }
.hv-words textarea { width:100%; box-sizing:border-box; min-height:84px; font:inherit; background:var(--panel); color:var(--fg); border:1px solid var(--line); border-radius:3px; padding:4px 6px; resize:vertical; }
.hv-words .ro { white-space:pre-wrap; padding:4px 6px; border:1px dashed var(--line); border-radius:3px; }
.hv-words .bar { display:flex; gap:8px; align-items:center; margin-top:4px; color:var(--dim); white-space:nowrap; }
.hv-empty { padding:10px; color:var(--dim); }
`;

const short = (v: unknown, n = 120): string => {
  const s = typeof v === "string" ? v : v === undefined ? "" : JSON.stringify(v);
  const one = s.replace(/\s+/g, " ").trim();
  return one.length > n ? `${one.slice(0, n)}…` : one;
};

/** One line for what an act was about. */
function actLine(e: ExchangeEvent, cwd?: string): string {
  const a = e.act;
  if (!a) return "";
  const i = (a.input ?? {}) as Record<string, Json>;
  if (a.kind === "prompt") return short(typeof a.input === "string" ? a.input : (i.prompt ?? a.input));
  if (a.kind === "reply") return short(a.output ?? a.input);
  const path = i.file_path ?? i.path ?? i.notebook_path;
  if (typeof path === "string") {
    const rel = cwd && path.toLowerCase().startsWith(cwd.toLowerCase()) ? path.slice(cwd.length).replace(/^[\\/]/, "") : path;
    return short(rel.replaceAll("\\", "/"));
  }
  return short(i.command ?? i.pattern ?? i.url ?? i.description ?? a.input);
}

const clock = (t?: string) => (t ? new Date(t).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" }) : "");

const harness: Pack = {
  id: "harness",
  inject: [
    "slot.fill",
    "here.read",
    "here.set",
    "agent.tree",
    "exchange.read",
    "exchange.watch",
    "verdict.read",
    "action.list",
    "action.invoke",
    "graph.read",
    "graph.watch",
  ],
  apply(ctx: Context) {
    const here = ctx.get<HereRead>("here.read");
    const set = ctx.get<HereSet>("here.set");
    const tree = ctx.get<AgentTree>("agent.tree");
    const read = ctx.get<ExchangeRead>("exchange.read");
    const live = ctx.get<ExchangeWatch>("exchange.watch");
    const verdicts = ctx.get<VerdictRead>("verdict.read");
    const actions = ctx.get<ActionList>("action.list");
    const invoke = ctx.get<ActionInvoke>("action.invoke");
    const graph = ctx.get<GraphRead>("graph.read");
    const graphLive = ctx.get<GraphWatch>("graph.watch");

    // ---------- hooks over the capabilities ----------

    const useHere = <T extends Json>(key: string): T | undefined => {
      const [v, setV] = useState<T | undefined>(here.get<T>(key));
      useEffect(() => here.watch(key, (c) => setV(c.value as T | undefined)) as () => void, [key]);
      return v;
    };

    const useNodes = (): NodeInfo[] => {
      const [nodes, setNodes] = useState(tree.nodes());
      useEffect(() => {
        const stop = tree.watch(() => setNodes(tree.nodes()));
        setNodes(tree.nodes());
        return stop as () => void;
      }, []);
      return nodes;
    };

    const useRuns = (): RunInfo[] => {
      const [runs, setRuns] = useState<RunInfo[]>([]);
      useEffect(() => {
        const load = () => void read.runs({ limit: 50 }).then((p) => setRuns(p.items));
        load();
        return live.watch({ kinds: ["begin", "end"] }, load) as () => void;
      }, []);
      return runs;
    };

    const useEvents = (run?: string): ExchangeEvent[] => {
      const [events, setEvents] = useState<ExchangeEvent[]>([]);
      useEffect(() => {
        setEvents([]);
        if (!run) return;
        let gone = false;
        const bySeq = new Map<number, ExchangeEvent>();
        const show = () => !gone && setEvents([...bySeq.values()].sort((a, b) => a.seq - b.seq));
        const stop = live.watch({ run }, (e) => {
          bySeq.set(e.seq, e);
          show();
        });
        void (async () => {
          for (let p = await read.events(run, { limit: 500 }); ; p = await read.events(run, { limit: 500, after: p.next })) {
            for (const e of p.items) bySeq.set(e.seq, e);
            if (!p.next) break;
          }
          show();
        })();
        return () => {
          gone = true;
          void stop();
        };
      }, [run]);
      return events;
    };

    /** Reloads `load` now and whenever verdicts may have changed for `run` (or every run). */
    const useVerdictData = <T>(load: () => Promise<T>, deps: unknown[], run?: string): T | undefined => {
      const [v, setV] = useState<T>();
      useEffect(() => {
        let gone = false;
        let timer: ReturnType<typeof setTimeout> | undefined;
        const go = () => void load().then((x) => !gone && setV(x));
        go();
        const stop = verdicts.watch((c) => {
          if (run !== undefined && c.run !== undefined && c.run !== run) return;
          clearTimeout(timer);
          timer = setTimeout(go, 150);
        });
        return () => {
          gone = true;
          clearTimeout(timer);
          void stop();
        };
      }, deps);
      return v;
    };

    const useEditable = (): boolean => {
      const has = () => actions.list().some((a) => a.name === EDIT);
      const [v, setV] = useState(has());
      useEffect(() => {
        const stop = actions.watch(() => setV(has()));
        setV(has());
        return stop as () => void;
      }, []);
      return v;
    };

    const useItem = (id?: string): Item | null => {
      const [item, setItem] = useState<Item | null>(null);
      useEffect(() => {
        setItem(null);
        if (!id) return;
        let gone = false;
        const load = () => void graph.get([id]).then(([i]) => !gone && setItem(i ?? null));
        load();
        const stop = graphLive.watch({ ids: [id] }, load);
        return () => {
          gone = true;
          void stop();
        };
      }, [id]);
      return item;
    };

    // ---------- the panes ----------

    const Mark = ({ v }: { v?: Verdict }) => html`<span class=${`hv-m m-${v ?? "none"}`} title=${v ?? "not said"}>${MARK[v ?? "none"]}</span>`;

    const TreePane = ({ nodes, byNode, counts }: { nodes: NodeInfo[]; byNode: Map<string, RunVerdict>; counts: Map<string, number> }) => {
      const [by, setBy] = useState<"place" | "pack">("place");
      const picked = useHere<string>(KEYS.node);
      const groups = useMemo(() => {
        const g = new Map<string, NodeInfo[]>();
        for (const n of nodes) for (const k of by === "pack" ? [n.pack] : n.at.length ? n.at : ["(nowhere)"]) {
          if (!g.has(k)) g.set(k, []);
          g.get(k)!.push(n);
        }
        return [...g.entries()].sort((a, b) => a[0].localeCompare(b[0]));
      }, [nodes, by]);
      return html`
        <div class="hv-pane">
          <div class="hv-head">
            <span class="t">Tree</span><span class="n" style="color:var(--dim)">${nodes.length}</span><span class="sp"></span>
            <span class="hv-tabs">
              <button class=${by === "place" ? "on" : ""} onClick=${() => setBy("place")}>place</button>
              <button class=${by === "pack" ? "on" : ""} onClick=${() => setBy("pack")}>pack</button>
            </span>
          </div>
          <div class="hv-body">
            ${!nodes.length && html`<div class="hv-empty">No nodes loaded.</div>`}
            ${groups.map(
              ([group, list]) => html`
                <div class="hv-group" title=${group}>${group}</div>
                ${list.map(
                  (n) => html`
                    <div class=${`hv-row ${picked === n.id ? "hv-lit hv-pick" : ""}`} title=${`${n.id} · ${n.kind}`} onClick=${() => {
                      set.set(KEYS.node, n.id);
                      set.set(KEYS.event, undefined);
                    }}>
                      <${Mark} v=${byNode.get(n.id)?.verdict} />
                      <span class="x">${n.title}</span>
                      <span class="n">${counts.get(n.id) ?? ""}</span>
                    </div>
                  `,
                )}
              `,
            )}
          </div>
        </div>
      `;
    };

    const RunPane = ({ runs, run, events, verdictsOfRun, titles }: { runs: RunInfo[]; run?: string; events: ExchangeEvent[]; verdictsOfRun: RunVerdict[]; titles: Map<string, string> }) => {
      const node = useHere<string>(KEYS.node);
      const event = useHere<string>(KEYS.event);
      const pinned = useHere<string>(KEYS.run);
      const body = useRef<HTMLDivElement>(null);
      const atEnd = useRef(true);
      const verdictOf = useMemo(() => new Map(verdictsOfRun.map((v) => [v.node, v])), [verdictsOfRun]);
      const broke = useMemo(() => new Set(node ? (verdictOf.get(node)?.failed_by ?? []) : []), [node, verdictOf]);
      const sum = { held: 0, failed: 0, quiet: 0 };
      for (const v of verdictsOfRun) sum[v.verdict]++;
      useEffect(() => {
        const el = body.current;
        if (el && atEnd.current) el.scrollTop = el.scrollHeight;
      }, [events.length, run]);
      useEffect(() => {
        if (!event) return;
        body.current?.querySelector(`[data-ev="${CSS.escape(event)}"]`)?.scrollIntoView({ block: "nearest" });
      }, [event]);
      const info = runs.find((r) => r.run === run);
      return html`
        <div class="hv-pane">
          <div class="hv-head">
            <span class="t">Run</span>
            <select class="hv-select" value=${pinned ?? ""} onChange=${(e: Event) => {
              const v = (e.target as HTMLSelectElement).value;
              set.set(KEYS.run, v || undefined);
            }}>
              <option value="">newest${runs[0] ? ` (${runs[0].run.slice(0, 8)})` : ""}</option>
              ${runs.map((r) => html`<option value=${r.run}>${r.run.slice(0, 8)} ${clock(r.started)}${r.ended ? "" : " ●"} ${short(r.title ?? r.cwd ?? "", 30)}</option>`)}
            </select>
            ${info && !info.ended && html`<span style="color:var(--held)" title="live">● live</span>`}
            <span class="sp"></span>
            <span><span class="m-held">${MARK.held} ${sum.held}</span> <span class="m-failed">${MARK.failed} ${sum.failed}</span> <span class="m-quiet">${MARK.quiet} ${sum.quiet}</span></span>
          </div>
          <div class="hv-cols"><div>map → agent</div><div>agent → map</div></div>
          <div class="hv-body" ref=${body} onScroll=${(e: Event) => {
            const el = e.target as HTMLElement;
            atEnd.current = el.scrollHeight - el.scrollTop - el.clientHeight < 24;
          }}>
            ${!run && html`<div class="hv-empty">No run yet. Start Claude Code through the adapter.</div>`}
            ${events.map((e) => {
              const toAgent = e.direction === "to_agent";
              const v = e.node ? verdictOf.get(e.node)?.verdict : undefined;
              const lit = (node && e.node === node) || event === e.id;
              const mark =
                e.kind === "say" ? html`<${Mark} v=${v} />`
                : e.kind === "refuse" ? html`<span class="hv-m m-failed">⊘</span>`
                : e.kind === "act" ? html`<span class=${`hv-m ${e.act?.ok === false ? "m-failed" : "m-quiet"}`}>${e.act?.ok === false ? "✕" : "●"}</span>`
                : e.kind === "begin" ? html`<span class="hv-m m-quiet">▶</span>`
                : e.kind === "end" ? html`<span class="hv-m m-quiet">■</span>`
                : html`<span class="hv-m m-failed">!</span>`;
              const what = e.kind === "act" ? actLine(e, info?.cwd) : e.node ? `${titles.get(e.node) ?? e.node}: ${short(e.text)}` : e.kind === "begin" ? "run began" : e.kind === "end" ? "run ended" : short(e.text);
              const cell = html`<div title=${`#${e.seq} ${e.kind}${e.place ? ` @${e.place}` : ""}${e.node ? ` ${e.node}` : ""}\n${e.text ?? actLine(e)}`}>
                <span class="s">${e.seq}</span>${mark}${e.place && html`<span class="p">${e.place}</span>`}<span class="x">${what}</span>
              </div>`;
              return html`
                <div data-ev=${e.id} class=${`hv-ev ${lit ? "hv-lit" : ""} ${event === e.id ? "hv-pick" : ""} ${broke.has(e.seq) ? "broke" : ""}`} onClick=${() => {
                  set.set(KEYS.event, e.id);
                  set.set(KEYS.node, e.node);
                }}>
                  ${toAgent ? html`${cell}<div></div>` : html`<div></div>${cell}`}
                </div>
              `;
            })}
          </div>
        </div>
      `;
    };

    const Words = ({ info, editable }: { info: NodeInfo; editable: boolean }) => {
      const item = useItem(info.source);
      const saved = typeof item?.fields.words === "string" ? item.fields.words : undefined;
      const [draft, setDraft] = useState<string | undefined>();
      const [status, setStatus] = useState("");
      const [lastSaid, setLastSaid] = useState<string>();
      useEffect(() => {
        setDraft(undefined);
        setStatus("");
        void read.said(info.id, { limit: 1 }).then((p) => setLastSaid(p.items[0]?.text));
      }, [info.id]);
      if (info.source && editable && saved !== undefined) {
        const text = draft ?? saved;
        const save = async () => {
          setStatus("saving…");
          const out = await invoke.invoke({
            action: EDIT,
            input: { node: info.source!, words: text },
            authority: { of: "human", basis: "edited in the harness view" },
            reason: `Changed what ${info.title} says`,
          });
          if (out.ok) {
            setDraft(undefined);
            setStatus(`saved (${out.change ?? "no change"}): the next say uses it`);
          } else setStatus(`refused: ${out.refused.message}`);
        };
        return html`
          <div class="hv-words">
            <textarea value=${text} onInput=${(e: Event) => setDraft((e.target as HTMLTextAreaElement).value)}></textarea>
            <div class="bar">
              <button class="hv-btn" disabled=${draft === undefined || draft === saved} onClick=${save}>Save</button>
              ${draft !== undefined && draft !== saved && html`<button class="hv-btn" onClick=${() => setDraft(undefined)}>Revert</button>`}
              <span style="overflow:hidden;text-overflow:ellipsis">${status}</span>
            </div>
          </div>
        `;
      }
      return html`
        <div class="hv-words">
          <div class="ro">${lastSaid ?? "Never said yet."}</div>
          <div class="bar">${info.source ? "Its words can't be edited here: nothing provides words.set." : "Its words are its pack's code; this is what it last said."}</div>
        </div>
      `;
    };

    const NodePane = ({ nodes, editable }: { nodes: NodeInfo[]; editable: boolean }) => {
      const id = useHere<string>(KEYS.node);
      const info = nodes.find((n) => n.id === id);
      const record = useVerdictData(() => (id ? verdicts.record(id) : Promise.resolve(undefined)), [id]);
      const list = useVerdictData(() => (id ? verdicts.verdicts(id, { limit: 30 }).then((p) => p.items) : Promise.resolve([])), [id]);
      const run = useHere<string>(KEYS.run);
      if (!id) return html`<div class="hv-pane"><div class="hv-head"><span class="t">Node</span></div><div class="hv-empty">Pick a node in the tree, or an event in the run.</div></div>`;
      return html`
        <div class="hv-pane">
          <div class="hv-head"><span class="t" style="overflow:hidden;text-overflow:ellipsis">${info?.title ?? id}</span></div>
          <div class="hv-body">
            ${!info && html`<div class="hv-empty">Not loaded now: its record stays.</div>`}
            ${info && html`<${Words} info=${info} editable=${editable} />`}
            ${info && html`
              <div class="hv-kv"><span class="k">places</span><span class="v" title=${info.at.join(", ")}>${info.at.join(", ")}</span></div>
              <div class="hv-kv"><span class="k">pack</span><span class="v">${info.pack}</span></div>
              <div class="hv-kv"><span class="k">kind</span><span class="v">${info.kind}</span></div>
            `}
            <div class="hv-kv"><span class="k">id</span><span class="v" title=${id}>${id}</span></div>
            <div class="hv-kv"><span class="k">record</span><span class="v">
              ${record
                ? html`said ${record.said} in ${record.runs} run${record.runs === 1 ? "" : "s"} · <span class="m-held">${MARK.held} ${record.held}</span> <span class="m-failed">${MARK.failed} ${record.failed}</span> <span class="m-quiet">${MARK.quiet} ${record.quiet}</span>`
                : "never said"}
            </span></div>
            <div class="hv-kv"><span class="k">last</span><span class="v">${record?.last ? new Date(record.last).toLocaleString() : "—"}</span></div>
            ${!!list?.length && html`<div class="hv-group">runs</div>`}
            ${(list ?? []).map(
              (v) => html`
                <div class=${`hv-row ${run === v.run ? "hv-lit" : ""}`} onClick=${() => set.set(KEYS.run, v.run)} title=${`failed by #${v.failed_by.join(", #") || "nothing"}`}>
                  <${Mark} v=${v.verdict} /><span class="x">${v.run.slice(0, 8)} · said ${v.said}</span><span class="n">${clock(v.said_at)}</span>
                </div>
              `,
            )}
          </div>
        </div>
      `;
    };

    const View = () => {
      const nodes = useNodes();
      const runs = useRuns();
      const pinned = useHere<string>(KEYS.run);
      const run = pinned ?? runs[0]?.run;
      const events = useEvents(run);
      const verdictsOfRun = useVerdictData(() => (run ? verdicts.run(run) : Promise.resolve([])), [run], run) ?? [];
      const records = useVerdictData(() => verdicts.records({ limit: 500 }).then((p) => p.items), []) ?? [];
      const editable = useEditable();
      const byNode = useMemo(() => new Map(verdictsOfRun.map((v) => [v.node, v])), [verdictsOfRun]);
      const counts = useMemo(() => new Map(records.map((r) => [r.node, r.said])), [records]);
      const titles = useMemo(() => new Map(nodes.map((n) => [n.id, n.title])), [nodes]);
      return html`
        <div class="hv">
          <${TreePane} nodes=${nodes} byNode=${byNode} counts=${counts} />
          <${RunPane} runs=${runs} run=${run} events=${events} verdictsOfRun=${verdictsOfRun} titles=${titles} />
          <${NodePane} nodes=${nodes} editable=${editable} />
        </div>
      `;
    };

    ctx.effect(() => {
      const style = document.createElement("style");
      style.textContent = STYLE;
      document.head.append(style);
      return () => style.remove();
    });
    ctx.get<SlotFill>("slot.fill").fill({ slot: "shell.main", name: "view", title: "Harness", view: View });
  },
};

export default harness;
