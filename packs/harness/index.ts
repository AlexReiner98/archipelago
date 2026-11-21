/**
 * The harness view: one view of every run, live or replayed, and every
 * profile. Three fills, linked through `here`:
 *
 * - Center (the view "Harness"): the tree of places and nodes (canvas.ts),
 *   lit by what the run looked at heard, refused and did up to the
 *   playhead, with the timeline under it (timeline.ts). The bar picks the
 *   run (`here.run`, else the newest) and a profile (`harness.profile`,
 *   else the run's own).
 * - Left: the run's events, one line each (events.ts).
 * - Right: the node looked at (node.ts).
 *
 * The playhead is `here.event`: unset, the view follows the run's end
 * live. A click on a node sets `here.node`; on an event, `here.event` and
 * `here.node`. Everything it shows, and its styles, go when it unloads.
 */
import { h } from "preact";
import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import htm from "htm";
import type { ActionInvoke, ActionList } from "../../spec/action.ts";
import type { AgentTree, NodeInfo } from "../../spec/agent.ts";
import type { ExchangeEvent, ExchangeRead, ExchangeWatch } from "../../spec/exchange.ts";
import type { GraphRead, GraphWatch } from "../../spec/graph.ts";
import type { HereDeclare, HereRead, HereSet } from "../../spec/here.ts";
import type { ProfileRead } from "../../spec/profile.ts";
import { KEYS } from "../../spec/here.ts";
import type { SlotFill } from "../../spec/slot.ts";
import type { Context, Pack } from "../../runtime/core.ts";
import { read as token, sheet, verdictGlyph } from "../../spec/style.ts";
import { Canvas, CANVAS_STYLE, type Fire, type Standing } from "./canvas.ts";
import { Events, short } from "./events.ts";
import { hooks, PROFILE, type VerdictRead } from "./hooks.ts";
import { KEEP_STYLE, keepParts } from "./keep.ts";
import { packHues, radial, treeOf, type Grouping } from "./layout.ts";
import { nodePane } from "./node.ts";
import { holdsOf, playhead, stateAt } from "./replay.ts";
import { Timeline, TIMELINE_STYLE } from "./timeline.ts";

const html: (s: TemplateStringsArray, ...v: unknown[]) => any = (htm as unknown as { bind(f: typeof h): any }).bind(h);

/** How long a step lasts when the run plays, in ms. */
const STEP = 260;

const STYLE = sheet(`
.hv-pane { display:flex; flex-direction:column; min-width:0; min-height:0; height:100%; }
.hv-head { display:flex; gap:var(--space-3); align-items:center; padding:var(--space-2) var(--space-4); border-bottom:1px solid var(--line); white-space:nowrap; min-height:20px; min-width:0; overflow:hidden; }
.hv-head .t { font-weight:var(--bold); }
.hv-head .sp, .hv-bar .sp { flex:1; }
.hv-dim { color:var(--dim); }
.hv-cut { overflow:hidden; text-overflow:ellipsis; white-space:nowrap; min-width:0; }
.hv-body { flex:1; overflow:auto; min-height:0; }
.hv-row { display:flex; gap:var(--space-3); align-items:baseline; padding:1px var(--space-4); white-space:nowrap; cursor:pointer; }
.hv-row:hover, .hv-ev:hover { background:color-mix(in srgb, var(--line) 50%, transparent); }
.hv-row .x { overflow:hidden; text-overflow:ellipsis; flex:1; min-width:0; }
.hv-row .n { color:var(--dim); font-variant-numeric:tabular-nums; }
.hv-group { padding:var(--space-3) var(--space-4) 1px; color:var(--dim); font-size:var(--text-s); white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
.hv-lit { background:var(--lit) !important; }
.hv-pick { box-shadow:inset 3px 0 0 var(--pick); }
.hv-m { width:1em; text-align:center; flex:none; }
.m-held { color:var(--held); } .m-failed { color:var(--failed); } .m-quiet, .m-none { color:var(--quiet); } .m-act { color:${"var(--write)"}; }
.hv-btn, .hv-bar button { font:inherit; background:var(--control); border:1px solid var(--control-line); color:var(--dim); padding:0 var(--space-3); border-radius:var(--radius); cursor:pointer; }
.hv-bar button.on { color:var(--fg); border-color:var(--dim); }
.hv-select { font:inherit; background:var(--control); color:var(--fg); border:1px solid var(--control-line); border-radius:var(--radius); max-width:220px; min-width:0; }
.hv-select option { background:var(--panel); color:var(--fg); }
.hv-ev { cursor:pointer; }
.hv-line { display:flex; gap:var(--space-2); align-items:baseline; padding:1px var(--space-4) 1px var(--space-2); white-space:nowrap; min-width:0; }
.hv-line .x { overflow:hidden; text-overflow:ellipsis; min-width:0; flex:1; }
.hv-line .p { color:var(--dim); flex:none; max-width:35%; overflow:hidden; text-overflow:ellipsis; }
.hv-line .s { color:var(--dim); flex:none; font-variant-numeric:tabular-nums; width:2.5em; text-align:right; }
.hv-dir { color:var(--dim); flex:none; width:1em; text-align:center; }
.hv-later { opacity:.4; }
.hv-ev.broke { box-shadow:inset -3px 0 0 var(--failed); }
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
.hv-words .ro { white-space:pre-wrap; padding:var(--space-2) var(--space-3); border-left:2px solid var(--line); max-height:12em; overflow:auto; }
.hv-words .bar { display:flex; gap:var(--space-3); align-items:center; margin-top:var(--space-2); color:var(--dim); white-space:nowrap; }
.hv-empty { padding:var(--space-4); color:var(--dim); }
.hv-tag { flex:none; font-size:var(--text-xs); padding:0 var(--space-2); border-radius:var(--radius); border:1px dashed var(--pick); color:var(--pick); }
.hv-prof { display:flex; gap:var(--space-4); padding:var(--space-1) var(--space-4); border-bottom:1px solid var(--line); white-space:nowrap; overflow:hidden; }
.hv-prof .part { color:var(--dim); }
.hv-miss { margin:var(--space-1) var(--space-4) var(--space-3); padding:var(--space-2) var(--space-3); border-left:3px solid var(--failed); white-space:pre-wrap; color:var(--dim); max-height:8em; overflow:auto; }
.hv-view { display:grid; grid-template-rows:auto 1fr auto; height:100%; min-height:0; }
.hv-bar { display:flex; gap:var(--space-3); align-items:center; padding:var(--space-2) var(--space-4); border-bottom:1px solid var(--line); white-space:nowrap; min-width:0; overflow:hidden; }
.hv-bar .live { color:var(--say); flex:none; }
.hv-n { font-variant-numeric:tabular-nums; flex:none; }
${KEEP_STYLE}
${CANVAS_STYLE}
${TIMELINE_STYLE}`);

const clock = (t?: string) => (t ? new Date(t).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }) : "");

const harness: Pack = {
  id: "harness",
  about: "The Harness view: every run, live or replayed, on the tree of what the map tells agents; and every profile.",
  inject: ["slot.fill", "here.read", "here.set", "here.declare", "agent.tree", "exchange.read", "exchange.watch", "verdict.read", "action.list", "action.invoke", "graph.read", "graph.watch", "profile.read"],
  apply(ctx: Context) {
    const here = ctx.get<HereRead>("here.read");
    const set = ctx.get<HereSet>("here.set");
    const read = ctx.get<ExchangeRead>("exchange.read");
    const verdicts = ctx.get<VerdictRead>("verdict.read");
    const actions = ctx.get<ActionList>("action.list");
    const invoke = ctx.get<ActionInvoke>("action.invoke");
    const graphLive = ctx.get<GraphWatch>("graph.watch");
    const profiles = ctx.get<ProfileRead>("profile.read");
    ctx.effect(() => ctx.get<HereDeclare>("here.declare").declare({ key: PROFILE, scope: "page", doc: "The profile the harness view shows: its holds over the tree." }));

    const hk = hooks({
      here,
      tree: ctx.get<AgentTree>("agent.tree"),
      read,
      live: ctx.get<ExchangeWatch>("exchange.watch"),
      verdicts,
      actions,
      graph: ctx.get<GraphRead>("graph.read"),
      graphLive,
      profiles,
    });
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
    const node = nodePane({ hk, invoke, set, read, verdicts, kp });

    /** The nodes each profile holds, by node id: its titles. For grouping by profile. */
    const useMembership = (list: { id: string; title: string }[], nodes: NodeInfo[]): Map<string, string[]> => {
      const [m, setM] = useState<Map<string, string[]>>(new Map());
      const key = `${list.map((p) => p.id).join(",")}|${nodes.length}`;
      useEffect(() => {
        let gone = false;
        const load = () =>
          void Promise.all(list.map(async (p) => [p.title, (await profiles.nodes(p.id)).in] as const)).then((all) => {
            const out = new Map<string, string[]>();
            for (const [title, ids] of all) for (const id of ids) out.set(id, [...(out.get(id) ?? []), title]);
            if (!gone) setM(out);
          });
        load();
        const stop = profiles.watch(load);
        return () => {
          gone = true;
          void stop();
        };
      }, [key]);
      return m;
    };

    const Center = () => {
      const nodes = hk.useNodes();
      const { runs, run, pinned, info } = hk.useRun();
      const fires = useRef<Fire | undefined>(undefined);
      const following = useRef(true);
      const onNew = useRef<((e: ExchangeEvent) => void) | undefined>(undefined);
      onNew.current = (e) => following.current && fires.current?.(e);
      const events = hk.useEvents(run, onNew);
      const event = hk.useHere<string>(KEYS.event);
      const picked = hk.useHere<string>(KEYS.node);
      const profile = hk.useHere<string>(PROFILE);
      const index = playhead(events, event);
      following.current = !event || !events.some((e) => e.id === event);
      const state = useMemo(() => stateAt(events, index), [events, index]);
      const verdictsOfRun = hk.useVerdictsOfRun(run);
      const rings = useMemo(() => (state.end ? new Map(verdictsOfRun.map((x) => [x.node, x.verdict])) : undefined), [state.end, verdictsOfRun]);
      const hearing = hk.useHearing(profile, nodes);
      const held = useMemo(() => (hearing ? holdsOf(hearing) : state.held), [hearing, state.held]);
      const profileList = hk.useProfileList();
      const membership = useMembership(profileList, nodes);
      const counts = hk.useCounts();
      const statuses = hk.useStatuses();
      const review = kp.useReview();
      const [by, setBy] = useState<Grouping>("place");
      const [unsaid, setUnsaid] = useState(false);
      const [showKey, setShowKey] = useState(false);
      const [playing, setPlaying] = useState(false);

      const standing = useMemo(() => {
        const m = new Map<string, Standing>();
        for (const r of review?.nodes ?? []) {
          const id = r.node ?? r.decided?.node;
          if (!id) continue;
          if (r.checks.length) m.set(id, "gone");
          else if (r.standing?.state === "promote") m.set(id, "up");
          else if (r.standing?.state === "retire") m.set(id, "down");
        }
        return m;
      }, [review]);
      const decided = useMemo(
        () => (review?.nodes ?? []).filter((r) => r.decided && (r.node ?? r.decided.node)).map((r) => ({ node: (r.node ?? r.decided!.node)!, title: r.title, up: r.decided!.state === "promote" })),
        [review],
      );
      const tree = useMemo(() => treeOf(nodes, { by, unsaid, profiles: membership, decided }), [nodes, by, unsaid, membership, decided]);
      const placed = useMemo(() => radial(tree), [tree]);
      const hues = useMemo(() => packHues(nodes.map((n) => n.pack)), [nodes]);

      // A step of the playhead lights its event; a jump lights only where it lands.
      const at = state.at;
      useEffect(() => {
        if (at && !following.current) fires.current?.(at);
      }, [at?.id]);
      // Playing: a step every STEP ms, from the start when at the end.
      useEffect(() => {
        if (!playing) return;
        let i = state.end ? -1 : index;
        const timer = setInterval(() => {
          i++;
          if (i >= events.length) {
            setPlaying(false);
            return;
          }
          set.set(KEYS.event, events[i]!.id);
        }, STEP);
        return () => clearInterval(timer);
      }, [playing, run]);
      useEffect(() => setPlaying(false), [run]);

      const pick = (id: string | undefined) => set.set(KEYS.node, id);
      const sum = { held: 0, failed: 0, quiet: 0 };
      for (const x of verdictsOfRun) sum[x.verdict]++;
      const shown = tree.order.filter((t) => t.node).length;
      return html`
        <div class="hv-view">
          <div class="hv-bar">
            <select class="hv-select" value=${pinned ?? ""} title="The run shown" onChange=${(e: Event) => {
              set.set(KEYS.run, (e.target as HTMLSelectElement).value || undefined);
              set.set(KEYS.event, undefined);
            }}>
              <option value="">newest${runs[0] ? ` · ${short(runs[0].title ?? runs[0].run.slice(0, 8), 40)}` : ""}</option>
              ${runs.map((r) => html`<option value=${r.run}>${r.ended ? "○" : "●"} ${short(r.title ?? r.run.slice(0, 8), 40)} · ${clock(r.started)}</option>`)}
            </select>
            ${info && !info.ended && html`<span class="live" title="The run hasn't ended">●</span>`}
            <select class="hv-select" value=${profile ?? ""} title="The profile whose holds the tree shows" onChange=${(e: Event) => set.set(PROFILE, (e.target as HTMLSelectElement).value || undefined)}>
              <option value="">the run's profiles</option>
              ${profileList.map((p) => html`<option value=${p.id}>${p.status === "on" ? "●" : p.status === "off" ? "○" : "◌"} ${p.title}</option>`)}
            </select>
            <button class=${by === "place" ? "on" : ""} onClick=${() => setBy("place")}>place</button>
            <button class=${by === "pack" ? "on" : ""} onClick=${() => setBy("pack")}>pack</button>
            ${profileList.length > 0 && html`<button class=${by === "profile" ? "on" : ""} onClick=${() => setBy("profile")} title="Under the profile each node is in">profile</button>`}
            ${by === "place" && (tree.hidden > 0 || unsaid) && html`<button class=${unsaid ? "on" : ""} onClick=${() => setUnsaid(!unsaid)} title="Nodes with no place: kept, never said">${unsaid ? "" : `+${tree.hidden} `}never said</button>`}
            <span class="sp"></span>
            <span class="hv-dim hv-n" title="nodes">${shown}</span>
            <span class="hv-n" title="In the run: held, failed, quiet"><span class="m-held">${token(verdictGlyph("held"))} ${sum.held}</span> <span class="m-failed">${token(verdictGlyph("failed"))} ${sum.failed}</span> <span class="m-quiet">${token(verdictGlyph("quiet"))} ${sum.quiet}</span></span>
            <button class=${showKey ? "on" : ""} onClick=${() => setShowKey(!showKey)} title="What the marks mean">key</button>
          </div>
          <div style="position:relative;min-height:0;display:grid">
            <${Canvas} tree=${tree} placed=${placed} hues=${hues} statuses=${statuses} rings=${rings} heard=${state.heard} held=${held} counts=${counts} standing=${standing} picked=${picked} fires=${fires} onPick=${pick} showKey=${showKey} />
          </div>
          <${Timeline}
            events=${events}
            index=${index}
            following=${following.current}
            live=${!!info && !info.ended}
            playing=${playing}
            onSeek=${(i: number) => {
              setPlaying(false);
              set.set(KEYS.event, events[i]?.id);
            }}
            onPlay=${() => setPlaying(!playing)}
            onLive=${() => {
              setPlaying(false);
              set.set(KEYS.event, undefined);
            }}
          />
        </div>
      `;
    };

    const Left = () => {
      const nodes = hk.useNodes();
      const { run, info } = hk.useRun();
      const events = hk.useEvents(run);
      const event = hk.useHere<string>(KEYS.event);
      const picked = hk.useHere<string>(KEYS.node);
      const index = playhead(events, event);
      const verdictsOfRun = hk.useVerdictsOfRun(run);
      const titles = useMemo(() => new Map(nodes.map((n) => [n.id, n.title])), [nodes]);
      const inProfiles = hk.useRunProfiles(info);
      return html`<${Events} info=${info} events=${events} index=${index} end=${index === events.length - 1} verdicts=${verdictsOfRun} titles=${titles} node=${picked} profiles=${inProfiles} onPick=${(e: ExchangeEvent) => {
        set.set(KEYS.event, e.id);
        if (e.node) set.set(KEYS.node, e.node);
      }} />`;
    };

    const Right = () => html`<${node.Pane} nodes=${hk.useNodes()} review=${kp.useReview()} />`;

    ctx.effect(() => {
      const style = document.createElement("style");
      style.textContent = STYLE;
      document.head.append(style);
      return () => style.remove();
    });
    // Three fills that show together: the tree is the view, the run and the node stand beside it while it shows.
    const fill = ctx.get<SlotFill>("slot.fill");
    const whileShown = { "here.view": "harness/view" };
    fill.fill({ slot: "left", name: "run", when: whileShown, view: Left });
    fill.fill({ slot: "center", name: "view", title: "Harness", view: Center });
    fill.fill({ slot: "right", name: "node", when: whileShown, view: Right });
  },
};

export default harness;
