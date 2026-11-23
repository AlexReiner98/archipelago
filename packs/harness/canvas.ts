/**
 * The Context interface's tree, drawn: every node as one circular tree grown
 * from its root (layout.ts), lit by the run up to the event looked at. It is
 * painted on a 2D canvas, as the Landscape is (paint.ts, scene.ts): no
 * element per node, so a zoom, a move or an event is one repaint.
 *
 * - A node the run said is lit blue, one it refused with red; one a profile
 *   held back is struck and faint, one only a shadow would have is dashed.
 * - Its dot has its pack's hue, hollow while its item is a trial, larger
 *   the more it is said (the count after its name: in the run, or all time). A mark after
 *   the name gives its standing by the keep pack: ↑ promote, ↓ retire, ⊝ held
 *   back by a check.
 * - A ring gives its verdict, once the run is looked at to its end.
 * - `fire` runs a light from the root to a node said (red when refused); its
 *   name lights when the light gets there, not before. Or it runs a spark on
 *   the bough of an act's place (lights.ts). Under reduced motion only the
 *   names light.
 * - The names on the wires give way where they overlap (labels.ts), worked
 *   out again once the camera settles.
 * - Small (one agent's tree among many, trees.ts): names show only on what
 *   is lit, said or picked.
 *
 * Drag to move, wheel to zoom, double-click to fit. A press picks a node by
 * its name, or within HIT_PX of its dot; resting the pointer on a node or a
 * bough shows its words after `tipMs`. The camera fits once, when first
 * laid out, again when the tree outgrows the view, and on a double-click (`shouldFit`): the map changing
 * under it otherwise never moves it.
 */
import { Key, marksIn, type KeyFilter } from "./key.ts";
export type { KeyFilter } from "./key.ts";
import { givenOnly } from "./given.ts";
import { h } from "preact";
import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import htm from "htm";
import type { NodeInfo } from "../../spec/agent.ts";
import { onStyle, sheet } from "../../spec/style.ts";
import { crowdedNames, boxQuad, nameQuad, type Quad } from "./labels.ts";
import { HIT_PX, nearest, outgrown, SETTLE_MS, shouldFit, fitKey } from "./camera.ts";
export { fitKey, HIT_PX, nearest, shouldFit } from "./camera.ts";
import { dotsBox, STYLE, type Placed, type Tree } from "./layout.ts";
import type { Verdict } from "./hooks.ts";
import type { Heard, Hold } from "./replay.ts";
import { windowShown, type WindowMark } from "./windowbar.ts";
import { Lights, type Fire } from "./lights.ts";
export type { Fire } from "./lights.ts";
import { dotExtent, dotOf, Ink, nameLayout, paint, Widths, type Camera } from "./paint.ts";
import { Atlas } from "./sprites.ts";
import { nameInk, sceneOf, type Mark, type Scene, type Standing } from "./scene.ts";
export type { Standing } from "./scene.ts";

const html: (s: TemplateStringsArray, ...v: unknown[]) => any = (htm as unknown as { bind(f: typeof h): any }).bind(h);

/** How long a wire name takes to fade out where it is crowded, or back in, in ms. */
const NAME_FADE_MS = 250;
/** A name's height for picking and crowding, as a share of its size. */
const NAME_TALL = 1.2;
/** A box grown by m on every side. */
const pad = (b: { x: number; y: number; width: number; height: number }, m: number) => ({ x: b.x - m, y: b.y - m, width: b.width + 2 * m, height: b.height + 2 * m });

export const CANVAS_STYLE = sheet(`
.rx-canvas { position:relative; overflow:hidden; cursor:grab; user-select:none; min-height:0; }
.rx-canvas.panning { cursor:grabbing; }
.rx-canvas.on-node { cursor:pointer; }
.rx-canvas > canvas { position:absolute; inset:0; width:100%; height:100%; display:block; }
.rx-tip { position:absolute; z-index:2; max-width:360px; padding:var(--space-2) var(--space-3); background:var(--bg); border:1px solid var(--line); border-radius:var(--radius); color:var(--fg); font-size:var(--text-s); white-space:pre-line; pointer-events:none; overflow-wrap:anywhere; }
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
  /** How long the pointer rests on a node before its words show, in ms (the `tip_ms` dial); 0, never. */
  tipMs?: number;
  /** While moving, names are drawn at this many sizes per doubling of the zoom (the `name_steps` dial); 0, every size. */
  nameSteps?: number;
  /** Below this size on screen a node's name shows only if it matters (paint.ts `quiet`). */
  quietPx?: number;
}

/** A name's outline in the picture's units, along its own line: where it starts, how long, how tall. */
function nameBox(m: Mark, ink: Ink, widths: Widths, small: boolean) {
  const ni = nameInk(m, { waiting: false, small });
  const L = nameLayout(m, ink, widths, small, ni.weight, ni.italic);
  return { x: m.x, y: m.y, turn: m.label.turn, from: L.start, to: L.start + L.total, dy: m.label.dy, h: L.size * NAME_TALL };
}

/** Whether the point (px, py) is on a mark's name. */
function onName(m: Mark, px: number, py: number, ink: Ink, widths: Widths, small: boolean): boolean {
  const b = nameBox(m, ink, widths, small);
  const a = (-b.turn * Math.PI) / 180, dx = px - b.x, dy = py - b.y;
  const u = dx * Math.cos(a) - dy * Math.sin(a), w = dx * Math.sin(a) + dy * Math.cos(a);
  return u >= b.from && u <= b.to && Math.abs(w - b.dy) <= b.h / 2;
}

/** The wire names crowded at zoom k: what overlaps a node's name or dot, a bough's dot, the root, or a name kept before it. */
function crowdedAt(scene: Scene, k: number, ink: Ink, widths: Widths, waiting: ReadonlySet<string>): Set<string> {
  const others: Quad[] = [];
  const names: { id: string; depth: number; quad: Quad }[] = [];
  for (const m of scene.marks) {
    if (m.bough) {
      names.push({ id: m.id, depth: m.depth, quad: nameQuad(nameBox(m, ink, widths, false), k) });
    } else if (!waiting.has(m.id)) {
      others.push(nameQuad(nameBox(m, ink, widths, false), k));
    }
    if (m.node && waiting.has(m.id)) continue;
    const d = dotOf(m, k, false), e = dotExtent(d.shape, d.r);
    others.push(boxQuad(m.x + e.x0, m.y + e.y0, m.x + e.x1, m.y + e.y1, k));
  }
  others.push(boxQuad(-STYLE.root, -STYLE.root, STYLE.root, STYLE.root, k));
  return crowdedNames(names, others);
}

export const Canvas = ({ tree, placed, hues, statuses, rings, heard, held, counts, standing, picked, fires, onPick, showKey, keyOpen, onKeyOpen, keyFilter, small, window: win, tipMs = 600, nameSteps = 4, quietPx = 0 }: CanvasProps) => {
  const box = useRef<HTMLDivElement>(null);
  const cv = useRef<HTMLCanvasElement>(null);
  const tipEl = useRef<HTMLDivElement>(null);
  // The camera: kept in a ref, and the canvas painted again as it moves; nothing renders for it.
  const viewRef = useRef<Camera>({ x: placed.box.x, y: placed.box.y, k: 1 });
  const [fits, refit] = useState(0);
  // What the tree draws: the scene, made again only when what it shows changed.
  const theirs = useMemo(() => givenOnly(tree), [tree]);
  const scene = useMemo(
    () => sceneOf({ tree, placed, hues, statuses, ...(rings ? { rings } : {}), heard, held, counts, standing, ...(picked ? { picked } : {}), ...(win ? { window: win } : {}), theirs }),
    [tree, placed, hues, statuses, rings, heard, held, counts, standing, picked, win, theirs],
  );
  const now = useRef({ tree, placed, scene, small: !!small, tipMs, nameSteps, quietPx });
  now.current = { tree, placed, scene, small: !!small, tipMs, nameSteps, quietPx };

  // The painter: made once, outside Preact, as the Landscape's engine is.
  type Painter = { schedule(): void; recrowd(): void; lights: Lights; ink: Ink; widths: Widths; moving: boolean; zooming: boolean };
  const painter = useRef<Painter | undefined>(undefined);
  useEffect(() => {
    const el = box.current!, canvas = cv.current!;
    const c = canvas.getContext("2d")!;
    const ink = new Ink(el);
    const widths = new Widths(c);
    const atlas = typeof OffscreenCanvas === "undefined" ? undefined : new Atlas();
    const paths = new Map<string, Path2D>();
    const shown = new Map<string, number>();
    let want = new Set<string>();
    let raf = 0, last = 0;
    const P: Painter = {
      ink,
      widths,
      moving: false,
      zooming: false,
      lights: undefined as unknown as Lights,
      schedule: () => void (raf ||= requestAnimationFrame(frame)),
      recrowd: () => {
        if (now.current.small) return;
        want = crowdedAt(now.current.scene, viewRef.current.k, ink, widths, P.lights.waiting);
        P.schedule();
      },
    };
    P.lights = new Lights(() => now.current, P.schedule);
    const frame = (t: number) => {
      raf = 0;
      const dpr = devicePixelRatio || 1, width = el.clientWidth, height = el.clientHeight;
      if (!width || !height) return;
      if (canvas.width !== Math.round(width * dpr) || canvas.height !== Math.round(height * dpr)) (canvas.width = Math.round(width * dpr)), (canvas.height = Math.round(height * dpr));
      // Each wire name eases toward shown or hidden.
      const dt = last ? Math.min(100, t - last) : 16;
      last = t;
      let fading = false;
      for (const m of now.current.scene.marks) {
        if (!m.bough) continue;
        const goal = want.has(m.id) ? 0 : 1, at = shown.get(m.id) ?? 1;
        if (at === goal) continue;
        const next = goal > at ? Math.min(goal, at + dt / NAME_FADE_MS) : Math.max(goal, at - dt / NAME_FADE_MS);
        shown.set(m.id, next);
        if (next !== goal) fading = true;
      }
      const v = viewRef.current;
      paint(c, now.current.scene, v, { width, height, dpr }, ink, widths, { waiting: P.lights.waiting, lit: P.lights.lit, shown, small: now.current.small, steps: now.current.nameSteps, zooming: P.zooming, quiet: now.current.quietPx }, paths, (cx) => P.lights.draw(cx, v.k, ink, t), atlas);
      if (fading || P.lights.running) P.schedule();
      else last = 0;
    };
    painter.current = P;
    fires.current = P.lights.fire;
    const restyle = () => (ink.clear(), atlas?.clear(), P.schedule());
    const off = onStyle(restyle);
    const scheme = matchMedia("(prefers-color-scheme: dark)");
    scheme.addEventListener("change", restyle);
    return () => {
      cancelAnimationFrame(raf);
      P.lights.stop();
      fires.current = undefined;
      off();
      scheme.removeEventListener("change", restyle);
      ink.dispose();
    };
  }, []);

  // A changed scene is painted again, and its wire names placed again.
  useEffect(() => {
    painter.current?.recrowd();
    painter.current?.schedule();
  }, [scene, small]);

  const settle = useRef(0);
  const setView = (v: Camera) => {
    viewRef.current = v;
    painter.current?.recrowd();
    painter.current?.schedule();
  };
  /** While moving: paint each frame; the wire names are placed again once it settles. */
  const glide = (v: Camera) => {
    const P = painter.current;
    if (P && v.k !== viewRef.current.k) P.zooming = true;
    viewRef.current = v;
    if (!P) return;
    P.moving = true;
    P.schedule();
    clearTimeout(settle.current);
    settle.current = window.setTimeout(() => ((P.moving = false), (P.zooming = false), P.recrowd(), P.schedule()), SETTLE_MS);
  };
  useEffect(() => () => clearTimeout(settle.current), []);

  // A preview fits its dots; the big tree fits its names too (the layout's measured box), so every name is in sight.
  const bounds = small ? dotsBox(placed, 40) : pad(placed.box, 16);
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
    if (!shouldFit({ fitted: fitted.current, manual: manual.current, asked: ask.current, outgrown: outgrown(bounds, viewRef.current, W, H) })) return;
    ask.current = false;
    fitted.current = true;
    const k = Math.min(3, Math.max(0.1, Math.min(W / bounds.width, H / bounds.height)));
    setView({ k, x: bounds.x - (W / k - bounds.width) / 2, y: bounds.y - (H / k - bounds.height) / 2 });
  }, [shape, fits, small]);
  // Fit again when the canvas changes size: it is first measured before the page has laid it out.
  useEffect(() => {
    let lastSize = "";
    const ro = new ResizeObserver(([e]) => {
      const size = `${Math.round(e!.contentRect.width)}x${Math.round(e!.contentRect.height)}`;
      if (size !== lastSize && e!.contentRect.width > 0 && e!.contentRect.height > 0) (lastSize = size), refit((n) => n + 1), painter.current?.schedule();
    });
    ro.observe(box.current!);
    return () => ro.disconnect();
  }, []);

  const toWorld = (e: { clientX: number; clientY: number }) => {
    const r = box.current!.getBoundingClientRect();
    const v = viewRef.current;
    return { x: v.x + (e.clientX - r.left) / v.k, y: v.y + (e.clientY - r.top) / v.k };
  };
  /** The node whose name is under the point, topmost first. */
  const named = (p: { x: number; y: number }): Mark | undefined => {
    const P = painter.current;
    if (!P) return undefined;
    const marks = now.current.scene.marks;
    for (let i = marks.length - 1; i >= 0; i--) {
      const m = marks[i]!;
      if (m.node && onName(m, p.x, p.y, P.ink, P.widths, !!small)) return m;
    }
    return undefined;
  };
  const hit = (p: { x: number; y: number }) => {
    const pts = now.current.scene.marks.flatMap((m) => (m.node ? [{ id: m.node, x: m.x, y: m.y }] : []));
    return nearest(pts, p, HIT_PX / viewRef.current.k);
  };
  /** What the pointer rests on, for its words: a node's name, or any dot under it. */
  const over = (p: { x: number; y: number }): Mark | undefined => {
    const m = named(p);
    if (m) return m;
    const k = viewRef.current.k, marks = now.current.scene.marks;
    for (let i = marks.length - 1; i >= 0; i--) {
      const d = dotOf(marks[i]!, k, !!small);
      if (Math.hypot(marks[i]!.x - p.x, marks[i]!.y - p.y) <= d.r * 1.3 + 3 / k) return marks[i];
    }
    return undefined;
  };

  // The words of what the pointer rests on.
  const tipTimer = useRef(0);
  const tipOn = useRef<string | undefined>(undefined);
  const hideTip = () => {
    clearTimeout(tipTimer.current);
    tipOn.current = undefined;
    if (tipEl.current) tipEl.current.style.display = "none";
  };
  useEffect(() => () => clearTimeout(tipTimer.current), []);
  const onHover = (e: PointerEvent) => {
    if (e.buttons) return;
    const m = over(toWorld(e));
    box.current?.classList.toggle("on-node", !!m?.node);
    if (m?.id === tipOn.current) return;
    hideTip();
    if (!m || !now.current.tipMs) return;
    tipOn.current = m.id;
    const r = box.current!.getBoundingClientRect();
    const x = e.clientX - r.left, y = e.clientY - r.top;
    tipTimer.current = window.setTimeout(() => {
      const t = tipEl.current;
      if (!t || tipOn.current !== m.id) return;
      t.textContent = m.tip;
      t.style.display = "block";
      const w = t.offsetWidth, hgt = t.offsetHeight;
      t.style.left = `${Math.max(4, Math.min(r.width - w - 4, x + 12))}px`;
      t.style.top = `${y + 18 + hgt > r.height ? Math.max(4, y - hgt - 8) : y + 18}px`;
    }, now.current.tipMs);
  };

  const onWheel = (e: WheelEvent) => {
    e.preventDefault();
    hideTip();
    manual.current = true;
    const p = toWorld(e);
    const k = Math.min(6, Math.max(0.05, viewRef.current.k * Math.exp(-e.deltaY * 0.0015)));
    const r = box.current!.getBoundingClientRect();
    glide({ k, x: p.x - (e.clientX - r.left) / k, y: p.y - (e.clientY - r.top) / k });
  };
  const onDown = (e: PointerEvent) => {
    if (e.button !== 0) return;
    hideTip();
    const at = toWorld(e);
    const on = named(at)?.node ?? hit(at);
    const start = { cx: e.clientX, cy: e.clientY, view: viewRef.current };
    let moved = false;
    const el = box.current!;
    el.setPointerCapture(e.pointerId);
    const move = (m: PointerEvent) => {
      if (!moved && Math.hypot(m.clientX - start.cx, m.clientY - start.cy) < 4) return;
      if (!moved) el.classList.add("panning");
      moved = true;
      manual.current = true;
      glide({ ...start.view, x: start.view.x - (m.clientX - start.cx) / start.view.k, y: start.view.y - (m.clientY - start.cy) / start.view.k });
    };
    const up = () => {
      el.removeEventListener("pointermove", move);
      el.removeEventListener("pointerup", up);
      el.removeEventListener("pointercancel", up);
      el.classList.remove("panning");
      if (!moved) onPick(on);
    };
    el.addEventListener("pointermove", move);
    el.addEventListener("pointerup", up);
    el.addEventListener("pointercancel", up);
  };

  const statusOf = (n?: NodeInfo) => (n?.source ? statuses.get(n.source) : undefined);
  // The marks this tree shows: the key lists only those.
  const present = useMemo(
    () => (showKey ? marksIn({ nodes: tree.order.flatMap((t) => (t.node ? [t.node] : [])), heard, held, ...(rings ? { rings } : {}), trial: (n) => statusOf(n) === "trial", ...(keyFilter ? { off: keyFilter.off } : {}), ...(win ? { window: windowShown(win, tree) } : {}) }) : undefined),
    [showKey, tree, heard, held, rings, statuses, keyFilter?.off, win],
  );
  return html`
    <div class=${`rx-canvas${small ? " rx-small" : ""}`} ref=${box} onWheel=${onWheel} onPointerDown=${onDown} onPointerMove=${onHover} onPointerLeave=${() => (hideTip(), box.current?.classList.remove("on-node"))} onDblClick=${() => ((manual.current = false), (ask.current = true), refit((n) => n + 1))}>
      <canvas ref=${cv}></canvas>
      <div class="rx-tip" ref=${tipEl} style="display:none"></div>
      ${tree.order.length === 1 && html`<div class="rx-empty">No nodes</div>`}
      ${showKey && html`<${Key} hues=${hues} filter=${keyFilter} open=${keyOpen ?? true} onOpen=${onKeyOpen} present=${present} />`}
    </div>
  `;
};

