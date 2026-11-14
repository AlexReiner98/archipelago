// A person's password, kept for their address beside the emailed link (packs/identity/kernel/passwords.ts): set, changed or taken away.
// A passkey is added here too (./passkey.js): a tap at the sign-in page in place of either.
// Reached from the menu under the workspace's name; a forgotten one is replaced after signing in by email.

import { authHeaders, gate, gateRow, h, postJson, route, ungate } from './base.js';
import { addPasskey, passkeysHere } from './passkey.js';

const ask = async (password) => {
  const res = await postJson('/connect/password/set', password === undefined ? {} : { password }, authHeaders());
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error ?? 'That did not work.');
  return body;
};

export async function passwordPage() {
  const error = h('div', { class: 'error gate-error' });
  const back = () => (ungate(), route());
  let now;
  try {
    now = await ask();
  } catch (err) {
    error.textContent = err.message;
  }
  const fresh = h('input', { type: 'password', placeholder: now?.set ? 'New password' : 'Password', autocomplete: 'new-password', minlength: 10, title: 'At least 10 characters' });
  const save = h('button', { class: 'primary' }, now?.set ? 'Change' : 'Set');
  const saved = async () => {
    if (!fresh.value) return;
    save.disabled = true;
    try {
      await ask(fresh.value);
      back();
    } catch (err) {
      error.textContent = err.message;
      save.disabled = false;
    }
  };
  save.onclick = saved;
  fresh.addEventListener('keydown', (e) => e.key === 'Enter' && saved());
  const remove = h('a', { href: '#', title: 'Sign in by email alone again' }, 'Remove');
  remove.onclick = (e) => (e.preventDefault(), ask(null).then(back, (err) => (error.textContent = err.message)));
  // A passkey: how many this address has, and one more added with a tap.
  const keys = passkeysHere() && (await postJson('/connect/passkey/mine', {}, authHeaders()).then((r) => r.json(), () => ({}))).passkeys;
  const count = h('span', { class: 'muted grow' }, keys ? `${keys} passkey${keys === 1 ? '' : 's'}` : 'No passkey yet');
  const add = h('button', { title: 'Sign in next time with a tap: your device keeps the key' }, 'Add a passkey');
  add.onclick = async () => {
    add.disabled = true;
    try {
      await addPasskey();
      passwordPage();
    } catch (err) {
      error.textContent = err.name === 'NotAllowedError' ? 'No passkey was added.' : err.message;
      add.disabled = false;
    }
  };
  const since = now?.set && new Date(now.set).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
  gate(
    'Password and passkey',
    gateRow(h('span', { class: 'muted grow gist', title: now?.set ? `${now.email} has a password, set ${since}; the emailed link works too` : `${now?.email ?? 'You'} signs in by email alone; a password works beside it` }, now?.email ?? ''), now?.set ? h('span', { class: 'muted small' }, `Set ${since}`) : '', now?.set ? remove : ''),
    gateRow(fresh, save),
    keys !== false && gateRow(count, add),
    error,
    gateRow(h('a', { href: '#', class: 'small', onclick: (e) => (e.preventDefault(), back()) }, 'Back')),
  );
  fresh.focus();
}
