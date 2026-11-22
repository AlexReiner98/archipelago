/**
 * The activity pack, page side: what agents are doing and what changed,
 * newest first, with an undo on each change set. Two fills over one store:
 *
 * - `center`, the view "Activity": each run (from `exchange.read`) with the
 *   change sets it made (from the journal, `history.list`), and the changes
 *   made outside a run, grouped by who made them. A change set shows its
 *   action, reason and the items it touched; undo runs `history.undo`.
 * - `bottom`, the status line: the live runs (begun or heard from in the
 *   last 15 minutes; a run not ended but quiet longer is only open), whether the page reaches the
 *   server (`bridge.link`), and the newest change with its undo.
 *
 * It meets the harness through `here.run`: a run picked here is the run the
 * harness shows, and `⇢` opens it there. The harness keeps what was said and
 * done in a run; this keeps what it changed. People only look and undo:
 * every write is `history.undo`, through `action.invoke`.
 */
import { h } from "preact";
import { useEffect, useState } from "preact/hooks";
import htm from "htm";
import type { ActionInvoke } from "../../spec/action.ts";
import { UNDO } from "../../spec/action.ts";
import { runName, type RunInfo } from "../../spec/agent.ts";
import type { Json, Page } from "../../spec/common.ts";
import type { ExchangeRead, ExchangeWatch } from "../../spec/exchange.ts";
import type { GraphRead, GraphWatch } from "../../spec/graph.ts";
import { LIMIT_MAX } from "../../spec/graph.ts";
import type { HereRead, HereSet } from "../../spec/here.ts";
import { KEYS } from "../../spec/here.ts";
import type { SlotFill } from "../../spec/slot.ts";
import type { Context, Pack } from "../../runtime/core.ts";
import type { BridgeLink } from "../bridge/client.ts";
import { sheet } from "../../spec/style.ts";
import { brief, group, liveness, standing, status, touches, type Change, type Group } from "./model.ts";

const html: (s: TemplateStringsArray, ...v: unknown[]) => any = (htm as unknown as { bind(f: typeof h): any }).bind(h);

export const VIEW = "activity/view";
const HARNESS = "harness/view";
/** The view an item opens in from Activity: Landscape, home. */
const OPENS_IN = "field/field";
/** Change sets read per page, and runs. */
const CHANGES = 100;
const RUNS = 50;

const STYLE = sheet(`
.av { display:flex; flex-direction:column; min-height:0; height:100%; }
.av-head { display:flex; gap:var(--space-4); align-items:center; padding:var(--space-2) var(--space-4); border-bottom:1px solid var(--line); white-space:nowrap; }
.av-head .t { font-weight:var(--bold); }
.av-head .sp { flex:1; }
.av-body { flex:1; overflow:auto; min-height:0; padding-bottom:var(--space-5); }
.av-run { display:flex; gap:var(--space-3); align-items:baseline; padding:var(--space-3) var(--space-4) 1px; white-space:nowrap; cursor:pointer; }
.av-run .x { font-weight:var(--bold); overflow:hidden; text-overflow:ellipsis; min-width:0; }
.av-run:hover .x { text-decoration:underline; }
.av-lit { background:var(--lit); }
.av-n { color:var(--dim); font-variant-numeric:tabular-nums; }
.av-dim { color:var(--dim); }
.av-open { color:var(--fire); }
.av-ch { display:flex; gap:var(--space-3); align-items:baseline; padding:1px var(--space-4) 1px calc(var(--space-4) + 1.2em); white-space:nowrap; }
.av-ch .a { flex:none; }
.av-ch .r { color:var(--dim); overflow:hidden; text-overflow:ellipsis; min-width:0; flex:1; }
.av-ch.undone > :not(.av-btn) { opacity:.5; }
.av-mk { width:1em; text-align:center; flex:none; color:var(--write); }
.av-mk.undone { color:var(--dim); } .av-mk.undo { color:var(--pick); }
.av-t { display:flex; gap:var(--space-3); align-items:baseline; padding:0 var(--space-4) 0 calc(var(--space-4) + 2.6em); white-space:nowrap; font-size:var(--text-s); }
.av-t .i { cursor:pointer; overflow:hidden; text-overflow:ellipsis; max-width:45%; }
.av-t .i:hover { text-decoration:underline; }
.av-t .f { color:var(--dim); overflow:hidden; text-overflow:ellipsis; min-width:0; }
.av-btn { font:inherit; font-size:var(--text-s); background:var(--control); border:1px solid var(--control-line); color:var(--control-fg); border-radius:var(--radius); padding:0 var(--space-3); cursor:pointer; flex:none; }
.av-btn:hover { border-color:var(--dim); }
.av-btn:disabled { opacity:.5; cursor:default; }
.av-err { padding:0 var(--space-4) 0 calc(var(--space-4) + 2.6em); color:var(--failed); font-size:var(--text-s); white-space:normal; }
.av-empty { padding:var(--space-4); color:var(--dim); display:flex; gap:var(--space-3); align-items:baseline; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
.av-empty::before { content:var(--glyph-circle-fresh); color:var(--mark-fresh); flex:none; }
.av-more { margin:var(--space-3) var(--space-4); }
.as { display:flex; gap:var(--space-5); align-items:baseline; white-space:nowrap; min-width:0; flex:1; }
.as > span { min-width:0; overflow:hidden; text-overflow:ellipsis; }
.as .go { cursor:pointer; }
.as .go:hover { color:var(--fg); }
.as .up { color:var(--held); } .as .down { color:var(--failed); }
.as .sp { flex:1; }
`);

const clock = (t?: string) => (t ? new Date(t).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "");
const day = (t?: string) => {
  if (!t) return "";
  const d = new Date(t);
  return d.toDateString() === new Date().toDateString() ? clock(t) : `${d.toLocaleDateString([], { month: "short", day: "numeric" })} ${clock(t)}`;
};
const plural = (n: number, one: string) => `${n} ${one}${n === 1 ? "" : "s"}`;

const activity: Pack = {
  id: "activity",
  about: "What agents are doing and what they changed, with an undo on each change.",
  inject: ["slot.fill", "here.read", "here.set", "exchange.read", "exchange.watch", "graph.read", "graph.watch", "action.invoke", "bridge.link"],
  apply(ctx: Context) {
    const here = ctx.get<HereRead>("here.read");
    const set = ctx.get<HereSet>("here.set");
    const exchange = ctx.get<ExchangeRead>("exchange.read");
    const exLive = ctx.get<ExchangeWatch>("exchange.watch");
    const graph = ctx.get<GraphRead>("graph.read");
    const graphLive = ctx.get<GraphWatch>("graph.watch");
    const invoke = ctx.get<ActionInvoke>("action.invoke");
    const link = ctx.get<BridgeLink>("bridge.link");

    // ---------- one store for both fills ----------

    let runs: RunInfo[] = [];
    let changes: Change[] = [];
    let next: string | undefined;
    /** When each run was last heard from, since the page opened. */
    const heard = new Map<string, number>();
    /** Titles of the items the changes touched, read by id. */
    const titles = new Map<string, string>();
    const subs = new Set<() => void>();
    const tell = () => subs.forEach((on) => on());

    const read = <O extends Json>(action: string, input: Json) =>
      invoke.invoke<O>({ action, input, authority: { of: "human", basis: "looked at in the Activity view" }, reason: "Show the activity" });

    const loadRuns = async () => {
      runs = (await exchange.runs({ limit: RUNS })).items;
      tell();
    };
    /** The newest page again, as long as what is shown; older pages stay. */
    const loadChanges = async () => {
      const limit = Math.min(500, Math.max(CHANGES, changes.length));
      const out = await read<Page<Change> & Json>("history.list", { limit });
      if (!out.ok) return;
      changes = out.output.items;
      next = out.output.next;
      tell();
      void loadTitles();
    };
    /** The titles not known yet of the items shown, by id: one bounded read. */
    const loadTitles = async () => {
      const want = new Set<string>();
      for (const c of changes) for (const t of touches(c.facts)) if (!t.title && !titles.has(t.id)) want.add(t.id);
      const ids = [...want].slice(0, LIMIT_MAX);
      if (!ids.length) return;
      const items = await graph.get(ids);
      ids.forEach((id, i) => titles.set(id, typeof items[i]?.fields.title === "string" ? (items[i]!.fields.title as string) : ""));
      tell();
    };
    const more = async () => {
      if (!next) return;
      const out = await read<Page<Change> & Json>("history.list", { limit: CHANGES, after: next });
      if (!out.ok) return;
      const seen = new Set(changes.map((c) => c.id));
      changes = [...changes, ...out.output.items.filter((c) => !seen.has(c.id))];
      next = out.output.next;
      tell();
      void loadTitles();
    };
    let soon: ReturnType<typeof setTimeout> | undefined;
    const later = () => {
      clearTimeout(soon);
      soon = setTimeout(() => void loadChanges(), 150);
    };
    void loadRuns();
    void loadChanges();
    exLive.watch({}, (e) => {
      heard.set(e.run, Date.now());
      if (e.kind === "begin" || e.kind === "end") void loadRuns();
      else tell();
    });
    // Live turns to open after a quiet spell: look again each minute.
    const minute = setInterval(tell, 60_000);
    ctx.effect(() => () => clearInterval(minute));
    graphLive.watch({}, later);
    ctx.effect(() => () => clearTimeout(soon));

    const useStore = () => {
      const [, tick] = useState(0);
      useEffect(() => {
        const on = () => tick((x) => x + 1);
        subs.add(on);
        return () => void subs.delete(on);
      }, []);
      return { runs, changes, next, now: Date.now() };
    };
    const useHere = <T extends Json>(key: string): T | undefined => {
      const [v, setV] = useState<T | undefined>(here.get<T>(key));
      useEffect(() => here.watch(key, (c) => setV(c.value as T | undefined)) as () => void, [key]);
      return v;
    };

    // ---------- undo ----------

    const refused = new Map<string, string>();
    const busy = new Set<string>();
    const undo = async (c: Change) => {
      busy.add(c.id);
      refused.delete(c.id);
      tell();
      const out = await invoke.invoke({
        action: UNDO,
        input: { change: c.id },
        authority: { of: "human", basis: "undone in the Activity view" },
        reason: c.header.undoes ? `Redo ${c.header.undoes}` : `Undo ${c.id}: ${c.header.action}`,
      });
      busy.delete(c.id);
      if (!out.ok) refused.set(c.id, `${out.refused.code}: ${out.refused.message}`);
      await loadChanges();
    };

    const UndoButton = ({ c }: { c: Change }) => {
      const s = standing(c);
      if (!s.button) return html`<span class="av-dim" title=${`undone by ${c.undoneBy}`}>by ${c.undoneBy}</span>`;
      return html`<button class="av-btn" disabled=${busy.has(c.id)} title=${s.button === "redo" ? `Undo this undo: ${c.header.undoes} stands again` : `Apply the inverse of ${c.id}`} onClick=${(e: Event) => (e.stopPropagation(), void undo(c))}>${s.button}</button>`;
    };

    const openItem = (id: string) => {
      set.set(KEYS.item, id);
      set.set(KEYS.view, OPENS_IN);
    };
    const openRun = (run: string) => {
      set.set(KEYS.run, run);
      set.set(KEYS.view, HARNESS);
    };

    // ---------- the view ----------

    const ChangeRows = ({ c }: { c: Change }) => {
      const s = standing(c);
      const err = refused.get(c.id);
      const t = touches(c.facts);
      return html`
        <div class=${`av-ch ${s.state}`} title=${`${c.id} · ${c.header.actor.kind} ${c.header.actor.id} · on ${c.header.authority.of}'s say${c.header.authority.basis ? `: ${c.header.authority.basis}` : ""}`}>
          <span class=${`av-mk ${s.state}`}>${s.mark}</span>
          <span class="a">${c.header.action}</span>
          <span class="r">${c.header.undoes ? `undoes ${c.header.undoes} · ` : ""}${c.header.reason}</span>
          <span class="av-n">${c.id} · ${clock(c.committed)}</span>
          <${UndoButton} c=${c} />
        </div>
        ${t.slice(0, 6).map(
          (x) => html`<div class="av-t" key=${x.id}>
            <span class="av-dim">${x.kind === "new" ? "+" : x.kind === "gone" ? "−" : "~"}</span>
            <span class="i" title=${x.id} onClick=${() => x.kind !== "gone" && openItem(x.id)}>${x.title ?? (titles.get(x.id) || x.id)}</span>
            <span class="f">${x.fields
              .filter(([f]) => f !== "title" || x.kind === "set")
              .map(([f, v]) => `${f} ${brief(v, 40)}`)
              .join(" · ")}</span>
          </div>`,
        )}
        ${t.length > 6 && html`<div class="av-t"><span class="av-dim">and ${t.length - 6} more</span></div>`}
        ${err && html`<div class="av-err">${err}</div>`}
      `;
    };

    const GroupRows = ({ g, lit, now }: { g: Group; lit: boolean; now: number }) => {
      const state = g.run ? liveness(g.run, heard.get(g.run.run), now) : "ended";
      const title = g.run ? runName(g.run) : g.actor;
      return html`
        <div class=${`av-run ${lit ? "av-lit" : ""}`} onClick=${() => g.run && set.set(KEYS.run, g.run.run)} title=${g.run ? `${g.run.run}${g.run.task ? ` · on ${g.run.task}` : ""}` : "changes made outside a run"}>
          <span class=${state === "live" ? "av-open" : "av-dim"} title=${g.run ? state : "no run"}>${g.key.startsWith("run:") ? (state === "live" ? "●" : state === "open" ? "◌" : "○") : "◇"}</span>
          <span class="x">${title ?? g.key.slice(4, 12)}</span>
          <span class="av-n">${day(g.run?.started ?? g.last)}${g.run?.ended ? `–${clock(g.run.ended)}` : g.run ? ` · ${state}` : ""}</span>
          <span class="av-n">${plural(g.changes.length, "change")}</span>
          ${g.key.startsWith("run:") && html`<button class="av-btn" title="Show what was said and done in the harness" onClick=${(e: Event) => (e.stopPropagation(), openRun(g.key.slice(4)))}>⇢ harness</button>`}
        </div>
        ${g.changes.map((c) => html`<${ChangeRows} key=${c.id} c=${c} />`)}
      `;
    };

    const View = () => {
      const store = useStore();
      const pinned = useHere<string>(KEYS.run);
      const [quiet, setQuiet] = useState(false);
      const groups = group(store.runs, store.changes);
      const shown = groups.filter((g) => quiet || g.changes.length > 0 || (!!g.run && liveness(g.run, heard.get(g.run.run), store.now) === "live"));
      const hidden = groups.length - shown.length;
      const st = status(store.runs, [], heard, store.now);
      return html`
        <div class="av">
          <div class="av-head">
            <span class="t">Activity</span>
            <span class="av-open" title="Live: begun or heard from in the last 15 minutes">● ${st.live.length}</span>
            <span class="av-dim" title="Not ended, but quiet">◌ ${st.open.length}</span>
            <span class="av-n">${plural(store.runs.length, "run")} · ${plural(store.changes.length, "change")}</span>
            <span class="sp"></span>
            ${hidden > 0 || quiet ? html`<button class="av-btn" onClick=${() => setQuiet(!quiet)} title="Runs that changed nothing">${quiet ? "hide quiet runs" : `+ ${hidden} quiet`}</button>` : ""}
          </div>
          <div class="av-body">
            ${shown.length === 0 && html`<div class="av-empty" title="When an agent runs or changes the map, it shows here, each change with its undo.">No runs or changes yet</div>`}
            ${shown.map((g) => html`<${GroupRows} key=${g.key} g=${g} now=${store.now} lit=${!!g.run && g.run.run === pinned} />`)}
            ${store.next && html`<button class="av-btn av-more" onClick=${() => void more()}>older changes</button>`}
          </div>
        </div>
      `;
    };

    // ---------- the status line ----------

    const useLink = () => {
      const [s, setS] = useState(link.state());
      useEffect(() => {
        setS(link.state());
        return link.watch(setS) as () => void;
      }, []);
      return s;
    };

    const Status = () => {
      const store = useStore();
      const up = useLink();
      const { live, open, last } = status(store.runs, store.changes, heard, store.now);
      const newest = live[0];
      const t = last && touches(last.facts);
      return html`
        <div class="as">
          <span class="go" onClick=${() => set.set(KEYS.view, VIEW)} title=${`${live.length} live, ${open.length} open but quiet`}>
            <span class=${live.length ? "av-open" : ""}>●</span> ${live.length}${newest ? html` · ${runName(newest)}` : " live"}
          </span>
          <span class=${up === "open" ? "up" : "down"} title=${up === "open" ? "The page reaches the server" : "The page lost the server; it tries again"}>${up === "open" ? "● linked" : "✕ no link"}</span>
          <span class="sp"></span>
          ${last &&
          html`<span class="go" onClick=${() => set.set(KEYS.view, VIEW)} title=${`${last.id} · ${last.header.reason}`}>
              ${standing(last).mark} ${last.header.action} · ${t && t.length === 1 ? (t[0]!.title ?? (titles.get(t[0]!.id) || t[0]!.id)) : plural(t?.length ?? 0, "item")} · ${clock(last.committed)}
            </span>
            <${UndoButton} c=${last} />`}
        </div>
      `;
    };

    ctx.effect(() => {
      const style = document.createElement("style");
      style.textContent = STYLE;
      document.head.append(style);
      return () => style.remove();
    });
    const fill = ctx.get<SlotFill>("slot.fill");
    fill.fill({ slot: "center", name: "view", title: "Activity", view: View });
    fill.fill({ slot: "bottom", name: "status", view: Status });
  },
};

export default activity;
