// An item as a fingerpost board carrying a waymark sign (round 6, screen e_vm8eg36x, pass 8; research e_bktf8877: Czech KČT
// plates, the Swiss and Austrian way, GR's wrong-way cross, DNT). The board is wood (`board_colours`, light and dark), its end by
// type (an arrow, a swallowtail, an arrow at both ends, a round end, a flat end, a flat end with a small roof), its name on the
// wood. At its left is a small white plate, a waymark: its symbol is the type (`type_signs`: a bar, two bars, two offset bars,
// a disc, a backslash, a T, a triangle) and its colour the status (the status palettes, done quieter). Blocked has a small cross
// beside the plate; an ended item a faded board and an empty plate; "you" keeps its colour as the board's outline.
// Layer: marks. Pure: a place and a word in, marks out.

/** The symbol of a waymark in a plate of side `s` at `x, y`, as a path: a bar, bars, a turn, a disc, a backslash, a T or a triangle. */
export function signPath(word, x, y, s) {
  const r = (a, b, w, h) => `M${+(x + s * a).toFixed(2)} ${+(y + s * b).toFixed(2)}h${+(s * w).toFixed(2)}v${+(s * h).toFixed(2)}h${+(-s * w).toFixed(2)}Z`;
  if (word === 'bars') return r(0.12, 0.2, 0.76, 0.2) + r(0.12, 0.6, 0.76, 0.2);
  if (word === 'turn') return r(0.12, 0.2, 0.5, 0.2) + r(0.38, 0.6, 0.5, 0.2);
  if (word === 'disc') return `M${x + s * 0.2} ${y + s / 2}a${s * 0.3} ${s * 0.3} 0 1 0 ${s * 0.6} 0a${s * 0.3} ${s * 0.3} 0 1 0 ${-s * 0.6} 0Z`;
  if (word === 'slash') return `M${x + s * 0.12} ${y + s * 0.26}L${x + s * 0.28} ${y + s * 0.12}L${x + s * 0.88} ${y + s * 0.74}L${x + s * 0.72} ${y + s * 0.88}Z`;
  if (word === 'tee') return r(0.15, 0.18, 0.7, 0.2) + r(0.42, 0.38, 0.16, 0.46);
  if (word === 'triangle') return `M${x + s / 2} ${y + s * 0.15}L${x + s * 0.86} ${y + s * 0.82}L${x + s * 0.14} ${y + s * 0.82}Z`;
  return r(0.1, 0.38, 0.8, 0.24);
}

/** The small cross of a blocked item, beside its plate (GR's wrong-way mark): two strokes in a square of side `s` at `x, y`. */
export const crossPath = (x, y, s) => `M${x} ${y}l${s} ${s}M${x + s} ${y}l${-s} ${s}`;

/**
 * The marks of a waymark: the white plate at `x, y` (side `s`), its symbol in the status colour's class (none when ended), and the
 * cross where the item is blocked. `word` is the status word (not_started, under_way, waiting, finished, trouble, ended).
 */
export function signMarks({ sign, word, x, y, s, gap, m }) {
  return [
    m('rect', { class: 'lf-sign', x, y, width: s, height: s, rx: 1 }),
    ...(word === 'ended' ? [] : [m('path', { class: `lf-sign-mark lf-cut-s-${word}`, d: signPath(sign, x, y, s) })]),
    ...(word === 'trouble' ? [m('path', { class: 'lf-cross', d: crossPath(x + s - gap / 2, y - gap / 2, gap) })] : []),
  ];
}

/** The relative luminance of a six-digit colour (WCAG), for the contrast the name needs on its board. */
export function luminance(hex) {
  const [r, g, b] = [1, 1 + 2, 1 + 2 * 2].map((k) => parseInt(String(hex).slice(k, k + 2), 0x10) / 0xff).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
export const contrast = (a, b) => ((x, y) => (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05))(luminance(a), luminance(b));

/**
 * Who holds an item, for the strip along its board (pass 10): under way, the sessions on it (the answer's `sessions`) and the people
 * at work on it or owning it; waiting, the people it waits on. A person the answer names (`holders`: { how: works | waits | owner,
 * id, name }) is their name; the owner the answer only gives as an id is "owner" (or "you" where it is the viewer). Each is
 * { kind: human | session, name, full, you }. None where nobody holds it or the item is not under way or waiting.
 */
export function holdersOf(item, word, viewer) {
  const named = Array.isArray(item?.holders) ? item.holders : [], person = (h) => ({ kind: 'human', name: h.id === viewer ? 'you' : h.name ?? 'someone', full: h.id === viewer ? 'You' : h.name ?? 'Someone', you: h.id === viewer });
  if (word === 'waiting') return named.filter((h) => h.how === 'waits').map(person);
  if (word !== 'under_way') return [];
  const owner = item.owner && !named.some((h) => h.id === item.owner) ? [person({ id: item.owner, name: 'owner' })] : [];
  return [
    ...(Array.isArray(item.sessions) ? item.sessions : []).map((s) => ({ kind: 'session', name: String(s.title ?? 'a session'), full: `${s.title ?? 'A session'} (session)`, state: s.state, dormant: Boolean(s.dormant) })),
    ...named.filter((h) => h.how !== 'waits').map(person), ...owner,
  ];
}

/** What the strip says: the first holder, short names whole and long ones by their first word, cut to `most` letters, then "+n" for the rest. */
export function whoText(list, most) {
  if (!list.length) return '';
  const first = list[0].name.length > most / 2 && list[0].kind === 'human' ? list[0].name.split(/[\s@.]/)[0] : list[0].name;
  return `${first.length > most ? `${first.slice(0, most - 1).trimEnd()}…` : first}${list.length > 1 ? ` +${list.length - 1}` : ''}`;
}
