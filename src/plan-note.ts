// A plan written as one long note on a work item with no parts, where the map wants its steps as items (issue
// e_mesewchn). Said back in the change's answer, never refused: a long note may be right, a plan as prose is not.

/** How many sections make a note read as a plan: its ## titles. */
export const PLAN_SECTIONS = 4;

/** The ## titles in a note. */
export const sections = (body: string): number => (body.match(/^##\s/gm) ?? []).length;

export type Noted = { at: number; op: string; body: string; work: boolean; parts: boolean };

/** What to say back for each work item whose note became a plan of sections while it has no parts; none when none did. */
export function planAsText(noted: Noted[]): string | undefined {
  const hits = noted.filter((n) => n.work && !n.parts && sections(n.body) >= PLAN_SECTIONS);
  if (!hits.length) return undefined;
  const where = hits.map((n) => `op ${n.at} (${n.op}): ${sections(n.body)} sections`).join(', ');
  return `${where}, on an item with no parts. If those are steps, lay them out as items: each a task part_of it, its order as depends_on, who must act as waits_on, and a flow view about it; keep in each note only what that step needs.`;
}
