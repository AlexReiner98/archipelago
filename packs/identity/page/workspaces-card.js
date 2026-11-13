// The server's workspaces, for whoever runs it (the owner, 5 Nov 2026, e_c6syn5hn: "A: card in the page"): on the
// default workspace's Packs section, its admin types the operator secret, sees every workspace, makes one (empty or
// from a backup file) and is shown its owner token once. The secret is kept in this page's memory alone, never
// stored, so it is asked for again after a reload; the operator routes are the server's (/operator/workspaces).

import { ask, h } from './base.js';
import { day, menu } from './words.js';
import { card, fileInput, line, secretBox } from './workspace-cards.js';

let secret = '';

/** A call to the operator's routes with the secret typed in. */
async function call(method, payload, path = '') {
  const res = await fetch(`/operator/workspaces${path}`, { method, headers: { authorization: `Bearer ${secret}`, ...(payload && { 'content-type': 'application/json' }) }, body: payload && JSON.stringify(payload) });
  const json = await res.json().catch(() => ({ error: `The server answered ${res.status}` }));
  if (!res.ok) throw new Error(json.error);
  return json.result;
}

/** A file's bytes in base64, as the route takes a backup. */
async function base64(file) {
  const bytes = new Uint8Array(await file.arrayBuffer());
  let out = '';
  for (let i = 0; i < bytes.length; i += 0x8000) out += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(out);
}

/** Who can sign in to a workspace by email and manage it: its admins' addresses, or a warning where it has none. */
const adminsMark = (admins) =>
  admins.length
    ? h('span', { class: 'muted small gist', style: 'min-width: 0', title: `Admins, who sign in by email:\n${admins.join('\n')}` }, admins.length === 1 ? admins[0] : `${admins[0]} +${admins.length - 1}`)
    : h('span', { class: 'error small', title: 'No admin with an email address: nobody can sign in to it by email. Add one under its People, signed in with an owner token.' }, 'no email');

export function workspacesCard(current) {
  const body = h('div');
  const error = h('div');
  const fail = (err) => error.replaceChildren(h('div', { class: 'error gist', title: err.message }, err.message));
  const draw = async (made) => {
    error.replaceChildren();
    if (!secret) {
      const typed = h('input', { type: 'password', placeholder: 'Operator secret', autocomplete: 'off', style: 'flex: 1; min-width: 0' });
      const open = () => ((secret = typed.value.trim()), draw().catch((err) => ((secret = ''), draw(), fail(err))));
      typed.onkeydown = (e) => e.key === 'Enter' && open();
      return body.replaceChildren(h('ul', { class: 'rows' }, line(h('span', { class: 'grow muted', title: 'Printed the first time the server started with tokens on, and kept in this page alone until it is reloaded. Lost, it is replaced with "node src/cli.ts operator-reset" on the server.' }, 'Operator secret'), typed, h('button', { onclick: open }, 'Open'))));
    }
    const list = await call('GET');
    const id = h('input', { type: 'text', placeholder: 'id (acme)', title: 'Its address: lowercase letters, digits and dashes', style: 'flex: 1; min-width: 0' });
    const name = h('input', { type: 'text', placeholder: 'Name', style: 'flex: 2; min-width: 0' });
    // Every workspace is made with its owner's address, who signs in to it by email; one from a backup brings its own.
    const email = h('input', { type: 'email', placeholder: 'Owner email', autocomplete: 'off', style: 'flex: 2; min-width: 0' });
    // With a backup file chosen, the new workspace starts as the map in that file.
    const file = fileInput('.gz,.json');
    const from = h('span', { class: 'muted small gist' });
    file.onchange = () => (from.textContent = file.files[0] ? `from ${file.files[0].name}` : '');
    // A new workspace's database takes some seconds to make: the button says so, and is not pressed twice.
    const create = async (e) => {
      const button = e.target;
      button.disabled = true;
      button.textContent = 'Making…';
      try {
        const backup = file.files[0] && (await base64(file.files[0]));
        await draw(await call('POST', { id: id.value.trim(), name: name.value.trim(), ...(backup ? { backup } : { email: email.value.trim() }) }));
      } catch (err) {
        button.disabled = false;
        button.textContent = 'Make workspace';
        fail(err);
      }
    };
    const reissue = async (w) =>
      (await ask({ title: `A new owner token for ${w.name}?`, message: 'It has full control of that workspace. Tokens already made keep working until its owner revokes them.', action: 'Make it' })) && call('POST', {}, `/${encodeURIComponent(w.id)}/owner-token`).then(draw, fail);
    const restored = made?.restored && `${made.restored.entities} items and ${made.restored.events} events from ${made.restored.from.name}, taken ${day(made.restored.taken)}`;
    body.replaceChildren(
      made ? secretBox(`Owner token for ${made.workspace.name} (${made.workspace.id})`, made.owner_token, made.workspace) : '',
      restored ? h('div', { class: 'muted small gist', title: `${restored}. Tokens from where it came from do not work here.` }, restored) : '',
      h(
        'ul',
        { class: 'rows' },
        list.map((w) => line(h('span', { class: 'grow gist', title: `${w.name} (${w.id})` }, h('strong', {}, w.name), ' ', h('span', { class: 'muted small' }, w.id === current ? `${w.id}, this one` : w.id)), adminsMark(w.admins ?? []), menu('⋯', [['New owner token…', () => reissue(w)]]))),
        line(id, name, email, from, h('button', { class: 'primary', title: 'An empty workspace, or the map in the backup file chosen; its owner token is shown once', onclick: create }, 'Make workspace'), menu('⋯', [['From a backup file…', () => file.click()], ['Forget the secret', () => ((secret = ''), draw())]])),
      ),
      file,
    );
  };
  draw().catch((err) => ((secret = ''), draw(), fail(err)));
  return card('Workspaces', 'Every workspace on this server, for whoever runs it. The operator secret makes them and reads none of their maps.', body, error);
}
