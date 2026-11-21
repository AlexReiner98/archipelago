/**
 * The field running on a canvas: the loop, the camera and the pointer.
 *
 * - The loop steps the physics while it has energy, as many steps as fit in
 *   `frame_ms`, paints when anything changed, and otherwise costs nothing.
 * - Over a particle: its title and its links lit. A click opens it.
 *   Dragging a particle holds it under the pointer, and once let go the
 *   layout settles round it again; dragging the sea pans; the wheel zooms
 *   about the pointer; a double-click on the sea fits the picture.
 * - The picture is fitted while it settles, until the reader moves it.
 */
import type { Id } from "../../spec/common.ts";
import type { Dial } from "./behaviour.ts";
import { bounds, build, grid, seed, sizes, type FieldIn, type G, type Grid, type Settings } from "./graph.ts";
import { ink, Light, paint, type Cam, type Ink } from "./paint.ts";
import { step, warm } from "./step.ts";

export interface Stats {
  n: number;
  m: number;
  islands: number;
  steps: number;
  alpha: number;
  crossings: number;
  state: "settling" | "untangling" | "settled";
  /** The mean time of a step over the last frames, in ms. */
  ms: number;
  /** Steps and time from the last seed or warm to settled. */
  settledIn?: { steps: number; ms: number };
}

export interface Field {
  input(next: FieldIn): void;
  settings(S: Settings, then: Dial["then"] | "none"): void;
  reseed(): void;
  fit(): void;
  stats(): Stats;
  /** Where each particle is now, by id: for tests and for whoever asks. */
  places(): Map<Id, [number, number]>;
  destroy(): void;
}

export interface Hooks {
  open(id: Id | undefined): void;
  hover(tip: { title: string; sub: string; x: number; y: number } | null): void;
}

export function field(canvas: HTMLCanvasElement, S0: Settings, hooks: Hooks): Field {
  let S = S0;
  const c = canvas.getContext("2d")!;
  let g: G = build({ items: [], islands: [], links: [] }, null);
  let pick: Grid = grid(g);
  const cam: Cam & { moved: boolean } = { k: 1, tx: 0, ty: 0, moved: false };
  const light = new Light();
  let colours: Ink = ink(canvas);
  let hover = -1, dirty = true, awake = false, stopped = false;
  let stepMs = 0, runStart = { steps: 0, at: 0 }, settledIn: Stats["settledIn"];
  const size = () => ({ width: canvas.clientWidth, height: canvas.clientHeight, dpr: devicePixelRatio || 1 });

  const fit = () => {
    const [x0, y0, x1, y1] = bounds(g), { width, height } = size();
    const pad = S.fit_pad!;
    const w = Math.max(1, width - 2 * pad), h = Math.max(1, height - 2 * pad);
    cam.k = Math.min(w / Math.max(1, x1 - x0), h / Math.max(1, y1 - y0));
    cam.tx = width / 2 - ((x0 + x1) / 2) * cam.k;
    cam.ty = height / 2 - ((y0 + y1) / 2) * cam.k;
  };
  const wake = () => {
    if (!awake) runStart = { steps: g.sim.steps, at: performance.now() };
    awake = true;
    dirty = true;
  };
  const toWorld = (sx: number, sy: number): [number, number] => [(sx - cam.tx) / cam.k, (sy - cam.ty) / cam.k];
  const local = (e: { clientX: number; clientY: number }) => {
    const r = canvas.getBoundingClientRect();
    return [e.clientX - r.left, e.clientY - r.top] as const;
  };
  const under = (sx: number, sy: number) => {
    const [wx, wy] = toWorld(sx, sy);
    return pick.nearest(wx, wy, 4 / cam.k);
  };

  // ─── The loop ───
  let raf = 0;
  const tick = () => {
    if (stopped) return;
    if (awake) {
      const t0 = performance.now();
      let steps = 0, energy = 0;
      do {
        energy = step(g, S);
        steps++;
      } while (energy && performance.now() - t0 < S.frame_ms!);
      const per = (performance.now() - t0) / steps;
      stepMs = stepMs ? stepMs * 0.8 + per * 0.2 : per;
      if (!energy && !press) {
        awake = false;
        settledIn = { steps: g.sim.steps - runStart.steps, ms: performance.now() - runStart.at };
      }
      pick = grid(g);
      dirty = true;
    }
    if (dirty) {
      if (awake && !cam.moved && S.follow) fit();
      const s = size();
      if (canvas.width !== Math.round(s.width * s.dpr) || canvas.height !== Math.round(s.height * s.dpr)) {
        canvas.width = Math.round(s.width * s.dpr);
        canvas.height = Math.round(s.height * s.dpr);
      }
      const easing = light.ease(g, hover, S);
      paint(c, g, cam, S, light, colours, pick, s);
      dirty = easing;
    }
    raf = requestAnimationFrame(tick);
  };
  raf = requestAnimationFrame(tick);

  // ─── The pointer ───
  let press: { id: number; x: number; y: number; tx: number; ty: number; node: number; moved: boolean } | null = null;
  const onMove = (e: PointerEvent) => {
    const [x, y] = local(e);
    if (press && press.id === e.pointerId) {
      if (!press.moved && Math.hypot(x - press.x, y - press.y) > 5) press.moved = true;
      if (!press.moved) return;
      if (press.node >= 0) {
        const [wx, wy] = toWorld(x, y), i = press.node;
        g.x[i] = wx;
        g.y[i] = wy;
        g.vx[i] = g.vy[i] = 0;
        g.fixed[i] = 1;
        wake();
      } else {
        cam.tx = press.tx + (x - press.x);
        cam.ty = press.ty + (y - press.y);
        cam.moved = true;
      }
      dirty = true;
      return;
    }
    const i = under(x, y);
    if (i !== hover) {
      hover = i;
      canvas.style.cursor = i >= 0 ? "pointer" : "grab";
      hooks.hover(i >= 0 ? { title: g.title[i]!, sub: `${g.type[i]}${g.status[i] ? ` · ${g.status[i]}` : ""} · ${g.islands[g.island[i]!]!.title}`, x, y } : null);
      dirty = true;
    } else if (i >= 0) hooks.hover({ title: g.title[i]!, sub: `${g.type[i]}${g.status[i] ? ` · ${g.status[i]}` : ""} · ${g.islands[g.island[i]!]!.title}`, x, y });
  };
  const onDown = (e: PointerEvent) => {
    if (e.button !== 0) return;
    const [x, y] = local(e);
    canvas.setPointerCapture(e.pointerId);
    press = { id: e.pointerId, x, y, tx: cam.tx, ty: cam.ty, node: under(x, y), moved: false };
    canvas.style.cursor = "grabbing";
  };
  const onUp = (e: PointerEvent) => {
    if (!press || press.id !== e.pointerId) return;
    if (!press.moved) hooks.open(press.node >= 0 ? g.id[press.node] : undefined);
    if (press.node >= 0 && press.moved) {
      g.fixed[press.node] = 0;
      warm(g, S);
      wake();
    }
    press = null;
    canvas.style.cursor = hover >= 0 ? "pointer" : "grab";
  };
  const onLeave = () => {
    if (press) return;
    hover = -1;
    hooks.hover(null);
    dirty = true;
  };
  const onWheel = (e: WheelEvent) => {
    e.preventDefault();
    const [x, y] = local(e);
    const f = Math.min(40 / cam.k, Math.max(0.02 / cam.k, Math.exp(-e.deltaY * 0.0015)));
    cam.tx = x - (x - cam.tx) * f;
    cam.ty = y - (y - cam.ty) * f;
    cam.k *= f;
    cam.moved = true;
    dirty = true;
  };
  const onDbl = (e: MouseEvent) => {
    const [x, y] = local(e);
    if (under(x, y) >= 0) return;
    cam.moved = false;
    fit();
    dirty = true;
  };
  const resize = new ResizeObserver(() => {
    if (!cam.moved) fit();
    dirty = true;
  });
  resize.observe(canvas);
  const scheme = matchMedia("(prefers-color-scheme: dark)");
  const recolour = () => ((colours = ink(canvas)), (dirty = true));
  scheme.addEventListener("change", recolour);
  canvas.addEventListener("pointermove", onMove);
  canvas.addEventListener("pointerdown", onDown);
  canvas.addEventListener("pointerup", onUp);
  canvas.addEventListener("pointercancel", onUp);
  canvas.addEventListener("pointerleave", onLeave);
  canvas.addEventListener("wheel", onWheel, { passive: false });
  canvas.addEventListener("dblclick", onDbl);

  return {
    input(next) {
      const first = !g.n;
      g = build(next, g.n ? g : null);
      seed(g, S);
      if (first) g.sim = { alpha: 1, steps: 0, crossings: 0 };
      else warm(g, S);
      pick = grid(g);
      hover = -1;
      if (!cam.moved) fit();
      wake();
    },
    settings(next, then) {
      S = next;
      if (then === "seed") return this.reseed();
      if (then === "size") sizes(g, S);
      if (then === "warm" || then === "size") warm(g, S), wake();
      dirty = true;
    },
    reseed() {
      g.placed.fill(0);
      g.vx.fill(0);
      g.vy.fill(0);
      g.vz.fill(0);
      seed(g, S);
      g.sim = { alpha: 1, steps: 0, crossings: 0 };
      pick = grid(g);
      cam.moved = false;
      fit();
      awake = false;
      wake();
    },
    fit() {
      cam.moved = false;
      fit();
      dirty = true;
    },
    stats() {
      const un = g.sim.un as { done?: boolean } | undefined;
      const state = g.sim.alpha >= S.alpha_min! ? "settling" : awake && un && !un.done ? "untangling" : awake ? "untangling" : "settled";
      return { n: g.n, m: g.m, islands: g.islands.length, steps: g.sim.steps, alpha: g.sim.alpha, crossings: g.sim.crossings, state, ms: stepMs, settledIn };
    },
    places() {
      return new Map(g.id.map((id, i) => [id, [g.x[i]!, g.y[i]!]]));
    },
    destroy() {
      stopped = true;
      cancelAnimationFrame(raf);
      resize.disconnect();
      scheme.removeEventListener("change", recolour);
      canvas.removeEventListener("pointermove", onMove);
      canvas.removeEventListener("pointerdown", onDown);
      canvas.removeEventListener("pointerup", onUp);
      canvas.removeEventListener("pointercancel", onUp);
      canvas.removeEventListener("pointerleave", onLeave);
      canvas.removeEventListener("wheel", onWheel);
      canvas.removeEventListener("dblclick", onDbl);
    },
  };
}
