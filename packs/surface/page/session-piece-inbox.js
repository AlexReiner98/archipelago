// A piece of a chat's row (./session-pieces.js): the inbox, the page's one mark for what waits on the owner
// (inbox.svg), where the chat's move is theirs, in the colour the style gives that state (session_marks), as the canvas
// draws it; what it waits on is a line of the tooltip.

import { YOURS } from './sessions-open.js';
import { markOf } from './session-pieces.js';

export default function inbox(s) {
  const at = s.session?.state, yours = YOURS[at];
  if (!yours) return null;
  const mark = markOf(at);
  return { mark: '', cls: 'isl-chat-mark on-you', ...(mark && { hue: mark.hue }), tip: s.session?.line || yours.said };
}
