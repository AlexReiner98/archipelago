// The fillings of the slot `rules.<on>` (./rule-events.ts) the judge still holds itself, each named for the pack its
// code goes to: when that pack fills the slot from its own code, its entry here goes (the gather step, e_j9gszd4j).
// This is the one place the rules pack names another's code, an import owed in test/fixtures/root-imports.json.

import { checkReplyRule, REPLY_ENDED } from '../../../src/reply-rules.ts';
import type { RuleEvent } from './rule-events.ts';

export const BUILT_IN: Record<string, RuleEvent> = {
  [REPLY_ENDED]: { pack: 'sessions', check: checkReplyRule },
};
