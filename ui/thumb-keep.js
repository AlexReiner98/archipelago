// When a view's thumbnail is drawn again (task e_qcydtzdj): input in, answer out, so a test holds the rule. A
// thumbnail is kept by the view and the scheme it was painted in, with what it was drawn from: the query and layout
// as asked, the log position its answer was read at, and the items and links that answer held. It stands until the
// view asks for something else or the log after that position touches what it held.

/** The key a thumbnail is kept under: one a view, in each scheme. */
export const keyOf = (view, dark) => `${view} ${dark ? 'dark' : 'light'}`;

/** What one fact of the log touches: its item or link, and a link's two ends when it is made. */
const touched = (f) => (f[2] === 'link' && f[0] === '+' && Array.isArray(f[3]) ? [f[1], ...f[3].slice(1)] : [f[1]]);

/**
 * Whether a thumbnail kept (`thumb`) is drawn again, given what the view asks now (`asked`, its query and layout as an
 * address) and what the log said after the thumbnail's position on what it held (`beat`, a tail's answer, which may
 * have been read from further back). Drawn again when nothing was kept, it was drawn from another query or layout,
 * it has no position (an answer not read from the log), the log was not read (`beat` null) or the read stopped short,
 * something it held is gone, or a fact after its position touches what it held.
 */
export function movedOn(thumb, asked, beat) {
  if (!thumb || thumb.asked !== asked || !Number.isInteger(thumb.pos)) return true;
  if (!beat || beat.more) return true;
  const held = new Set(thumb.ids ?? []);
  if ((beat.gone ?? []).some((id) => held.has(id))) return true;
  return (beat.entries ?? []).some((e) => e.pos > thumb.pos && (e.facts ?? []).some((f) => touched(f).some((id) => held.has(id))));
}

/** The thumbnail as kept once the log has been read past it: the same picture at the new position, or null to draw it again. */
export const readOn = (thumb, asked, beat) => (movedOn(thumb, asked, beat) ? null : { ...thumb, pos: Math.max(thumb.pos, Number.isInteger(beat.pos) ? beat.pos : thumb.pos) });
