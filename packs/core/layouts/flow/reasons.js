// Why a step needs attention now, where the answer says (the frontier term, src/frontier.ts: `reasons`, the strongest
// first, each { why, said }): its strongest reason a word over the step's top right corner, as a story flags a step,
// in the colour of what waits on you where it is the person's to act on; every reason's few words in the step's tip.
// Layer: marks. Pure: an item in, its word, class and lines out.

/** Each reason as one word or two: a mark, not a sentence. */
export const REASON_WORDS = {
  corrected: 'Corrected', waits_on: 'Waits', to_confirm: 'To confirm', unsettled: 'Undecided', left: 'Left',
  under_way: 'Under way', holding_up: 'Holds up', blocked: 'Blocked', moved: 'Moved', due: 'Due', unseen: 'Unseen', open: 'Next',
};
/** The reasons a person acts on: drawn in the colour of what waits on you. */
const YOURS = new Set(['waits_on', 'to_confirm', 'unsettled']);

/** An item's reasons, where the answer gives them. */
export const reasonsOf = (i) => (Array.isArray(i?.reasons) ? i.reasons.filter((r) => r && REASON_WORDS[r.why]) : []);

/** The word flagged on a step, and its class, or null. */
export function reasonFlag(i) {
  const [first] = reasonsOf(i);
  return first ? { word: REASON_WORDS[first.why], cls: `lf-flag lf-why${YOURS.has(first.why) ? ' you' : ''}` } : null;
}

/** Every reason's few words, for the step's tip. */
export const reasonLines = (i) => reasonsOf(i).map((r) => String(r.said || REASON_WORDS[r.why]));

export const css = `
.lf-why { fill: var(--ln-muted); font-size: var(--ln-flow-says-text); font-family: var(--ln-font); text-anchor: end; }
.lf-why.you { fill: var(--ln-you); }
`;
