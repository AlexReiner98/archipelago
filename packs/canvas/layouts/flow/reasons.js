// Why a step needs attention now, where the answer says (the frontier term, packs/runs/kernel/frontier.ts: `reasons`, the strongest
// first, each { why, said }). No word is drawn on the step: where it stands is its dot and its tint alone (the owner,
// 10 Nov 2026), so a reason only adds to its state (./state.js: the person's to act on, blocked, under way), and every
// reason's few words are in the step's tip. Layer: marks. Pure: an item in, its state and lines out.

/** Each reason as one word or two, for the tip when the answer gives no words of its own. */
export const REASON_WORDS = {
  corrected: 'Corrected', waits_on: 'Waits', to_confirm: 'To confirm', unsettled: 'Undecided', left: 'Left',
  under_way: 'Under way', holding_up: 'Holds up', blocked: 'Blocked', moved: 'Moved', due: 'Due', unseen: 'Unseen', open: 'Next',
};
/** The reasons a person acts on: the step is drawn as what waits on you. */
const YOURS = new Set(['waits_on', 'to_confirm', 'unsettled']);

/** An item's reasons, where the answer gives them. */
export const reasonsOf = (i) => (Array.isArray(i?.reasons) ? i.reasons.filter((r) => r && REASON_WORDS[r.why]) : []);

/** What an item's reasons say of its state: { you, blocked, working }, each true only where a reason says so. */
export function reasonState(i) {
  const whys = new Set(reasonsOf(i).map((r) => r.why));
  return { you: [...YOURS].some((w) => whys.has(w)), blocked: whys.has('blocked'), working: whys.has('under_way') };
}

/** Every reason's few words, for the step's tip. */
export const reasonLines = (i) => reasonsOf(i).map((r) => String(r.said || REASON_WORDS[r.why]));
