// A guest map from one click (the owner, 13 Nov 2026, e_4bsagguk; the server's half is
// packs/surface/kernel/guest-route.ts). The site's button "Try it with your agent", and a shared map's "Make it yours"
// (packs/surface/page/frozen-page.js), lead here, to #/try (with ?from=<the shared map's address> for a copy), in the
// app's own origin, where its token is kept. The map is made at once (POST /guest) with one item on it, the install
// note: the sentence to paste into an agent, each block with its Copy (a Share on a phone: packs/kit/page/body.js),
// and what happens next. The tab opens on that note's own page, over the canvas where it stands (the owner, 14 Nov
// 2026: "it opens automatically and shows the instructions"). The canvas is a replica of the log, so each item the agent
// writes is drawn as it lands (packs/surface/page/replica.js). A phone gets the same note, which says how to send the
// address to a computer (e_hmmh2xta).
// The host's: it enters a token, which no pack's code may do.

import { enter, gate, gateRow, h, keepLanding, known, postJson, store } from './base.js';

/**
 * What the canvas under the note shows: a query, as an address says one (packs/surface/page/query.js, readAddress). A new
 * map has no view of its own and an empty query draws nothing, so it finds the work, aims, questions and records the
 * agent writes (the install note among them), and whom they wait on.
 */
const QUERY = `${['work', 'aim', 'question', 'record'].map((t) => `find=${encodeURIComponent(`type ${t}`)}`).join('&')}&over=waits_on&steps=1`;

/** A map being made: the page is routed again while it is (the kit's hooks), and one visit makes one map. */
let making = false;

const TITLE = 'Try it with your agent';

/** #/try: make a guest map and open it on its install note. */
export async function tryPage(query = '') {
  const from = new URLSearchParams(query).get('from') ?? undefined;
  if (making) return;
  making = true;
  const error = h('div', { class: 'error gate-error' });
  gate(TITLE, gateRow(h('span', { class: 'muted grow' }, from ? 'Copying the map…' : 'Making your map…')), error);
  try {
    const res = await postJson('/guest', from ? { from } : {});
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(body.error ?? 'That did not work.');
    const { workspace, install, page_token } = body.result;
    keepLanding(workspace.id, install ? `#/e/${install}?${QUERY}` : `#/v?${QUERY}`);
    // The page token is this browser's sign-in, remembered as any workspace is: signing in to keep the map
    // (packs/identity/page/authorize.js, /oauth/authorize opened by the agent's installer) finds the guest by it.
    store.token = page_token;
    known.remember(workspace);
    enter(page_token);
  } catch (err) {
    making = false;
    error.textContent = err.message;
    gate(TITLE, gateRow(h('span', { class: 'grow' }), h('button', { class: 'primary', onclick: () => tryPage(query) }, 'Try again')), error);
  }
}
