// The bridge: a part's actions, on the person's authority (decision e_3mdf9gn8, task e_9ests3je). A part runs walled
// in its pack version's worker and speaks only on that version's port (ui/layout.js partPort): it asks with
// `act { id, asked, action, params }` and is answered `acted { asked, ... }`. The host sends the action only when it is
// one the part's pack declares for it (its `sends`, from packs/loader/kernel/ui-parts.ts), as the person looking, naming
// the part and the hash of its code, which the server checks again and records on the change
// (packs/loader/kernel/part-calls.ts). Whatever a rule holds stays held: the answer says so.
//
// A part may send on its own, not only from a press. The host tells the two apart itself: each press it passes the
// part lets it send one action as that press's, for a moment; anything else is the part's own, and is shown as it goes
// out (packs/surface/page/part-going.js), so nobody's map changes unseen. A part cannot claim a press it was not given.

import { api, may } from './base.js';
import { goingOut } from './part-going.js';

/** How long, in milliseconds, a press lets its part send one action as the press's own. */
const pressLasts = 2000;
/** What the person does that a part may answer with one action as theirs: a press, a tick in a note's checklist, and a pick (a day, yes or no, one of a field's values, an item found), and an item picked on the canvas. */
const GESTURES = ['press', 'tick', 'pick', 'picked'];
/** What the person does that a part may answer by moving the page: those, and Enter in its input. */
const MOVES = [...GESTURES, 'submit'];

/**
 * Bridge one pack version's port. `partOf(id)` is the part mounted under that id ({ id, title, sends, hash, island?, host? }):
 * the island it is drawn on goes with the part, so the server checks its code there (a version the island pins). Send
 * the parts everything through `send`, so a press is counted; hand each message from the port to `heard`, which
 * answers true when it was an action it took.
 */
export function partBridge(port, { partOf, go } = {}) {
  const pressed = new Map(), moved = new Map(), busy = new Set();
  const answer = (asked, result) => port.postMessage({ type: 'acted', asked, ...result });

  async function act(said) {
    const id = String(said.id), asked = said.asked;
    const part = partOf?.(id);
    const action = String(said.action ?? '');
    if (!part) return answer(asked, { error: 'No part is drawn under that id.' });
    if (!(part.sends ?? []).includes(action)) return answer(asked, { error: `${part.title ?? part.id} does not send "${action.slice(0, 80)}".` });
    if (!may('write')) return answer(asked, { error: 'This session may only read the map.' });
    // One at a time for each part: one that sends without waiting is told so, and never floods the screen.
    if (busy.has(id)) return answer(asked, { error: 'A change of this part is still going out.' });
    const press = pressed.get(id);
    const ownAccord = !(press && performance.now() - press < pressLasts);
    pressed.delete(id);
    const params = said.params && typeof said.params === 'object' && !Array.isArray(said.params) ? said.params : {};
    const shown = ownAccord ? goingOut(part, action) : null;
    busy.add(id);
    try {
      // Called by its tool's name, as the kernel makes it of the action's id (toolName in packs/loader/kernel/declared.ts).
      const made = await api(action.replaceAll('.', '_'), { ...params, part: { id: part.id, hash: part.hash, ...(part.island && { island: part.island }), ...(part.host && { host: part.host }) } });
      const result = { status: made?.status, created: made?.created ?? {}, ...(made?.proposal && { proposal: made.proposal, held: made.held_by?.say ?? '' }), ...(made?.answer !== undefined && { answer: made.answer }) };
      shown?.done(result);
      answer(asked, result);
    } catch (err) {
      const error = String(err?.message ?? err).slice(0, 300);
      shown?.done({ error });
      answer(asked, { error });
    } finally {
      busy.delete(id);
    }
  }

  // A move is a part naming another address for the page (`go` in its manifest): only just after the person pressed,
  // ticked or pressed Enter in it, so a part never moves the page on its own. The page (`go`) checks the address.
  function moveTo(said) {
    const id = String(said.id), part = partOf?.(id), at = moved.get(id);
    moved.delete(id);
    if (!part?.go || !(at && performance.now() - at < pressLasts)) return;
    pressed.delete(id);
    go?.(said.address);
  }

  return {
    /** Send the version's parts a message: a `press` (or a note's `tick`) lets that part send one action as its own. */
    send(message) {
      if (message?.type === 'event' && GESTURES.includes(message.event?.name)) pressed.set(String(message.id), performance.now());
      if (message?.type === 'event' && MOVES.includes(message.event?.name)) moved.set(String(message.id), performance.now());
      if (message?.type === 'unmount') (pressed.delete(String(message.id)), moved.delete(String(message.id)), busy.delete(String(message.id)));
      port.postMessage(message);
    },
    /** A message from the port: true when it was an action or a move, taken here. */
    heard(said) {
      if (said?.type === 'go') return (moveTo(said), true);
      if (said?.type !== 'act') return false;
      void act(said);
      return true;
    },
  };
}
