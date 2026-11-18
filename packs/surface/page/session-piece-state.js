// A piece of a chat's row (./session-pieces.js): its state as a mark before its name, one at work a dot, one blocked a
// square, one resting none (the room kept). What waits on the owner is the inbox's piece (./session-piece-inbox.js).

import { YOURS } from './sessions-open.js';

const MARKS = { working: '•', blocked: '■' };

export default function state(s) {
  const at = s.session?.state ?? 'idle';
  if (YOURS[at]) return null;
  return { mark: MARKS[at] ?? '', cls: 'isl-chat-mark', tip: s.session?.line || at };
}
