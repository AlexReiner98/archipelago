// A piece of a chat's row (./session-pieces.js): its state as a mark before its name, in the shape and colour the style
// names for that state (session_marks), as the canvas marks it, so the bar and the canvas never mark one state two ways;
// its tip names the state in the style's word.
// What waits on the owner is the inbox's piece (./session-piece-inbox.js).

import { YOURS } from './sessions-open.js';
import { markOf } from './session-pieces.js';

export default function state(s) {
  const at = s.session?.state ?? 'idle';
  if (YOURS[at]) return null;
  const mark = markOf(at);
  // Its tip says the state in the style's word first, then what the session is doing.
  const word = mark?.word ?? at, line = s.session?.line;
  return { mark: '', cls: `isl-chat-mark${mark ? ` shape-${mark.shape}` : ''}`, ...(mark && { hue: mark.hue }), tip: line ? `${word}: ${line}` : word };
}
