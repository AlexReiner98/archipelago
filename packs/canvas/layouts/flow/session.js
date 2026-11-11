// A run's session on its step (docs/sessions.md, "Wired: what the server gives"): where the answer gives a run its
// `session` ({ state, for?, line, since }), its state is a mark in place of the dot, in the shape and hue the style
// names for it (session_marks), and its line is the step's one line, cut to fit, whole in its tip. The states the style
// lights (lit) are drawn as what waits on you (./state.js) and laid out first, in the states' order of attention, each
// oldest first. Layer: marks. Pure: an answer's items and the style in, items, marks and rules out.

/** The states in their order of attention (docs/sessions.md): the order runs are laid out and the key's rows go in. */
export const STATES = ['waiting', 'your_move', 'blocked', 'working', 'quiet', 'idle', 'done'];
/** What the key calls each state. */
export const STATE_WORDS = { waiting: 'Waiting', your_move: 'Your move', blocked: 'Blocked', working: 'Working', quiet: 'Quiet', idle: 'Idle', done: 'Done' };
/** The shapes a state's mark may take. */
export const SHAPES = ['disc', 'ring', 'half', 'square', 'diamond', 'triangle'];
const NAMED = /^[a-z]+$/;

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
 * The items as the flow lays them out: a run with a session and a mark has its line as its title, cut to one line by
 * `cut` (the whole line kept as `said`, the run's own title as `named`), and every such run comes before the rest, the lit
 * first, in the states' order, each oldest `since` first (`place`, which the steps are sorted by).
 */
export function sessionItems(items, marks, cut) {
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
    return { ...i, title: cut(said), said, named: i.title, place: place.get(i.id) };
  });
}

/** The mark of a state, centred on cx, cy, as big as a dot of radius r. */
export function stateMark(m, state, mark, cx, cy, r) {
  const cls = `lf-ss lf-ss-${state} ${mark.shape}`;
  if (mark.shape === 'disc' || mark.shape === 'ring') return m('circle', { cx, cy, r, class: cls });
  if (mark.shape === 'half') return m('g', { class: cls }, m('circle', { cx, cy, r }), m('path', { d: `M${cx} ${cy - r}A${r} ${r} 0 0 0 ${cx} ${cy + r}Z`, class: 'lf-ss-fill' }));
  if (mark.shape === 'square') return m('rect', { x: cx - r, y: cy - r, width: 2 * r, height: 2 * r, class: cls });
  if (mark.shape === 'diamond') return m('path', { d: `M${cx} ${cy - r}L${cx + r} ${cy}L${cx} ${cy + r}L${cx - r} ${cy}Z`, class: cls });
  return m('path', { d: `M${cx} ${cy - r}L${cx + r} ${cy + r}L${cx - r} ${cy + r}Z`, class: cls });
}

/** Each state's colour, a rule of its own: a drawing sets no style on a mark. */
export const hueRules = (marks) => [...marks].map(([state, s]) => `.lf-ss-${state} { --lf-ss: ${s.colour}; }`);

export const css = `
.lf-ss { fill: var(--lf-ss); stroke: var(--lf-ss); stroke-width: var(--ln-flow-dot-ring); }
.lf-ss.ring, .lf-ss.half circle { fill: none; } .lf-ss-fill { fill: var(--lf-ss); stroke: none; }
`;
