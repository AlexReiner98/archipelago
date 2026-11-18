// A piece of a chat's row (./session-pieces.js): the inbox, the page's one mark for what waits on the owner
// (inbox.svg), where the chat's move is theirs; what it waits on is a line of the tooltip.

import { YOURS } from './sessions-open.js';

export default function inbox(s) {
  const yours = YOURS[s.session?.state];
  return yours ? { mark: '', cls: 'isl-chat-mark on-you', tip: s.session?.line || yours.said } : null;
}
