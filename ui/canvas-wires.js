// Wires drawn by hand, and changes held for the owner decided where they are drawn (the owner, 25 Oct 2026). A wire
// let go on another step (ui/drag.js: `drawing-wire`) asks which link it is, of the link types its two ends allow, and
// makes that link through `change`, as the person: drawn at once as theirs and pending (the store's `expect`), drawn
// as it is once its fact arrives, taken back if it is refused, and drawn as held if a rule holds it for the owner. A
// click on a held change's badge (ui/drawing.js: `drawing-held`) puts that change to the person, in the page's words
// (ui/held.js), and applies or declines it through `decide`, the page's own path.

import { api, ask, state, tell } from './base.js';
import { said } from './held.js';
import { heldAgain } from './live.js';
import { fits, kept, loadSchema, relations } from './words.js';

/** How long a link made here is drawn as pending while its fact has not come (the page reads the log every 2 s). */
const patience = 15000;

/** The links that can join a to b (types), each read from a's side: a link from a to b, or one from b to a in its inverse words. */
export function linkChoices(a, b) {
  const all = (state.schema?.relations ?? []).filter((r) => !r.dormant && !kept(r.id));
  const out = all.filter((r) => fits(r.from, a.type) && fits(r.to, b.type)).map((r) => ({ type: r.id, from: a.id, to: b.id, label: r.title ?? r.id }));
  const back = all.filter((r) => fits(r.from, b.type) && fits(r.to, a.type) && r.inverse && r.inverse !== r.title).map((r) => ({ type: r.id, from: b.id, to: a.id, label: r.inverse }));
  return [...out, ...back];
}

/** Listen on the canvas `host` for wires drawn and held changes clicked; `storeNow()` is the store the canvas draws from. */
export function wiresOn(host, storeNow) {
  host.addEventListener('drawing-wire', async (ev) => {
    const store = storeNow();
    const [a, b] = [store?.item(ev.detail.from), store?.item(ev.detail.to)];
    if (!a || !b) return;
    const choices = linkChoices(a, b);
    if (!choices.length) return tell('These cannot be linked', `No link joins ${a.title} and ${b.title}.`);
    const n = await ask({ title: `${a.title} …`, message: `… ${b.title}`, choices: choices.map((c, k) => [k, c.label, `${a.title} ${c.label} ${b.title}`]) });
    if (n === null) return;
    const { type, from, to } = choices[n];
    const mine = store.expect({ type, from, to });
    try {
      const done = await api('change', { ops: [{ op: 'link', type, from, to }], reason: `Wired by hand on the canvas: ${relations.get(type)?.title ?? type}` });
      // Held by a rule: it is drawn as held, with the other changes that wait for the owner.
      if (done.status !== 'applied') return (store.forget(mine), heldAgain());
      setTimeout(() => store.forget(mine), patience);
    } catch (err) {
      store.forget(mine);
      tell('That link was not made', err.message);
    }
  });
  host.addEventListener('drawing-held', async (ev) => {
    const store = storeNow();
    const p = store?.held.find((x) => x.id === ev.detail.proposal);
    if (!p) return;
    const names = new Map(store.drawn().items.map((i) => [i.id, i]));
    const yes = await ask({ title: said(p, names), message: p.reason, choices: [[true, 'Apply'], [false, 'Decline']] });
    if (yes === null) return;
    const note = yes ? undefined : await ask({ title: 'Decline this change?', message: p.reason, input: { placeholder: 'Why not? (optional, kept in the log for whoever made it)' }, action: 'Decline', danger: true });
    if (!yes && note === null) return;
    try {
      await api('decide', { proposal: p.id, approve: yes, note: note || undefined });
      if (yes && p.ops.some((o) => o.op === 'define_type')) await loadSchema();
    } catch (err) {
      return tell('That was not done', err.message);
    }
    heldAgain();
  });
}
