// An item named outside the app: a link in an agent's reply (GET /i/<workspace>/<item>, src/item-address.ts) opens
// the page at /?link=<workspace>#/e/<item>. Before anything is drawn, a tab of this browser already open on that
// workspace is asked to take it (over a BroadcastChannel): it goes to the item, comes forward if the browser lets it,
// and this tab closes. With no answer, or a browser that will not close it, this page opens there itself: in the
// workspace the link names, signed in to it already, or once signed in.

import { api, keepLanding, known, signIn, state, store, whoami, workspaceOf } from './base.js';

const CHANNEL = 'pelago-link';
const WORKSPACE = /^[a-z0-9][a-z0-9-]{0,39}$/, ITEM = /^#\/e\/(e_[a-z0-9]{8})(?:\?|$)/;

const channel = typeof BroadcastChannel === 'function' ? new BroadcastChannel(CHANNEL) : null;
const me = Math.random().toString(36).slice(2, 10);
/** A window a tab was popped out into draws that tab only: it takes no link. */
const popped = window.name.startsWith('pelago-tab:');
let seen = document.hasFocus() ? Date.now() : 0;
addEventListener('focus', () => (seen = Date.now()));

/** The workspace this page is in: as heard, else as its token says, else as the server says. */
const mine = async () => state.workspace?.id ?? workspaceOf(store.token) ?? (await whoami().catch(() => null))?.workspace?.id;

/** Open the item here (`there`: the address names it already): a saved view (a lens) as its canvas, anything else as its page. */
async function land(id, there = false) {
  if (!there) location.hash = `#/e/${id}`;
  const got = await api('get', { id }).catch(() => null);
  if (got?.entity?.type === 'lens' && location.hash.startsWith(`#/e/${id}`)) location.replace(`#/v?canvas=${id}`);
}

// Every tab of the app answers: here, if it is in the workspace asked; and goes to the item if it is the one picked.
channel?.addEventListener('message', async ({ data }) => {
  if (popped || !data || typeof data !== 'object') return;
  if (data.ask && WORKSPACE.test(data.ws) && (await mine()) === data.ws) channel.postMessage({ here: data.ask, tab: me, visible: document.visibilityState === 'visible', seen });
  if (data.take && data.tab === me && /^e_[a-z0-9]{8}$/.test(data.id)) {
    channel.postMessage({ took: data.take });
    window.focus();
    land(data.id);
  }
});

/** Ask the open tabs in workspace `ws` to take item `id`: whether one did, within 400 ms, the tabs that are there heard for the first 120. */
function handOff(ws, id) {
  if (!channel) return Promise.resolve(false);
  const ask = Math.random().toString(36).slice(2, 10);
  const heard = [];
  return new Promise((done) => {
    const hear = ({ data }) => {
      if (data?.here === ask) heard.push(data);
      if (data?.took === ask) finish(true);
    };
    const finish = (took) => {
      channel.removeEventListener('message', hear);
      clearTimeout(late);
      done(took);
    };
    const late = setTimeout(() => finish(false), 400);
    channel.addEventListener('message', hear);
    channel.postMessage({ ask, ws });
    // The tab in sight first, then the one last in focus.
    setTimeout(() => {
      const best = heard.sort((a, b) => Number(b.visible) - Number(a.visible) || b.seen - a.seen)[0];
      if (best) channel.postMessage({ take: ask, tab: best.tab, id });
      else finish(false);
    }, 120);
  });
}

/**
 * At the page's start, for an address with ?link=<workspace>: handed to an open tab (this one then closes), or opened
 * here, in that workspace. Answers 'gate' when the page is to ask for a sign-in and draw nothing else.
 */
export async function linkFirst() {
  const params = new URLSearchParams(location.search);
  const ws = params.get('link');
  if (ws === null) return;
  // The address keeps its item and loses the link: a reload is the page, not another hand-off.
  params.delete('link');
  history.replaceState(history.state, '', `${location.pathname}${params.toString() ? `?${params}` : ''}${location.hash}`);
  const id = ITEM.exec(location.hash)?.[1];
  if (!WORKSPACE.test(ws)) return;
  if (id && (await handOff(ws, id))) {
    window.close();
    // A browser that will not close a tab it did not open leaves it here: it carries on as the page.
    await new Promise((resolve) => setTimeout(resolve, 120));
  }
  const now = workspaceOf(store.token), token = known.all()[ws]?.token;
  if (now !== ws && token) store.token = token;
  else if (now !== ws) {
    // Not signed in to it: a sign-in first, and its item after it. Signed in elsewhere, the page asks for it now;
    // signed in nowhere, it asks as it starts.
    keepLanding(ws, location.hash);
    if (now) {
      signIn('');
      return 'gate';
    }
  }
  if (id) land(id, true);
}
