/**
 * The lights and sparks an event runs on the tree, painted with it
 * (paint.ts) a frame at a time. A say or a refusal runs a light from the
 * root along the branches to its node, a trail behind it and a glow round
 * its head, and its name lights only when the light gets there; an act, a
 * miss or a run's start sparks on a bough. A lit node keeps its light for
 * `linger` seconds. With a run's colour, the light is in that colour.
 * Under reduced motion only the names light.
 */
import type { ExchangeEvent } from "../../spec/exchange.ts";
import { lightOf, pointAt, route, STYLE, type Placed, type Tree } from "./layout.ts";
import type { Ink } from "./paint.ts";
import { INK, TONE, type Lit } from "./scene.ts";

const S = STYLE;

/** Runs a light for an event; with a colour (a run's, when many are shown), in it rather than the event's tone. */
export type Fire = (e: Pick<ExchangeEvent, "kind" | "node" | "place" | "act"> & { run?: string }, color?: string) => void;

type Fx = { start: number; draw: (c: CanvasRenderingContext2D, age: number, k: number, ink: Ink) => boolean };

export class Lights {
  private fx: Fx[] = [];
  private timers = new Map<string, ReturnType<typeof setTimeout>>();
  /** Nodes lit now, by tree id. */
  readonly lit = new Map<string, Lit>();
  /** Nodes a light is on its way to, by tree id, with how many lights. */
  private ways = new Map<string, number>();
  readonly waiting = new Set<string>();
  private still = typeof matchMedia !== "undefined" && matchMedia("(prefers-reduced-motion: reduce)").matches;

  /** `get`: the tree as drawn now; `changed`: something to paint. */
  private get: () => { tree: Tree; placed: Placed; sparkS?: number };
  private changed: () => void;
  constructor(get: () => { tree: Tree; placed: Placed; sparkS?: number }, changed: () => void) {
    this.get = get;
    this.changed = changed;
  }

  /** Whether a light or spark is still running: the canvas keeps painting. */
  get running(): boolean {
    return this.fx.length > 0;
  }

  private light(id: string, tone: Lit["tone"], color?: string, secs: number = S.linger): void {
    if (!this.get().tree.byId.has(id)) return;
    clearTimeout(this.timers.get(id));
    this.lit.set(id, { tone, ...(color ? { color } : {}) });
    this.timers.set(id, setTimeout(() => (this.lit.delete(id), this.timers.delete(id), this.changed()), secs * 1000));
    this.changed();
  }

  private wait(id: string): void {
    this.ways.set(id, (this.ways.get(id) ?? 0) + 1);
    this.waiting.add(id);
  }

  private arrive(id: string): void {
    const n = (this.ways.get(id) ?? 1) - 1;
    if (n > 0) return void this.ways.set(id, n);
    this.ways.delete(id);
    this.waiting.delete(id);
  }

  /** The three soft rings of a glow, `r` across, at a strength. */
  private static glow(c: CanvasRenderingContext2D, x: number, y: number, r: number, alpha: number, color: string): void {
    const parts: [number, number][] = [[1, S.glow / 2], [0.6, S.glow], [0.3, Math.min(1, S.glow * 2)]];
    c.fillStyle = color;
    for (const [size, fill] of parts) {
      c.globalAlpha = alpha * fill;
      c.beginPath();
      c.arc(x, y, size * r, 0, Math.PI * 2);
      c.fill();
    }
  }

  fire: Fire = (e, color) => {
    const { tree, placed } = this.get();
    const l = lightOf(tree, e);
    if (!l) return;
    if (this.still) return this.light(l.at, l.tone, color);
    const ink = (k: Ink) => k.color(color ?? TONE[l.tone]);
    if (l.kind === "light") {
      const pts = route(tree, placed, l.at);
      if (pts.length < 2) return;
      let reached = false;
      this.wait(l.at);
      this.fx.push({
        start: performance.now(),
        draw: (c, age, k, inks) => {
          const u = Math.min(1, age / S.pulse);
          const flash = u < 1 ? 1 : 1 - (age - S.pulse) / S.flashTime;
          if (u >= 1 && !reached) (reached = true), this.arrive(l.at), this.light(l.at, l.tone, color);
          if (flash <= 0) return false;
          const [hx, hy] = pointAt(pts, u);
          const upto = pts.slice(0, Math.floor(u * (pts.length - 1)) + 1);
          const tone = ink(inks);
          c.globalAlpha = flash * S.trailInk;
          c.strokeStyle = tone;
          c.lineWidth = S.trail / Math.sqrt(k);
          c.beginPath();
          c.moveTo(upto[0]![0], upto[0]![1]);
          for (const p of upto.slice(1)) c.lineTo(p[0], p[1]);
          c.lineTo(hx, hy);
          c.stroke();
          if (u < 1) {
            c.globalAlpha = 1;
            c.fillStyle = tone;
            c.beginPath();
            c.arc(hx, hy, S.head, 0, Math.PI * 2);
            c.fill();
          }
          const r = (u < 1 ? S.light : S.light + (S.flash - S.light) * (1 - flash)) / Math.sqrt(k);
          Lights.glow(c, hx, hy, r, flash, tone);
          return true;
        },
      });
    } else {
      const p = placed.xy.get(l.at);
      if (!p) return;
      // How long a spark lasts: the spark_s dial, else the style's.
      const life = this.get().sparkS || S.sparkLife;
      this.light(l.at, l.tone, color, Math.max(S.linger, life));
      this.fx.push({
        start: performance.now(),
        draw: (c, age, k, inks) => {
          if (age >= life) return false;
          const r = (S.spark + S.sparkGrow * Math.sqrt(age / life * S.sparkLife)) / Math.sqrt(k);
          Lights.glow(c, p.x, p.y, r, 1 - age / life, ink(inks));
          // A white-hot core, so a spark reads on any branch, the orange of Claude Code's own too.
          c.globalAlpha = 1 - age / life;
          c.fillStyle = inks.color(INK.fg);
          c.beginPath();
          c.arc(p.x, p.y, (S.spark * 0.9) / Math.sqrt(k), 0, Math.PI * 2);
          c.fill();
          return true;
        },
      });
    }
    this.changed();
  };

  /** Paints every running effect at zoom k, and drops those that are done. */
  draw(c: CanvasRenderingContext2D, k: number, ink: Ink, now: number): void {
    for (let i = this.fx.length - 1; i >= 0; i--) {
      const f = this.fx[i]!;
      // A frame's time may come before the effect started: its age is never below 0.
      if (!f.draw(c, Math.max(0, now - f.start) / 1000, k, ink)) this.fx.splice(i, 1);
    }
    c.globalAlpha = 1;
  }

  stop(): void {
    this.fx.length = 0;
    this.timers.forEach((t) => clearTimeout(t));
    this.timers.clear();
    this.lit.clear();
    this.ways.clear();
    this.waiting.clear();
  }
}
