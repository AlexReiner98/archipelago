// Systems asking for a token: one row each, with the code the system showed, approved or refused with one click. On
// an item's page only the requests about that item; on Home all of them, those about no item you can see included,
// so a mistyped address is seen and refused. The token goes to the system's poll, never to this page. An answered
// request stays as one line until it runs out, linking to the items its token is within, whose page lists the token.

import { api, ask, authHeaders, h } from './base.js';
import { link, when } from './words.js';
import { seekTokens } from './token-piece.js';

/** How often the card looks for new requests while it is on the page. */
const AGAIN_MS = 15_000;

/** The piece: drawn into host on a server where tokens sign people in, and drawn again while it is on the page. */
export async function tokenAskPiece(host, e) {
  if (!host.isConnected) return;
  const me = await fetch('/whoami', { headers: authHeaders() }).then((r) => r.json()).catch(() => null);
  if (me?.auth !== 'tokens' || e?.archived_at) return host.remove();
  const asks = await api('token_requests', { ...(e && { within: e.id }), answered: true }).catch(() => []);
  const waiting = asks.filter((a) => a.state === 'pending');
  if (!host.isConnected) return;
  const again = () => tokenAskPiece(host, e);
  clearTimeout(host.later);
  host.later = setTimeout(again, AGAIN_MS);
  const error = h('div', { class: 'error' });
  const known = (a) => a.items.every(Boolean);
  const names = (a) => a.items.map((i, n) => i?.title ?? a.addresses[n]).join(', ');
  const answer = async (a, approve) => {
    const asked = approve
      ? await ask({ title: `Give "${a.name}" a token?`, message: `Only if it shows ${a.code}. It may only report, on ${names(a)}, and acts for you.`, action: 'Approve' })
      : await ask({ title: `Refuse "${a.name}"?`, message: 'It is told no, and can ask again.', action: 'Refuse', danger: true });
    if (asked) await api('token_request_answer', { id: a.id, approve }).then(again, (err) => (error.textContent = err.message));
  };
  const items = (a, title) => a.items.map((i, n) => [n > 0 && ', ', i ? h('a', { href: `#/e/${i.id}`, title, onclick: seekTokens(i.id) }, i.title) : h('span', { class: 'muted', title: 'No item you can see is watched here' }, a.addresses[n])]);
  const answered = (a) =>
    h(
      'li',
      { class: 'row-top tie-row' },
      h('strong', { class: 'gist muted', title: a.name, style: 'flex: 0 1 auto; min-width: var(--code-least); max-width: var(--code-most); overflow: hidden; text-overflow: ellipsis; white-space: nowrap' }, a.name),
      h('span', { class: `pill ${a.state === 'refused' ? 'bad' : 'ok'}`, title: `${a.answered_by ? `By ${a.answered_by}, ` : ''}${a.state === 'handed' ? 'and the system has collected its token' : a.state === 'approved' ? 'not yet collected by the system' : 'the system is told no'}` }, a.state === 'refused' ? 'refused' : a.state === 'handed' ? 'collected' : 'approved'),
      h('span', { class: 'grow gist', title: names(a) }, a.state === 'refused' ? h('span', { class: 'muted' }, names(a)) : items(a, a.state === 'handed' ? 'Its token is under Tokens for this' : 'Its token is made when the system collects it')),
      h('span', { class: 'muted small', title: `Gone from here ${when(a.expires_at)}` }, a.code),
    );
  const row = (a) =>
    h(
      'li',
      { class: 'row-top tie-row' },
      h('strong', { class: 'gist', title: a.name, style: 'flex: 0 1 auto; min-width: var(--code-least); max-width: var(--code-most); overflow: hidden; text-overflow: ellipsis; white-space: nowrap' }, a.name),
      h('span', { class: 'pill warn', title: `The code the system showed: approve only if it is the same.\nAsked ${when(a.asked_at)}, runs out ${when(a.expires_at)}` }, a.code),
      h('span', { class: 'grow gist', title: names(a) }, a.items.map((i, n) => [n > 0 && ', ', i ? link(i) : h('span', { class: 'muted', title: 'No item you can see is watched here' }, a.addresses[n])])),
      h('button', { class: 'primary', disabled: !known(a), title: known(a) ? `A token that may only report, within ${names(a)}` : 'No item you can see is watched at one of its addresses', onclick: () => answer(a, true) }, 'Approve'),
      h('button', { onclick: () => answer(a, false) }, 'Refuse'),
    );
  host.replaceChildren(
    ...(asks.length
      ? [h('section', { class: `card wide${waiting.length ? ' needs' : ''}`, style: 'margin-bottom: var(--space-8)' }, h('header', {}, h('h2', {}, 'Asking for a token'), waiting.length > 0 && h('span', { class: 'n' }, waiting.length)), h('ul', { class: 'rows' }, asks.map((a) => (a.state === 'pending' ? row(a) : answered(a)))), error)]
      : []),
  );
}
