// An instruction's record as rows of marks, decided without the map: the record (the reflex_said pack's said_record)
// and the runs' heads in, rows out. The kernel draws a row's state, its name, then its marks (packs/sheet/page/screens.js).

/** How many runs are drawn under the counts at most. */
export const RUNS_SHOWN = 12;

/** What became of a miss in one run, as a mark: a glyph, its word in the tooltip. */
const VERDICT = {
  came_back: { text: '↺', tone: 'bad', tip: 'Its miss came back after it was said' },
  held: { text: '✓', tone: 'ok', tip: 'Its miss came before it was said, and not after' },
  quiet: { text: '·', tip: 'No miss it answers in this run' },
};

const times = (n) => `${n}×`;

/** The counts row: the instruction itself, with how often it was said and how its runs went. */
export function countsRow(item, record) {
  const r = record ?? { said: 0, runs: 0, came_back: 0, held: 0, quiet: 0 };
  const places = Object.entries(r.places ?? {}).sort((a, b) => b[1] - a[1]).map(([where, n]) => `${where} ${n}`).join(', ');
  const marks = [
    { text: times(r.said), tip: `Said ${r.said} times to ${r.runs} runs${places ? `: ${places}` : ''}` },
    ...(r.came_back ? [{ ...VERDICT.came_back, text: `↺ ${r.came_back}`, tip: `Its miss came back in ${r.came_back} runs after it was said` }] : []),
    ...(r.held ? [{ ...VERDICT.held, text: `✓ ${r.held}`, tip: `Its miss stopped in ${r.held} runs once it was said` }] : []),
    ...(r.quiet ? [{ text: `· ${r.quiet}`, tip: `${r.quiet} runs had no miss it answers` }] : []),
    ...(r.last ? [{ ago: r.last, tip: 'Last said' }] : []),
  ];
  return { id: item.id, type: item.type, title: item.title, status: item.status, marks };
}

/** One run it was said to, the newest first: the run by its name, how often it was said there and what became of the miss. */
export function runRows(record, runs) {
  const named = new Map((runs ?? []).map((r) => [r.id, r]));
  return [...(record?.per_run ?? [])]
    .sort((a, b) => b.said_at.localeCompare(a.said_at))
    .slice(0, RUNS_SHOWN)
    .map((v) => {
      const run = named.get(v.run);
      return { id: v.run, type: run?.type ?? 'run', title: run?.title ?? v.run, marks: [VERDICT[v.verdict], ...(v.said > 1 ? [{ text: times(v.said), tip: `Said ${v.said} times there` }] : []), { ago: v.said_at, tip: 'First said there' }] };
    });
}

/** The rows of one instruction: its counts, then its runs. */
export const rowsOf = (item, record, runs) => [countsRow(item, record), ...runRows(record, runs)];

/**
 * Each asked id's counts, in the order asked: an item kept as the owner's version of a preset is counted under the
 * preset's id, and answered under its own, with where it is said (its for, as given). `read` is the record's read, handed the ids to read.
 */
export async function countsOf(asked, items, read) {
  const under = new Map(asked.map((id) => { const it = items.find((e) => e.id === id); return [id, typeof it?.props?.preset === 'string' ? it.props.preset : id]; }));
  const ids = [...new Set(under.values())];
  const got = ids.length ? await read(ids) : [];
  const by = new Map((Array.isArray(got) ? got : []).map((r) => [r.id, r]));
  return asked.map((id) => {
    const r = by.get(under.get(id)) ?? {};
    // Where it is said, as given: the drawing's answer carries no for, and its branches are by it.
    const fors = items.find((e) => e.id === id)?.props?.for;
    return { id, said: r.said ?? 0, runs: r.runs ?? 0, places: r.places ?? {}, ...(r.last && { last: r.last }), came_back: r.came_back ?? 0, held: r.held ?? 0, quiet: r.quiet ?? 0, ...(Array.isArray(fors) && { for: fors }) };
  });
}
