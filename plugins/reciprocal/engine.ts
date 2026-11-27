/**
 * The frame on the page: it holds the rules' evaluation, steps the live
 * `solve` (the DAG's sweep, then the agents' pushes through the field's
 * step) for `frame_ms` a frame until it settles, measures every contact,
 * and draws (gl.ts). Drag to turn, shift- or right-drag to pan, wheel to
 * zoom, double-click to fit; a click picks a beam (shift adds it).
 */
import type { Settings } from "../field/graph.ts";
import type { Stats } from "../field/engine.ts";
import { warm } from "../field/step.ts";
import { read, HUES, type Token } from "../../spec/style.ts";
import { endAt, type RG } from "./beams.ts";
import { DRAW_HERE } from "./dials.ts";
import { drawer, project, type Cam, type Picture } from "./gl.ts";
import type { V3 } from "./mesh.ts";
import { measure, RULES, solveStep, type Measure } from "./pipeline.ts";
import { evaluate, type Evaluation } from "./rules.ts";
import { add, at, len, mul, sub, unit } from "./vec.ts";

export interface FrameStats extends Stats {
  most: number;
  under: number;
  contacts: number;
  closing: number;
}

export interface Hover {
  beam: number;
  x: number;
  y: number;
}

export interface Engine {
  settings(S: Settings): void;
  select(beams: number[]): void;
  stats(): FrameStats | undefined;
  evaluation(): Evaluation | undefined;
  graph(): RG | null;
  measure(): Measure | null;
  fit(): void;
  reseed(): void;
  destroy(): void;
}

const PAINT = new Set(DRAW_HERE.map((d) => d.key));

/** A token as red, green, blue in 0–1, through a canvas, which reads any CSS colour. */
const rgbOf = (() => {
  const c = typeof document !== "undefined" ? document.createElement("canvas").getContext("2d") : null;
  return (token: Token): [number, number, number] => {
    if (!c) return [0.5, 0.5, 0.5];
    c.fillStyle = "#808080";
    c.fillStyle = read(token);
    const s = String(c.fillStyle);
    if (s.startsWith("#")) return [1, 3, 5].map((k) => parseInt(s.slice(k, k + 2), 16) / 255) as [number, number, number];
    const m = s.match(/[\d.]+/g) ?? ["128", "128", "128"];
    return [Number(m[0]) / 255, Number(m[1]) / 255, Number(m[2]) / 255];
  };
})();
const mix = (a: number[], b: number[], t: number) => a.map((x, k) => x + (b[k]! - x) * t) as [number, number, number];

export function engine(canvas: HTMLCanvasElement, on: { pick(beam: number | null, add: boolean): void; hover(h: Hover | null): void; ran(): void }): Engine {
  const gl = drawer(canvas);
  let S: Settings = {};
  let ev: Evaluation | undefined;
  let g: RG | null = null;
  let mz: Measure | null = null;
  let picked = new Set<number>();
  let hovered = -1;
  const cam: Cam = { yaw: 0.6, pitch: 0.55, scale: 1, target: [0, 0, 0], pan: [0, 0] };
  let running = false, dirty = true, stepMs = 0, settledIn: Stats["settledIn"], runStart = 0, runSteps = 0, raf = 0;
  let meshKey = "";

  const size = () => ({ W: canvas.clientWidth || 1, H: canvas.clientHeight || 1, dpr: devicePixelRatio || 1 });
  const ends = (b: number): [V3, V3] => {
    const o = S.overhang ?? 0, A = at(g!, 2 * b), B = at(g!, 2 * b + 1), d = unit(sub(B, A));
    return [sub(A, mul(d, o)), add(B, mul(d, o))];
  };
  const reach = () => {
    if (!g) return 100;
    let r = 0;
    for (let i = 0; i < g.n; i++) r = Math.max(r, len(sub(at(g, i), cam.target)));
    return r || 100;
  };

  const fit = () => {
    if (!g || !g.n) return;
    const lo: V3 = [Infinity, Infinity, Infinity], hi: V3 = [-Infinity, -Infinity, -Infinity];
    for (let i = 0; i < g.n; i++) for (let k = 0; k < 3; k++) (lo[k] = Math.min(lo[k]!, at(g, i)[k]!)), (hi[k] = Math.max(hi[k]!, at(g, i)[k]!));
    cam.target = mul(add(lo, hi), 0.5);
    cam.pan = [0, 0];
    const { W, H } = size();
    cam.scale = (0.8 * Math.min(W, H)) / Math.max(1, len(sub(hi, lo)));
    dirty = true;
  };

  const paint = () => {
    if (!gl || !g) return;
    const { W, H, dpr } = size();
    const held = rgbOf("held"), failed = rgbOf("failed"), pick = rgbOf("pick"), dim = rgbOf("dim"), fg = rgbOf("fg"), line = rgbOf("line");
    const hues = HUES.map((h) => rgbOf(h));
    const m = g.m, beams = new Float32Array(m * 10);
    for (let b = 0; b < m; b++) {
      const [A, B] = ends(b);
      const colourBy = S.colour ?? 0;
      let c: [number, number, number] =
        colourBy === 1 ? hues[g.rf.rests.level[b]! % hues.length]! : colourBy === 2 ? mix(dim, fg, 0.35) : mix(held, failed, Math.min(1, (mz?.worst[b] ?? 0) / 0.1));
      if (picked.has(b)) c = pick;
      else if (b === hovered) c = mix(c, pick, 0.5);
      beams.set([...A, ...B, g.rf.r[b]!, ...c], b * 10);
    }
    const mesh = g.rf.mesh, lines: number[] = [];
    if (S.show_mesh) {
      for (const [p, q] of mesh.edges) lines.push(...mesh.nodes[p]!.p, ...line, 0.35, ...mesh.nodes[q]!.p, ...line, 0.35);
      for (const nd of mesh.nodes) if (!nd.support) lines.push(...nd.p, ...line, 0.6, ...add(nd.p, mul(nd.n, 30)), ...line, 0.6);
    }
    const dots: number[] = [];
    if (S.show_contacts && mz)
      g.rf.rests.contacts.forEach((c, k) => {
        const p = at(g!, endAt(mesh, c.over, c.node));
        const col = mix(held, failed, Math.min(1, Math.abs(mz!.gap[k]!) / (0.1 * 2 * g!.rf.r[c.over]!)));
        dots.push(...p, ...col, 1, c.closing ? -11 : 6);
      });
    for (const nd of mesh.nodes) if (nd.support) dots.push(...nd.p, ...dim, 0.8, 7);
    gl.draw({ cam, W, H, dpr, reach: reach(), beams, beamCount: m, lines: new Float32Array(lines), lineCount: lines.length / 7, dots: new Float32Array(dots), dotCount: dots.length / 8 });
  };

  const tick = () => {
    raf = requestAnimationFrame(tick);
    if (g && running) {
      const t0 = performance.now();
      let k = 0;
      while (performance.now() - t0 < (S.frame_ms ?? 12)) {
        k++;
        if (solveStep(g, S) === 0) {
          running = false;
          if (g.sim.settled) settledIn = { steps: g.sim.steps - runSteps, ms: performance.now() - runStart };
          break;
        }
      }
      stepMs = (performance.now() - t0) / Math.max(1, k);
      mz = measure(g);
      summarise();
      dirty = true;
    }
    if (dirty) (paint(), (dirty = false));
  };

  /** The live rules' words on the DAG: how the solve goes and what it measures. */
  const summarise = () => {
    if (!ev || !g) return;
    const state = running ? "settling" : g.sim.settled ? "settled" : "stopped";
    ev.ran.solve!.summary = `${state} · step ${g.sim.steps} · push ${(g.sim.push ?? 0).toFixed(3)}`;
    if (mz) ev.ran.measure!.summary = `worst gap ${(mz.most * 100).toFixed(1)}% · ${mz.under} under`;
    on.ran();
  };

  const run = () => {
    if (!g) return;
    running = true;
    runStart = performance.now();
    runSteps = g.sim.steps;
    settledIn = undefined;
  };

  // The pointer: turn, pan, zoom, pick.
  let down: { x: number; y: number; pan: boolean; moved: boolean } | null = null;
  const beamAt = (x: number, y: number): number => {
    if (!g) return -1;
    const { W, H } = size();
    let best = -1, bestDepth = -Infinity;
    for (let b = 0; b < g.m; b++) {
      const [A, B] = ends(b);
      const a = project(cam, W, H, A), c = project(cam, W, H, B);
      const dx = c[0] - a[0], dy = c[1] - a[1], l2 = dx * dx + dy * dy || 1;
      const t = Math.max(0, Math.min(1, ((x - a[0]) * dx + (y - a[1]) * dy) / l2));
      const d = Math.hypot(x - a[0] - t * dx, y - a[1] - t * dy);
      const depth = a[2] + t * (c[2] - a[2]);
      if (d <= g.rf.r[b]! * cam.scale + 3 && depth > bestDepth) (best = b), (bestDepth = depth);
    }
    return best;
  };
  const onDown = (e: PointerEvent) => {
    canvas.setPointerCapture(e.pointerId);
    down = { x: e.clientX, y: e.clientY, pan: e.shiftKey || e.button !== 0, moved: false };
  };
  const onMove = (e: PointerEvent) => {
    const r = canvas.getBoundingClientRect(), x = e.clientX - r.left, y = e.clientY - r.top;
    if (down) {
      const dx = e.clientX - down.x, dy = e.clientY - down.y;
      if (Math.abs(dx) + Math.abs(dy) > 3) down.moved = true;
      if (!down.moved) return;
      if (down.pan) (cam.pan[0] += dx), (cam.pan[1] += dy);
      else (cam.yaw += dx * 0.008), (cam.pitch = Math.max(-1.5, Math.min(1.5, cam.pitch + dy * 0.008)));
      down.x = e.clientX;
      down.y = e.clientY;
      dirty = true;
      return;
    }
    const b = beamAt(x, y);
    if (b !== hovered) (hovered = b), (dirty = true);
    on.hover(b >= 0 ? { beam: b, x, y } : null);
  };
  const onUp = (e: PointerEvent) => {
    if (down && !down.moved) {
      const r = canvas.getBoundingClientRect(), b = beamAt(e.clientX - r.left, e.clientY - r.top);
      on.pick(b >= 0 ? b : null, e.shiftKey);
    }
    down = null;
  };
  const onWheel = (e: WheelEvent) => {
    e.preventDefault();
    cam.scale *= Math.exp(-e.deltaY * 0.0015);
    dirty = true;
  };
  const onLeave = () => ((hovered = -1), (dirty = true), on.hover(null));
  const noMenu = (e: Event) => e.preventDefault();
  canvas.addEventListener("pointerdown", onDown);
  canvas.addEventListener("pointermove", onMove);
  canvas.addEventListener("pointerup", onUp);
  canvas.addEventListener("pointerleave", onLeave);
  canvas.addEventListener("wheel", onWheel, { passive: false });
  canvas.addEventListener("dblclick", fit);
  canvas.addEventListener("contextmenu", noMenu);
  const ro = new ResizeObserver(() => (dirty = true));
  ro.observe(canvas);
  raf = requestAnimationFrame(tick);

  return {
    settings(next) {
      const was = S;
      S = next;
      const changed = [...new Set([...Object.keys(was), ...Object.keys(next)])].filter((k) => was[k] !== next[k]);
      if (!changed.length && ev) return;
      ev = evaluate(RULES, S, ev);
      if (ev.ran.frame!.ran) {
        g = ev.out.frame as RG;
        mz = measure(g);
        run();
        const key = `${S.mesh}/${S.detail}`;
        if (key !== meshKey) (meshKey = key), fit();
      } else if (g && changed.some((k) => !PAINT.has(k))) {
        g.rf.r = (ev.out.radii as Float32Array).slice();
        warm(g, S);
        run();
      }
      summarise();
      dirty = true;
    },
    select(beams) {
      picked = new Set(beams);
      dirty = true;
    },
    stats() {
      if (!g) return undefined;
      const state = running ? "settling" : g.sim.settled ? "settled" : "stopped";
      return { n: g.n, m: g.m, steps: g.sim.steps, alpha: g.sim.alpha, state, moved: g.sim.moved, push: g.sim.push, ms: stepMs, settledIn, most: mz?.most ?? 0, under: mz?.under ?? 0, contacts: g.rf.rests.contacts.length, closing: g.rf.rests.contacts.filter((c) => c.closing).length };
    },
    evaluation: () => ev,
    graph: () => g,
    measure: () => mz,
    fit,
    reseed() {
      // The frame rule again, from the evaluation before it: the particles start from the DAG's seed.
      if (!ev) return;
      const { frame: _f, ...out } = ev.out;
      ev = evaluate(RULES, S, { ...ev, out });
      g = ev.out.frame as RG;
      mz = measure(g);
      run();
      summarise();
      dirty = true;
    },
    destroy() {
      cancelAnimationFrame(raf);
      ro.disconnect();
      canvas.removeEventListener("pointerdown", onDown);
      canvas.removeEventListener("pointermove", onMove);
      canvas.removeEventListener("pointerup", onUp);
      canvas.removeEventListener("pointerleave", onLeave);
      canvas.removeEventListener("wheel", onWheel);
      canvas.removeEventListener("dblclick", fit);
      canvas.removeEventListener("contextmenu", noMenu);
      gl?.destroy();
    },
  };
}
