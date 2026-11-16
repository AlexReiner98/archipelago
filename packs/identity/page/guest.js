// A guest map from one click (the owner, 13 Nov 2026, e_4bsagguk; the server's half is
// packs/surface/kernel/guest-route.ts). The site's button "Try it with your agent", and a shared map's "Make it yours"
// (packs/surface/page/frozen-page.js), lead here, to #/try (with ?from=<the shared map's address> for a copy), in the
// app's own origin, where its token is kept. The map is made at once (POST /guest) with one item on it, the install
// note: the sentence to paste into an agent, each block with its Copy (a Share on a phone: packs/kit/page/body.js),
// and what happens next. A new map opens on a card in the middle that says the same, with nothing of the app around
// it until the agent writes (firstMoments: the owner, 16 Nov 2026); the note stays on the map. The canvas is a replica of the log, so each item the agent
// writes is drawn as it lands (packs/surface/page/replica.js). A phone gets the same note, which says how to send the
// address to a computer (e_hmmh2xta).
// The host's: it enters a token, which no pack's code may do.

import { enter, gate, gateRow, h, hooks, keepLanding, known, postJson, store, workspaceOf } from './base.js';

/**
 * What the canvas under the note shows: a query, as an address says one (packs/surface/page/query.js, readAddress). A new
 * map has no view of its own and an empty query draws nothing, so it finds the work, aims, questions and records the
 * agent writes (the install note among them), and whom they wait on.
 */
const QUERY = `${['work', 'aim', 'question', 'record'].map((t) => `find=${encodeURIComponent(`type ${t}`)}`).join('&')}&over=waits_on&steps=1`;

/** A map being made: the page is routed again while it is (the kit's hooks), and one visit makes one map. */
let making = false;

const TITLE = 'Try it with your agent';

/**
 * The first moments on a new guest map (e_afpvmy78, critiqued with the owner 16 Nov 2026): one card in the middle, over
 * a faint picture of what is coming, and nothing of the app around it, since nothing there is any use yet. It says what
 * the visitor gets, gives them the one thing to do (Copy), and says where the wait stands: waiting, the agent reading
 * their project (it has read its link: GET /guest/read), then drawing. The first item lands and the card gives way to
 * the canvas, still quiet, while the agent draws the work; the next change brings the app back. Kept for the map just
 * made, across the reload that enters it, and dropped once the work is drawn.
 */
const FIRST = 'pelago-guest-first';
function keepFirst(first) {
  try {
    if (first) localStorage.setItem(FIRST, JSON.stringify(first));
    else localStorage.removeItem(FIRST);
  } catch {}
}
const firstNow = () => {
  try {
    return JSON.parse(localStorage.getItem(FIRST) ?? 'null');
  } catch {
    return null;
  }
};
/** A phone, where no agent runs: the card says to send the address to a computer. */
const phone = () => matchMedia('(hover: none) and (pointer: coarse)').matches;

let card, status, asking;
const SAY = { wait: 'Waiting for your agent', read: 'Your agent is reading your project', drawing: 'Your agent is drawing your work' };

/** The stage the visitor sees: on the body (the CSS quiets the app by it) and in words. */
function stage(first, now) {
  if (first.stage !== now) keepFirst({ ...first, stage: now });
  first.stage = now;
  document.body.dataset.first = now === 'drawing' ? 'drawing' : 'wait';
  if (status) status.textContent = SAY[now];
  if (now === 'drawing') card?.remove(), (card = status = undefined);
}

/** Done: the work is drawn, and the app is back. */
function done() {
  keepFirst(null);
  delete document.body.dataset.first;
  card?.remove();
  card = status = undefined;
  clearInterval(asking);
  hooks.awaiting = hooks.made = undefined;
}

/**
 * A faint map behind the card: a project, its parts and their work, marked done, under way and next, and a question
 * waiting on the visitor. Shapes only: their own words replace it.
 */
function sketch() {
  const ns = 'http://www.w3.org/2000/svg';
  const el = (tag, attrs) => Object.entries(attrs).reduce((n, [k, v]) => (n.setAttribute(k, v), n), document.createElementNS(ns, tag));
  const svg = el('svg', { class: 'first-sketch', viewBox: '0 0 1000 600', preserveAspectRatio: 'xMidYMid slice', 'aria-hidden': 'true' });
  const wire = (x1, y1, x2, y2) => svg.append(el('path', { class: 'first-wire', d: `M${x1} ${y1} V${(y1 + y2) / 2} H${x2} V${y2}` }));
  const node = (x, y, w, mark) => {
    svg.append(el('rect', { class: 'first-node', x, y, width: w, height: 34, rx: 4 }), el('rect', { class: 'first-line', x: x + 26, y: y + 14, width: w * 0.55, height: 6, rx: 3 }));
    if (mark) svg.append(el('circle', { class: `first-mark first-${mark}`, cx: x + 13, cy: y + 17, r: 5 }));
  };
  const parts = [[120, 'done', 'doing', 'todo'], [420, 'done', 'done', 'doing'], [720, 'doing', 'todo', 'todo']];
  for (const [x] of parts) wire(500, 94, x + 80, 170);
  wire(500, 94, 500, 500);
  node(420, 60, 160);
  for (const [x, ...work] of parts) {
    node(x, 170, 160);
    work.forEach((m, i) => (wire(x + 80, 204 + i * 54, x + 80, 250 + i * 54), node(x + 10, 250 + i * 54, 140, m)));
  }
  node(400, 500, 200, 'ask');
  return svg;
}

/** The card: what they get, Copy, three steps, and where the wait stands. */
function drawCard(first) {
  if (card) return;
  const said = first.prompt ?? '';
  const words = said.replace(/ How to write to it.*$/, '');
  const label = phone() ? 'Share the link' : 'Copy the prompt';
  const copy = h('button', { class: 'primary first-copy', title: 'The sentence, with a private link to your map' }, label);
  copy.addEventListener('click', () => {
    if (phone()) return void navigator.share?.({ text: `${location.origin}/#/try` }).catch(() => undefined);
    navigator.clipboard.writeText(said).then(() => ((copy.textContent = 'Copied: now paste it into your agent'), setTimeout(() => (copy.textContent = label), 4000)), () => undefined);
  });
  status = h('div', { class: 'first-status' }, SAY[first.stage ?? 'wait']);
  const steps = phone()
    ? [h('li', {}, 'No agent runs on a phone: send this to your computer and open it there.')]
    : [h('li', {}, 'Copy the prompt'), h('li', {}, "Paste it into your agent (Claude Code, Codex or Cursor) in your project's folder"), h('li', {}, 'Watch your work appear here')];
  card = h(
    'div',
    { class: 'first' },
    sketch(),
    h(
      'div',
      { class: 'first-card' },
      h('h1', {}, "Your project's work, mapped"),
      h('p', { class: 'first-promise' }, 'Your agent reads your project and draws its parts, what is under way and what waits on you. About a minute, no account.'),
      phone() ? null : h('div', { class: 'first-prompt', title: said }, words, h('span', { class: 'muted' }, ' + a private link to this map')),
      copy,
      h('ol', { class: 'first-steps' }, ...steps),
      status,
    ),
  );
  document.body.append(card);
}

/** On each route: on the guest map just made, the card until the agent writes, then a quiet canvas while it draws. */
export function firstMoments() {
  const first = firstNow();
  if (!first || first.ws !== workspaceOf(store.token)) return void (hooks.awaiting = hooks.made = undefined);
  first.stage ??= 'wait';
  if (first.stage !== 'drawing') drawCard(first);
  stage(first, first.stage);
  hooks.awaiting = () => SAY[first.stage] ?? SAY.wait;
  hooks.made = () => (first.stage === 'drawing' ? done() : stage(first, 'drawing'));
  // Whether the agent has read its link yet, every two seconds while the card waits: only on this map, only now.
  clearInterval(asking);
  if (first.stage === 'wait')
    asking = setInterval(async () => {
      if (first.stage !== 'wait') return clearInterval(asking);
      const read = await fetch('/guest/read', { headers: { authorization: `Bearer ${store.token}` } }).then((r) => (r.ok ? r.json() : null), () => null);
      if (read?.read && first.stage === 'wait') stage(first, 'read');
    }, 2000);
}

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
    const { workspace, page_token } = body.result;
    // A new map opens on the card (firstMoments), over the canvas the agent draws on; a copy, on the copy.
    keepLanding(workspace.id, `#/v?${QUERY}`);
    if (!from) keepFirst({ ws: workspace.id, prompt: body.result.prompt, stage: 'wait' });
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
