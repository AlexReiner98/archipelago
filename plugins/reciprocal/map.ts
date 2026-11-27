/**
 * The reciprocal plugin, server side: a reciprocal frame kept on the map.
 *
 * - The `frame` flavour of record: the mesh it is made on, and the design's
 *   dials that differ from where they start.
 * - The `beam` flavour of record: one per edge of the frame's mesh, `part_of`
 *   the frame, with its index and, if it has one, its own diameter.
 * - Actions that make one and change what was chosen (`reciprocal.create`,
 *   `reciprocal.dial`, `reciprocal.diameter`), and `reciprocal.solve`, which
 *   runs the rules off the page and keeps the result as one record `about`
 *   the frame, superseding the one before.
 *
 * The graph holds what was chosen; a solve is rebuilt from it. Every change
 * is one change set, undone like any other.
 */
import type { ActionContext, ActionRegister } from "../../spec/action.ts";
import type { Fact } from "../../spec/changeset.ts";
import type { Id, Json } from "../../spec/common.ts";
import { Refused } from "../../spec/common.ts";
import type { GraphRead, Item } from "../../spec/graph.ts";
import { LIMIT_MAX } from "../../spec/graph.ts";
import type { FlavourDef, TypesDefine } from "../../spec/types.ts";
import type { Context, Plugin } from "../../runtime/core.ts";
import type { RG } from "./beams.ts";
import { MESHES, mesh, type MeshName } from "./mesh.ts";
import { RULES, measure, solveStep } from "./pipeline.ts";
import { evaluate } from "./rules.ts";
import { START, checkDial, settingsOf, type Kept } from "./settings.ts";

export const FRAME: FlavourDef = {
  name: "frame",
  base: "record",
  doc: "A reciprocal frame: a mesh whose every edge is a beam resting on the next round each node.",
  trial: true,
  fields: {
    mesh: { kind: "choice", values: [...MESHES], doc: "The seeded mesh it is made on." },
    detail: { kind: "number", doc: "How fine the mesh is, 1 to 4." },
    dials: { kind: "json", doc: "The design's dials that differ from where they start, by key: { engage: 0.2 }." },
  },
};

export const BEAM: FlavourDef = {
  name: "beam",
  base: "record",
  doc: "One beam of a reciprocal frame, part of it: an edge of its mesh.",
  trial: true,
  fields: {
    index: { kind: "number", doc: "Which edge of the frame's mesh it is, from 0." },
    diameter: { kind: "number", doc: "Its own diameter in cm; absent, the frame's diameter dial." },
  },
};

/** What `reciprocal.solve` records: a record of this kind about the frame. */
export const SOLVE = "solve";
export const BY = "reciprocal.solve";

/** At most this many beams to a frame: one read of its parts. */
const MOST = LIMIT_MAX;

const refuse = (code: string, message: string): never => {
  throw new Refused({ code: `reciprocal.${code}`, message, by: { plugin: "reciprocal" } });
};

const newId = () => `i_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
const today = () => new Date().toISOString().slice(0, 10);
const isObj = (v: Json | undefined): v is { [k: string]: Json } => !!v && typeof v === "object" && !Array.isArray(v);

/** The facts that move one field from `old` to `now`. */
const move = (id: Id, field: string, old: Json | undefined, now: Json | undefined): Fact[] => {
  if (JSON.stringify(old) === JSON.stringify(now)) return [];
  return [...(old !== undefined ? [["-", id, field, old] as Fact] : []), ...(now !== undefined ? [["+", id, field, now] as Fact] : [])];
};

/** A frame on the map, its beams, and what was chosen, read. */
export interface Loaded {
  item: Item;
  beams: Item[];
  kept: Kept;
}

/** Reads a frame and its beams; refuses what isn't one. */
export async function load(graph: GraphRead, id: Id): Promise<Loaded> {
  if (typeof id !== "string") return refuse("missing", "Name the frame by its id.");
  const [item] = await graph.get([id]);
  if (!item) return refuse("missing", `There is no item ${id}.`);
  if (item.type !== FRAME.name) return refuse("not_a_frame", `${id} is a ${item.type}, not a frame. Make one with reciprocal.create.`);
  const parts = await graph.links(id, { type: "part_of", dir: "in" }, { limit: MOST });
  const beams = (await graph.get(parts.items.map((l) => l.from))).filter((b): b is Item => !!b && b.type === BEAM.name);
  const diameters: Record<number, number> = {};
  for (const b of beams) if (typeof b.fields.diameter === "number") diameters[b.fields.index as number] = b.fields.diameter;
  const dials = isObj(item.fields.dials) ? (item.fields.dials as Record<string, number>) : {};
  return { item, beams, kept: { mesh: item.fields.mesh as MeshName, detail: item.fields.detail as number, dials, diameters } };
}

/** What one solve found: settled or not, in how many steps, the worst gap, the ends under where they rest, and each beam's worst gap by item id. */
export interface Solved {
  settled: boolean;
  steps: number;
  worst: number;
  under: number;
  items: Record<Id, number>;
}

/** Runs the rules off the page, to settled or the run's most steps, and measures. */
export function solve(k: Kept, beamIds: Record<number, Id>): Solved {
  const S = settingsOf(k);
  const g = evaluate(RULES, S).out.frame as RG;
  const most = S.steps_most ?? START.steps_most!;
  let steps = 0;
  while (steps < most && solveStep(g, S) > 0) steps++;
  const mz = measure(g);
  const items: Record<Id, number> = {};
  mz.worst.forEach((w, b) => {
    if (beamIds[b]) items[beamIds[b]!] = Math.round(w * 1e4) / 1e4;
  });
  return { settled: !!g.sim.settled, steps, worst: Math.round(mz.most * 1e4) / 1e4, under: mz.under, items };
}

const pct = (x: number) => `${(x * 100).toFixed(1)}%`;

const reciprocal: Plugin = {
  id: "reciprocal",
  about: "Reciprocal frames kept on the map: the mesh, the dials and each beam's diameter as items, each solve a record about them.",
  inject: ["types.define", "action.register", "graph.read"],
  apply(ctx: Context) {
    const define = ctx.get<TypesDefine>("types.define");
    define.flavour(FRAME);
    define.flavour(BEAM);
    const register = ctx.get<ActionRegister>("action.register");
    const graph = ctx.get<GraphRead>("graph.read");

    register.register({
      name: "reciprocal.create",
      title: "Make a reciprocal frame",
      input: {
        type: "object",
        properties: {
          title: { type: "string", description: "A name of a few words." },
          mesh: { type: "string", enum: [...MESHES], description: "The seeded mesh it is made on." },
          detail: { type: "number", minimum: 1, maximum: 4, description: "How fine the mesh is (default 2)." },
          dials: { type: "object", additionalProperties: { type: "number" }, description: "Design dials that differ from where they start, by key." },
          diameters: { type: "object", additionalProperties: { type: "number" }, description: "Beams' own diameters in cm, by beam index." },
          part_of: { type: "string", description: "An item the frame is part of." },
        },
        required: ["title", "mesh"],
      },
      async run(input: { title: string; mesh: MeshName; detail?: number; dials?: Record<string, number>; diameters?: Record<string, number>; part_of?: Id }, call: ActionContext) {
        const detail = input.detail ?? 2;
        if (!Number.isInteger(detail) || detail < 1 || detail > 4) refuse("detail", "detail is a whole number from 1 to 4.");
        const dials: Record<string, number> = {};
        for (const [k, v] of Object.entries(input.dials ?? {})) {
          const no = checkDial(k, v);
          if (no) refuse("dial", no);
          if (v !== START[k]) dials[k] = v;
        }
        const m = mesh(input.mesh, detail);
        const id = newId();
        const facts: Fact[] = [
          ["+", id, "type", FRAME.name],
          ["+", id, "status", "current"],
          ["+", id, "title", input.title],
          ["+", id, "mesh", input.mesh],
          ["+", id, "detail", detail],
          ["+", id, "dials", dials],
        ];
        if (input.part_of) {
          const l = newId();
          facts.push(["+", l, "type", "part_of"], ["+", l, "from", id], ["+", l, "to", input.part_of]);
        }
        const beams: Id[] = [];
        m.edges.forEach((_e, b) => {
          const bid = newId() + b.toString(36);
          beams.push(bid);
          facts.push(["+", bid, "type", BEAM.name], ["+", bid, "status", "current"], ["+", bid, "title", `Beam ${b}`], ["+", bid, "index", b]);
          const d = input.diameters?.[b];
          if (typeof d === "number") facts.push(["+", bid, "diameter", d]);
          const l = newId() + b.toString(36);
          facts.push(["+", l, "type", "part_of"], ["+", l, "from", bid], ["+", l, "to", id]);
        });
        call.write(facts);
        return { frame: id, beams };
      },
    });

    register.register({
      name: "reciprocal.dial",
      title: "Set a reciprocal frame's dials",
      input: {
        type: "object",
        properties: {
          frame: { type: "string" },
          dials: { type: "object", additionalProperties: { type: ["number", "null"] }, description: "Dials by key; null puts one back where it starts." },
        },
        required: ["frame", "dials"],
      },
      async run(input: { frame: Id; dials: Record<string, number | null> }, call: ActionContext) {
        const { item, kept } = await load(graph, input.frame);
        const next = { ...kept.dials };
        for (const [k, v] of Object.entries(input.dials)) {
          if (v === null) {
            delete next[k];
            continue;
          }
          const no = checkDial(k, v);
          if (no) refuse("dial", no);
          if (v === START[k]) delete next[k];
          else next[k] = v;
        }
        call.write(move(item.id, "dials", item.fields.dials, next));
        return { dials: next };
      },
    });

    register.register({
      name: "reciprocal.diameter",
      title: "Give beams their own diameter",
      input: {
        type: "object",
        properties: {
          beams: { type: "array", items: { type: "string" }, description: "The beams' ids." },
          diameter: { type: ["number", "null"], minimum: 2, maximum: 40, description: "In cm; null gives them the frame's again." },
        },
        required: ["beams", "diameter"],
      },
      async run(input: { beams: Id[]; diameter: number | null }, call: ActionContext) {
        if (!input.beams.length) refuse("beams", "Name at least one beam.");
        if (input.beams.length > LIMIT_MAX) refuse("beams", `At most ${LIMIT_MAX} beams at once.`);
        const got = await graph.get(input.beams);
        const facts: Fact[] = [];
        got.forEach((b, i) => {
          if (!b || b.type !== BEAM.name) refuse("not_a_beam", `${input.beams[i]} is not a beam.`);
          facts.push(...move(b!.id, "diameter", b!.fields.diameter, input.diameter ?? undefined));
        });
        call.write(facts);
        return { set: facts.length ? input.beams : [] };
      },
    });

    register.register({
      name: "reciprocal.solve",
      title: "Solve a reciprocal frame",
      input: {
        type: "object",
        properties: {
          frame: { type: "string" },
          record: { type: "boolean", description: "Keep the result on the map as a record about the frame (default true). False only answers." },
        },
        required: ["frame"],
      },
      async run(input: { frame: Id; record?: boolean }, call: ActionContext) {
        const { item, beams, kept } = await load(graph, input.frame);
        const ids: Record<number, Id> = {};
        for (const b of beams) ids[b.fields.index as number] = b.id;
        const s = solve(kept, ids);
        if (input.record === false) return { ...s, recorded: null } as unknown as Json;
        const value = { by: BY, frame: item.id, ...s } as unknown as Json;
        const about = await graph.links(item.id, { type: "about", dir: "in" }, { limit: LIMIT_MAX });
        const before = (await graph.get(about.items.map((l) => l.from))).filter(
          (r): r is Item => !!r && r.type === "record" && r.fields.kind === SOLVE && r.fields.status === "current" && isObj(r.fields.value) && r.fields.value.by === BY,
        );
        const same = before.find((r) => JSON.stringify(r.fields.value) === JSON.stringify(value));
        if (same) return { ...s, recorded: same.id } as unknown as Json;
        const id = newId();
        const over = Object.values(s.items).filter((w) => w > 0.05).length;
        const facts: Fact[] = [
          ["+", id, "type", "record"],
          ["+", id, "status", "current"],
          ["+", id, "title", `${String(item.fields.title ?? item.id)}: ${s.settled ? "settled" : "not settled"}, worst gap ${pct(s.worst)}`],
          ["+", id, "kind", SOLVE],
          ["+", id, "note", `- ${s.steps} steps, ${s.settled ? "settled" : "stopped at the most steps"}\n- worst gap ${pct(s.worst)} of the diameter there\n- ${over} beams with a gap over 5%\n- ${s.under} ends under the beam they rest on`],
          ["+", id, "value", value],
          ["+", id, "as_of", today()],
        ];
        const l = newId();
        facts.push(["+", l, "type", "about"], ["+", l, "from", id], ["+", l, "to", item.id]);
        for (const r of before) facts.push(["-", r.id, "status", "current"], ["+", r.id, "status", "superseded"]);
        call.write(facts);
        return { ...s, recorded: id, superseded: before.map((r) => r.id) } as unknown as Json;
      },
    });
  },
};

export default reciprocal;
