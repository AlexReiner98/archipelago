// A run's turns, worked out from its events (docs/sessions.md, "A turn"). Pure: the run's events in order in, its turns
// out, the same turns for the same events. An event names its turn by `turn` when its source knows one; else it is the
// turn open at its time, and a `turn.start` with no id opens one named by its time, which stays its name when the
// events before it are let go. An event the run already has (the same `at`, `kind` and `turn`) is a resend and is
// dropped. An event outside every turn (a session's start or end, a tool after the reply) belongs to no turn.

const TURN_KINDS = new Set(['turn.start', 'tool.end', 'test.run', 'commit', 'wait.start', 'wait.end', 'turn.end']);

const fresh = (turn, at) => ({ turn, began: at, by: null, from: null, gist: null, tools: {}, files: [], items: [], tests: { runs: 0, ok: 0, failed: 0 }, commits: [], waits: [] });

const add = (list, values) => {
  for (const v of values ?? []) if (!list.includes(v)) list.push(v);
};

/** The turns of a run, from its events in order: each as docs/sessions.md's "A turn", in the order they began. */
export function turnsOf(events) {
  const seen = new Set(), turns = new Map();
  let open = null;
  for (const e of events ?? []) {
    if (!e || !TURN_KINDS.has(e.kind)) continue;
    const key = `${e.at}\u0000${e.kind}\u0000${e.turn ?? ''}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const id = e.turn ?? (e.kind === 'turn.start' ? e.at : open?.turn);
    if (id == null) continue;
    let t = turns.get(id);
    if (!t) turns.set(id, (t = fresh(id, e.at)));
    if (e.at < t.began) t.began = e.at;
    if (e.kind === 'turn.start') {
      t.by = e.by ?? null;
      t.from = e.from ?? null;
      t.gist = e.gist ?? null;
      if (!('end' in t)) open = t;
    } else if (e.kind === 'tool.end') {
      if (e.tool) t.tools[e.tool] = (t.tools[e.tool] ?? 0) + 1;
      add(t.files, e.files);
      add(t.items, e.items);
    } else if (e.kind === 'test.run') {
      t.tests.runs++;
      t.tests[e.ok ? 'ok' : 'failed']++;
    } else if (e.kind === 'commit') {
      add(t.commits, [e.sha]);
    } else if (e.kind === 'wait.start') {
      t.waits.push({ for: e.for ?? null, began: e.at, ...(e.gist ? { gist: e.gist } : {}) });
    } else if (e.kind === 'wait.end') {
      const w = t.waits.findLast((x) => !('ended' in x) && (e.for == null || x.for === e.for));
      if (w) w.ended = e.at;
    } else if (e.kind === 'turn.end') {
      t.ended = e.at;
      t.end = e.ended ?? 'done';
      if (e.question) t.question = e.question;
      if (e.gist) t.reply = e.gist;
      if (e.tokens) t.tokens = { ...e.tokens };
      if (open === t) open = null;
    }
  }
  return [...turns.values()].sort((a, b) => (a.began < b.began ? -1 : a.began > b.began ? 1 : 0));
}
