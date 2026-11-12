// A structured result (a plan, findings, options, a comparison) written as one long note on an item with few parts, where
// the map wants each piece as an item (issues e_mesewchn, e_sm2sa75h; principle e_56egrtvp). Said back in the change's
// answer, never refused: a long note may be right, a structure as prose is not.

/** How many sections make a note read as a structure: its ## titles. */
export const PLAN_SECTIONS = 4;

/** The ## titles in a note. */
export const sections = (body: string): number => (body.match(/^##\s/gm) ?? []).length;

/** A note written in a change: what it says after the op, and how many items are tied to its item (its parts, what bears on
 * it or is about it), in the map and in the same change. Counted only for an item that can hold
 * structure: not a writing for a reader (a deliverable) and not the app's own configuration. */
export type Noted = { at: number; op: string; body: string; ties: number };

/** The links that tie a piece to the item it belongs to, from the piece into the item: part_of, bears_on, about and
 * every link that extends them (based_on among them). */
export type TieTypes = string[];

/** What to say back for each note that became one of several sections while fewer items than sections are tied to its
 * item; none when none did. */
export function structureAsText(noted: Noted[]): string | undefined {
  const hits = noted.filter((n) => sections(n.body) >= PLAN_SECTIONS && n.ties < sections(n.body));
  if (!hits.length) return undefined;
  const where = hits.map((n) => `op ${n.at} (${n.op}): ${sections(n.body)} sections, ${n.ties} items tied to it`).join('; ');
  return `${where}. Sections are pieces of the map written as prose: make each an item tied to this one (a step part_of it with its order as depends_on, an option or finding that bears_on it, a fact it rests on about it), its facts as fields or a short note, and a view (a lens about it) that draws them; an explanation is a diagram, a view of how its parts connect. Keep in this note only the point.`;
}

/** The links of a change that tie something to an item, by its id or its ref. */
export function tiedInChange(all: { op: string; type?: string; to?: string }[], key: string | undefined, tie: TieTypes): number {
  return key ? all.filter((p) => p.op === 'link' && !!p.type && tie.includes(p.type) && p.to === key).length : 0;
}
