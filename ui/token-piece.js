// Tokens for one item: made on its page, within it. One that may only report is for a running system (a monitor, a
// deploy) that sends what it measured; one that may propose is for an agent whose every change waits. The tokens
// within the item are listed here too, each with when it was last used, and revocable; all of them stay listed on
// the Workspace screen.

import { api, ask, authHeaders, h } from './base.js';
import { ago, unfolded, when } from './words.js';
import { connectBox, secretBox } from './workspace-cards.js';

/** What an agent's token may write, as pills: within what, by name, and whether it only reports or proposes. */
export const scopePills = (t) => [
  t.within?.length && [' ', h('span', { class: 'pill', title: `It writes only within: ${(t.within_titles ?? t.within).join(', ')}` }, `${t.within.length === 1 ? (t.within_titles?.[0] ?? t.within[0]) : `${t.within.length} items`} only`)],
  t.may && t.may !== 'change' && [' ', h('span', { class: 'pill', title: t.may === 'report' ? 'It can only send what a system measured' : 'Every change it sends waits for you' }, t.may === 'report' ? 'reports' : 'proposes')],
];

/** The item whose tokens a link led to: its page opens with them unfolded and in sight. */
let sought;
/** What a link to an item's tokens does on its click, so they are what its page opens on. */
export const seekTokens = (id) => () => {
  unfolded.set(`${id}:tokens`, true);
  sought = id;
};

const MAY = [
  ['report', 'Reports only', 'For a system (a monitor, a deploy): it can only send what it measured, about what is in this'],
  ['propose', 'Proposes', 'For an agent: it reads what you read, and every change it makes within this waits for you'],
];

/** The piece: drawn into host, folded until asked for, on a server where tokens sign people in. */
export async function tokenPiece(host, e, fold, made) {
  const me = await fetch('/whoami', { headers: authHeaders() }).then((r) => r.json()).catch(() => null);
  if (me?.auth !== 'tokens' || e.archived_at) return host.remove();
  const tokens = (await api('token_list', { within: e.id }).catch(() => [])).filter((t) => !t.revoked_at && t.within?.length);
  if (!host.isConnected) return;
  const again = (shown) => tokenPiece(host, e, fold, shown);
  const error = h('div', { class: 'error' });
  const name = h('input', { type: 'text', placeholder: 'Name (Uptime Kuma)', style: 'flex: 1; min-width: 160px' });
  const may = h('select', { title: MAY[0][2], onchange: () => (may.title = MAY.find(([v]) => v === may.value)[2]) }, MAY.map(([v, label]) => h('option', { value: v }, label)));
  const make = async () => {
    try {
      const token = await api('token_create', { kind: 'agent', name: name.value.trim() || (may.value === 'report' ? 'reporter' : 'agent'), within: [e.id], may: may.value });
      await again({ ...token, may: may.value });
    } catch (err) {
      error.textContent = err.message;
    }
  };
  const revoke = async (t) => (await ask({ title: `Revoke the token "${t.name}"?`, message: 'Whatever uses it can no longer reach the map.', action: 'Revoke', danger: true })) && api('token_revoke', { id: t.id }).then(() => again(), (err) => (error.textContent = err.message));
  const row = (t) =>
    h(
      'li',
      { class: 'row-top' },
      h('strong', { class: 'grow gist', title: t.name }, t.name),
      scopePills({ may: t.may, ...(t.within.length > 1 && { within: t.within, within_titles: t.within_titles }) }),
      h('span', { class: 'muted small', title: t.expires_at ? `Expires ${when(t.expires_at)}` : 'Never expires' }, t.last_used ? ago(t.last_used) : 'never used'),
      h('button', { class: 'danger', onclick: () => revoke(t) }, 'Revoke'),
    );
  host.replaceChildren(
    fold(e.id, 'tokens', 'Tokens for this', tokens.length || '', Boolean(made), [
      made && (made.may === 'report' ? secretBox(`For ${made.name}: POST ${location.origin}/agent/report, with this as Authorization: Bearer`, made.token) : connectBox(made)),
      tokens.length > 0 && h('ul', { class: 'rows' }, tokens.map(row)),
      h('div', { class: 'toolbar fold-bar' }, name, may, h('button', { class: 'primary', title: 'A token that writes only within this, shown once', onclick: make }, 'Make a token for this')),
      error,
    ]),
  );
  if (sought === e.id) {
    sought = undefined;
    host.scrollIntoView({ block: 'start' });
  }
}
