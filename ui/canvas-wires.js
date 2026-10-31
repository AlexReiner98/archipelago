// Changes held for the owner, decided where they are drawn (the owner, 25 Oct 2026). Wires are no longer drawn by
// hand on the canvas (the owner, 28 Oct 2026: never used). A click on a held change's badge (ui/layout.js: `drawing-held`) puts that change to the person, in the page's words
// (ui/held.js), and applies or declines it through `decide`, the page's own path.

import { api, ask, tell } from './base.js';
import { said } from './held.js';
import { heldAgain } from './live.js';
import { loadSchema } from './words.js';

/** Listen on the canvas `host` for held changes clicked; `storeNow()` is the store the canvas draws from. */
export function wiresOn(host, storeNow) {
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
