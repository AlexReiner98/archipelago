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
/**
 * What the person does that a part may answer by moving the page: those, Enter in its input, scrolling the reading (told
 * to the sheet's part), a step back or forth in the browser, and a show landing (told to the part on `tabs`).
 */
const MOVES = [...GESTURES, 'submit', 'scrolled', 'step', 'land'];

/**
 * Bridge one pack version's port. `partOf(id)` is the part mounted under that id ({ id, title, sends, hash, island?, host? }):
 * the island it is drawn on goes with the part, so the server checks its code there (a version the island pins). Send
 * the parts everything through `send`, so a press is counted; hand each message from the port to `heard`, which
 * answers true when it was an action it took.
 */
export function partBridge(port, { partOf, go, state } = {}) {
  const pressed = new Map(), moved = new Map(), busy = new Set();
  const answer = (asked, result) => port.postMessage({ type: 'acted', asked, ...result });
  // A press that sent an action may move the page once the action has answered (Save, then the view as kept), however
  // long it took to go out: its move is counted from the answer, not from the press. Only a press's, never one of the
  // part's own accord, and only where the press was one that may move.
  const lastsTill = (id, ownAccord) => !ownAccord && moved.has(id) && moved.set(id, performance.now());

  // A change a root pack's part makes as the person (its `writes`: the sheet, task e_zhxd9bhb), or an undo of one: as an
  // action goes, one at a time, shown when it is the part's own accord; an undo only just after a press. The server checks
  // the part, its code's hash and the types it writes (packs/loader/kernel/part-calls.ts partChange).
  async function write(said) {
    const id = String(said.id), asked = said.asked;
    const part = partOf?.(id);
    if (!part) return answer(asked, { error: 'No part is drawn under that id.' });
    if (!part.writes?.length) return answer(asked, { error: `${part.title ?? part.id} writes nothing.` });
    if (!may('write')) return answer(asked, { error: 'This session may only read the map.' });
    if (busy.has(id)) return answer(asked, { error: 'A change of this part is still going out.' });
    const press = pressed.get(id);
    const ownAccord = !(press && performance.now() - press < pressLasts);
    pressed.delete(id);
    if (said.type === 'undo' && ownAccord) return answer(asked, { error: 'An undo is the person’s: only just after they press.' });
    const ops = Array.isArray(said.ops) ? said.ops : [];
    if (said.type === 'change' && !ops.length) return answer(asked, { error: 'A change needs ops.' });
    const shown = ownAccord ? goingOut(part, 'change') : null;
    busy.add(id);
    try {
      const ref = { id: part.id, hash: part.hash, ...(part.island && { island: part.island }), ...(part.host && { host: part.host }) };
      const made = said.type === 'undo'
        ? await api('undo', { changeset: String(said.changeset ?? '') })
        : await api('change', { ops, reason: String(said.reason || `From ${part.title ?? part.id}`).slice(0, 500), part: ref });
      const result = { status: made?.status, created: made?.created ?? {}, ...(made?.changeset && { changeset: made.changeset }), ...(made?.proposal && { proposal: made.proposal, held: made.held_by?.say ?? '' }) };
      shown?.done(result);
      lastsTill(id, ownAccord);
      answer(asked, result);
    } catch (err) {
      const error = String(err?.message ?? err).slice(0, 300);
      shown?.done({ error });
      answer(asked, { error });
    } finally {
      busy.delete(id);
    }
  }

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
      lastsTill(id, ownAccord);
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
    go?.(said.address, part);
  }

  // Page state a part publishes (`state` in its manifest): only a name it declared, and only its own, so one name has
  // one owner here as everywhere. The page (`state`) writes it on the root; no gesture is needed, since it says what
  // the page is doing, never what the person did.
  function publish(said) {
    const part = partOf?.(String(said.id));
    if (!part?.state?.includes(String(said.name))) return;
    state?.(String(said.name), said.value === null ? null : String(said.value).slice(0, 300), part);
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
      if (said?.type === 'state') return (publish(said), true);
      if (said?.type === 'change' || said?.type === 'undo') return (void write(said), true);
      if (said?.type !== 'act') return false;
      void act(said);
      return true;
    },
  };
}
