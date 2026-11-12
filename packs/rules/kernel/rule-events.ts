// The slot `rules.<on>` (docs/kernel-packs.md, "Slots"): a rule with `on` decides about an event, not a change, and
// what such a rule may say is its event's pack's to check, not the judge's. Rules opens the slot; the pack that
// decides about the event fills it. It is filled first by what the judge still did inline (./rule-fillings.ts, each
// named for the pack it moves to), then by whoever calls fillRuleEvent, as the loader will for a pack that declares
// `rules.<on>` under `kernel.hooks`. The judge skips every rule with `on` (src/rules.ts, judge).

import type { RuleDef } from './rules.ts';
import { BUILT_IN } from './rule-fillings.ts';

/** What a pack says of the rules on its event: the problems with one, as checkRules reports them. */
export interface RuleEvent {
  pack: string;
  check(rule: RuleDef, at: string, known: (type: string) => boolean): string[];
}

const filled = new Map<string, RuleEvent>(Object.entries(BUILT_IN));

/** Fill the slot for an event: the pack that decides about it says what a rule on it may be. One pack per event. */
export function fillRuleEvent(on: string, event: RuleEvent): void {
  const had = filled.get(on);
  if (had && had.pack !== event.pack) throw new Error(`Rules on "${on}" are the ${had.pack} pack's, not the ${event.pack} pack's.`);
  filled.set(on, event);
}

/**
 * The problems with a rule on an event, as its filling says. On an event no pack decides about, each filling says
 * what it would want of it (its own event's name among them), as the judge said when it knew only reply_ended.
 */
export function checkOnEvent(rule: RuleDef, at: string, known: (type: string) => boolean): string[] {
  const event = filled.get(String(rule.on));
  if (event) return event.check(rule, at, known);
  const said = [...new Set([...filled.values()].flatMap((e) => e.check(rule, at, known)))];
  return said.length ? said : [`${at}: no pack decides about "${rule.on}"`];
}
