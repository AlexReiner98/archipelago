// What a thing is inside: where the link that says what is inside what leads, up past what is not kept to the nearest
// thing that is. Read by the tree view and by the old lens; the flat lens has no containment.

/**
 * Each kept thing's holder, its depth below the start (or below what is inside nothing) and what each holds. Led to
 * two things (a task of a feature, linked to the project as well), a thing is inside the nearer: the one that is
 * itself inside another of them; failing that, one inside something. `standing` is what the ladder may climb
 * through (kept or not); a loop of belonging is cut where it closes, so everything has a depth.
 */
export function holders(links: { type: string; from_id: string; to_id: string }[], by: string, standing: Set<string>, kept: { has(id: string): boolean; keys(): Iterable<string> }, start?: string) {
  const leads = new Map<string, string[]>();
  for (const r of links) if (r.type === by && r.from_id !== r.to_id && standing.has(r.from_id) && standing.has(r.to_id)) leads.set(r.from_id, [...(leads.get(r.from_id) ?? []), r.to_id]);
  const parent = new Map<string, string>();
  const above = (from: string, seek: string, seen = new Set<string>()): boolean =>
    (leads.get(from) ?? []).some((up) => up === seek || (!seen.has(up) && seen.size < 64 && (seen.add(up), above(up, seek, seen))));
  const holder = (id: string) => {
    const ups = leads.get(id);
    return ups?.find((p) => ups.some((q) => q !== p && above(p, q))) ?? ups?.find((p) => leads.has(p)) ?? ups?.[0];
  };
  for (const id of kept.keys()) {
    // Up past what is not kept, to the nearest thing that is.
    let up = holder(id);
    for (let steps = 0; up !== undefined && !kept.has(up) && steps < 64; steps++) up = holder(up);
    if (up !== undefined && up !== id && kept.has(up)) parent.set(id, up);
  }
  const depths = new Map<string, number>();
  const depth = (id: string, trail = new Set<string>()): number => {
    const known = depths.get(id);
    if (known !== undefined) return known;
    const up = parent.get(id);
    if (up === undefined || id === start) return depths.set(id, 0), 0;
    if (trail.has(up)) return parent.delete(id), depths.set(id, 0), 0;
    trail.add(id);
    const d = depth(up, trail) + 1;
    depths.set(id, d);
    return d;
  };
  for (const id of kept.keys()) depth(id);
  const kids = new Map<string, string[]>();
  for (const [id, up] of parent) kids.set(up, [...(kids.get(up) ?? []), id]);
  return { parent, depths, kids };
}
