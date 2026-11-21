/**
 * The harness view's tree, drawn: every node as one circular tree grown
 * from its root (layout.ts), lit by the run up to the event looked at.
 *
 * - A node the run said is lit blue, one it refused with red; one a profile
 *   held back is struck and faint, one only a shadow would have is dashed.
 * - Its dot has its pack's hue, hollow while its item is a trial, larger
 *   the more it is said across runs (the count after its name). A mark after
 *   the name gives its standing by the keep pack: ↑ promote, ↓ retire, ⊝ held
 *   back by a check.
 * - A ring gives its verdict, once the run is looked at to its end.
 * - `fire` runs a light from the root to a node said (red when refused), or
 *   a spark on the bough of an act's place. Under reduced motion only the
 *   names light.
 *
 * Drag to move, wheel to zoom, double-click to fit. A click picks a node.
 */
import { h } from "preact";
import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import htm from "htm";
import type { NodeInfo } from "../../spec/agent.ts";
import type { ExchangeEvent } from "../../spec/exchange.ts";
import { sheet, v } from "../../spec/style.ts";
import { branchAt, lightOf, pointAt, route, STYLE, type Placed, type Tree } from "./layout.ts";
import type { Verdict } from "./hooks.ts";
import type { Heard, Hold } from "./replay.ts";

const html: (s: TemplateStringsArray, ...v: unknown[]) => any = (htm as unknown as { bind(f: typeof h): any }).bind(h);

const S = STYLE;
const C = S.colors;
const NS = "http://www.w3.org/2000/svg";

export const CANVAS_STYLE = sheet(`
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
.rx-name .c { fill:var(--dim); font-weight:400; font-variant-numeric:tabular-nums; }
.rx-name .up { fill:${C.say}; } .rx-name .down, .rx-name .gone { fill:${C.fail}; }
.rx-bough .rx-name { fill:var(--dim); font-weight:500; }
.rx-trial .rx-name { font-style:italic; }
.rx-said .rx-name { fill:${C.say}; } .rx-said .rx-dot { fill-opacity:1; }
.rx-refused .rx-name { fill:${C.fail}; }
.rx-held { opacity:.38; } .rx-held .rx-name { text-decoration:line-through; }
.rx-shadow .rx-dot { stroke:var(--dim); stroke-dasharray:1.5 1; stroke-width:1.2; }
.rx-retired .rx-name { text-decoration:line-through; fill:var(--dim); }
.rx-pick .rx-name { fill:var(--pick); }
.rx-pick .rx-dot { stroke:var(--pick); stroke-width:2; }
.rx-lit .rx-name { fill:${C.say}; }
.rx-lit.rx-hot-fail .rx-name { fill:${C.fail}; }
.rx-root { fill:var(--fg); }
.rx-trail { fill:none; stroke-width:${S.trail}; stroke-opacity:${S.trailInk}; stroke-linecap:round; stroke-linejoin:round; pointer-events:none; }
.rx-glow, .rx-head { pointer-events:none; }
.k-say { fill:${C.say}; } .k-fail { fill:${C.fail}; } .k-write { fill:${C.write}; }
.rx-trail.k-say { stroke:${C.say}; fill:none; } .rx-trail.k-fail { stroke:${C.fail}; fill:none; } .rx-trail.k-write { stroke:${C.write}; fill:none; }
.rx-key { position:absolute; left:10px; bottom:10px; padding:var(--space-3); background:color-mix(in srgb, var(--bg) 88%, transparent); border:1px solid var(--line); border-radius:var(--radius); font-size:var(--text-s); color:var(--dim); display:grid; grid-template-columns:auto 1fr; gap:var(--space-1) var(--space-3); align-items:center; pointer-events:none; }
.rx-key svg { width:14px; height:10px; }
.rx-empty { position:absolute; inset:0; display:grid; place-items:center; color:var(--dim); pointer-events:none; }
`);

export type Fire = (e: Pick<ExchangeEvent, "kind" | "node" | "place" | "act">) => void;

/** Runs the lights and sparks in a group of the svg, a frame at a time, outside Preact. */
function lighter(group: SVGGElement, svg: SVGSVGElement, get: () => { tree: Tree; placed: Placed; k: number }) {
  const still = matchMedia("(prefers-reduced-motion: reduce)").matches;
  type Fx = { start: number; els: SVGElement[]; step: (age: number, k: number) => boolean };
  const fx: Fx[] = [];
  const lit = new Map<string, ReturnType<typeof setTimeout>>();
  let frame = 0;
  const el = (tag: string, attrs: Record<string, string | number>) => {
    const e = document.createElementNS(NS, tag);
    for (const [k, val] of Object.entries(attrs)) e.setAttribute(k, String(val));
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
  const fire: Fire = (e) => {
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
  };
  return {
    fire,
    stop() {
      cancelAnimationFrame(frame);
      fx.forEach((f) => f.els.forEach((e) => e.remove()));
      fx.length = 0;
      lit.forEach((t) => clearTimeout(t));
    },
  };
}

/** A node's standing as a mark after its name. */
export type Standing = "up" | "down" | "gone";
const STANDING: Record<Standing, string> = { up: "↑", down: "↓", gone: "⊝" };

const KeyRow = (mark: unknown, text: string) => html`${mark}<span>${text}</span>`;
export const Key = ({ hues }: { hues: Map<string, string> }) => html`
  <div class="rx-key">
    ${KeyRow(html`<svg viewBox="0 0 14 10"><path class="rx-trail k-say" d="M1 5H13" style="stroke-opacity:1" /></svg>`, "said")}
    ${KeyRow(html`<svg viewBox="0 0 14 10"><path class="rx-trail k-fail" d="M1 5H13" style="stroke-opacity:1" /></svg>`, "refused · failed")}
    ${KeyRow(html`<svg viewBox="0 0 14 10"><circle class="k-write" cx="7" cy="5" r="4" /></svg>`, "acted")}
    ${KeyRow(html`<svg viewBox="0 0 14 10"><circle cx="7" cy="5" r="3" style=${`fill:${v("fg")};opacity:.38`} /></svg>`, "held back")}
    ${KeyRow(html`<svg viewBox="0 0 14 10"><circle cx="7" cy="5" r="3" style=${`fill:${v("fg")};stroke:${v("dim")};stroke-dasharray:1.5 1;stroke-width:1.2`} /></svg>`, "shadow would hold")}
    ${KeyRow(html`<svg viewBox="0 0 14 10"><circle class="rx-ring v-held" cx="7" cy="5" r="3.5" /></svg>`, "held")}
    ${KeyRow(html`<svg viewBox="0 0 14 10"><circle class="rx-ring v-failed" cx="7" cy="5" r="3.5" /></svg>`, "failed")}
    ${KeyRow(html`<svg viewBox="0 0 14 10"><circle class="rx-ring v-quiet" cx="7" cy="5" r="3.5" /></svg>`, "quiet")}
    ${KeyRow(html`<svg viewBox="0 0 14 10"><circle cx="7" cy="5" r="3" style=${`fill:none;stroke:${v("fg")};stroke-width:1.2`} /></svg>`, "trial")}
    ${[...hues].map(([p, c]) => KeyRow(html`<svg viewBox="0 0 14 10"><circle cx="7" cy="5" r="3.5" style=${`fill:${c}`} /></svg>`, p === "words" ? "the map's words" : p === "grow" ? "learned" : p))}
  </div>
`;

export interface CanvasProps {
  tree: Tree;
  placed: Placed;
  hues: Map<string, string>;
  statuses: Map<string, string>;
  /** Verdicts in the run, or nothing when it isn't looked at to its end. */
  rings?: Map<string, Verdict>;
  heard: Map<string, Heard>;
  held: Map<string, Hold>;
  counts: Map<string, number>;
  standing: Map<string, Standing>;
  picked?: string;
  fires: { current?: Fire };
  onPick(node: string | undefined): void;
  showKey: boolean;
}

export const Canvas = ({ tree, placed, hues, statuses, rings, heard, held, counts, standing, picked, fires, onPick, showKey }: CanvasProps) => {
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
      const id = t.node?.id ?? t.decided?.node;
      if (!id) continue;
      const q = placed.xy.get(t.id)!;
      const dd = Math.hypot(q.x - p.x, q.y - p.y);
      if (dd < d) (d = dd), (best = id);
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
      if (!moved) onPick(on);
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
            const id = n?.id ?? t.decided?.node;
            const trial = statusOf(n) === "trial";
            const ver = id ? rings?.get(id) : undefined;
            const said = id ? counts.get(id) : undefined;
            const r = id ? S.leaf + Math.min(3, Math.log2(1 + (said ?? 0)) * 0.45) : S.node;
            const hue = n ? hues.get(n.pack) : undefined;
            const hear = n ? heard.get(n.id) : undefined;
            const hold = n ? held.get(n.id) : undefined;
            const st = id ? standing.get(id) : undefined;
            const cls = [
              id ? "rx-node" : "rx-bough",
              trial && "rx-trial",
              hear && `rx-${hear}`,
              hold && `rx-${hold}`,
              t.decided && !t.decided.up && "rx-retired",
              picked && picked === id && "rx-pick",
            ].filter(Boolean).join(" ");
            const tip = n
              ? `${n.title}\n${n.kind} · ${n.pack}${trial ? " · trial" : ""}${hear ? ` · ${hear}` : ""}${hold ? ` · ${hold === "held" ? "held back" : "a shadow would hold it back"}` : ""}${ver ? ` · ${ver}` : ""}\n${n.at.join(", ") || "said nowhere"}${said ? `\nsaid ${said} times` : ""}`
              : t.decided ? `${t.title}\n${t.decided.up ? "kept" : "retired"}` : t.title;
            return html`
              <g key=${`n:${t.id}`} data-id=${t.id} class=${cls} transform=${`translate(${p.x.toFixed(1)} ${p.y.toFixed(1)})`}>
                <title>${tip}</title>
                ${ver && html`<circle class=${`rx-ring v-${ver}`} r=${r + 2.5} />`}
                <circle class="rx-dot" r=${r} style=${hue ? (trial ? `stroke:${hue}` : `fill:${hue}`) : ""} />
                <text class="rx-name" transform=${`rotate(${l.turn})`} x=${l.dx} y=${l.dy} text-anchor=${l.anchor}>${
                  l.anchor === "end"
                    ? html`${st && html`<tspan class=${st}>${STANDING[st]} </tspan>`}${said ? html`<tspan class="c">${said} </tspan>` : ""}${l.text}`
                    : html`${l.text}${said ? html`<tspan class="c"> ${said}</tspan>` : ""}${st && html`<tspan class=${st}> ${STANDING[st]}</tspan>`}`
                }</text>
              </g>
            `;
          })}
        </g>
        <circle class="rx-root" r=${S.root} />
        <g ref=${fxGroup}></g>
      </g></svg>
      ${tree.order.length === 1 && html`<div class="rx-empty">No nodes to show.</div>`}
      ${showKey && html`<${Key} hues=${hues} />`}
    </div>
  `;
};
