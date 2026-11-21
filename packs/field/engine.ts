/**
 * The field running on a canvas: the loop, the camera and the pointer.
 *
 * - The physics runs on its own loop (a message channel, not animation
 *   frames), in slices of `frame_ms`, until the run is fully settled: a tab
 *   in the background, where frames all but stop, settles as fast. The
 *   frames only paint, when anything changed; asleep, it costs nothing.
 * - Over a particle: its title and its links lit. A click opens it.
 *   Dragging a particle holds it under the pointer, and once let go the
 *   layout settles round it again; dragging the sea pans; the wheel zooms
 *   about the pointer; a double-click on the sea fits the picture.
 * - The picture is fitted while it settles, until the reader moves it.
 */
import type { Id } from "../../spec/common.ts";
import type { Dial } from "./behaviour.ts";
import { bounds, build, grid, seed, sizes, type FieldIn, type G, type Grid, type Settings } from "./graph.ts";
import { onStyle } from "../../spec/style.ts";
import { ink, Light, paint, palette, type Cam, type Ink } from "./paint.ts";
import { step, warm } from "./step.ts";

export interface Stats {
  n: number;
  m: number;
  steps: number;
  alpha: number;
  state: "settling" | "settled";
  /** The mean time of a step over the last frames, in ms. */
  ms: number;
  /** Steps and time from the last seed or warm to settled. */
  settledIn?: { steps: number; ms: number };
}

export interface Field {
  /** A new map to lay out; `warmTo` is how warm the run gets (else alpha_warm). */
  input(next: FieldIn, warmTo?: number): void;
  /** What the find line finds, lit over the rest, or null for none: it never moves a particle. */
  found(ids: Set<Id> | null): void;
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
  let g: G = build({ items: [], links: [] }, null);
  let pick: Grid = grid(g);
  const cam: Cam & { moved: boolean } = { k: 1, tx: 0, ty: 0, moved: false };
  const light = new Light();
  let colours: Ink = ink(canvas);
  let pal = palette(canvas);
  let hover = -1, dirty = true, awake = false, stopped = false;
  let foundIds: Set<Id> | null = null, match: Uint8Array | null = null;
  const remark = () => {
    match = foundIds ? Uint8Array.from(g.id, (id) => (foundIds!.has(id) ? 1 : 0)) : null;
    dirty = true;
  };
  let stepMs = 0, runStart = { steps: 0, at: 0 }, settledIn: Stats["settledIn"];
  const size = () => ({ width: canvas.clientWidth, height: canvas.clientHeight, dpr: devicePixelRatio || 1 });

  /** The camera that fits the whole picture now. */
  const fitted = (): Cam => {
    const [x0, y0, x1, y1] = bounds(g), { width, height } = size();
    const pad = S.fit_pad!;
    const w = Math.max(1, width - 2 * pad), h = Math.max(1, height - 2 * pad);
    const k = Math.min(w / Math.max(1, x1 - x0), h / Math.max(1, y1 - y0));
    return { k, tx: width / 2 - ((x0 + x1) / 2) * k, ty: height / 2 - ((y0 + y1) / 2) * k };
  };
  const fit = () => Object.assign(cam, fitted());
  /**
   * While it settles, the camera follows the fitted one smoothly: it closes
   * a share of the gap each frame (`follow_ms`), zooming by ratio about the
   * picture's middle, so the picture never jumps. True while still moving.
   */
  let lastFollow = 0;
  const follow = (): boolean => {
    const now = performance.now(), dt = lastFollow ? Math.min(100, now - lastFollow) : 16;
    lastFollow = now;
    const to = fitted();
    const a = S.follow_ms! > 0 ? 1 - Math.exp(-dt / S.follow_ms!) : 1;
    const { width, height } = size();
    // Where the middle of the view looks, in the world, eased; then the zoom, eased by ratio.
    const mx = (width / 2 - cam.tx) / cam.k, my = (height / 2 - cam.ty) / cam.k;
    const tmx = (width / 2 - to.tx) / to.k, tmy = (height / 2 - to.ty) / to.k;
    const k = cam.k * Math.pow(to.k / cam.k, a), nx = mx + (tmx - mx) * a, ny = my + (tmy - my) * a;
    cam.k = k;
    cam.tx = width / 2 - nx * k;
    cam.ty = height / 2 - ny * k;
    return Math.abs(Math.log(to.k / k)) > 0.002 || Math.hypot(tmx - nx, tmy - ny) * k > 0.5;
  };
  // ─── The physics' own loop: a slice, then a message to itself, until settled ───
  const chan = new MessageChannel();
  let queued = false;
  const slice = () => {
    queued = false;
    if (stopped || !awake) return;
    const t0 = performance.now();
    let steps = 0, energy = 0;
    do {
      energy = step(g, S);
      steps++;
    } while (energy && performance.now() - t0 < S.frame_ms!);
    const per = (performance.now() - t0) / steps;
    stepMs = stepMs ? stepMs * 0.8 + per * 0.2 : per;
    pick = grid(g);
    dirty = true;
    if (!energy && !press) {
      awake = false;
      settledIn = { steps: g.sim.steps - runStart.steps, ms: performance.now() - runStart.at };
      return;
    }
    // Held by a hand, a sleeping run waits for the next move instead of spinning.
    if (!energy) return;
    queued = true;
    chan.port2.postMessage(0);
  };
  chan.port1.onmessage = slice;
  const wake = () => {
    if (!awake) runStart = { steps: g.sim.steps, at: performance.now() };
    awake = true;
    dirty = true;
    if (!queued && !stopped) (queued = true), chan.port2.postMessage(0);
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
  let raf = 0, following = false;
  const tick = () => {
    if (stopped) return;
    if (dirty || following) {
      following = !cam.moved && !!S.follow && (awake || following) ? follow() : false;
      if (!following) lastFollow = 0;
      const s = size();
      if (canvas.width !== Math.round(s.width * s.dpr) || canvas.height !== Math.round(s.height * s.dpr)) {
        canvas.width = Math.round(s.width * s.dpr);
        canvas.height = Math.round(s.height * s.dpr);
      }
      const easing = light.ease(g, hover, S);
      // What lies over the canvas (the legend), in canvas pixels: no title goes under it.
      const at = canvas.getBoundingClientRect();
      const clear = Array.from(canvas.parentElement?.querySelectorAll(".fl-key") ?? [], (el) => {
        const r = el.getBoundingClientRect();
        return [r.left - at.left - 4, r.top - at.top - 4, r.right - at.left + 4, r.bottom - at.top + 4] as [number, number, number, number];
      });
      paint(c, g, cam, S, light, colours, pick, s, match, clear);
      dirty = easing || following;
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
      hooks.hover(i >= 0 ? { title: g.title[i]!, sub: `${g.type[i]}${g.status[i] ? ` · ${g.status[i]}` : ""}`, x, y } : null);
      dirty = true;
    } else if (i >= 0) hooks.hover({ title: g.title[i]!, sub: `${g.type[i]}${g.status[i] ? ` · ${g.status[i]}` : ""}`, x, y });
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
  // The legend opening or closing over the canvas moves where titles may go: paint again.
  const overlay = new MutationObserver(() => (dirty = true));
  if (canvas.parentElement) overlay.observe(canvas.parentElement, { childList: true, subtree: true });
  const scheme = matchMedia("(prefers-color-scheme: dark)");
  // The style's tokens again, on a new theme or a new style: the inks, and each type's hue.
  const recolour = () => {
    colours = ink(canvas);
    pal = palette(canvas);
    g.types.forEach((t, k) => (t.colour = pal[k] ?? t.colour));
    dirty = true;
  };
  scheme.addEventListener("change", recolour);
  const unstyle = onStyle(recolour);
  canvas.addEventListener("pointermove", onMove);
  canvas.addEventListener("pointerdown", onDown);
  canvas.addEventListener("pointerup", onUp);
  canvas.addEventListener("pointercancel", onUp);
  canvas.addEventListener("pointerleave", onLeave);
  canvas.addEventListener("wheel", onWheel, { passive: false });
  canvas.addEventListener("dblclick", onDbl);

  return {
    input(next, warmTo) {
      const first = !g.n;
      g = build(next, g.n ? g : null, pal);
      seed(g, S);
      if (first) g.sim = { alpha: 1, steps: 0 };
      else warm(g, S, warmTo);
      pick = grid(g);
      hover = -1;
      remark();
      if (first && !cam.moved) fit();
      wake();
    },
    found(ids) {
      foundIds = ids;
      remark();
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
      g.sim = { alpha: 1, steps: 0 };
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
      const state = awake ? "settling" : "settled";
      return { n: g.n, m: g.m, steps: g.sim.steps, alpha: g.sim.alpha, state, ms: stepMs, settledIn };
    },
    places() {
      return new Map(g.id.map((id, i) => [id, [g.x[i]!, g.y[i]!]]));
    },
    destroy() {
      stopped = true;
      cancelAnimationFrame(raf);
      chan.port1.close();
      resize.disconnect();
      overlay.disconnect();
      scheme.removeEventListener("change", recolour);
      unstyle();
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
