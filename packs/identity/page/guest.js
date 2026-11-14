// A guest map from one click (the owner, 13 Nov 2026, e_4bsagguk; the server's half is
// packs/surface/kernel/guest-route.ts). The site's button "Try it with your agent", and a shared map's "Make it yours"
// (packs/surface/page/frozen-page.js), lead here, to #/try (with ?from=<the shared map's address> for a copy), in the
// app's own origin, where its token is kept:
// - on a computer, the map is made at once (POST /guest), its token entered, and the tab opens on it, the sentence to
//   paste into an agent in a band over the canvas with its Copy button; the canvas is a replica of the log, so each
//   item the agent writes is drawn as it lands (packs/surface/page/replica.js);
// - on a phone, where no agent runs, nothing is made: a place for the recording of an agent drawing, and the phone's own
//   Share for this address, to send it to a computer (e_hmmh2xta).
// The host's: it enters a token and keeps the sentence beside it, which no pack's code may do.

import { enter, gate, gateRow, h, keepLanding, postJson, store, workspaceOf } from './base.js';

/** Where a guest map opens: a query, as an address says one (packs/surface/page/query.js, readAddress). */
const LANDING = `#/v?${['work', 'aim', 'question', 'record'].map((t) => `find=${encodeURIComponent(`type ${t}`)}`).join('&')}&over=waits_on&steps=1`;

/** The sentence and its map, kept for this tab across the reload entering the token makes. */
const KEPT = 'pelago-guest';
const keep = (value) => {
  try {
    sessionStorage.setItem(KEPT, JSON.stringify(value));
  } catch {}
};
const kept = () => {
  try {
    return JSON.parse(sessionStorage.getItem(KEPT) ?? 'null');
  } catch {
    return null;
  }
};
const drop = () => {
  try {
    sessionStorage.removeItem(KEPT);
  } catch {}
};

/** A phone or a tablet: a screen touched, with no mouse to hover, where no agent runs. */
const handheld = () => matchMedia('(hover: none) and (pointer: coarse)').matches;

/** Copy words, and say so on the button for a moment. */
async function copy(button, words) {
  try {
    await navigator.clipboard.writeText(words);
    button.textContent = 'Copied';
  } catch {
    button.textContent = 'Select and copy';
  }
  setTimeout(() => (button.textContent = 'Copy'), 2000);
}

const TITLE = 'Try it with your agent';

/** A map being made: the page is routed again while it is (the kit's hooks), and one visit makes one map. */
let making = false;

/** #/try: make a guest map and open it, or, on a phone, a way to send this address to a computer. */
export async function tryPage(query = '') {
  const from = new URLSearchParams(query).get('from') ?? undefined;
  if (handheld()) return phone();
  if (making) return;
  making = true;
  const error = h('div', { class: 'error gate-error' });
  gate(TITLE, gateRow(h('span', { class: 'muted grow' }, from ? 'Copying the map…' : 'Making your map…')), error);
  try {
    const res = await postJson('/guest', from ? { from } : {});
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(body.error ?? 'That did not work.');
    const { workspace, prompt, link, page_token } = body.result;
    keep({ workspace: workspace.id, prompt, link, at: Date.now() });
    // A new map has no view of its own, and an empty query draws nothing: the tab opens on the work, aims, questions
    // and records the agent writes, and whom they wait on, so each lands on the canvas as it is written.
    keepLanding(workspace.id, LANDING);
    enter(page_token);
  } catch (err) {
    making = false;
    error.textContent = err.message;
    gate(TITLE, gateRow(h('span', { class: 'grow' }), h('button', { class: 'primary', onclick: () => tryPage(query) }, 'Try again')), error);
  }
}

/** On a phone: the recording's place, and the phone's Share for this address. */
function phone() {
  const address = location.href;
  const share = h('button', { class: 'primary', title: 'Send this to your computer, where your agent runs' }, 'Share');
  share.onclick = () => (navigator.share ? navigator.share({ title: TITLE, url: address }).catch(() => undefined) : copy(share, address));
  if (!navigator.share) share.textContent = 'Copy';
  gate(
    TITLE,
    // The recording of an agent drawing a map comes later; this holds its place.
    h('div', { class: 'guest-recording', role: 'img', 'aria-label': 'A recording of an agent drawing a map' }, h('span', { class: 'muted' }, 'Recording')),
    gateRow(h('span', { class: 'muted grow gist', title: address }, 'Open this on your computer'), share),
  );
}

/**
 * Over a guest map just made in this tab: the sentence to paste into an agent, one line, with its Copy, until closed.
 * Drawn above find, at the canvas's foot.
 */
export function guestBand() {
  const k = kept();
  if (!k?.prompt || k.workspace !== workspaceOf(store.token)) return;
  const find = document.getElementById('find');
  if (!find || find.querySelector('.guest-band')) return;
  const button = h('button', { type: 'button', class: 'primary', title: 'Copy the sentence, then paste it into Claude Code, Codex or Cursor' }, 'Copy');
  button.onclick = () => copy(button, k.prompt);
  const band = h(
    'div',
    { class: 'guest-band', role: 'group', 'aria-label': 'Paste into your agent' },
    h('span', { class: 'muted' }, 'Paste into your agent'),
    h('span', { class: 'grow gist', title: k.prompt }, k.prompt),
    button,
    h('button', { type: 'button', class: 'quiet', title: 'Close', onclick: () => (drop(), band.remove()) }, '×'),
  );
  find.prepend(band);
}
