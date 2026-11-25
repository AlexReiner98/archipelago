/**
 * What a behaviour is, and what a dial is. Each behaviour lowers an energy
 * of its own (`energy`), and its push on every particle is that energy's
 * downhill slope (`apply`); the step sums them, each times its weight, and
 * moves the particles. So the run's whole energy falls step by step and the
 * run ends when the push left is small: it settles, never only cools.
 * `descends` (descends.ts) checks a behaviour keeps to this, and the field's
 * test holds every behaviour to it.
 *
 * Every number a behaviour reads is one of its dials: the panel shows each,
 * so nothing is hard-coded. Its first dial is its weight, `w_<name>`.
 */
import type { G, Settings, Sim } from "./graph.ts";

export interface Dial {
  key: string;
  label: string;
  min: number;
  max: number;
  step: number;
  value: number;
  doc: string;
  /** A heading the panel puts it under, within its section (springs: the link type). */
  group?: string;
  /** Named stops, for a dial that picks one of a few ways. */
  choices?: string[];
  /**
   * What a change needs: the run warmed again (the default for a
   * behaviour's dial), the particles seeded again, their sizes worked out
   * again and the run warmed, or only a new paint.
   */
  then?: "warm" | "seed" | "size" | "paint";
}

/** What a behaviour's dials may depend on: the link types the map has. */
export interface DialContext {
  links: string[];
}

export interface Force {
  x: Float32Array;
  y: Float32Array;
  z: Float32Array;
}

export interface Behaviour {
  name: string;
  /** One line: what it does to the picture. */
  doc: string;
  /** Whether it runs when nobody has said. */
  on: boolean;
  dials(c: DialContext): Dial[];
  /**
   * The energy it lowers, for where the particles are now (before its
   * weight). Its push is this energy's downhill slope. Read by checks, not
   * by the run, so it may be slower than `apply` (all pairs, say).
   */
  energy(g: G, S: Settings): number;
  /** Adds its push to every particle's force: the downhill slope of `energy`. */
  apply(g: G, f: Force, S: Settings, sim: Sim): void;
}

/** The weight dial every behaviour has first. */
export const weight = (name: string, value = 1, max = 3): Dial => ({
  key: `w_${name}`,
  label: "weight",
  min: 0,
  max,
  step: 0.05,
  value,
  doc: `How strongly ${name} pushes, against the others.`,
});
