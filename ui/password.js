// A person's password, kept for their address beside the emailed link (src/passwords.ts): set, changed or taken away.
// Reached from the menu under the workspace's name; a forgotten one is replaced after signing in by email.

import { authHeaders, gate, gateRow, h, postJson, route, ungate } from './base.js';

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
  const since = now?.set && new Date(now.set).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
  gate(
    'Password',
    gateRow(h('span', { class: 'muted grow gist', title: now?.set ? `${now.email} has a password, set ${since}; the emailed link works too` : `${now?.email ?? 'You'} signs in by email alone; a password works beside it` }, now?.email ?? ''), now?.set ? h('span', { class: 'muted small' }, `Set ${since}`) : '', now?.set ? remove : ''),
    gateRow(fresh, save),
    error,
    gateRow(h('a', { href: '#', class: 'small', onclick: (e) => (e.preventDefault(), back()) }, 'Back')),
  );
  fresh.focus();
}
