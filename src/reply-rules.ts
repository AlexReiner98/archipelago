// Rules on a session's reply ending (the owner, 26 Oct 2026: e_na4u9smw, e_dj9aa8fv). A rule in a pack's rules with
// on "reply_ended" decides about a reply, not a change: when the facts the session's hook read from its transcript
// (what the reply read of the map, surveyed, showed, changed, told, edited, committed and pushed, and how much other
// work it did) are as its when.reply says, it asks the
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
 * told, the beats it told (report, action tell); worked, its calls to tools other than the map's (a file read or
 * written, a command run); edited counts the files it wrote.
 */
export const REPLY_FACTS = ['read', 'surveyed', 'showed', 'changed', 'told', 'worked', 'edited', 'committed', 'pushed'] as const;
export type ReplyFacts = Partial<Record<(typeof REPLY_FACTS)[number], number>>;

/** A reply rule's setting: what the owner turns it off by. */
export const REPLY_LIFT = /^reply_[a-z0-9_]+$/;
/** A reason is one line, short enough to be read in passing and kept as a beat. */
const SAY_MAX = 200;

/** Whether a rule is on the end of a reply, rather than on a change. */
export const onReply = (rule: RuleDef) => rule.on === REPLY_ENDED;

/** Problems with a reply rule, as checkRules reports them. */
export function checkReplyRule(rule: RuleDef, at: string, known: (type: string) => boolean = () => true): string[] {
  const problems: string[] = [];
  if (!rule.id) problems.push(`${at}: a rule on a reply ending has an id, so it asks once a turn`);
  if (rule.on !== REPLY_ENDED) problems.push(`${at}: on is "${REPLY_ENDED}"`);
  if (rule.then !== 'ask') problems.push(`${at}: a rule on a reply ending asks (then: "ask")`);
  const when = rule.when ?? {};
  for (const key of Object.keys(when)) if (key !== 'reply') problems.push(`${at}: a rule on a reply ending reads only when.reply`);
  const reply = when.reply ?? {};
  if (!Object.keys(reply).length) problems.push(`${at}: when.reply says which of ${REPLY_FACTS.join(', ')} the reply did (true), did not (false) or did at least so many times (a number)`);
  for (const [fact, did] of Object.entries(reply)) {
    if (!(REPLY_FACTS as readonly string[]).includes(fact)) problems.push(`${at}: no fact "${fact}" about a reply (${REPLY_FACTS.join(', ')})`);
    if (typeof did !== 'boolean' && !(Number.isInteger(did) && (did as number) > 0)) problems.push(`${at}: when.reply.${fact} is true, false or how many times at least`);
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

/** The fact a rule counts to (a number in its when.reply) and that number, as its pack says: the owner may set another. */
export function countsTo(rule: RuleDef): { fact: string; at: number } | undefined {
  const found = Object.entries(rule.when?.reply ?? {}).find(([, did]) => typeof did === 'number');
  return found && { fact: found[0], at: found[1] as number };
}

/** The setting that holds the owner's own number for a rule that counts: its lifted, with _at. */
export const atSetting = (rule: RuleDef) => `${rule.lifted}_at`;
/** The most a rule may be set to count to. */
export const AT_MAX = 1000;
/** Whether a setting is a number a rule may count to. */
export const isAt = (v: unknown) => Number.isInteger(v) && (v as number) >= 1 && (v as number) <= AT_MAX;

/**
 * Whether a reply rule's when holds of what the reply did: true at least once, false never, a number at least that
 * often (at, the owner's number, in place of the pack's when it is given).
 */
export function holds(rule: RuleDef, facts: ReplyFacts, at?: number): boolean {
  return Object.entries(rule.when?.reply ?? {}).every(([fact, did]) => {
    const n = facts[fact as keyof ReplyFacts] ?? 0;
    return typeof did === 'number' ? n >= (at ?? did) : n > 0 === did;
  });
}

