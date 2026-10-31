// A client asks to connect (src/oauth.ts): the person signs in if they need to, sees who is asking, the workspace it
// would act in and where it returns to, and says Allow or Deny. Anyone can name a client anything, so every connection
// is asked for here and the place it returns to is always shown.

import { authHeaders, h, keepWaiting, main, signIn, store, waitingOnSignIn } from './base.js';
import { applyTheme } from './theme.js';

const post = async (path, body, headers = {}) => {
  const res = await fetch(path, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) });
  return { res, body: await res.json().catch(() => ({})) };
};

const page = (title, ...kids) => {
  fetch('/connect/theme').then((r) => r.json()).then(applyTheme, () => undefined);
  document.querySelector('#nav .brand').replaceChildren('Archipelago');
  document.title = `${title} · Archipelago`;
  main.replaceChildren(h('div', { class: 'page-head' }, h('h1', {}, title)), h('section', { class: 'card', style: 'max-width: var(--card-most)' }, ...kids));
};

const fact = (label, value) => h('div', { class: 'toolbar', style: 'padding: var(--space-4) var(--space-8)' }, h('span', { class: 'muted grow' }, label), h('strong', {}, value));

export async function authorizePage(given) {
  const query = given || waitingOnSignIn();
  if (!query) return void (location.hash = '#/');
  keepWaiting(query);
  const asked = await post('/oauth/describe', { query });
  if (!asked.res.ok) {
    keepWaiting(null);
    return page('This client cannot connect', h('div', { class: 'empty' }, asked.body.error ?? 'Start again from the client.'));
  }
  const { client, returns_to, workspace } = asked.body;
  const whoami = store.token ? await fetch('/whoami', { headers: authHeaders() }) : null;
  const me = whoami?.ok ? await whoami.json() : null;
  if (me?.actor.kind !== 'human') return signIn('', `Sign in to connect ${client}`);
  // This address is one workspace's own: a person signed in to another is asked to sign in to it.
  if (workspace && me.workspace.id !== workspace) return signIn('', `Sign in to ${workspace} to connect ${client}`);
  const error = h('div', { class: 'error', style: 'padding: 0 var(--space-8) var(--space-8)' });
  const answer = (allow) => async (e) => {
    e.target.disabled = true;
    const said = await post('/oauth/allow', { query, allow }, authHeaders());
    if (!said.res.ok) {
      e.target.disabled = false;
      return (error.textContent = said.body.error ?? 'That did not work.');
    }
    keepWaiting(null);
    location.assign(said.body.redirect);
  };
  page(
    `Connect ${client}?`,
    fact('Workspace', me.workspace.name),
    fact('Acts for', me.actor.name),
    fact('Returns to', returns_to),
    h(
      'div',
      { class: 'toolbar', style: 'padding: var(--space-8)' },
      h('a', { href: '#', class: 'grow small', title: 'Allow it on another workspace you belong to', onclick: (e) => (e.preventDefault(), signIn('', `Sign in to connect ${client}`)) }, 'Another workspace'),
      h('button', { onclick: answer(false) }, 'Deny'),
      h('button', { class: 'primary', title: 'It sees what you see and acts under this workspace’s rules, until you revoke it under Workspace → Agents', onclick: answer(true) }, 'Allow'),
    ),
    error,
  );
}
