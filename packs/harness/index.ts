/**
 * The harness view: one view of every run, live or replayed, and every
 * profile. Three fills, linked through `here`:
 *
 * - Center (the view "Harness"): the tree of places and nodes (canvas.ts),
 *   lit by what the run looked at heard, refused and did up to the
 *   playhead, with the timeline under it (timeline.ts). The bar (bar.ts)
 *   picks every live run at once (`harness.live`, live.ts: where the view
 *   lands), or one run (`here.run`, else the last active), or every run
 *   (`harness.all`), or a profile (`harness.profile`). Live, each run is an
 *   agent with a tree of its own, the nodes its profile lets it hear
 *   (trees.ts), its profile over it and a click from changing (agents.ts);
 *   what it is told colours its tree in its colour, then fades (tint.ts).
 * - Right: the run's events, one line each (events.ts): the wider side,
 *   as an opened line needs the room. Live: every live run's, interleaved.
 *   Every run: the runs, or a profile's runs.
 * - Left: the node looked at (node.ts), and the Dials of that colouring (dials.ts).
 *
 * The playhead is `here.event`: unset, the view follows the run's end
 * live. A click on a node sets `here.node`; on an event, `here.event` and
 * `here.node`. Everything it shows, and its styles, go when it unloads.
 */
import { h } from "preact";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "preact/hooks";
import htm from "htm";
import type { ActionInvoke, ActionList } from "../../spec/action.ts";
import type { AgentTree, NodeInfo, RunInfo } from "../../spec/agent.ts";
import type { ExchangeEvent, ExchangeRead, ExchangeWatch } from "../../spec/exchange.ts";
import type { GraphRead, GraphWatch } from "../../spec/graph.ts";
import type { HereDeclare, HereRead, HereSet } from "../../spec/here.ts";
import type { ProfileRead } from "../../spec/profile.ts";
import { KEYS } from "../../spec/here.ts";
import type { SlotFill } from "../../spec/slot.ts";
import type { Context, Pack } from "../../runtime/core.ts";
import { sheet, v } from "../../spec/style.ts";
import { Canvas, CANVAS_STYLE, type Fire, type Standing } from "./canvas.ts";
import { Events, short } from "./events.ts";
import { ALL, hooks, LIVE, PROFILE, type VerdictRead } from "./hooks.ts";
import { colourOf, colours, liveRuns, LiveEvents } from "./live.ts";
import { AGENTS_STYLE, placementOf, ProfileMenu } from "./agents.ts";
import { focusOf, Trees, TREES_STYLE, treesAndRows } from "./trees.ts";
import { DIALS_KEY, DIALS_STYLE, DialsPane, useDials } from "./dials.ts";
import { Bar, BAR_STYLE } from "./bar.ts";
import { KEEP_STYLE, keepParts } from "./keep.ts";
import { packHues, radial, treeOf, type Grouping } from "./layout.ts";
import { nodePane } from "./node.ts";
import { holdsOf, nodeOf, playhead, stateAt } from "./replay.ts";
import { Timeline, TIMELINE_STYLE } from "./timeline.ts";

const html: (s: TemplateStringsArray, ...v: unknown[]) => any = (htm as unknown as { bind(f: typeof h): any }).bind(h);

/** The frame's page key for its folded fills (packs/frame/fold.ts): picking a node opens the node pane. */
const FOLDED = "frame.folded";

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
.hv-btn { font:inherit; background:var(--control); border:1px solid var(--control-line); color:var(--dim); padding:0 var(--space-3); border-radius:var(--radius); cursor:pointer; }
.hv-bar button { font:inherit; background:none; border:0; color:var(--dim); padding:0; cursor:pointer; flex:none; }
.hv-bar button:hover { color:var(--fg); }
.hv-bar button.on { color:var(--fg); text-decoration:underline; text-underline-offset:4px; }
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
.hv-open { margin:0 var(--space-2) var(--space-2) var(--space-3); padding:var(--space-1) 0 var(--space-1) var(--space-3); border-left:2px solid var(--line); cursor:default; white-space:normal; }
.hv-part { padding:2px 0; min-width:0; }
.hv-part .k { display:block; color:var(--dim); font-size:var(--text-xs); overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
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
.hv-bar { display:flex; gap:var(--space-3); align-items:center; padding:var(--space-2) var(--space-4); border-bottom:1px solid var(--line); white-space:nowrap; min-width:0; position:relative; z-index:2; }
.hv-bar .live { color:var(--say); flex:none; }
.hv-n { font-variant-numeric:tabular-nums; flex:none; }
${KEEP_STYLE}
${AGENTS_STYLE}
${DIALS_STYLE}
${TREES_STYLE}
${BAR_STYLE}
${CANVAS_STYLE}
${TIMELINE_STYLE}`);

const values = (v: string | string[] | undefined) => (v === undefined ? [] : Array.isArray(v) ? v : [v]);

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
    const declare = ctx.get<HereDeclare>("here.declare");
    ctx.effect(() => declare.declare({ key: PROFILE, scope: "page", doc: "The profile the harness view shows: its holds over the tree." }));
    ctx.effect(() => declare.declare({ key: ALL, scope: "page", doc: "True: the harness view looks at every run, with all-time totals, not one run." }));
    ctx.effect(() => declare.declare({ key: DIALS_KEY, scope: "page", doc: "The harness view's dials: how each agent's tree is coloured by what it is told, those moved from where they start." }));
    ctx.effect(() => declare.declare({ key: LIVE, scope: "page", doc: "True: the harness view looks at every live run at once, a colour each." }));
    // A run picked anywhere (here, the node's runs, Activity) is looked at alone, with its own profiles.
    ctx.effect(() =>
      here.watch(KEYS.run, () => {
        if (here.get(LIVE)) set.set(LIVE, undefined);
        if (here.get(ALL)) set.set(ALL, undefined);
        if (here.get(PROFILE)) set.set(PROFILE, undefined);
      }),
    );

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
      const { runs, run, pinned, all, live, info } = hk.useRun();
      const lives = useMemo(() => (live ? liveRuns(runs) : []), [live, runs]);
      const colour = useLiveColours(lives);
      const liveEvents = hk.useLiveEvents(lives.map((r) => r.run), live);
      const fires = useRef<Fire | undefined>(undefined);
      const following = useRef(true);
      const events = hk.useEvents(run);
      const event = hk.useHere<string>(KEYS.event);
      const picked = hk.useHere<string>(KEYS.node);
      const profile = hk.useHere<string>(PROFILE);
      const index = playhead(events, event);
      following.current = !event || !events.some((e) => e.id === event);
      // Live: what the live runs did since the view opened on them.
      const state = useMemo(() => (live ? stateAt(liveEvents, liveEvents.length - 1) : stateAt(events, index)), [live, liveEvents, events, index]);
      const verdictsOfRun = hk.useVerdictsOfRun(run);
      const rings = useMemo(() => (run && state.end ? new Map(verdictsOfRun.map((x) => [x.node, x.verdict])) : undefined), [state.end, verdictsOfRun]);
      const hearing = hk.useHearing(profile, nodes);
      const held = useMemo(() => (hearing ? holdsOf(hearing) : state.held), [hearing, state.held]);
      const profileList = hk.useProfileList();
      const membership = useMembership(profileList, nodes);
      const records = hk.useRecords();
      // All runs: each node's all-time count. One run: what that run said, up to the playhead.
      const counts = useMemo(() => (all ? new Map(records.map((r) => [r.node, r.said])) : state.counts), [all, records, state.counts]);
      const statuses = hk.useStatuses();
      const review = kp.useReview();
      const [by, setBy] = useState<Grouping>("place");
      const [unsaid, setUnsaid] = useState(false);
      const [showKey, setShowKey] = useState(false);
      const [playing, setPlaying] = useState(false);
      const [menu, setMenu] = useState<{ run: string; x: number; y: number; error?: string }>();
      const canPlace = hk.useHas("profile.place");
      const placements = hk.usePlacements(lives);
      const stage = useRef<HTMLDivElement>(null);

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
      // Live: each run an agent with a tree of its own (what it hears), in its colour, its profile over it.
      const dials = useDials(here);
      const acting = useMemo(() => new Set(liveEvents.map((e) => e.run)), [liveEvents]);
      // Trees for the agent in focus, those acting and the last active; a line each for the rest.
      const [focus, setFocus] = useState<string>();
      const split = useMemo(() => {
        const ids = lives.map((r) => r.run);
        return treesAndRows(ids, acting, focusOf(ids, focus));
      }, [lives, acting, focus]);
      const treed = useMemo(() => lives.filter((r) => split.trees.includes(r.run)), [lives, split]);
      const hears = hk.useHears(treed, nodes, placements);
      const fallbacks = useMemo(() => new Set(profileList.filter((p) => p.fallback).map((p) => p.id)), [profileList]);
      const treeFires = useRef(new Map<string, { current?: Fire }>());
      const firesOf = (r: string) => treeFires.current.get(r) ?? (treeFires.current.set(r, {}), treeFires.current.get(r)!);
      const everyAgent = useMemo(
        () =>
          // In the order of their colours, so a tree keeps its place while its agent is live.
          [...lives].sort((a, b) => (colour.get(a.run) ?? 0) - (colour.get(b.run) ?? 0)).map((r) => {
            const ps = placements.get(r.run);
            return { run: r, colour: colourOf(colour.get(r.run) ?? 0), hears: hears.get(r.run), quiet: !acting.has(r.run), fires: firesOf(r.run), ...(ps ? { placement: placementOf(ps, fallbacks, values(r.facts?.profiles)) } : {}) };
          }),
        [lives, colour, placements, fallbacks, acting, hears],
      );
      const agents = useMemo(() => everyAgent.filter((a) => split.trees.includes(a.run.run)), [everyAgent, split]);
      const rows = useMemo(() => everyAgent.filter((a) => split.rows.includes(a.run.run)), [everyAgent, split]);
      const onProfile = (r: string, ev: MouseEvent) => {
        const box = stage.current?.getBoundingClientRect();
        if (!box) return;
        setMenu({ run: r, x: Math.max(4, Math.min(ev.clientX - box.left - 20, box.width - 290)), y: ev.clientY - box.top + 14 });
      };
      const onOpen = (r: string) => {
        set.set(KEYS.event, undefined);
        set.set(KEYS.run, r);
      };
      const place = (r: string, profile: string) => {
        const who = lives.find((x) => x.run === r)?.title ?? r.slice(0, 8);
        const to = profileList.find((p) => p.id === profile)?.title ?? profile;
        void invoke
          .invoke({ action: "profile.place", input: { run: r, profile }, authority: { of: "human", basis: "moved in the harness view" }, reason: `Move ${who} into ${to}` })
          .then((out) => (out.ok ? setMenu(undefined) : setMenu((m) => m && { ...m, error: out.refused.message })));
      };

      // Lights fire once the tree is drawn, so a name a light is on its way to stays unlit until it gets there.
      // Following: each event that comes after the first read. Else a step of the playhead lights its event;
      // a jump lights only where it lands.
      const at = state.at;
      const seen = useRef<{ run?: string; seq: number }>({ seq: 0 });
      useLayoutEffect(() => {
        const last = events[events.length - 1]?.seq ?? 0;
        const was = seen.current;
        seen.current = { run, seq: last };
        if (was.run !== run || !was.seq || !following.current) return;
        for (const e of events) if (e.seq > was.seq) fires.current?.(e);
      }, [events, run]);
      useLayoutEffect(() => {
        if (at && !following.current && !live) fires.current?.(at);
      }, [at?.id]);
      // Live: each event as it comes, in its run's colour.
      const lit = useRef(new Set<string>());
      useLayoutEffect(() => {
        const was = lit.current;
        lit.current = new Set(liveEvents.map((e) => e.id));
        for (const e of liveEvents) if (!was.has(e.id)) firesOf(e.run).current?.(e, colour.has(e.run) ? colourOf(colour.get(e.run)!) : v("say"));
      }, [liveEvents]);
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

      const pick = (id: string | undefined) => {
        set.set(KEYS.node, id);
        // Picking a node opens the node pane if the frame folded it.
        const folded = here.get<string[]>(FOLDED);
        if (id && Array.isArray(folded) && folded.includes("harness/node")) set.set(FOLDED, folded.filter((k) => k !== "harness/node"));
      };
      const sum = { held: 0, failed: 0, quiet: 0 };
      if (all) for (const r of records) (sum.held += r.held), (sum.failed += r.failed), (sum.quiet += r.quiet);
      else for (const x of verdictsOfRun) sum[x.verdict]++;
      return html`
        <div class="hv-view">
          <${Bar}
            runs=${runs} live=${live} all=${all} pinned=${pinned} info=${info} sum=${sum} profile=${profile} profiles=${profileList}
            by=${by} hidden=${tree.hidden} unsaid=${unsaid} showKey=${showKey}
            onBy=${setBy} onUnsaid=${setUnsaid} onKey=${setShowKey}
            onRun=${(val: string) => {
              set.set(KEYS.event, undefined);
              set.set(PROFILE, undefined);
              if (val === "live" || val === "*") {
                set.set(KEYS.run, undefined);
                set.set(LIVE, val === "live" ? true : undefined);
                set.set(ALL, val === "*" ? true : undefined);
                return;
              }
              set.set(ALL, undefined);
              set.set(KEYS.run, val || undefined);
              set.set(LIVE, false);
            }}
            onProfile=${(val: string | undefined) => {
              set.set(KEYS.event, undefined);
              set.set(PROFILE, val);
              set.set(ALL, val ? true : undefined);
              if (val) set.set(LIVE, undefined);
            }}
          />
          <div style="position:relative;min-height:0;display:grid;overflow:hidden" ref=${stage}>
            ${live
              ? html`<${Trees} agents=${agents} nodes=${nodes} events=${liveEvents} by=${by} hues=${hues} statuses=${statuses} standing=${standing} picked=${picked} dials=${dials} canPlace=${canPlace} onPick=${pick} onOpen=${onOpen} onProfile=${onProfile} focus=${focus} onFocus=${setFocus} rows=${rows} />`
              : html`<${Canvas} tree=${tree} placed=${placed} hues=${hues} statuses=${statuses} rings=${rings} heard=${state.heard} held=${held} counts=${counts} standing=${standing} picked=${picked} fires=${fires} onPick=${pick} showKey=${showKey} />`}
            ${live && !lives.length && html`<div class="rx-empty">No agent is live.</div>`}
            ${menu && html`<${ProfileMenu} x=${menu.x} y=${menu.y} title=${lives.find((r) => r.run === menu.run)?.title ?? menu.run.slice(0, 8)} profiles=${profileList} current=${placements.get(menu.run)?.filter((p) => p.by === "match").map((p) => p.id) ?? []} error=${menu.error} onPick=${(id: string) => place(menu.run, id)} onClose=${() => setMenu(undefined)} />`}
          </div>
          ${run && html`<${Timeline}
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
          />`}
        </div>
      `;
    };

    const RunFill = () => {
      const nodes = hk.useNodes();
      const { run, info, runs, all, live } = hk.useRun();
      const profile = hk.useHere<string>(PROFILE);
      const inProfile = hk.useRunsIn(runs, all ? profile : undefined);
      const profileTitle = hk.useProfileList().find((p) => p.id === profile)?.title;
      const lives = useMemo(() => (live ? liveRuns(runs) : []), [live, runs]);
      const colour = useLiveColours(lives);
      const liveEvents = hk.useLiveEvents(lives.map((r) => r.run), live);
      const events = hk.useEvents(run);
      const event = hk.useHere<string>(KEYS.event);
      const picked = hk.useHere<string>(KEYS.node);
      const index = playhead(events, event);
      const verdictsOfRun = hk.useVerdictsOfRun(run);
      const titles = useMemo(() => new Map(nodes.map((n) => [n.id, n.title])), [nodes]);
      const inProfiles = hk.useRunProfiles(info);
      if (live)
        return html`<${LiveEvents} runs=${lives} events=${liveEvents} colour=${new Map([...colour].map(([r, i]) => [r, colourOf(i)]))} titles=${titles} onPick=${(e: ExchangeEvent) => {
          set.set(LIVE, undefined);
          set.set(KEYS.run, e.run);
          set.set(KEYS.event, e.id);
          set.set(KEYS.node, e.node);
        }} />`;
      if (all) return html`<${Runs} runs=${inProfile} of=${profile ? (profileTitle ?? profile) : undefined} />`;
      return html`<${Events} info=${info} events=${events} index=${index} end=${index === events.length - 1} verdicts=${verdictsOfRun} titles=${titles} node=${picked} profiles=${inProfiles} onPick=${(e: ExchangeEvent) => {
        set.set(KEYS.event, e.id);
        // The node pane follows: the event's node, or for an act the node it failed or was told just before.
        set.set(KEYS.node, nodeOf(events, events.indexOf(e), verdictsOfRun));
      }} />`;
    };

    /** Every run, or a profile's (`of`), last active first: a click looks at it alone. */
    const Runs = ({ runs, of }: { runs?: RunInfo[]; of?: string }) => html`
      <div class="hv-pane">
        <div class="hv-head"><span class="t">Runs</span>${of && html`<span class="hv-cut" title="Only the runs this profile has in it">in ${of}</span>`}<span class="hv-dim">${runs ? runs.length : "…"}</span></div>
        <div class="hv-body">
          ${runs && !runs.length && html`<div class="hv-empty" title="Of the last 50 runs, by profile.read.of">${of ? `No run in ${of}.` : "No run yet."}</div>`}
          ${(runs ?? []).map((r) => html`<div class="hv-row" title=${r.title ?? r.run} onClick=${() => set.set(KEYS.run, r.run)}>
            <span class="hv-m">${r.ended ? "○" : "●"}</span><span class="x">${r.title ?? r.run.slice(0, 8)}</span><span class="n">${clock(r.started)}</span>
          </div>`)}
        </div>
      </div>`;

    /** Each live run's colour, kept while it stays live. */
    const useLiveColours = (lives: RunInfo[]): Map<string, number> => {
      const had = useRef(new Map<string, number>());
      return useMemo(() => (had.current = colours(lives.map((r) => r.run), had.current)), [lives.map((r) => r.run).join(",")]);
    };

    const NodeFill = () => html`<${node.Pane} nodes=${hk.useNodes()} review=${kp.useReview()} />`;

    ctx.effect(() => {
      const style = document.createElement("style");
      style.textContent = STYLE;
      document.head.append(style);
      return () => style.remove();
    });
    // Three fills that show together: the tree is the view, the node and the run stand beside it while it shows.
    // The run takes the right, the wider side: an opened line needs the room.
    const fill = ctx.get<SlotFill>("slot.fill");
    const whileShown = { "here.view": "harness/view" };
    fill.fill({ slot: "left", name: "node", title: "Node", when: whileShown, view: NodeFill });
    fill.fill({ slot: "center", name: "view", title: "Harness", view: Center });
    fill.fill({ slot: "left", name: "dials", title: "Dials", when: whileShown, view: () => html`<${DialsPane} here=${here} set=${set} />` });
    fill.fill({ slot: "right", name: "run", title: "Run", when: whileShown, view: RunFill });
  },
};

export default harness;
