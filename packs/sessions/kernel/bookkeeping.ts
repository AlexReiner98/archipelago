// A session's own bookkeeping: what the sessions pack writes of a run as it goes (it began, it was named, it waits, it
// ended), which no person reviews. Every such write goes through `bookkeep`, the one place it skips the rules, so the
// rule that will let it through is named here (docs/kernel-packs.md, "System authority": `sessions.bookkeeping`).
//
// Until the rules can say it (a rule that spares a pack's own change every hold, and a system change that keeps the
// agent it is made for as its actor), it is applied as it always was: without consulting policy, as the agent.

/** The rule the sessions pack declares for its bookkeeping, as a held change or an answer would name it. */
export const BOOKKEEPING = {
  rule: 'bookkeeping',
  pack: 'sessions',
  say: "A session's own record of itself (it began, was named, waits, ended) is bookkeeping: it applies as it is made.",
} as const;

/** What applies a change without consulting policy: the map's apply. */
export interface Applies<I, O> {
  apply(actor: string, input: I): Promise<O>;
}

/** Write a session's bookkeeping, as the actor it is made for: applied as it is made, with no rule consulted. */
export const bookkeep = <I, O>(map: Applies<I, O>, actor: string, input: I): Promise<O> => map.apply(actor, input);
