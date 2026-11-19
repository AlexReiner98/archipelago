// A run's session on its step (docs/sessions.md, "Wired: what the server gives"): where the answer gives a run its
// `session` ({ state, for?, line, since }), its state is a mark in place of the dot, in the shape and hue the style
// names for it (session_marks), and its name is the step's one line, cut to fit (the study e_unru8ftt, screen e_fd547h78:
// a step that said its last beat read a refused test as the session's state); its line is in its tip. The states the style
// lights (lit) are drawn as what waits on you (./state.js) and laid out first, in the states' order of attention, each
// oldest first. Layer: marks. Pure: an answer's items and the style in, items, marks and rules out.

/** The states in their order of attention (docs/sessions.md): the order runs are laid out and the key's rows go in. */
export const STATES = ['waiting', 'your_move', 'blocked', 'working', 'quiet', 'idle', 'done'];
/** What the key calls each state. */
export const STATE_WORDS = { waiting: 'Waiting', your_move: 'Your move', blocked: 'Blocked', working: 'Working', quiet: 'Quiet', idle: 'Idle', done: 'Done' };
/** The shapes a state's mark may take. */
export const SHAPES = ['disc', 'ring', 'half', 'square', 'diamond', 'triangle', 'inbox', 'cross'];
const NAMED = /^[a-z_]+$/;

/** A run's session, where the answer gives one. */
export const sessionOf = (i) => (i?.session && typeof i.session === 'object' && STATES.includes(i.session.state) ? i.session : null);

/**
 * How each state is drawn, as the style says (session_marks, by state): { shape, colour, lit }, its colour one of the
 * theme's by name (you, blocked, session, muted...), so it follows light and dark. A state the style does not name has no mark.
 */
export function sessionMarks(style) {
  const given = style?.session_marks && typeof style.session_marks === 'object' ? style.session_marks : {};
  const out = new Map();
  for (const state of STATES) {
    const s = given[state];
    if (!s || typeof s !== 'object') continue;
    const hue = String(s.hue ?? '');
    out.set(state, {
      shape: SHAPES.includes(s.shape) ? s.shape : 'disc',
      colour: `var(--ln-${NAMED.test(hue) ? hue : 'text'})`,
      lit: s.lit === true,
    });
  }
  return out;
}

/** The states the style lights, for ./state.js. */
export const litStates = (marks) => new Set([...marks].filter(([, s]) => s.lit).map(([state]) => state));

/**
 * The items as the flow lays them out: a run with a session and a mark has its name as its title, cut to one line by
 * `cut` (its line kept as `said`, for its tip, the run's whole title as `named`), and every such run comes before the rest, the lit
 * first, in the states' order, each oldest `since` first (`place`, which the steps are sorted by).
 */
export function sessionItems(items, marks, cut) {
  // A run whose session rings an item drawn here is told by its ring's tag, beside what it works on (./session-ring.js),
  // not again as a step of its own in the sea under the island (verdict e_kefj5n2c); one the style lights, waiting on
  // you, stays a step, for its click is where you answer it.
  const ringed = new Set(items.flatMap((i) => (Array.isArray(i?.sessions) ? i.sessions.map((s) => s?.run) : [])));
  items = items.filter((i) => !(ringed.has(i.id) && marks.has(sessionOf(i)?.state) && !marks.get(sessionOf(i).state).lit));
  const runs = items.filter((i) => marks.has(sessionOf(i)?.state));
  if (!runs.length) return items;
  const rank = (i) => {
    const { state } = sessionOf(i);
    return (marks.get(state).lit ? 0 : STATES.length) + STATES.indexOf(state);
  };
  const order = [...runs].sort((a, b) => rank(a) - rank(b) || String(sessionOf(a).since ?? '').localeCompare(String(sessionOf(b).since ?? '')));
  const place = new Map(order.map((i, k) => [i.id, k - order.length]));
  return items.map((i) => {
    if (!place.has(i.id)) return i;
    const said = String(sessionOf(i).line || i.title);
    const asks = askedOf(sessionOf(i));
    return { ...i, title: cut(String(i.title)), said, named: i.title, place: place.get(i.id), ...(asks && { asks }) };
  });
}

/** A held change named by its id in what a run asks of you (its line), as a word of its own. */
const ASKED_CHANGE = /(?:^|\W)(p_[a-z\d]+)(?!\w)/;
/**
 * The held change a run's question puts to you, where its line names one and the run waits on you (waiting, your_move):
 * its step is then where that change is decided, its click keyed `held:<proposal>` (docs/layouts.md, Ghosts), and the
 * page puts it to the person if it is still held, else opens the run.
 */
export function askedOf(session) {
  if (!session || !['waiting', 'your_move'].includes(session.state)) return null;
  return ASKED_CHANGE.exec(String(session.line ?? ''))?.[1] ?? null;
}

/** The mark of a state, centred on cx, cy, as big as a dot of radius r. */
export function stateMark(m, state, mark, cx, cy, r) {
  const cls = `lf-ss lf-ss-${state} ${mark.shape}`;
  if (mark.shape === 'disc' || mark.shape === 'ring') return m('circle', { cx, cy, r, class: cls });
  if (mark.shape === 'half') return m('g', { class: cls }, m('circle', { cx, cy, r }), m('path', { d: `M${cx} ${cy - r}A${r} ${r} 0 0 0 ${cx} ${cy + r}Z`, class: 'lf-ss-fill' }));
  if (mark.shape === 'cross') return m('path', { d: `M${cx - r} ${cy - r}L${cx + r} ${cy + r}M${cx + r} ${cy - r}L${cx - r} ${cy + r}`, class: cls });
  if (mark.shape === 'square') return m('rect', { x: cx - r, y: cy - r, width: 2 * r, height: 2 * r, class: cls });
  if (mark.shape === 'diamond') return m('path', { d: `M${cx} ${cy - r}L${cx + r} ${cy}L${cx} ${cy + r}L${cx - r} ${cy}Z`, class: cls });
  // What waits on the owner, as the page draws it everywhere (packs/surface/page/inbox.svg): a tray open at the top, its
  // lip dipping in the middle, its points that drawing's in parts of the dot's radius.
  if (mark.shape === 'inbox') {
    const at = (x, y) => `${cx + x * r} ${cy + y * r}`;
    const tray = `M${at(-1, 0.25)}L${at(-0.7, -0.75)}L${at(0.7, -0.75)}L${at(1, 0.25)}L${at(1, 0.75)}L${at(-1, 0.75)}Z`;
    const lip = `M${at(-1, 0.25)}L${at(-0.42, 0.25)}L${at(-0.25, 0.5)}L${at(0.25, 0.5)}L${at(0.42, 0.25)}L${at(1, 0.25)}`;
    return m('g', { class: cls }, m('path', { d: tray }), m('path', { d: lip }));
  }
  return m('path', { d: `M${cx} ${cy - r}L${cx + r} ${cy + r}L${cx - r} ${cy + r}Z`, class: cls });
}

/** Each state's colour, a rule of its own: a drawing sets no style on a mark. */
export const hueRules = (marks) => [...marks].map(([state, s]) => `.lf-ss-${state} { --lf-ss: ${s.colour}; }`);

export const css = `
.lf-ss { fill: var(--lf-ss); stroke: var(--lf-ss); stroke-width: var(--ln-flow-dot-ring); }
.lf-ss.ring, .lf-ss.half circle, .lf-ss.inbox, .lf-ss.cross { fill: none; } .lf-ss-fill { fill: var(--lf-ss); stroke: none; }
.lf-ss.inbox { stroke-linejoin: round; }
`;
