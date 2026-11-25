/**
 * What is lit on the field, eased over time (paint.ts draws it): the
 * particle pointed at and its neighbours, the one a view picked, and what
 * the titles and link names held last frame so they fade rather than jump.
 */
import { neighbours, type G, type Settings } from "./graph.ts";
import { hubSet } from "./labels.ts";
import { easeWires, type WireFade } from "./wires.ts";
import type { Label } from "./gone.ts";
import { carryLight } from "./carry.ts";

/** What is lit, eased over time: dim is how far the rest has faded, shine[i] how lit particle i is. */
export class Light {
  dim = 0;
  shine: Float32Array = new Float32Array(0);
  shining = new Set<number>();
  focus = -1;
  /** A particle a view has picked (Field.pick): ringed in the accent whatever else is lit, -1 for none. */
  picked = -1;
  /** The graph shine and focus are numbered for. */
  private of: G | null = null;
  /** Each link name's fade, by link: names fade in and out, never pop (wires.ts). */
  wires = new Map<number, WireFade>();
  /** True while a link name is still fading: the view keeps painting. */
  wiresMoving = false;
  private wiresAt = 0;
  /** A step of the link names' fade. */
  easeWires(placed: Parameters<typeof easeWires>[1], ms: number): void {
    const now = performance.now(), dt = this.wiresAt ? Math.min(100, now - this.wiresAt) : 16;
    this.wiresAt = now;
    this.wiresMoving = easeWires(this.wires, placed, ms > 0 ? 1 - Math.exp(-dt / ms) : 1);
  }
  /** The ids named last frame: they are placed first, so names hold still while the map settles. */
  named = new Set<string>();
  /** Where each named title stood last frame, in world units (gone.ts Label). */
  labels = new Map<string, Label>();
  /** The spot each title took last frame (labels.ts), tried first so it keeps its side. */
  spots = new Map<string, number>();
  /** Where each named particle stood on screen last frame, so a title it carries as it moves is not faded. */
  spotsAt = new Map<string, [number, number]>();
  /** When each title last took another spot (performance.now), so it fades in there. */
  movedAt = new Map<string, number>();
  /** Titles fading out from where they stood before they moved. */
  leaving: { label: Label; at: number }[] = [];
  /** True while a moved title still fades. */
  labelsMoving = false;
  /** The hubs named at any zoom, by id: kept from graph to graph (labels.ts hubSet). */
  hubIds = new Set<string>();
  private hubOf: { g: G; key: string; mask: Uint8Array } | null = null;
  /** Which particles are hubs now: worked out again only when the graph or the dials change. */
  hubs(g: G, S: Settings): Uint8Array {
    const key = `${S.label_hubs}|${S.label_hub_links}|${S.label_hub_keep}`;
    if (this.hubOf && this.hubOf.g === g && this.hubOf.key === key) return this.hubOf.mask;
    this.hubIds = hubSet(g.id, g.degree, this.hubIds, S.label_hubs!, S.label_hub_links!, S.label_hub_keep!);
    const mask = new Uint8Array(g.n);
    for (let i = 0; i < g.n; i++) if (this.hubIds.has(g.id[i]!)) mask[i] = 1;
    this.hubOf = { g, key, mask };
    return mask;
  }
  private leftAt = 0;
  private last = 0;
  /** Eases toward the particle pointed at (hover) and its neighbours; true while it still moves. */
  ease(g: G, hover: number, S: Settings): boolean {
    const now = performance.now(), dt = this.last ? Math.min(100, now - this.last) : 16;
    this.last = now;
    // A new graph renumbers the particles: what was lit stays lit, by id (carry.ts).
    if (g !== this.of) ({ shine: this.shine, shining: this.shining, focus: this.focus } = carryLight(this.of, g, this.shine, this.shining, this.focus)), (this.of = g);
    if (hover >= 0) (this.focus = hover), (this.leftAt = 0);
    else if (this.focus >= 0 && !this.leftAt) this.leftAt = now;
    if (this.focus >= 0 && this.leftAt && now - this.leftAt > S.dim_hold_ms!) this.focus = -1;
    const k = S.dim_ms! > 0 ? 1 - Math.exp(-dt / S.dim_ms!) : 1;
    const lit = this.focus >= 0 ? neighbours(g, this.focus) : new Set<number>();
    const want = this.focus >= 0 ? 1 : 0;
    this.dim += (want - this.dim) * k;
    if (Math.abs(this.dim - want) < 0.005) this.dim = want;
    for (const i of lit) this.shining.add(i);
    let moving = (this.dim !== 0 && this.dim !== 1) || (this.focus >= 0 && !!this.leftAt);
    for (const i of this.shining) {
      const w = lit.has(i) ? 1 : 0;
      this.shine[i]! += (w - this.shine[i]!) * k;
      if (Math.abs(this.shine[i]! - w) < 0.005) this.shine[i] = w;
      if (this.shine[i] !== w) moving = true;
      if (!this.shine[i]) this.shining.delete(i);
    }
    return moving;
  }
}
