/**
 * What a behaviour is, and what a dial is. Each behaviour adds a push to
 * every particle's force; the step sums them, each times its weight, and
 * moves the particles. A behaviour may also move particles outright after
 * the step (`move`), for a search no force expresses (untangle).
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
  /** A firm behaviour's push is not cooled with the run (collide). */
  firm?: boolean;
  apply(g: G, f: Force, S: Settings, sim: Sim): void;
  move?(g: G, S: Settings, sim: Sim): void;
  /** Whether its search still has work once the forces sleep. */
  busy?(sim: Sim): boolean;
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
