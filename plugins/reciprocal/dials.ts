/**
 * The reciprocal frame's dials, beside its agents' (agents.ts) and the
 * field's run (packs/field/step.ts `RUN`, some started elsewhere here, for
 * a frame in centimetres). Every number is a dial, as in the Landscape.
 */
import type { Dial } from "../field/behaviour.ts";
import { MESHES } from "./mesh.ts";

/** The input and the beams. */
export const INPUT: Dial[] = [
  { key: "mesh", label: "mesh", min: 0, max: MESHES.length - 1, step: 1, value: 0, choices: [...MESHES], then: "seed", doc: "The seeded input mesh, until meshes can be drawn." },
  { key: "detail", label: "detail", min: 1, max: 4, step: 1, value: 2, then: "seed", doc: "How fine the mesh is: the dome's subdivisions, the vault's bays, the fan's beams less three." },
  { key: "turn", label: "turn", min: 0, max: 1, step: 1, value: 0, choices: ["each on the next", "each on the last"], then: "seed", doc: "Which way round its fan each beam rests: on the next beam counter-clockwise round the node's normal, or the one before." },
  { key: "diameter", label: "diameter", min: 2, max: 40, step: 0.5, value: 8, doc: "Every beam's diameter, in cm, unless the beam has its own (click a beam to give it one)." },
];

/** Where the field's run dials start, for this frame. */
export const RUN_HERE: Record<string, number> = { steps_most: 8000, settle_push: 0.01, speed_most: 20, alpha_warm: 0.5 };

/** How it is drawn; none of these moves an agent. */
export const DRAW_HERE: Dial[] = [
  { key: "overhang", label: "overhang", min: 0, max: 60, step: 1, value: 12, then: "paint", doc: "How far, in cm, each beam is drawn past its two ends." },
  { key: "colour", label: "colour by", min: 0, max: 2, step: 1, value: 0, choices: ["gap", "DAG level", "plain"], then: "paint", doc: "Gap: each beam by its worst contact (held when touching, failed when off). DAG level: how far up the DAG it rests from the supports." },
  { key: "show_mesh", label: "input mesh", min: 0, max: 1, step: 1, value: 1, choices: ["hidden", "shown"], then: "paint", doc: "The input mesh's edges and normals, faint." },
  { key: "show_contacts", label: "contacts", min: 0, max: 1, step: 1, value: 1, choices: ["hidden", "shown"], then: "paint", doc: "A dot at each contact: closing contacts (where the DAG closes a fan's cycle) ringed." },
];
