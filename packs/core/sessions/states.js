// A session's state and its line, worked out from its turns (docs/sessions.md, "A state" and "Its line"): pack data,
// tested with turns in and a state out, no database. The states and their order are the one table below; the first
// whose test holds is the state. A threshold is the caller's (quiet_after, a style's number), never this module's.

const ASKED = ['asked', 'stopped', 'failed'];

/**
 * The states, first that holds wins. Each reads the facts `stateOf` gathers: `holds` says whether it is the state,
 * `since` when it began, `for` (where there is one) what it is for.
 */
export const STATES = [
  { state: 'done', holds: (f) => f.closed, since: (f) => f.run.ended ?? f.last },
  { state: 'waiting', holds: (f) => !!f.wait, since: (f) => f.wait.began, for: (f) => f.wait.for },
  { state: 'blocked', holds: (f) => f.blocked, since: (f) => f.blockedSince ?? f.last },
  { state: 'working', holds: (f) => !!f.turn && !f.turn.ended, since: (f) => f.turn.began },
  { state: 'quiet', holds: (f) => f.quiet, since: (f) => f.last },
  { state: 'your_move', holds: (f) => ASKED.includes(f.turn?.end), since: (f) => f.turn.ended },
  // The last: a run whose latest turn ended done, or one with no turn yet.
  { state: 'idle', holds: () => true, since: (f) => f.turn?.ended ?? f.last },
];

const latestOf = (times) => times.filter(Boolean).reduce((a, b) => (a === undefined || Date.parse(b) > Date.parse(a) ? b : a), undefined);

/** What the states read, from what the caller has. */
function facts({ run, turns = [], wait, blocked, last, now, quiet_after }) {
  const turn = turns.at(-1);
  const open = wait ?? turn?.waits?.findLast((w) => !w.ended);
  const latest = latestOf([last, run.started, turn?.began, turn?.ended, ...(turn?.waits ?? []).flatMap((w) => [w.began, w.ended])]);
  return {
    run,
    turn,
    wait: open,
    last: latest,
    closed: run.open === false,
    // A run held for a resource has status waiting; an item it works on with an open depends_on is the caller's.
    blocked: run.status === 'waiting' || !!blocked,
    blockedSince: typeof blocked === 'object' && blocked ? blocked.since : undefined,
    quiet: quiet_after != null && !!latest && Date.parse(now) - Date.parse(latest) >= quiet_after * 60_000,
  };
}

/** The line: the question its latest turn asked, else its latest beat, else the title of what it works on. */
export function lineOf({ turns = [], beat, title }) {
  const question = turns.at(-1)?.question;
  const said = typeof beat === 'string' ? beat : beat?.said;
  return question || said || title || '';
}

/**
 * The state of a run: { state, for?, line, since }.
 * run: { open, status?, started?, ended? }; turns: its turns in order ("A turn"); wait?: its open wait, else read off
 * the latest turn; blocked?: true or { since } when it works on an item with an open depends_on; beat?: its latest
 * beat ({ said } or the words); title?: what it works on; last?: its latest event's time; now: the time now;
 * quiet_after: minutes with no event before an open run is quiet.
 */
export function stateOf(input) {
  const f = facts(input);
  const rule = STATES.find((s) => s.holds(f));
  const out = { state: rule.state, line: lineOf(input), since: rule.since(f) ?? null };
  if (rule.for) out.for = rule.for(f);
  return out;
}
