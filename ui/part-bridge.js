// The bridge: a part's actions, on the person's authority (decision e_3mdf9gn8, task e_9ests3je). A part runs walled
// in its pack version's worker and speaks only on that version's port (ui/layout.js partPort): it asks with
// `act { id, asked, action, params }` and is answered `acted { asked, ... }`. The host sends the action only when it is
// one the part's pack declares for it (its `sends`, from packs/loader/kernel/ui-parts.ts), as the person looking, naming
// the part and the hash of its code, which the server checks again and records on the change
// (packs/loader/kernel/part-calls.ts). Whatever a rule holds stays held: the answer says so.
//
// A part may send on its own, not only from a press. The host tells the two apart itself: each press it passes the
// part lets it send one action as that press's, for a moment; anything else is the part's own, and is shown as it goes
// out (ui/part-going.js), so nobody's map changes unseen. A part cannot claim a press it was not given.

import { api, may } from './base.js';
import { goingOut } from './part-going.js';

/** How long, in milliseconds, a press lets its part send one action as the press's own. */
const pressLasts = 2000;

/**
 * Bridge one pack version's port. `partOf(id)` is the part mounted under that id ({ id, title, sends, hash }); a part
 * on an island that pins its pack's version names that island in its params (`island`), as the action takes it. Send
 * the parts everything through `send`, so a press is counted; hand each message from the port to `heard`, which
 * answers true when it was an action it took.
 */
export function partBridge(port, { partOf } = {}) {
  const pressed = new Map(), busy = new Set();
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
      const made = await api(action.replaceAll('.', '_'), { ...params, part: { id: part.id, hash: part.hash } });
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

  return {
    /** Send the version's parts a message: a `press` event lets that part send one action as the press's own. */
    send(message) {
      if (message?.type === 'event' && message.event?.name === 'press') pressed.set(String(message.id), performance.now());
      if (message?.type === 'unmount') (pressed.delete(String(message.id)), busy.delete(String(message.id)));
      port.postMessage(message);
    },
    /** A message from the port: true when it was an action, taken here. */
    heard(said) {
      if (said?.type !== 'act') return false;
      void act(said);
      return true;
    },
  };
}
