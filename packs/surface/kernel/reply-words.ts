// What the owner's workspace settings read of a rule on a reply's end (./workspace-tools.ts): whether a rule is one,
// what it counts, the setting that holds the owner's own number for it and the most it may be. The sessions pack's
// words, its filling of the server slot surface.replies (./server-fillings.ts), read once before anything is called:
// the reply rules are its, and the settings are the surface's.

import { serverFillings } from './server-fillings.ts';
import type { replyWords } from '../../sessions/kernel/reply-rules.ts';

const filled = await serverFillings<ReturnType<typeof replyWords>>('surface.replies');
if (filled.length !== 1) throw new Error(`surface.replies takes one filling: ${filled.length ? filled.map((f) => f.pack).join(' and ') : 'no pack of this server'} fills it`);

export const { onReply, countsTo, atSetting, isAt, AT_MAX } = filled[0].filled;
