// Snags grouped by what they touched: the read the refiner starts from (task "1. Snags the refiner can read"). Pure:
// the open snags and the runs that wrote them in, the groups out, the same groups for the same input. A snag names
// what it touched in its `touches` field, one or more `kind:ref` separated by spaces or commas (pack:core,
// tool:change, rule:finding_note, part:findings.island); a snag that names none is counted apart, so the refiner sees what it cannot group.

/** The kinds of thing a snag may touch, each read as `kind:ref`. */
export const TOUCH_KINDS = ['pack', 'instruction', 'tool', 'rule', 'view', 'hook', 'page', 'part'];

/** The pack a touch reaches beside its own ref: a part's id is `<pack>.<name>`, so what got in its way reaches that pack's refiner too. */
const packOf = (kind, ref) => (kind === 'part' && ref.includes('.') ? ref.slice(0, ref.indexOf('.')) : undefined);

const KIND = TOUCH_KINDS.join('|');
/** One touch, as the field holds it. */
const ONE = `(?:${KIND}):[^\\s,]+`;
/** What a well-formed `touches` holds: one or more touches, separated by spaces or commas. */
export const TOUCHES = new RegExp(`^\\s*${ONE}(?:[\\s,]+${ONE})*\\s*$`, 'u');

/** The touches a value names, each `kind:ref` once, in the order named; a malformed part is left out. */
export function touchesOf(value) {
  const parts = Array.isArray(value) ? value : typeof value === 'string' ? value.split(/[\s,]+/u) : [];
  const out = [];
  for (const p of parts) {
    if (typeof p !== 'string') continue;
    const t = p.trim();
    const at = t.indexOf(':');
    if (at < 1 || at === t.length - 1 || !TOUCH_KINDS.includes(t.slice(0, at))) continue;
    if (!out.includes(t)) out.push(t);
  }
  return out;
}

const SEVERITY = { critical: 4, high: 3, medium: 2, low: 1 };
const weight = (s) => SEVERITY[s.severity] ?? 0;

/**
 * The open snags grouped by what they touched, the most snags first (then the heaviest, then by name). A snag that
 * touched two things is in both groups. Each group: `touches` (kind:ref), `kind`, `ref`, `pack` (for a part: its pack), `count`, `severity` (the
 * highest of its snags), its `snags` (id, title, type, status, severity) and the `runs` that wrote them in or added
 * to them (id, title, and the pack versions they ran under where the run says), each run once.
 *
 * snags: [{ id, title, type, status, severity?, touches? }]
 * runs:  [{ snag, id, title?, packs? }], a run that wrote a snag (made it, or added a line under Seen)
 */
export function snagsOf(snags, runs = []) {
  const runsOf = new Map();
  for (const r of runs ?? []) {
    if (!r?.snag || !r.id) continue;
    const list = runsOf.get(r.snag) ?? runsOf.set(r.snag, []).get(r.snag);
    if (!list.some((x) => x.id === r.id)) list.push({ id: r.id, ...(r.title && { title: r.title }), ...(r.packs && { packs: r.packs }) });
  }
  const groups = new Map();
  const untouched = [];
  for (const s of snags ?? []) {
    if (!s?.id) continue;
    const slim = { id: s.id, title: s.title, type: s.type, status: s.status, ...(s.severity && { severity: s.severity }) };
    const touches = touchesOf(s.touches);
    if (!touches.length) { untouched.push(slim); continue; }
    for (const t of touches) {
      const g = groups.get(t) ?? groups.set(t, { touches: t, kind: t.slice(0, t.indexOf(':')), ref: t.slice(t.indexOf(':') + 1), snags: [], runs: [] }).get(t);
      g.snags.push(slim);
      for (const r of runsOf.get(s.id) ?? []) if (!g.runs.some((x) => x.id === r.id)) g.runs.push(r);
    }
  }
  const list = [...groups.values()].map((g) => {
    const top = Math.max(0, ...g.snags.map(weight));
    g.snags.sort((a, b) => weight(b) - weight(a) || String(a.title).localeCompare(String(b.title)));
    const severity = Object.keys(SEVERITY).find((k) => SEVERITY[k] === top);
    const pack = packOf(g.kind, g.ref);
    return { touches: g.touches, kind: g.kind, ref: g.ref, ...(pack && { pack }), count: g.snags.length, ...(severity && { severity }), snags: g.snags, runs: g.runs };
  });
  list.sort((a, b) => b.count - a.count || (SEVERITY[b.severity] ?? 0) - (SEVERITY[a.severity] ?? 0) || a.touches.localeCompare(b.touches));
  const kinds = {};
  for (const g of list) kinds[g.kind] = (kinds[g.kind] ?? 0) + g.count;
  return { open: (snags ?? []).filter((s) => s?.id).length, kinds, groups: list, untouched: { count: untouched.length, snags: untouched } };
}
