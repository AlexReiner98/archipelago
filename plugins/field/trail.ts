/**
 * The run in focus opened into a graph on the Landscape (plugins/trail's page
 * key `trail.graph`): its turns in order from its session, each turn's tool
 * calls and the nodes said in it, each call linked `touched` to the items on
 * the map its input or output named, each said node linked `about` the item
 * whose words it is. Drawn as ghosts: hollow, in one muted colour, never items.
 * Nothing on the map links to them, and nothing is written.
 */
import type { Id } from "../../spec/common.ts";
import { MARK_SHAPES } from "../../spec/style.ts";
import type { FieldIn } from "./graph.ts";
import { sessionId } from "./sessions.ts";

/** A trail as plugins/trail sets it (read by name, a key not an import). */
export interface TrailIn {
  run: string;
  title: string;
  earlier: number;
  turns: { seq: number; title: string; acts: { seq: number; title: string; kind: string; ok: boolean; ids: string[] }[]; says: { node: string; kind: string; count: number }[] }[];
}

/** The types a trail is drawn in: none is a type of the map. */
export const TRAIL_TYPES = { turn: "trail turn", call: "trail call", said: "trail said" } as const;

/** The link that orders a trail's turns: a turn is `after` the one before it, so flow (behaviours/flow.ts) puts the earlier on the left. */
export const TRAIL_AFTER = "after";
/** The link that orders a turn's calls: a call is `then` the one above it (the turn, or the call before), so stack (behaviours/stack.ts) hangs them in order below the turn. */
export const TRAIL_THEN = "then";

const shape = (s: (typeof MARK_SHAPES)[number]) => MARK_SHAPES.indexOf(s);

/** The item a said node is about: a node item is named by its id; a node said through a context filter link (`words/<link>`) is that link's item. */
function aboutOf(node: string, ids: Set<Id>, links: Map<Id, Id>): Id | undefined {
  if (ids.has(node)) return node;
  const m = /^words\/(.+)$/.exec(node);
  return m ? links.get(m[1]!) : undefined;
}

/** `input` with the trail drawn beside it, linked to the items it touched; `on` false or no trail, as it was. `ghost`: the colour its marks are drawn in. */
export function withTrail(input: FieldIn, trail: TrailIn | null | undefined, on: boolean, ghost?: string): FieldIn {
  if (!on || !trail || !trail.turns.length) return input;
  const ids = new Set(input.items.map((it) => it.id));
  const titles = new Map(input.items.map((it) => [it.id, it.title] as const));
  const from = new Map(input.links.map((l) => [l.id, l.from] as const));
  const items = [...input.items], links = [...input.links];
  const base = `trail:${trail.run}:`;
  const mark = (id: Id, title: string, type: string, s: (typeof MARK_SHAPES)[number], closed = false) =>
    items.push({ id, title, type, status: "", closed, kind: "", base: type, shape: shape(s), side: 0 });
  const link = (type: string, a: Id, b: Id) => links.push({ id: `${a}>${type}>${b}`, type, from: a, to: b });

  // The session the trail hangs from: drawn by plugins/sessions while live, else here.
  const session = sessionId(trail.run);
  if (!ids.has(session)) items.push({ id: session, title: trail.title, type: "session", status: "past", closed: false, kind: "", base: "session", shape: shape("pentagon"), side: 0 });

  // The turns in order, each `after` the one before (an order link: flow reads them left to right), from the
  // session; each turn's calls hang under it in order, each `then` the one before (a stacking link: stack
  // reads them top to bottom).
  let before: Id = session;
  const next = (id: Id) => (link(TRAIL_AFTER, id, before), (before = id));
  if (trail.earlier) {
    const id = `${base}earlier`;
    mark(id, `${trail.earlier} earlier events`, TRAIL_TYPES.turn, "circle");
    next(id);
  }
  for (const t of trail.turns) {
    const turn = `${base}turn:${t.seq}`;
    mark(turn, t.title, TRAIL_TYPES.turn, "circle");
    next(turn);
    let above: Id = turn;
    t.acts.forEach((a, k) => {
      const id = `${base}${a.seq}`;
      mark(id, `${k + 1}. ${a.title}${a.ok ? "" : " ✕"}`, TRAIL_TYPES.call, "triangle");
      link(TRAIL_THEN, id, above);
      above = id;
      for (const it of a.ids) if (ids.has(it)) link("touched", id, it);
    });
    for (const s of t.says) {
      const id = `${base}say:${t.seq}:${s.kind}:${s.node}`;
      const about = aboutOf(s.node, ids, from);
      const name = (about && titles.get(about)) || s.node;
      mark(id, `${s.kind === "say" ? "said" : s.kind === "refuse" ? "refused" : "held back"} ${name}${s.count > 1 ? ` ×${s.count}` : ""}`, TRAIL_TYPES.said, "diamond");
      link("in_turn", id, turn);
      if (about) link("about", id, about);
    }
  }
  const colours = ghost ? { ...input.colours, [TRAIL_TYPES.turn]: ghost, [TRAIL_TYPES.call]: ghost, [TRAIL_TYPES.said]: ghost } : input.colours;
  return { ...input, items, links, ...(colours ? { colours } : {}) };
}
