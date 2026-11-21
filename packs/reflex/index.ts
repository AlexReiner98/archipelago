/**
 * The reflex tree, page side: every node the map says to agents as one
 * circular tree grown from its root, in the shell as the view "Reflex tree".
 * The shape is layout.ts's; this draws it and lights it.
 *
 * - Grouped by place (the default) or by pack. Nodes said nowhere are left
 *   out unless asked for.
 * - Live from the exchange: a say runs a blue light from the root to its
 *   node, a refusal a red one; an act sparks amber on the bough of its
 *   place (red when it failed). "Replay" plays the run shown again.
 * - Each node's dot has its pack's hue, hollow while its item is a trial.
 *   A ring marks its verdict in the run shown: blue held, red failed, grey
 *   quiet. The run shown is `here.run`, else the newest.
 * - A click on a node sets `here.node`, so the harness view opens on it,
 *   and its way from the root lights. Drag to move, wheel to zoom,
 *   double-click to fit.
 *
 * - A profile picked in the bar shows the nodes a run in it hears from
 *   profiles: its own and those of every profile it is part of
 *   (`profile.read`), and "by profile" groups them by where each comes
 *   from; the card names them. "all" shows every node.
 *
 * It only shows: it invokes no action. Its styles go when it unloads.
 */
import { h } from "preact";
import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import htm from "htm";
import type { AgentTree, NodeInfo, RunInfo } from "../../spec/agent.ts";
import type { Json } from "../../spec/common.ts";
import type { ExchangeEvent, ExchangeRead, ExchangeWatch } from "../../spec/exchange.ts";
import type { GraphRead, GraphWatch } from "../../spec/graph.ts";
import type { HereRead, HereSet } from "../../spec/here.ts";
import type { ProfileRead } from "../../spec/profile.ts";
import { KEYS } from "../../spec/here.ts";
import type { SlotFill } from "../../spec/slot.ts";
import type { Context, Pack } from "../../runtime/core.ts";
import { profileHooks } from "./profiles.ts";
import { branchAt, lightOf, packHues, pointAt, radial, route, STYLE, treeOf, type Grouping, type Placed, type Tree } from "./layout.ts";
import { read as token, sheet, v, verdictGlyph } from "../../spec/style.ts";


const html: (s: TemplateStringsArray, ...v: unknown[]) => any = (htm as unknown as { bind(f: typeof h): any }).bind(h);

/** What `verdict.read` answers (the verdict pack's own key). */
type Verdict = "held" | "failed" | "quiet";
interface RunVerdict {
  run: string;
  node: string;
  verdict: Verdict;
}
interface VerdictRead {
  run(run: string): Promise<RunVerdict[]>;
  watch(on: (c: { run?: string }) => void): () => void;
}

const S = STYLE;
const C = S.colors;
const NS = "http://www.w3.org/2000/svg";

const SHEET = sheet(`
.rx { display:grid; grid-template-rows:auto 1fr; height:100%; min-height:0; }
.rx-bar { display:flex; gap:var(--space-4); align-items:center; padding:var(--space-2) var(--space-4); border-bottom:1px solid var(--line); white-space:nowrap; min-width:0; overflow:hidden; }
.rx-bar .t { font-weight:var(--bold); }
.rx-bar .dim, .rx-dim { color:var(--dim); }
.rx-bar .sp { flex:1; }
.rx-bar button { font:inherit; background:var(--control); border:1px solid var(--control-line); color:var(--dim); padding:0 var(--space-3); border-radius:var(--radius); cursor:pointer; }
.rx-bar button.on { color:var(--fg); border-color:var(--dim); }
.rx-n { font-variant-numeric:tabular-nums; }
.rx-sel { font:inherit; background:var(--control); color:var(--dim); border:1px solid var(--control-line); border-radius:var(--radius); padding:0 var(--space-2); max-width:180px; }
.rx-sel option { background:var(--panel); color:var(--fg); }
.rx-say { color:${C.say}; } .rx-fail { color:${C.fail}; } .rx-write { color:${C.write}; }
.rx-canvas { position:relative; overflow:hidden; cursor:grab; user-select:none; min-height:0; }
.rx-canvas.panning { cursor:grabbing; }
.rx-canvas svg { width:100%; height:100%; display:block; }
.rx-branch { fill:none; stroke:${C.say}; stroke-linecap:round; }
.rx-branch.way { stroke:var(--pick); stroke-opacity:1 !important; }
.rx-dot { fill:var(--fg); fill-opacity:.85; }
.rx-bough .rx-dot { fill-opacity:.5; }
.rx-node { cursor:pointer; }
.rx-trial .rx-dot { fill:none !important; stroke-width:1.2; }
.rx-ring { fill:none; stroke-width:1.6; stroke:none; }
.rx-ring.v-held { stroke:${C.say}; } .rx-ring.v-failed { stroke:${C.fail}; } .rx-ring.v-quiet { stroke:var(--quiet); stroke-dasharray:1.5 1.5; }
.rx-name { fill:var(--fg); font:var(--bold) ${S.nameText}px var(--font); dominant-baseline:middle; pointer-events:none; }
.rx-bough .rx-name { fill:var(--dim); font-weight:500; }
.rx-trial .rx-name { font-style:italic; }
.rx-pick .rx-name { fill:var(--pick); }
.rx-pick .rx-dot { stroke:var(--pick); stroke-width:2; }
.rx-lit .rx-name { fill:${C.say}; }
.rx-lit.rx-hot-fail .rx-name { fill:${C.fail}; }
.rx-root { fill:var(--fg); }
.rx-trail { fill:none; stroke-width:${S.trail}; stroke-opacity:${S.trailInk}; stroke-linecap:round; stroke-linejoin:round; pointer-events:none; }
.rx-glow, .rx-head { pointer-events:none; }
.k-say { fill:${C.say}; } .k-fail { fill:${C.fail}; } .k-write { fill:${C.write}; }
.rx-trail.k-say { stroke:${C.say}; fill:none; } .rx-trail.k-fail { stroke:${C.fail}; fill:none; } .rx-trail.k-write { stroke:${C.write}; fill:none; }
.rx-key { position:absolute; left:10px; bottom:10px; padding:var(--space-3) var(--space-3); background:color-mix(in srgb, var(--bg) 88%, transparent); border:1px solid var(--line); border-radius:var(--radius); font-size:var(--text-s); color:var(--dim); display:grid; grid-template-columns:auto 1fr; gap:var(--space-1) var(--space-3); align-items:center; pointer-events:none; }
.rx-key svg { width:14px; height:10px; }
.rx-card { position:absolute; right:10px; top:10px; max-width:min(340px, 45%); padding:var(--space-3) var(--space-4); background:var(--panel); border:1px solid var(--line); border-radius:var(--radius); }
.rx-card .t { font-weight:var(--bold); }
.rx-card .kv { color:var(--dim); white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
.rx-card a { color:var(--pick); }
.rx-empty { position:absolute; inset:0; display:grid; place-items:center; color:var(--dim); pointer-events:none; }
`);

const clock = (t?: string) => (t ? new Date(t).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "");

const reflex: Pack = {
  id: "reflex",
  about: "The Reflex tree: everything the map says to agents, as one tree that lights up as they work.",
  inject: ["slot.fill", "here.read", "here.set", "agent.tree", "exchange.read", "exchange.watch", "verdict.read", "graph.read", "graph.watch", "profile.read"],
  apply(ctx: Context) {
    const here = ctx.get<HereRead>("here.read");
    const set = ctx.get<HereSet>("here.set");
    const agent = ctx.get<AgentTree>("agent.tree");
    const read = ctx.get<ExchangeRead>("exchange.read");
    const live = ctx.get<ExchangeWatch>("exchange.watch");
    const verdicts = ctx.get<VerdictRead>("verdict.read");
    const graph = ctx.get<GraphRead>("graph.read");
    const graphLive = ctx.get<GraphWatch>("graph.watch");
    const profiles = ctx.get<ProfileRead>("profile.read");

    const { useProfileList, useProfileNodes } = profileHooks(graph, graphLive, profiles);

    // ---------- hooks over the capabilities ----------

    const useHere = <T extends Json>(key: string): T | undefined => {
      const [v, setV] = useState<T | undefined>(here.get<T>(key));
      useEffect(() => here.watch(key, (c) => setV(c.value as T | undefined)) as () => void, [key]);
      return v;
    };

    const useNodes = (): NodeInfo[] => {
      const [nodes, setNodes] = useState(agent.nodes());
      useEffect(() => {
        const stop = agent.watch(() => setNodes(agent.nodes()));
        setNodes(agent.nodes());
        return stop as () => void;
      }, []);
      return nodes;
    };

    const useRuns = (): RunInfo[] => {
      const [runs, setRuns] = useState<RunInfo[]>([]);
      useEffect(() => {
        const load = () => void read.runs({ limit: 20 }).then((p) => setRuns(p.items));
        load();
        return live.watch({ kinds: ["begin", "end"] }, load) as () => void;
      }, []);
      return runs;
    };

    const useVerdicts = (run?: string): Map<string, Verdict> => {
      const [v, setV] = useState<Map<string, Verdict>>(new Map());
      useEffect(() => {
        setV(new Map());
        if (!run) return;
        let gone = false;
        let timer: ReturnType<typeof setTimeout> | undefined;
        const go = () => void verdicts.run(run).then((list) => !gone && setV(new Map(list.map((x) => [x.node, x.verdict]))));
        go();
        const stop = verdicts.watch((c) => {
          if (c.run !== undefined && c.run !== run) return;
          clearTimeout(timer);
          timer = setTimeout(go, 200);
        });
        return () => {
          gone = true;
          clearTimeout(timer);
          void stop();
        };
      }, [run]);
      return v;
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

    // ---------- lights ----------

    /** Runs the lights and sparks in a group of the svg, a frame at a time, outside Preact. */
    const lighter = (group: SVGGElement, svg: SVGSVGElement, get: () => { tree: Tree; placed: Placed; k: number }) => {
      const still = matchMedia("(prefers-reduced-motion: reduce)").matches;
      type Fx = { start: number; els: SVGElement[]; step: (age: number, k: number) => boolean };
      const fx: Fx[] = [];
      const lit = new Map<string, ReturnType<typeof setTimeout>>();
      let frame = 0;
      const el = (tag: string, attrs: Record<string, string | number>) => {
        const e = document.createElementNS(NS, tag);
        for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, String(v));
        group.append(e);
        return e;
      };
      const light = (id: string, tone: string) => {
        const node = svg.querySelector(`[data-id="${CSS.escape(id)}"]`);
        if (!node) return;
        clearTimeout(lit.get(id));
        node.classList.add("rx-lit");
        node.classList.toggle("rx-hot-fail", tone === "fail");
        lit.set(id, setTimeout(() => (node.classList.remove("rx-lit", "rx-hot-fail"), lit.delete(id)), S.linger * 1000));
      };
      const tick = (now: number) => {
        const { k } = get();
        for (let i = fx.length - 1; i >= 0; i--) {
          const f = fx[i]!;
          // A frame's time may come before the effect started: its age is never below 0.
          if (!f.step(Math.max(0, now - f.start) / 1000, k)) {
            f.els.forEach((e) => e.remove());
            fx.splice(i, 1);
          }
        }
        frame = fx.length ? requestAnimationFrame(tick) : 0;
      };
      const run = () => (frame ||= requestAnimationFrame(tick));
      const glow = (tone: string) => [1, 0.6, 0.3].map((r, i) => el("circle", { class: `rx-glow k-${tone}`, r, "fill-opacity": [S.glow / 2, S.glow, Math.min(1, S.glow * 2)][i]!, opacity: 0 }));
      return {
        fire(e: Pick<ExchangeEvent, "kind" | "node" | "place" | "act">) {
          const { tree, placed } = get();
          const l = lightOf(tree, e);
          if (!l) return;
          if (still) return light(l.at, l.tone);
          if (l.kind === "light") {
            const pts = route(tree, placed, l.at);
            if (pts.length < 2) return;
            const trail = el("path", { class: `rx-trail k-${l.tone}`, fill: "none" });
            const head = el("circle", { class: `rx-head k-${l.tone}`, r: S.head });
            const rings = glow(l.tone);
            let reached = false;
            fx.push({
              start: performance.now(),
              els: [trail, head, ...rings],
              step: (age, k) => {
                const u = Math.min(1, age / S.pulse);
                const flash = u < 1 ? 1 : 1 - (age - S.pulse) / S.flashTime;
                if (u >= 1 && !reached) (reached = true), light(l.at, l.tone);
                if (flash <= 0) return false;
                const [hx, hy] = pointAt(pts, u);
                const upto = pts.slice(0, Math.floor(u * (pts.length - 1)) + 1);
                trail.setAttribute("d", `M${[...upto, [hx, hy] as [number, number]].map((p) => `${p[0].toFixed(1)} ${p[1].toFixed(1)}`).join(" L")}`);
                trail.setAttribute("opacity", flash.toFixed(2));
                trail.setAttribute("stroke-width", String(S.trail / Math.sqrt(k)));
                head.setAttribute("cx", hx.toFixed(1));
                head.setAttribute("cy", hy.toFixed(1));
                head.setAttribute("opacity", u < 1 ? "1" : "0");
                const r = (u < 1 ? S.light : S.light + (S.flash - S.light) * (1 - flash)) / Math.sqrt(k);
                for (const g of rings) {
                  g.setAttribute("transform", `translate(${hx.toFixed(1)} ${hy.toFixed(1)}) scale(${r.toFixed(2)})`);
                  g.setAttribute("opacity", flash.toFixed(2));
                }
                return true;
              },
            });
          } else {
            const p = placed.xy.get(l.at);
            if (!p) return;
            light(l.at, l.tone);
            const rings = glow(l.tone);
            fx.push({
              start: performance.now(),
              els: rings,
              step: (age, k) => {
                if (age >= S.sparkLife) return false;
                const r = (S.spark + S.sparkGrow * Math.sqrt(age)) / Math.sqrt(k);
                for (const g of rings) {
                  g.setAttribute("transform", `translate(${p.x.toFixed(1)} ${p.y.toFixed(1)}) scale(${r.toFixed(2)})`);
                  g.setAttribute("opacity", (1 - age / S.sparkLife).toFixed(2));
                }
                return true;
              },
            });
          }
          run();
        },
        stop() {
          cancelAnimationFrame(frame);
          fx.forEach((f) => f.els.forEach((e) => e.remove()));
          fx.length = 0;
          lit.forEach((t) => clearTimeout(t));
        },
      };
    };

    // ---------- the view ----------

    const Key = ({ hues }: { hues: Map<string, string> }) => html`
      <div class="rx-key">
        <svg viewBox="0 0 14 10"><path class="rx-trail k-say" d="M1 5H13" style="stroke-opacity:1" /></svg><span>said: a light to its node</span>
        <svg viewBox="0 0 14 10"><path class="rx-trail k-fail" d="M1 5H13" style="stroke-opacity:1" /></svg><span>refused, or an act failed</span>
        <svg viewBox="0 0 14 10"><circle class="k-write" cx="7" cy="5" r="4" /></svg><span>the agent acted at a place</span>
        <svg viewBox="0 0 14 10"><circle class="rx-ring v-held" cx="7" cy="5" r="3.5" /></svg><span>held in the run shown</span>
        <svg viewBox="0 0 14 10"><circle class="rx-ring v-failed" cx="7" cy="5" r="3.5" /></svg><span>failed in the run shown</span>
        <svg viewBox="0 0 14 10"><circle class="rx-ring v-quiet" cx="7" cy="5" r="3.5" /></svg><span>quiet: said, nothing followed</span>
        <svg viewBox="0 0 14 10"><circle cx="7" cy="5" r="3" style=${`fill:none;stroke:${v("fg")};stroke-width:1.2`} /></svg><span>a trial node</span>
        ${[...hues].map(([p, c]) => html`<svg viewBox="0 0 14 10"><circle cx="7" cy="5" r="3.5" style=${`fill:${c}`} /></svg><span>${p === "words" ? "the map's words" : p === "grow" ? "learned (grow)" : p}</span>`)}
      </div>
    `;

    const Card = ({ info, verdict, from }: { info?: NodeInfo; verdict?: Verdict; from?: string[] }) =>
      info
        ? html`
            <div class="rx-card">
              <div class="t">${info.title}</div>
              <div class="kv">${info.kind} · ${info.pack}${verdict ? ` · ${verdict} in this run` : ""}</div>
              <div class="kv" title=${info.at.join(", ")}>${info.at.length ? info.at.join(", ") : "said nowhere"}</div>
              ${from?.length ? html`<div class="kv" title="The profiles it comes from, nearest first">from ${from.join(", ")}</div>` : null}
              <div class="kv"><a href="#harness">Open in the harness view</a></div>
            </div>
          `
        : null;

    const Canvas = ({ tree, placed, hues, statuses, byNode, picked, fires }: {
      tree: Tree;
      placed: Placed;
      hues: Map<string, string>;
      statuses: Map<string, string>;
      byNode: Map<string, Verdict>;
      picked?: string;
      fires: { current?: (e: Pick<ExchangeEvent, "kind" | "node" | "place" | "act">) => void };
    }) => {
      const box = useRef<HTMLDivElement>(null);
      const svg = useRef<SVGSVGElement>(null);
      const fxGroup = useRef<SVGGElement>(null);
      const [view, setView] = useState({ x: placed.box.x, y: placed.box.y, k: 1 });
      const [panning, setPanning] = useState(false);
      const [fits, refit] = useState(0);
      const now = useRef({ tree, placed, k: view.k });
      now.current = { tree, placed, k: view.k };

      useEffect(() => {
        const W = box.current?.clientWidth || 900;
        const H = box.current?.clientHeight || 700;
        const k = Math.min(3, Math.max(0.1, Math.min(W / placed.box.width, H / placed.box.height)));
        setView({ k, x: placed.box.x - (W / k - placed.box.width) / 2, y: placed.box.y - (H / k - placed.box.height) / 2 });
      }, [placed, fits]);
      // Fit again when the canvas changes size: it is first measured before the page has laid it out.
      useEffect(() => {
        let last = "";
        const ro = new ResizeObserver(([e]) => {
          const size = `${Math.round(e!.contentRect.width)}x${Math.round(e!.contentRect.height)}`;
          if (size !== last && e!.contentRect.width > 0 && e!.contentRect.height > 0) (last = size), refit((n) => n + 1);
        });
        ro.observe(box.current!);
        return () => ro.disconnect();
      }, []);

      useEffect(() => {
        const l = lighter(fxGroup.current!, svg.current!, () => now.current);
        fires.current = l.fire;
        return () => {
          l.stop();
          fires.current = undefined;
        };
      }, []);

      const toWorld = (e: { clientX: number; clientY: number }) => {
        const r = box.current!.getBoundingClientRect();
        return { x: view.x + (e.clientX - r.left) / view.k, y: view.y + (e.clientY - r.top) / view.k };
      };
      const hit = (p: { x: number; y: number }) => {
        let best: string | undefined, d = 12 / view.k;
        for (const t of tree.order) {
          if (!t.node) continue;
          const q = placed.xy.get(t.id)!;
          const dd = Math.hypot(q.x - p.x, q.y - p.y);
          if (dd < d) (d = dd), (best = t.id);
        }
        return best;
      };
      const onWheel = (e: WheelEvent) => {
        e.preventDefault();
        const p = toWorld(e);
        const k = Math.min(6, Math.max(0.05, view.k * Math.exp(-e.deltaY * 0.0015)));
        const r = box.current!.getBoundingClientRect();
        setView({ k, x: p.x - (e.clientX - r.left) / k, y: p.y - (e.clientY - r.top) / k });
      };
      const onDown = (e: PointerEvent) => {
        if (e.button !== 0) return;
        const on = hit(toWorld(e));
        const start = { cx: e.clientX, cy: e.clientY, view };
        let moved = false;
        const el = box.current!;
        el.setPointerCapture(e.pointerId);
        const move = (m: PointerEvent) => {
          if (!moved && Math.hypot(m.clientX - start.cx, m.clientY - start.cy) < 4) return;
          moved = true;
          setPanning(true);
          setView({ ...start.view, x: start.view.x - (m.clientX - start.cx) / start.view.k, y: start.view.y - (m.clientY - start.cy) / start.view.k });
        };
        const up = () => {
          el.removeEventListener("pointermove", move);
          el.removeEventListener("pointerup", up);
          el.removeEventListener("pointercancel", up);
          setPanning(false);
          if (!moved && on) {
            set.set(KEYS.node, on);
            set.set(KEYS.event, undefined);
          } else if (!moved) set.set(KEYS.node, undefined);
        };
        el.addEventListener("pointermove", move);
        el.addEventListener("pointerup", up);
        el.addEventListener("pointercancel", up);
      };

      // The picked node's way from the root.
      const way = useMemo(() => {
        const s = new Set<string>();
        for (let t = picked ? tree.byId.get(picked) : undefined; t?.parent; t = t.parent) s.add(t.id);
        return s;
      }, [picked, tree]);
      const statusOf = (n?: NodeInfo) => (n?.source ? statuses.get(n.source) : undefined);
      const rest = tree.order.filter((t) => t.parent);
      return html`
        <div class=${`rx-canvas${panning ? " panning" : ""}`} ref=${box} onWheel=${onWheel} onPointerDown=${onDown} onDblClick=${() => refit((n) => n + 1)} title="Click a node to pick it; drag to move; wheel to zoom; double-click to fit">
          <svg ref=${svg}><g transform=${`scale(${view.k}) translate(${-view.x} ${-view.y})`}>
            <g>
              ${rest.map((t) => {
                const b = branchAt(t.depth);
                return html`<path key=${`b:${t.id}`} class=${`rx-branch${way.has(t.id) ? " way" : ""}`} d=${placed.branch.get(t.id)} style=${`stroke-width:${way.has(t.id) ? b.width + 1 : b.width};stroke-opacity:${b.ink}`} />`;
              })}
            </g>
            <g>
              ${rest.map((t) => {
                const p = placed.xy.get(t.id)!;
                const l = placed.labels.get(t.id)!;
                const n = t.node;
                const trial = statusOf(n) === "trial";
                const v = n ? byNode.get(n.id) : undefined;
                const r = n ? S.leaf : S.node;
                const hue = n ? hues.get(n.pack) : undefined;
                const tip = n ? `${n.title}\n${n.kind} · ${n.pack}${trial ? " · trial" : ""}${v ? ` · ${v}` : ""}\n${n.at.join(", ") || "said nowhere"}` : t.title;
                return html`
                  <g key=${`n:${t.id}`} data-id=${t.id} class=${`${n ? "rx-node" : "rx-bough"}${trial ? " rx-trial" : ""}${picked === t.id ? " rx-pick" : ""}`} transform=${`translate(${p.x.toFixed(1)} ${p.y.toFixed(1)})`}>
                    <title>${tip}</title>
                    ${v && html`<circle class=${`rx-ring v-${v}`} r=${r + 2.5} />`}
                    <circle class="rx-dot" r=${r} style=${hue ? (trial ? `stroke:${hue}` : `fill:${hue}`) : ""} />
                    <text class="rx-name" transform=${`rotate(${l.turn})`} x=${l.dx} y=${l.dy} text-anchor=${l.anchor}>${l.text}</text>
                  </g>
                `;
              })}
            </g>
            <circle class="rx-root" r=${S.root} />
            <g ref=${fxGroup}></g>
          </g></svg>
          ${tree.order.length === 1 && html`<div class="rx-empty">No nodes to show.</div>`}
          <${Key} hues=${hues} />
        </div>
      `;
    };

    const View = () => {
      const nodes = useNodes();
      const [by, setBy] = useState<Grouping>("place");
      const [unsaid, setUnsaid] = useState(false);
      const [profile, setProfile] = useState("");
      const profileList = useProfileList();
      const held = useProfileNodes(profile, nodes);
      const shownNodes = useMemo(() => (held ? nodes.filter((n) => held.has(n.id)) : nodes), [nodes, held]);
      const grouping = by === "profile" && !held ? "place" : by;
      const tree = useMemo(() => treeOf(shownNodes, { by: grouping, unsaid, ...(held ? { profiles: held } : {}) }), [shownNodes, grouping, unsaid, held]);
      const placed = useMemo(() => radial(tree), [tree]);
      const hues = useMemo(() => packHues(nodes.map((n) => n.pack)), [nodes]);
      const statuses = useStatuses();
      const runs = useRuns();
      const pinned = useHere<string>(KEYS.run);
      const run = pinned ?? runs[0]?.run;
      const info = runs.find((r) => r.run === run);
      const byNode = useVerdicts(run);
      const picked = useHere<string>(KEYS.node);
      const fires = useRef<((e: Pick<ExchangeEvent, "kind" | "node" | "place" | "act">) => void) | undefined>(undefined);
      const [playing, setPlaying] = useState(false);
      const replay = useRef<(() => void) | undefined>(undefined);

      // Every event as it is appended, from every run.
      useEffect(() => live.watch({}, (e) => fires.current?.(e)) as () => void, []);
      useEffect(() => () => replay.current?.(), []);

      const play = async () => {
        if (playing) return replay.current?.();
        if (!run) return;
        setPlaying(true);
        const events: ExchangeEvent[] = [];
        for (let p = await read.events(run, { limit: 500 }); ; p = await read.events(run, { limit: 500, after: p.next })) {
          events.push(...p.items);
          if (!p.next) break;
        }
        const timers = events.map((e, i) => setTimeout(() => fires.current?.(e), i * 110));
        const done = setTimeout(() => setPlaying(false), events.length * 110 + 1500);
        replay.current = () => {
          timers.forEach(clearTimeout);
          clearTimeout(done);
          setPlaying(false);
          replay.current = undefined;
        };
      };

      const sum = { held: 0, failed: 0, quiet: 0 };
      for (const v of byNode.values()) sum[v]++;
      const shown = tree.order.filter((t) => t.node).length;
      const pickedInfo = nodes.find((n) => n.id === picked);
      return html`
        <div class="rx">
          <div class="rx-bar">
            <span class="t">Reflex tree</span>
            <span class="dim rx-n">${shown} node${shown === 1 ? "" : "s"}</span>
            <button class=${by === "place" ? "on" : ""} onClick=${() => setBy("place")}>by place</button>
            <button class=${by === "pack" ? "on" : ""} onClick=${() => setBy("pack")}>by pack</button>
            ${held ? html`<button class=${by === "profile" ? "on" : ""} onClick=${() => setBy("profile")} title="Group by the profile each node comes from">by profile</button>` : null}
            ${profileList.length ? html`<select class="rx-sel" value=${profile} onChange=${(e: Event) => setProfile((e.target as HTMLSelectElement).value)} title="Show one profile's nodes">
              <option value="">all</option>
              ${profileList.map((p) => html`<option value=${p.id}>${p.title}</option>`)}
            </select>` : null}
            ${by === "place" && (tree.hidden || unsaid) ? html`<button class=${unsaid ? "on" : ""} onClick=${() => setUnsaid(!unsaid)} title="Nodes whose places are empty: kept, but never said">${unsaid ? "hide" : "show"} ${unsaid ? "" : tree.hidden} never said</button>` : null}
            <span class="sp"></span>
            ${run
              ? html`<span class="dim" title=${run}>run ${run.slice(0, 8)} ${clock(info?.started)}${info && !info.ended ? html` <span class="rx-say">● live</span>` : ""}${pinned ? "" : " (newest)"}</span>`
              : html`<span class="dim">no run yet</span>`}
            <span class="rx-n"><span class="rx-say">${token(verdictGlyph("held"))} ${sum.held}</span> <span class="rx-fail">${token(verdictGlyph("failed"))} ${sum.failed}</span> <span class="dim">${token(verdictGlyph("quiet"))} ${sum.quiet}</span></span>
            <button disabled=${!run} onClick=${play} title="Play the run shown again, its events in order">${playing ? "Stop" : "Replay"}</button>
          </div>
          <div style="position:relative;min-height:0;display:grid">
            <${Canvas} tree=${tree} placed=${placed} hues=${hues} statuses=${statuses} byNode=${byNode} picked=${picked} fires=${fires} />
            <${Card} info=${pickedInfo} verdict=${picked ? byNode.get(picked) : undefined} from=${picked ? held?.get(picked) : undefined} />
          </div>
        </div>
      `;
    };

    ctx.effect(() => {
      const style = document.createElement("style");
      style.textContent = SHEET;
      document.head.append(style);
      return () => style.remove();
    });
    ctx.get<SlotFill>("slot.fill").fill({ slot: "shell.main", name: "view", title: "Reflex tree", view: View });
  },
};

export default reflex;
