// Who may do what, said once: a workspace's admin, or a person and not an agent. A tool marked humanOnly is refused to
// an agent before it runs (src/tools.ts); a function reached some other way checks for itself, with these.

/** Refused unless a workspace admin asks: "Only a workspace admin can <what>." */
export function needAdmin(actor: { admin?: boolean }, what: string): void {
  if (!actor.admin) throw new Error(`Only a workspace admin can ${what}.`);
}

/** Refused unless a person asks, with what is said to anyone else. */
export function needHuman(actor: { kind: string }, refusal: string): void {
  if (actor.kind !== 'human') throw new Error(refusal);
}
