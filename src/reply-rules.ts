// Rules on a session's reply ending (the owner, 26 Oct 2026: e_na4u9smw, e_dj9aa8fv). A rule in a pack's rules with
// on "reply_ended" decides about a reply, not a change: when the facts the session's hook read from its transcript
// (what the reply read of the map, surveyed, showed, changed, edited, committed and pushed) are as its when.reply says, it asks the
// agent once, with its one-line say, to go on before it stops. It asks never while the agent is already going on
// because a hook asked (stop_hook_active), never twice in one turn, and only of a registered session, whose story
// keeps each time it asked as a step. Every such rule names the setting the owner turns it off by (lifted).
// What such a rule is and when it holds is read here, with nothing of the map; src/replies.ts asks.

import type { RuleDef } from './rules.ts';

/** The event a reply rule is on. */
export const REPLY_ENDED = 'reply_ended';
/**
 * What a reply did, as the hook counts it since the owner's last message. surveyed counts the reads that answer about
 * several items (search, a lens, a view), not one item's get nor a read of what the tools take or where to start;
 * edited counts the files it wrote.
 */
export const REPLY_FACTS = ['read', 'surveyed', 'showed', 'changed', 'edited', 'committed', 'pushed'] as const;
export type ReplyFacts = Partial<Record<(typeof REPLY_FACTS)[number], number>>;

/** A reply rule's setting: what the owner turns it off by. */
export const REPLY_LIFT = /^reply_[a-z0-9_]+$/;
/** A reason is one line, short enough to be read in passing and kept as a beat. */
const SAY_MAX = 200;

/** Whether a rule is on the end of a reply, rather than on a change. */
export const onReply = (rule: RuleDef) => rule.on === REPLY_ENDED;

/** Problems with a reply rule, as checkRules reports them. */
export function checkReplyRule(rule: RuleDef, at: string): string[] {
  const problems: string[] = [];
  if (!rule.id) problems.push(`${at}: a rule on a reply ending has an id, so it asks once a turn`);
  if (rule.on !== REPLY_ENDED) problems.push(`${at}: on is "${REPLY_ENDED}"`);
  if (rule.then !== 'ask') problems.push(`${at}: a rule on a reply ending asks (then: "ask")`);
  const when = rule.when ?? {};
  for (const key of Object.keys(when)) if (key !== 'reply') problems.push(`${at}: a rule on a reply ending reads only when.reply`);
  const reply = when.reply ?? {};
  if (!Object.keys(reply).length) problems.push(`${at}: when.reply says which of ${REPLY_FACTS.join(', ')} the reply did (true) or did not (false)`);
  for (const [fact, did] of Object.entries(reply)) {
    if (!(REPLY_FACTS as readonly string[]).includes(fact)) problems.push(`${at}: no fact "${fact}" about a reply (${REPLY_FACTS.join(', ')})`);
    if (typeof did !== 'boolean') problems.push(`${at}: when.reply.${fact} is true or false`);
  }
  if (!rule.say || rule.say.length > SAY_MAX || /\n/.test(rule.say)) problems.push(`${at}: say is the one line it asks with, ${SAY_MAX} characters at most`);
  if (!rule.lifted || !REPLY_LIFT.test(rule.lifted)) problems.push(`${at}: lifted names the setting that turns it off, reply_<name>`);
  return problems;
}

/** The facts a hook sent, as counts: anything else in them is dropped. */
export function replyFacts(said: unknown): ReplyFacts | undefined {
  if (!said || typeof said !== 'object') return undefined;
  const facts: ReplyFacts = {};
  for (const fact of REPLY_FACTS) {
    const n = (said as Record<string, unknown>)[fact];
    if (Number.isInteger(n) && (n as number) >= 0) facts[fact] = n as number;
  }
  return facts;
}

/** Whether a reply rule's when holds of what the reply did. */
export function holds(rule: RuleDef, facts: ReplyFacts): boolean {
  return Object.entries(rule.when?.reply ?? {}).every(([fact, did]) => ((facts[fact as keyof ReplyFacts] ?? 0) > 0) === did);
}

