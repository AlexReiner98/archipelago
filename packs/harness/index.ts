/**
 * The harness view: what the map says to an agent, what the agent does,
 * and whether each thing said works. Three fills, linked through `here`:
 * the tree in the region `left`, the run in `center` (the view "Harness"),
 * the node in `right`; the two beside show while the run does:
 *
 * - Tree: every node that can be said, by place or by pack, each with its
 *   verdict in the run looked at.
 * - Run: one run live, map → agent beside agent → map. Its profiles
 *   (`profile.read`) on one row under the head: ● holds, ◌ shadow, a part
 *   dimmed; a node a gate held back is a ⊝ line (◌ when only a shadow would).
 * - Node: its words, places, pack and record. Words made from a map item
 *   are edited through the `words.set` action, and the next say uses them.
 *   A trial node (its item's `status` is `trial`) is marked in the tree, and
 *   its pane says what miss it came from and can retire it (`words.retire`).
 *   With the keep pack (keep.ts): each trial node's standing by its record
 *   in the tree (trial, promote, retire, held back), the nodes kept or
 *   retired in the tree's last group, and the record against the
 *   thresholds, the gate's checks, Keep and Retire in the node pane.
 *   A node the map writes a file from shows the file and its rule, held as
 *   written or open to refinement, and can flip it (`written.rule`).
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
import type { ProfileRead } from "../../spec/profile.ts";
import { profileHook } from "./profiles.ts";
import { expand, fold, type Part } from "./expand.ts";
import { KEEP_STYLE, keepParts, type Review } from "./keep.ts";
import { KEYS } from "../../spec/here.ts";
import type { SlotFill } from "../../spec/slot.ts";
import type { Context, Pack } from "../../runtime/core.ts";
import { onStyle, read, sheet, v, verdictGlyph } from "../../spec/style.ts";

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
/** The action that retires a node made from a map item. */
const RETIRE = "words.retire";
/** The action that opens a written node to refinement or holds it (packs/written). */
const RULE = "written.rule";

/** A verdict's glyph, as the style draws it now. */
const mark = (v: Verdict | "none") => read(verdictGlyph(v));

const STYLE = sheet(`
.hv-pane { display:flex; flex-direction:column; min-width:0; min-height:0; height:100%; }
.hv-head { display:flex; gap:var(--space-3); align-items:center; padding:var(--space-2) var(--space-4); border-bottom:1px solid var(--line); white-space:nowrap; min-height:20px; }
.hv-head .t { font-weight:var(--bold); }
.hv-head .sp { flex:1; }
.hv-body { flex:1; overflow:auto; min-height:0; }
.hv-row { display:flex; gap:var(--space-3); align-items:baseline; padding:1px var(--space-4); white-space:nowrap; cursor:pointer; }
.hv-row:hover { background:color-mix(in srgb, var(--line) 50%, transparent); }
.hv-row .x { overflow:hidden; text-overflow:ellipsis; flex:1; min-width:0; }
.hv-row .n { color:var(--dim); font-variant-numeric:tabular-nums; }
.hv-group { padding:var(--space-3) var(--space-4) 1px; color:var(--dim); font-size:var(--text-s); white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
.hv-lit { background:var(--lit) !important; }
.hv-pick { box-shadow:inset 3px 0 0 var(--pick); }
.hv-m { width:1em; text-align:center; flex:none; }
.m-held { color:var(--held); } .m-failed { color:var(--failed); } .m-quiet, .m-none { color:var(--quiet); }
.hv-tabs button, .hv-btn { font:inherit; background:var(--control); border:1px solid var(--control-line); color:var(--dim); padding:0 var(--space-3); border-radius:var(--radius); cursor:pointer; }
.hv-tabs button.on { color:var(--fg); border-color:var(--dim); }
.hv-select { font:inherit; background:var(--control); color:var(--fg); border:1px solid var(--control-line); max-width:240px; }
.hv-cols { display:grid; grid-template-columns:1fr 1fr; position:sticky; top:0; background:var(--bg); color:var(--dim); font-size:var(--text-s); border-bottom:1px solid var(--line); }
.hv-cols div { padding:var(--space-1) var(--space-4); }
.hv-ev { display:grid; grid-template-columns:1fr 1fr; cursor:pointer; }
.hv-ev > div { display:flex; gap:var(--space-3); align-items:baseline; padding:1px var(--space-4); white-space:nowrap; min-width:0; }
.hv-ev:hover { background:color-mix(in srgb, var(--line) 50%, transparent); }
.hv-ev .x { overflow:hidden; text-overflow:ellipsis; min-width:0; }
.hv-ev .p { color:var(--dim); flex:none; max-width:40%; overflow:hidden; text-overflow:ellipsis; }
.hv-ev .s { color:var(--dim); flex:none; font-variant-numeric:tabular-nums; width:2.5em; text-align:right; }
.hv-ev.broke { box-shadow:inset -3px 0 0 var(--failed); }
.hv-ev > div.hv-cell { display:block; padding:0; }
.hv-cell > .hv-line { display:flex; gap:var(--space-3); align-items:baseline; padding:1px var(--space-4); white-space:nowrap; min-width:0; }
.hv-tw { color:var(--dim); width:.8em; flex:none; font-size:var(--text-xs); }
.hv-open { margin:0 var(--space-4) var(--space-2) calc(var(--space-4) + 3.5em); padding:var(--space-1) 0 var(--space-1) var(--space-3); border-left:2px solid var(--line); cursor:default; white-space:normal; }
.hv-part { display:grid; grid-template-columns:6.5em minmax(0,1fr); gap:var(--space-3); padding:1px 0; }
.hv-part .k { color:var(--dim); font-size:var(--text-s); overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.hv-part pre { margin:0; font:var(--text-s)/var(--leading) var(--mono); white-space:pre-wrap; overflow-wrap:anywhere; max-width:70ch; }
.hv-fold { font:inherit; font-size:var(--text-xs); background:none; border:0; color:var(--pick); cursor:pointer; padding:0; }
.hv-kv { display:flex; gap:var(--space-3); padding:1px var(--space-4); white-space:nowrap; }
.hv-kv .k { color:var(--dim); width:4.5em; flex:none; }
.hv-kv .v { overflow:hidden; text-overflow:ellipsis; }
.hv-words { margin:var(--space-3) var(--space-4); }
.hv-words textarea { width:100%; box-sizing:border-box; min-height:84px; font:inherit; background:var(--control); color:var(--fg); border:1px solid var(--control-line); border-radius:var(--radius); padding:var(--space-2) var(--space-3); resize:vertical; }
.hv-words .ro { white-space:pre-wrap; padding:var(--space-2) var(--space-3); border:1px dashed var(--line); border-radius:var(--radius); }
.hv-words .bar { display:flex; gap:var(--space-3); align-items:center; margin-top:var(--space-2); color:var(--dim); white-space:nowrap; }
.hv-empty { padding:var(--space-4); color:var(--dim); }
.hv-trial .x { font-style:italic; }
.hv-tag { flex:none; font-size:var(--text-xs); padding:0 var(--space-2); border-radius:var(--radius); border:1px dashed var(--pick); color:var(--pick); }
.hv-prof { display:flex; gap:var(--space-4); padding:var(--space-1) var(--space-4); border-bottom:1px solid var(--line); white-space:nowrap; overflow:hidden; }
.hv-prof .k { color:var(--dim); }
.hv-prof .part { color:var(--dim); }
.hv-prof .sp { flex:1; }
.hv-miss { margin:var(--space-1) var(--space-4) var(--space-3); padding:var(--space-2) var(--space-3); border-left:3px solid var(--failed); white-space:pre-wrap; color:var(--dim); }
${KEEP_STYLE}`);

const short = (v: unknown, n = 120): string => {
  const s = typeof v === "string" ? v : v === undefined ? "" : JSON.stringify(v);
  const one = s.replace(/\s+/g, " ").trim();
  return one.length > n ? `${one.slice(0, n)}…` : one;
};

/** One line for what an act was about. */
/** The first begin starts the run; a later one is the run saying more about itself. */
function beginLine(e: ExchangeEvent): string {
  const d = (e.detail ?? {}) as { started?: string; title?: string; task?: string };
  if (!d.started || d.started === e.time) return "run began";
  const told = [d.title && `"${short(d.title, 60)}"`, d.task && `on ${d.task}`].filter(Boolean).join(" ");
  return told ? `run is ${told}` : "run said what it is";
}

function actLine(e: ExchangeEvent, cwd?: string): string {
  const a = e.act;
  if (!a) return "";
  const i = (a.input ?? {}) as Record<string, Json>;
  if (a.kind === "prompt") return short(typeof a.input === "string" ? a.input : (i.prompt ?? a.input));
  if (a.kind === "reply") return short(a.input ?? a.output);
  if (a.kind === "notice") return `waits on the person (${String(i.type ?? "notice")}): ${short(i.message ?? "")}`;
  if (a.kind === "decision") return `the person ${a.output === "deny" ? "denied" : "allowed"}: ${short(i.command ?? i.file_path ?? i.pattern ?? a.input)}`;
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
  about: "The Harness view: what an agent was told, what it did, and whether each thing told helped.",
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
    "profile.read",
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
    const profiles = ctx.get<ProfileRead>("profile.read");

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

    const useProfiles = profileHook(profiles);

    const kp = keepParts({
      actions,
      invoke,
      graphLive,
      onVerdicts: (on) => verdicts.watch(() => on()),
      pick: (node) => {
        set.set(KEYS.node, node);
        set.set(KEYS.event, undefined);
      },
    });

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

    /** Each node item's status (`trial`, `retired`), by item id, kept live. */
    const useStatuses = (): Map<string, string> => {
      const [st, setSt] = useState<Map<string, string>>(new Map());
      useEffect(() => {
        let gone = false;
        const load = async () => {
          const m = new Map<string, string>();
          for (let p = await graph.of("node", { limit: 500 }); ; p = await graph.of("node", { limit: 500, after: p.next })) {
            for (const i of p.items) if (typeof i.fields.status === "string") m.set(i.id, i.fields.status);
            if (!p.next) break;
          }
          if (!gone) setSt(m);
        };
        void load();
        const stop = graphLive.watch({ types: ["node"] }, () => void load());
        return () => {
          gone = true;
          void stop();
        };
      }, []);
      return st;
    };
    const statusOf = (n: NodeInfo | undefined, st: Map<string, string>) => (n?.source ? st.get(n.source) : undefined);

    const useHas = (name: string): boolean => {
      const has = () => actions.list().some((a) => a.name === name);
      const [v, setV] = useState(has());
      useEffect(() => {
        const stop = actions.watch(() => setV(has()));
        setV(has());
        return stop as () => void;
      }, [name]);
      return v;
    };

    // ---------- the panes ----------

    const Mark = ({ v }: { v?: Verdict }) => html`<span class=${`hv-m m-${v ?? "none"}`} title=${v ?? "not said"}>${mark(v ?? "none")}</span>`;

    const TreePane = ({ nodes, byNode, counts, statuses, review }: { nodes: NodeInfo[]; byNode: Map<string, RunVerdict>; counts: Map<string, number>; statuses: Map<string, string>; review?: Review }) => {
      const reviewed = useMemo(() => new Map((review?.nodes ?? []).map((r) => [r.item, r])), [review]);
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
            <span class="t">Tree</span><span class="n" style=${`color:${v("dim")}`}>${nodes.length}</span><span class="sp"></span>
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
                    <div class=${`hv-row ${picked === n.id ? "hv-lit hv-pick" : ""} ${statusOf(n, statuses) === "trial" ? "hv-trial" : ""}`} title=${`${n.id} · ${n.kind}${statusOf(n, statuses) === "trial" ? " · trial" : ""}`} onClick=${() => {
                      set.set(KEYS.node, n.id);
                      set.set(KEYS.event, undefined);
                    }}>
                      <${Mark} v=${byNode.get(n.id)?.verdict} />
                      <span class="x">${n.title}</span>
                      ${review && n.source && reviewed.has(n.source) ? html`<${kp.Tag} r=${reviewed.get(n.source)} />` : statusOf(n, statuses) === "trial" && html`<span class="hv-tag">trial</span>`}
                      <span class="n">${counts.get(n.id) ?? ""}</span>
                    </div>
                  `,
                )}
              `,
            )}
            <${kp.Decided} review=${review} picked=${picked} />
          </div>
        </div>
      `;
    };

    /** One part of an opened row, its text folded past a dozen lines. */
    const PartRow = ({ p }: { p: Part }) => {
      const [all, setAll] = useState(false);
      const f = fold(p.text);
      return html`<div class="hv-part">
        <span class="k" title=${p.label}>${p.label}</span>
        <div><pre>${all ? p.text : f.head}</pre>${f.more > 0 && html`<button class="hv-fold" onClick=${() => setAll(!all)}>${all ? "fold" : `+${f.more} lines`}</button>`}</div>
      </div>`;
    };

    /** A row opened in place: everything the exchange holds for it. Clicks inside don't close it. */
    const Opened = ({ e }: { e: ExchangeEvent }) => html`
      <div class="hv-open" onClick=${(ev: Event) => ev.stopPropagation()}>
        ${expand(e).map((p, i) => html`<${PartRow} key=${i} p=${p} />`)}
      </div>`;

    const RunPane = ({ runs, run, events, verdictsOfRun, titles }: { runs: RunInfo[]; run?: string; events: ExchangeEvent[]; verdictsOfRun: RunVerdict[]; titles: Map<string, string> }) => {
      const node = useHere<string>(KEYS.node);
      const event = useHere<string>(KEYS.event);
      const pinned = useHere<string>(KEYS.run);
      const body = useRef<HTMLDivElement>(null);
      const atEnd = useRef(true);
      const [opened, setOpened] = useState<Set<string>>(new Set());
      useEffect(() => setOpened(new Set()), [run]);
      const toggle = (id: string) =>
        setOpened((o) => {
          const n = new Set(o);
          if (n.has(id)) n.delete(id);
          else n.add(id);
          return n;
        });
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
      const inProfiles = useProfiles(info);
      const facts = info?.facts ?? {};
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
            ${info && !info.ended && html`<span style=${`color:${v("held")}`} title="live">● live</span>`}
            <span class="sp"></span>
            <span><span class="m-held">${mark("held")} ${sum.held}</span> <span class="m-failed">${mark("failed")} ${sum.failed}</span> <span class="m-quiet">${mark("quiet")} ${sum.quiet}</span></span>
          </div>
          ${info && html`<div class="hv-prof" title=${Object.entries(facts).map(([k, v]) => `${k}: ${Array.isArray(v) ? v.join(", ") : v}`).join("\n")}>
            <span class="k">profiles</span>
            ${inProfiles && !inProfiles.length && html`<span class="part" title="In no profile: it hears every node.">none</span>`}
            ${(inProfiles ?? []).map((p) => html`<span class=${p.by === "part" ? "part" : ""} title=${`${p.holding ? "holds" : "shadow: only records"}${p.by === "part" ? ", as a part" : ""}`}>${p.holding ? "●" : "◌"} ${p.title}</span>`)}
            ${facts.remote && html`<span class="sp"></span><span class="part">${String(facts.remote).split("/").slice(-1)[0]}${facts.branch ? ` · ${facts.branch}` : ""}</span>`}
          </div>`}
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
                : e.kind === "compact" ? html`<span class="hv-m m-quiet">⇣</span>`
                : e.kind === "gated" ? html`<span class="hv-m m-quiet">${(e.detail as { trial?: boolean } | undefined)?.trial ? "◌" : "⊝"}</span>`
                : html`<span class="hv-m m-failed">!</span>`;
              const resaid = (e.detail as { resaid?: boolean } | undefined)?.resaid ? "re-said after compaction · " : "";
              const what = e.kind === "act" ? actLine(e, info?.cwd) : e.node ? `${resaid}${titles.get(e.node) ?? e.node}: ${short(e.text)}` : e.kind === "begin" ? beginLine(e) : e.kind === "end" ? "run ended" : e.kind === "compact" ? `context compacted (${String((e.detail as { trigger?: string } | undefined)?.trigger ?? "auto")}): what follows is said again` : short(e.text);
              const isOpen = opened.has(e.id);
              const cell = html`<div class="hv-cell">
                <div class="hv-line" title=${`#${e.seq} ${e.kind}${e.place ? ` @${e.place}` : ""}${e.node ? ` ${e.node}` : ""}\n${e.text ?? actLine(e)}`}>
                  <span class="s">${e.seq}</span><span class="hv-tw">${isOpen ? "▾" : "▸"}</span>${mark}${e.place && html`<span class="p">${e.place}</span>`}<span class="x">${what}</span>
                </div>
                ${isOpen && html`<${Opened} e=${e} />`}
              </div>`;
              return html`
                <div data-ev=${e.id} class=${`hv-ev ${lit ? "hv-lit" : ""} ${event === e.id ? "hv-pick" : ""} ${broke.has(e.seq) ? "broke" : ""}`} onClick=${() => {
                  toggle(e.id);
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

    const Trial = ({ info }: { info: NodeInfo }) => {
      const item = useItem(info.source);
      const canRetire = useHas(RETIRE) && !useHas("keep.apply");
      const [status, setStatus] = useState("");
      useEffect(() => setStatus(""), [info.id]);
      if (item?.fields.status !== "trial") return null;
      const from = typeof item.fields.from_run === "string" ? item.fields.from_run : undefined;
      const seq = item.fields.from_seq;
      const retire = async () => {
        setStatus("retiring…");
        const out = await invoke.invoke({
          action: RETIRE,
          input: { node: info.source! },
          authority: { of: "human", basis: "retired in the harness view" },
          reason: `Retired the trial node ${info.title}`,
        });
        setStatus(out.ok ? "retired: it is no longer said" : `refused: ${out.refused.message}`);
      };
      return html`
        <div class="hv-group">trial: written after this miss</div>
        <div class="hv-miss">${typeof item.fields.misses === "string" ? item.fields.misses : "—"}</div>
        ${from && html`<div class="hv-row" onClick=${() => set.set(KEYS.run, from)} title="show that run"><span class="x">from ${from.slice(0, 8)}${seq !== undefined ? ` #${seq}` : ""}</span></div>`}
        ${canRetire && html`<div class="hv-words"><div class="bar">
          <button class="hv-btn" onClick=${retire}>Retire</button>
          <span>${status || "Said only at its place, marked as a trial."}</span>
        </div></div>`}
      `;
    };

    /** A node the map writes a file from (packs/written): the file, and whether it may be refined here. */
    const Written = ({ info }: { info: NodeInfo }) => {
      const item = useItem(info.source);
      const canRule = useHas(RULE);
      const [status, setStatus] = useState("");
      useEffect(() => setStatus(""), [info.id]);
      if (typeof item?.fields.file !== "string") return null;
      const held = typeof item.fields.held === "string" ? item.fields.held : undefined;
      const flip = async () => {
        setStatus("…");
        const out = await invoke.invoke({
          action: RULE,
          input: held ? { node: info.source!, refine: "open" } : { node: info.source!, refine: "held", why: "Held as written in the harness view." },
          authority: { of: "human", basis: "set in the harness view" },
          reason: held ? `Opened ${info.title} to refinement inside the map` : `Held ${info.title} as written`,
        });
        setStatus(out.ok ? "" : `refused: ${out.refused.message}`);
      };
      return html`
        <div class="hv-group">written: the map writes this file</div>
        <div class="hv-kv"><span class="k">file</span><span class="v" title=${item.fields.file}>${item.fields.file}</span></div>
        <div class="hv-kv"><span class="k">rule</span><span class="v" title=${held ?? ""}>${held ? `held: ${held}` : "open: the loop or an agent may refine it"}</span></div>
        ${canRule && html`<div class="hv-words"><div class="bar">
          <button class="hv-btn" onClick=${flip}>${held ? "Open to refinement" : "Hold as written"}</button>
          <span style="overflow:hidden;text-overflow:ellipsis">${status}</span>
        </div></div>`}
      `;
    };

    const NodePane = ({ nodes, editable, review }: { nodes: NodeInfo[]; editable: boolean; review?: Review }) => {
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
            ${info?.source && html`<${Trial} info=${info} />`}
            <${kp.Standing} review=${review} id=${id} source=${info?.source} />
            ${info?.source && html`<${Written} info=${info} />`}
            ${info && html`
              <div class="hv-kv"><span class="k">places</span><span class="v" title=${info.at.join(", ")}>${info.at.join(", ")}</span></div>
              <div class="hv-kv"><span class="k">pack</span><span class="v">${info.pack}</span></div>
              <div class="hv-kv"><span class="k">kind</span><span class="v">${info.kind}</span></div>
            `}
            <div class="hv-kv"><span class="k">id</span><span class="v" title=${id}>${id}</span></div>
            <div class="hv-kv"><span class="k">record</span><span class="v">
              ${record
                ? html`said ${record.said} in ${record.runs} run${record.runs === 1 ? "" : "s"} · <span class="m-held">${mark("held")} ${record.held}</span> <span class="m-failed">${mark("failed")} ${record.failed}</span> <span class="m-quiet">${mark("quiet")} ${record.quiet}</span>`
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

    /** The run looked at: the one pinned, else the newest. */
    const useRun = () => {
      const runs = useRuns();
      const pinned = useHere<string>(KEYS.run);
      return { runs, run: pinned ?? runs[0]?.run };
    };
    const useVerdictsOfRun = (run: string | undefined) => useVerdictData(() => (run ? verdicts.run(run) : Promise.resolve([])), [run], run) ?? [];

    /** Left: the tree, each node with its verdict in the run looked at. */
    const Tree = () => {
      const nodes = useNodes();
      const { run } = useRun();
      const verdictsOfRun = useVerdictsOfRun(run);
      const records = useVerdictData(() => verdicts.records({ limit: 500 }).then((p) => p.items), []) ?? [];
      const statuses = useStatuses();
      const review = kp.useReview();
      const byNode = useMemo(() => new Map(verdictsOfRun.map((v) => [v.node, v])), [verdictsOfRun]);
      const counts = useMemo(() => new Map(records.map((r) => [r.node, r.said])), [records]);
      return html`<${TreePane} nodes=${nodes} byNode=${byNode} counts=${counts} statuses=${statuses} review=${review} />`;
    };

    /** Center: one run live. */
    const Run = () => {
      const nodes = useNodes();
      const { runs, run } = useRun();
      const events = useEvents(run);
      const verdictsOfRun = useVerdictsOfRun(run);
      const titles = useMemo(() => new Map(nodes.map((n) => [n.id, n.title])), [nodes]);
      return html`<${RunPane} runs=${runs} run=${run} events=${events} verdictsOfRun=${verdictsOfRun} titles=${titles} />`;
    };

    /** Right: the node looked at. */
    const Node = () => {
      const nodes = useNodes();
      const editable = useEditable();
      const review = kp.useReview();
      return html`<${NodePane} nodes=${nodes} editable=${editable} review=${review} />`;
    };

    ctx.effect(() => {
      const style = document.createElement("style");
      style.textContent = STYLE;
      document.head.append(style);
      return () => style.remove();
    });
    // Three fills that show together: the run is the view, the tree and the node stand beside it while it shows.
    const fill = ctx.get<SlotFill>("slot.fill");
    const whileShown = { "here.view": "harness/view" };
    fill.fill({ slot: "left", name: "tree", when: whileShown, view: Tree });
    fill.fill({ slot: "center", name: "view", title: "Harness", view: Run });
    fill.fill({ slot: "right", name: "node", when: whileShown, view: Node });
  },
};

export default harness;
