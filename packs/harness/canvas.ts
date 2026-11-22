/**
 * The Sensory interface's tree, drawn: every node as one circular tree grown
 * from its root (layout.ts), lit by the run up to the event looked at.
 *
 * - A node the run said is lit blue, one it refused with red; one a profile
 *   held back is struck and faint, one only a shadow would have is dashed.
 * - Its dot has its pack's hue, hollow while its item is a trial, larger
 *   the more it is said (the count after its name: in the run, or all time). A mark after
 *   the name gives its standing by the keep pack: ↑ promote, ↓ retire, ⊝ held
 *   back by a check.
 * - A ring gives its verdict, once the run is looked at to its end.
 * - `fire` runs a light from the root to a node said (red when refused); its
 *   name lights when the light gets there, not before. Or it runs a spark on the bough of an act's place. Under reduced motion only the
 *   names light.
 *
 * - Small (one agent's tree among many, trees.ts): names show only on what
 *   is lit, said or picked.
 *
 * Drag to move, wheel to zoom, double-click to fit: the camera is set on the
 * picture's transform as it moves, and the tree drawn again once it settles. A press picks a node by
 * its name, or within HIT_PX of its dot. The camera fits once,
 * when first laid out, and then only on a double-click (`shouldFit`): the
 * map changing under it never moves it. A click picks a node,
 */
import { Key, marksIn, type KeyFilter } from "./key.ts";
export type { KeyFilter } from "./key.ts";
import { givenOnly } from "./given.ts";
import { h } from "preact";
import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import htm from "htm";
import type { NodeInfo } from "../../spec/agent.ts";
import type { ExchangeEvent } from "../../spec/exchange.ts";
import { sheet, v } from "../../spec/style.ts";
import { fadeCrowded } from "./labels.ts";
import { Branch, Node, type Standing } from "./nodes.ts";
import { cameraOf, HIT_PX, nearest, SETTLE_MS, shouldFit, fitKey } from "./camera.ts";
export { fitKey, HIT_PX, nearest, shouldFit } from "./camera.ts";
import { branchAt, dotsBox, lightOf, pointAt, route, STYLE, type Placed, type Tree } from "./layout.ts";
import type { Verdict } from "./hooks.ts";
import type { Heard, Hold } from "./replay.ts";
import { windowShown, type WindowMark } from "./windowbar.ts";

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
.rx-canvas svg { --rx-fade:0s; }
.rx-branch { transition:stroke var(--rx-fade), stroke-opacity var(--rx-fade); }
.rx-name { transition:fill var(--rx-fade), opacity var(--rx-fade); }
.rx-bough .rx-name { transition:opacity .25s; }
.rx-bough .rx-name.rx-hide { opacity:0 !important; }
.rx-small .rx-name { opacity:0; font-size:15px; paint-order:stroke; stroke:var(--bg); stroke-width:3px; stroke-linejoin:round; }
.rx-small .rx-branch { stroke-width:2px !important; }
.rx-small .rx-dot { r:3.5px; }
.rx-small .rx-lit .rx-name, .rx-small .rx-said .rx-name, .rx-small .rx-refused .rx-name, .rx-small .rx-pick .rx-name { opacity:1; }
.rx-dot { fill:var(--fg); fill-opacity:.85; }
.rx-bough .rx-dot { fill-opacity:.5; }
.rx-node { cursor:pointer; }
.rx-trial .rx-dot { fill:none !important; stroke-width:1.2; }
.rx-branch.given { stroke:var(--harness); }
.rx-given .rx-name { fill:var(--harness); font-weight:400; }
.rx-given .rx-dot { fill:var(--harness); fill-opacity:.9; }
.rx-given.rx-unused .rx-dot { fill-opacity:.15; stroke:var(--harness); stroke-width:1.2; }
.rx-bough.rx-given .rx-name { fill:var(--harness); opacity:.8; }
.rx-ring { fill:none; stroke-width:1.6; stroke:none; }
.rx-win { pointer-events:none; }
.rx-win.w-in { fill:var(--say); fill-opacity:.16; stroke:none; }
.rx-win.w-listed { fill:none; stroke:var(--dim); stroke-width:1.1; stroke-dasharray:1 2; }
.rx-win.w-dropped { fill:none; stroke:var(--dim); stroke-width:1.4; stroke-linecap:round; }
.rx-small .rx-win { display:none; }
.rx-ring.v-held { stroke:${C.say}; } .rx-ring.v-failed { stroke:${C.fail}; } .rx-ring.v-quiet { stroke:var(--quiet); stroke-dasharray:1.5 1.5; }
.rx-name { fill:var(--fg); font:var(--bold) ${S.nameText}px var(--font); dominant-baseline:middle; pointer-events:none; }
.rx-node .rx-name { pointer-events:auto; cursor:pointer; }
.rx-name .c { fill:var(--dim); font-weight:400; font-variant-numeric:tabular-nums; }
.rx-name .up { fill:${C.say}; } .rx-name .down, .rx-name .gone { fill:${C.fail}; }
.rx-bough .rx-name { fill:var(--dim); font-weight:500; }
.rx-trial .rx-name { font-style:italic; }
.rx-said .rx-name { fill:${C.say}; } .rx-said .rx-dot { fill-opacity:1; }
.rx-refused .rx-name { fill:${C.fail}; }
.rx-wait.rx-said .rx-name, .rx-wait.rx-refused .rx-name { fill:var(--fg); } .rx-wait.rx-said .rx-dot { fill-opacity:.85; }
.rx-held { opacity:.38; } .rx-held .rx-name { text-decoration:line-through; }
.rx-shadow .rx-dot { stroke:var(--dim); stroke-dasharray:1.5 1; stroke-width:1.2; }
.rx-retired .rx-name { text-decoration:line-through; fill:var(--dim); }
.rx-pick .rx-name { fill:var(--pick); }
.rx-pick .rx-dot { stroke:var(--pick); stroke-width:2; }
.rx-lit .rx-name { fill:${C.say}; }
.rx-lit.rx-run .rx-name { fill:var(--rx-run); }
.rx-lit.rx-hot-fail .rx-name { fill:${C.fail}; }
.rx-root { fill:var(--fg); }
.rx-trail { fill:none; stroke-width:${S.trail}; stroke-opacity:${S.trailInk}; stroke-linecap:round; stroke-linejoin:round; pointer-events:none; }
.rx-glow, .rx-head { pointer-events:none; }
.k-say { fill:${C.say}; } .k-fail { fill:${C.fail}; } .k-write { fill:${C.write}; }
.rx-trail.k-say { stroke:${C.say}; fill:none; } .rx-trail.k-fail { stroke:${C.fail}; fill:none; } .rx-trail.k-write { stroke:${C.write}; fill:none; }
.rx-key { position:absolute; left:10px; bottom:10px; padding:var(--space-3); background:color-mix(in srgb, var(--bg) 88%, transparent); border:1px solid var(--line); border-radius:var(--radius); font-size:var(--text-s); color:var(--dim); display:grid; grid-template-columns:auto 1fr; gap:var(--space-1) var(--space-3); align-items:center; pointer-events:none; }
.rx-key svg { width:14px; height:10px; }
.rx-key.filters { pointer-events:auto; }
.rx-key .rx-krow { display:contents; font:inherit; color:inherit; cursor:pointer; }
.rx-key .rx-krow > span { cursor:pointer; text-align:left; justify-self:start; }
.rx-key .rx-krow:hover > span { color:var(--fg); }
.rx-key .rx-krow.off > * { opacity:.35; } .rx-key .rx-krow.off > span { text-decoration:line-through; }
.rx-key .rx-kfull { grid-column:1 / -1; }
.rx-key .rx-ksec { grid-column:1 / -1; margin-top:var(--space-2); padding-top:var(--space-2); border-top:1px solid var(--line); color:var(--fg); font-size:var(--text-xs); font-weight:var(--bold); }
.rx-key .rx-kfull + .rx-ksec { margin-top:0; }
.rx-key .rx-khead { font:inherit; font-size:var(--text-xs); background:none; border:0; padding:0; color:var(--dim); cursor:pointer; }
.rx-key .rx-khead:hover { color:var(--fg); }
.rx-key.closed { display:flex; gap:var(--space-3); align-items:center; white-space:nowrap; }
.rx-key .rx-kmark { display:inline-flex; background:none; border:0; padding:0; cursor:pointer; }
.rx-key .rx-kmark.off { opacity:.3; }
.rx-key .rx-kmark:hover { filter:brightness(1.4); }
.rx-empty { position:absolute; inset:0; display:flex; align-items:center; justify-content:center; color:var(--dim); pointer-events:none; white-space:nowrap; }
.rx-empty::before { content:var(--glyph-circle-fresh); color:var(--mark-fresh); margin-right:var(--space-3); }
`);

/**
 * Runs a light for an event; with a colour (a run's, when many are shown), in it rather than the event's tone.
 */
export type Fire = (e: Pick<ExchangeEvent, "kind" | "node" | "place" | "act"> & { run?: string }, color?: string) => void;

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
  const light = (id: string, tone: string, color?: string, secs: number = S.linger) => {
    const node = svg.querySelector<SVGElement>(`[data-id="${CSS.escape(id)}"]`);
    if (!node) return;
    clearTimeout(lit.get(id));
    node.classList.add("rx-lit");
    node.classList.toggle("rx-hot-fail", tone === "fail");
    node.classList.toggle("rx-run", !!color);
    if (color) node.style.setProperty("--rx-run", color);
    lit.set(id, setTimeout(() => (node.classList.remove("rx-lit", "rx-hot-fail", "rx-run"), lit.delete(id)), secs * 1000));
  };
  /** Paints an effect's elements in a run's colour. */
  const paint = (els: SVGElement[], color?: string) => {
    if (!color) return;
    for (const e of els) e.style.setProperty(e.tagName === "path" ? "stroke" : "fill", color);
  };
  // A node a light is on its way to keeps its name unlit until the light gets there.
  const waiting = new Map<string, number>();
  const wait = (id: string) => {
    waiting.set(id, (waiting.get(id) ?? 0) + 1);
    svg.querySelector(`[data-id="${CSS.escape(id)}"]`)?.classList.add("rx-wait");
  };
  const arrive = (id: string) => {
    const n = (waiting.get(id) ?? 1) - 1;
    if (n > 0) return void waiting.set(id, n);
    waiting.delete(id);
    svg.querySelector(`[data-id="${CSS.escape(id)}"]`)?.classList.remove("rx-wait");
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
  const run_ = () => (frame ||= requestAnimationFrame(tick));
  const glow = (tone: string) => [1, 0.6, 0.3].map((r, i) => el("circle", { class: `rx-glow k-${tone}`, r, "fill-opacity": [S.glow / 2, S.glow, Math.min(1, S.glow * 2)][i]!, opacity: 0 }));
  const fire: Fire = (e, color) => {
    const { tree, placed } = get();
    const l = lightOf(tree, e);
    if (!l) return;
    if (still) return light(l.at, l.tone, color);
    if (l.kind === "light") {
      const pts = route(tree, placed, l.at);
      if (pts.length < 2) return;
      const trail = el("path", { class: `rx-trail k-${l.tone}`, fill: "none" });
      const head = el("circle", { class: `rx-head k-${l.tone}`, r: S.head });
      const rings = glow(l.tone);
      paint([trail, head, ...rings], color);
      let reached = false;
      wait(l.at);
      fx.push({
        start: performance.now(),
        els: [trail, head, ...rings],
        step: (age, k) => {
          const u = Math.min(1, age / S.pulse);
          const flash = u < 1 ? 1 : 1 - (age - S.pulse) / S.flashTime;
          if (u >= 1 && !reached) (reached = true), arrive(l.at), light(l.at, l.tone, color);
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
      light(l.at, l.tone, color);
      const rings = glow(l.tone);
      paint(rings, color);
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
    run_();
  };
  return {
    fire,
    stop() {
      cancelAnimationFrame(frame);
      fx.forEach((f) => f.els.forEach((e) => e.remove()));
      fx.length = 0;
      lit.forEach((t) => clearTimeout(t));
      for (const id of waiting.keys()) svg.querySelector(`[data-id="${CSS.escape(id)}"]`)?.classList.remove("rx-wait");
      waiting.clear();
    },
  };
}

export type { Standing } from "./nodes.ts";

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
  /** This tree has the key: the big one, or one run's. */
  showKey: boolean;
  /** The key open (every mark with its words), else collapsed to one line. */
  keyOpen?: boolean;
  onKeyOpen?(open: boolean): void;
  /** The key as a filter: its rows hide and show. */
  keyFilter?: KeyFilter;
  /** Small, one of many: names show only on what is lit, said or picked. */
  small?: boolean;
  /** Each node's place in the agent's window at the playhead: in it, listed only, dropped (windowbar.ts). */
  window?: ReadonlyMap<string, WindowMark>;
}

export const Canvas = ({ tree, placed, hues, statuses, rings, heard, held, counts, standing, picked, fires, onPick, showKey, keyOpen, onKeyOpen, keyFilter, small, window: win }: CanvasProps) => {
  const box = useRef<HTMLDivElement>(null);
  const svg = useRef<SVGSVGElement>(null);
  const fxGroup = useRef<SVGGElement>(null);
  // The camera: kept in a ref and set straight on the picture's transform while a wheel or a drag goes on, so
  // moving draws nothing again; one render follows once it settles (SETTLE_MS), for what depends on the zoom.
  const viewRef = useRef({ x: placed.box.x, y: placed.box.y, k: 1 });
  const camera = useRef<SVGGElement>(null);
  const [, rendered] = useState(0);
  const settle = useRef(0);
  const moving = useRef(false);
  const view = viewRef.current;
  const setView = (v: { x: number; y: number; k: number }) => {
    viewRef.current = v;
    rendered((n) => n + 1);
  };
  /** While moving: the transform alone, and a render once it settles. */
  const glide = (v: { x: number; y: number; k: number }) => {
    viewRef.current = v;
    now.current.k = v.k;
    moving.current = true;
    camera.current?.setAttribute("transform", cameraOf(v));
    clearTimeout(settle.current);
    settle.current = window.setTimeout(() => ((moving.current = false), rendered((n) => n + 1)), SETTLE_MS);
  };
  useEffect(() => () => clearTimeout(settle.current), []);
  const panning = useRef(false);
  const [fits, refit] = useState(0);
  const now = useRef({ tree, placed, k: view.k });
  now.current = { tree, placed, k: view.k };
  // Fit the dots, not the names: a long name never shrinks or shifts the picture.
  const bounds = dotsBox(placed, small ? 40 : 60);
  // The camera fits once, when the canvas is first laid out, and then only when asked (a double-click):
  // the map changing under it never moves it.
  const manual = useRef(false);
  const fitted = useRef(false);
  const ask = useRef(false);
  const shape = fitKey(tree.order.length, bounds);

  useEffect(() => {
    const W = box.current?.clientWidth ?? 0;
    const H = box.current?.clientHeight ?? 0;
    if (!W || !H) return;
    if (!shouldFit({ fitted: fitted.current, manual: manual.current, asked: ask.current })) return;
    ask.current = false;
    fitted.current = true;
    const k = Math.min(3, Math.max(0.1, Math.min(W / bounds.width, H / bounds.height)));
    setView({ k, x: bounds.x - (W / k - bounds.width) / 2, y: bounds.y - (H / k - bounds.height) / 2 });
  }, [shape, fits, small]);
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
    const v = viewRef.current;
    return { x: v.x + (e.clientX - r.left) / v.k, y: v.y + (e.clientY - r.top) / v.k };
  };
  const hit = (p: { x: number; y: number }) => {
    const pts = tree.order.flatMap((t) => {
      const id = t.node?.id ?? t.decided?.node;
      const q = placed.xy.get(t.id);
      return id && q ? [{ id, x: q.x, y: q.y }] : [];
    });
    return nearest(pts, p, HIT_PX / viewRef.current.k);
  };
  /** A node's name is part of it: a press on the name picks it. */
  const named = (target: EventTarget | null) => {
    const g = (target as Element | null)?.closest?.("g.rx-node") as SVGGElement | null;
    const t = g ? tree.byId.get(g.dataset.id ?? "") : undefined;
    return t ? (t.node?.id ?? t.decided?.node) : undefined;
  };
  const onWheel = (e: WheelEvent) => {
    e.preventDefault();
    manual.current = true;
    const p = toWorld(e);
    const k = Math.min(6, Math.max(0.05, viewRef.current.k * Math.exp(-e.deltaY * 0.0015)));
    const r = box.current!.getBoundingClientRect();
    glide({ k, x: p.x - (e.clientX - r.left) / k, y: p.y - (e.clientY - r.top) / k });
  };
  const onDown = (e: PointerEvent) => {
    if (e.button !== 0) return;
    const on = named(e.target) ?? hit(toWorld(e));
    const start = { cx: e.clientX, cy: e.clientY, view: viewRef.current };
    let moved = false;
    const el = box.current!;
    el.setPointerCapture(e.pointerId);
    const move = (m: PointerEvent) => {
      if (!moved && Math.hypot(m.clientX - start.cx, m.clientY - start.cy) < 4) return;
      moved = true;
      manual.current = true;
      if (!panning.current) (panning.current = true), box.current?.classList.add("panning");
      glide({ ...start.view, x: start.view.x - (m.clientX - start.cx) / start.view.k, y: start.view.y - (m.clientY - start.cy) / start.view.k });
    };
    const up = () => {
      el.removeEventListener("pointermove", move);
      el.removeEventListener("pointerup", up);
      el.removeEventListener("pointercancel", up);
      panning.current = false;
      box.current?.classList.remove("panning");
      if (!moved) onPick(on);
    };
    el.addEventListener("pointermove", move);
    el.addEventListener("pointerup", up);
    el.addEventListener("pointercancel", up);
  };

  // The names on the wires give way: after each draw, those that overlap anything fade (labels.ts). Not while
  // moving: the names scale with the picture, so what overlaps stays the same until it settles.
  // Only when what it measures changed: the tree, its places, the camera settled. Never in a preview, where the
  // wire names are always hidden: measuring them would only force a layout on every event.
  useEffect(() => {
    if (moving.current || small) return;
    const f = requestAnimationFrame(() => svg.current && fadeCrowded(svg.current));
    return () => cancelAnimationFrame(f);
  }, [tree, placed, view.k, view.x, view.y, small, picked]);

  // The picked node's way from the root.
  const way = useMemo(() => {
    const s = new Set<string>();
    for (let t = picked ? tree.byId.get(picked) : undefined; t?.parent; t = t.parent) s.add(t.id);
    return s;
  }, [picked, tree]);
  const statusOf = (n?: NodeInfo) => (n?.source ? statuses.get(n.source) : undefined);
  // The marks this tree shows: the key lists only those.
  const present = useMemo(
    () => (showKey ? marksIn({ nodes: tree.order.flatMap((t) => (t.node ? [t.node] : [])), heard, held, ...(rings ? { rings } : {}), trial: (n) => statusOf(n) === "trial", ...(keyFilter ? { off: keyFilter.off } : {}), ...(win ? { window: windowShown(win, tree) } : {}) }) : undefined),
    [showKey, tree, heard, held, rings, statuses, keyFilter?.off, win],
  );
  // What the harness gave, and every bough that holds nothing else: grey, so the map's own stands out in colour.
  const theirs = useMemo(() => givenOnly(tree), [tree]);
  const rest = tree.order.filter((t) => t.parent);
  return html`
    <div class=${`rx-canvas${small ? " rx-small" : ""}`} ref=${box} onWheel=${onWheel} onPointerDown=${onDown} onDblClick=${() => ((manual.current = false), (ask.current = true), refit((n) => n + 1))}>
      <svg ref=${svg}><g ref=${camera} transform=${cameraOf(view)}>
        <g>
          ${rest.map((t) => {
            const b = branchAt(t.depth);
            return html`<${Branch} key=${`b:${t.id}`} id=${t.id} d=${placed.branch.get(t.id)} width=${b.width} ink=${b.ink} way=${way.has(t.id)} theirs=${theirs.has(t.id)} />`;
          })}
        </g>
        <g>
          ${rest.map((t) => {
            const p = placed.xy.get(t.id)!;
            const n = t.node;
            const id = n?.id ?? t.decided?.node;
            // Plain values only: a node draws again when one of them changes (nodes.ts).
            return html`<${Node}
              key=${`n:${t.id}`}
              t=${t}
              x=${p.x}
              y=${p.y}
              label=${placed.labels.get(t.id)!}
              leaf=${S.leaf}
              bough=${S.node}
              hue=${n ? hues.get(n.pack) : undefined}
              trial=${statusOf(n) === "trial"}
              theirs=${theirs.has(t.id)}
              hear=${n ? heard.get(n.id) : undefined}
              held=${n ? held.get(n.id) : undefined}
              standing=${id ? standing.get(id) : undefined}
              window=${id ? win?.get(id) : undefined}
              ring=${id ? rings?.get(id) : undefined}
              said=${id ? counts.get(id) : undefined}
              picked=${!!picked && picked === id}
              k=${n ? view.k : 1}
              small=${!!small}
            />`;
          })}
        </g>
        <circle class="rx-root" r=${S.root} />
        <g ref=${fxGroup}></g>
      </g></svg>
      ${tree.order.length === 1 && html`<div class="rx-empty">No nodes</div>`}
      ${showKey && html`<${Key} hues=${hues} filter=${keyFilter} open=${keyOpen ?? true} onOpen=${onKeyOpen} present=${present} />`}
    </div>
  `;
};
