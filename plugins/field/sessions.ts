/**
 * The live agent sessions on the Landscape (plugins/sessions' page key
 * `sessions.live`): each a particle of the type `session`, drawn as a
 * pentagon, linked `runs_in` to each context filter it is in, so a session is
 * seen beside the filter whose context nodes it hears. They are not items on
 * the map: they come and go with the sessions, and nothing is written.
 */
import type { Id } from "../../spec/common.ts";
import { MARK_SHAPES } from "../../spec/style.ts";
import type { FieldIn } from "./graph.ts";

/** A live session as plugins/sessions sets it. */
export interface Live {
  run: string;
  title: string;
  filters: Id[];
}

/** The particle id a session is drawn as. */
export const sessionId = (run: string) => `session:${run}`;

/** `input` with each live session as a particle, linked to each of its filters the input holds; `on` false, as it was. */
export function withSessions(input: FieldIn, live: Live[], on: boolean): FieldIn {
  if (!on || !live.length) return input;
  const ids = new Set(input.items.map((it) => it.id));
  const items = [...input.items], links = [...input.links];
  for (const s of live) {
    const id = sessionId(s.run);
    items.push({ id, title: s.title, type: "session", status: "live", closed: false, kind: "", base: "session", shape: MARK_SHAPES.indexOf("pentagon"), side: 0 });
    for (const f of s.filters) if (ids.has(f)) links.push({ id: `${id}>${f}`, type: "runs_in", from: id, to: f });
  }
  // The map's own types stay as listed: a session's colour comes after theirs (graph.ts inputColours).
  return { ...input, items, links };
}

/** What the find line found, with each session in a filter it found: a session comes with its filter. */
export function withFoundSessions(found: Set<Id> | null, live: Live[], on: boolean): Set<Id> | null {
  if (!found || !on) return found;
  const out = new Set(found);
  for (const s of live) if (s.filters.some((f) => found.has(f))) out.add(sessionId(s.run));
  return out;
}
