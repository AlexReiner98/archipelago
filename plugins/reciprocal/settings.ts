/**
 * The reciprocal frame's dials as one list, where they start, and how a
 * frame kept on the map becomes the settings the rules read. Pure: the
 * page (index.ts) and the server (map.ts) read the same file.
 *
 * The design's dials (the input, the agents, the sweep, the run) are what a
 * frame keeps on the map; the drawing's (`DRAW_HERE`) are the page's own.
 */
import type { Dial } from "../field/behaviour.ts";
import type { Settings } from "../field/graph.ts";
import { RUN, defaults } from "../field/step.ts";
import { AGENTS, ENGAGE, SWEEP } from "./agents.ts";
import { DRAW_HERE, INPUT, RUN_HERE } from "./dials.ts";
import { MESHES, type MeshName } from "./mesh.ts";
import { diameterKey } from "./pipeline.ts";

/** The field's run dials, started here for a frame in centimetres. */
export const RUN_DIALS: Dial[] = RUN.filter((d) => d.key !== "alpha_filter").map((d) => ({ ...d, value: RUN_HERE[d.key] ?? d.value }));

/** Every dial that shapes the frame, in the order the page lists them. */
export const DESIGN: Dial[] = [...INPUT, ENGAGE, ...AGENTS.flatMap((b) => b.dials({ links: [] })), SWEEP, ...RUN_DIALS];

/** Every dial, the drawing's last. */
export const ALL: Dial[] = [...DESIGN, ...DRAW_HERE];

/** Where every dial starts. */
export const START: Settings = defaults(ALL);

/** Keys a frame fixes when it is made: another mesh is another frame. */
export const FIXED = ["mesh", "detail"];

const DESIGN_KEYS = new Set(DESIGN.map((d) => d.key));
const DRAW_KEYS = new Set(DRAW_HERE.map((d) => d.key));

/** Whether a key is a dial of the design (kept on the map), as against the drawing's. */
export const isDesign = (key: string) => DESIGN_KEYS.has(key);
export const isDraw = (key: string) => DRAW_KEYS.has(key);

/** A frame as the map keeps it: its mesh, its dials that differ from the start, and each beam's own diameter by index. */
export interface Kept {
  mesh: MeshName;
  detail: number;
  /** Design dials that differ from `START`, by key (never mesh or detail). */
  dials: Record<string, number>;
  /** Beams' own diameters in cm, by beam index. */
  diameters: Record<number, number>;
}

/** The settings the rules read for a kept frame. */
export function settingsOf(k: Kept, draw: Settings = {}): Settings {
  const S: Settings = { ...START, ...draw, ...k.dials, mesh: MESHES.indexOf(k.mesh), detail: k.detail };
  for (const [b, d] of Object.entries(k.diameters)) S[diameterKey(Number(b))] = d;
  return S;
}

/** A dial's value checked against its range, or why it won't do. */
export function checkDial(key: string, v: unknown): string | null {
  const d = DESIGN.find((x) => x.key === key);
  if (!d) return `${key} is not a dial of the frame's design. Its dials: ${DESIGN.map((x) => x.key).filter((x) => !FIXED.includes(x)).join(", ")}.`;
  if (FIXED.includes(key)) return `A frame's ${key} is fixed when it is made: make another frame (reciprocal.create) for another.`;
  if (typeof v !== "number" || !Number.isFinite(v)) return `${key} takes a number from ${d.min} to ${d.max}.`;
  if (v < d.min || v > d.max) return `${key} takes a number from ${d.min} to ${d.max}; ${v} is outside.`;
  return null;
}
