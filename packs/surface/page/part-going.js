// A change a part sends on its own, shown as it goes out (decision e_3mdf9gn8: nobody's map changes unseen). One quiet
// line at the canvas's foot for each, naming the part and its action, then a mark for what came of it: sent, held for
// a person (the rule's words in its tooltip) or refused (why, in its tooltip). It goes a moment later. The bridge
// (packs/surface/page/part-bridge.js) sends a part's changes one at a time, so a part cannot stack lines here.

import { h } from './base.js';
import { pageSchema } from './page-schema.js';

/** How long, in milliseconds, a line stays once what came of it is shown. */
const stays = 6000;

let band;
const bandOf = () => (band?.isConnected ? band : (band = document.body.appendChild(h('div', { class: 'part-going', role: 'status', 'aria-live': 'polite' }))));

/** An action's name as a person reads it: its title where its pack gives one. */
const titleOf = (action) => (pageSchema()?.pack_tools ?? []).find((t) => t.action === action || t.tool === action)?.title ?? action.slice(action.indexOf('.') + 1).replaceAll('_', ' ');

/** Show a part's change going out; `done(result)` shows what came of it ({ status, held } or { error }) and lets it go. */
export function goingOut(part, action) {
  const said = `${part.title ?? part.id} · ${titleOf(action)}`;
  const mark = h('span', { class: 'mark open' }, 'sending');
  const row = h('div', { class: 'part-going-row', title: said }, h('span', { class: 'part-going-what' }, said), mark);
  bandOf().append(row);
  return {
    done(result) {
      const [word, tone, why] = result?.error ? ['refused', 'bad', result.error] : result?.proposal ? ['held', 'warn', result.held || 'Held for a person to approve.'] : ['sent', 'ok', ''];
      mark.className = `mark ${tone}`;
      mark.textContent = word;
      if (why) row.title = `${said}: ${why}`;
      setTimeout(() => row.remove(), stays);
    },
  };
}
