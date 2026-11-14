// A client asks to connect (packs/identity/kernel/oauth.ts): the person signs in if they need to, sees who is asking, the workspace it
// would act in and where it returns to, and says Allow or Deny. Anyone can name a client anything, so every connection
// is asked for here and the place it returns to is always shown.

import { authHeaders, enter, gate, gateRow, h, keepWaiting, postJson, signIn, store, waitingOnSignIn, whoami } from './base.js';

const post = async (path, body, headers = {}) => {
  const res = await postJson(path, body, headers);
  return { res, body: await res.json().catch(() => ({})) };
};

const page = gate;

/**
 * Keep a guest map before its agent connects: an address, the code mailed to it, what it owes agreed to, and the map is
 * the person's, signed in as its member; the page comes back here (enter) to Allow. `machine`: the installer's id for
 * the computer, carried in the client's request.
 */
function keepFirst(machine) {
  const error = h('div', { class: 'error gate-error' });
  const email = h('input', { type: 'email', placeholder: 'Email', autocomplete: 'email', spellcheck: false });
  const send = h('button', { class: 'primary', title: 'A code is mailed to it' }, 'Email me a code');
  const keep = async (body) => {
    const said = await post('/connect/keep', { ...body, ...(machine && { machine }) }, authHeaders());
    if (!said.res.ok) throw new Error(said.body.error ?? 'That did not work.');
    return said.body;
  };
  const codeStep = (sentTo) => {
    const code = h('input', { type: 'text', placeholder: 'Code from the email', autocomplete: 'one-time-code', autocapitalize: 'characters', spellcheck: false });
    const go = h('button', { class: 'primary' }, 'Keep this map');
    const typed = async (agree) => {
      go.disabled = true;
      try {
        const said = await keep({ email: sentTo, code: code.value.trim(), ...(agree && { agree }) });
        if (said.agree) return agreeStep(said.agree, typed);
        enter(said.token);
      } catch (err) {
        error.textContent = err.message;
        go.disabled = false;
      }
    };
    go.onclick = () => typed();
    code.addEventListener('keydown', (e) => e.key === 'Enter' && typed());
    page('Check your email', gateRow(h('span', { class: 'muted grow gist', title: sentTo }, sentTo)), gateRow(code, go), error);
    code.focus();
  };
  // What the address has not agreed to yet: one box for all of it, and the code sent again with it.
  const agreeStep = (documents, again) => {
    const box = h('input', { type: 'checkbox' });
    const go = h('button', { class: 'primary', disabled: true }, 'Continue');
    box.addEventListener('change', () => (go.disabled = !box.checked));
    go.onclick = () => again(documents.map(({ id, version }) => ({ id, version })));
    const links = documents.flatMap((d, i) => [i === 0 ? '' : i === documents.length - 1 ? ' and the ' : ', the ', h('a', { href: d.url, target: '_blank', rel: 'noopener' }, d.title)]);
    page('Agree to our terms', h('label', { class: 'gate-agree' }, box, h('span', {}, 'I agree to the ', ...links)), gateRow(h('span', { class: 'grow' }), go), error);
  };
  const ask = async () => {
    send.disabled = true;
    try {
      codeStep((await keep({ email: email.value.trim() })).sent_to);
    } catch (err) {
      error.textContent = err.message;
      send.disabled = false;
    }
  };
  send.onclick = ask;
  email.addEventListener('keydown', (e) => e.key === 'Enter' && ask());
  page('Sign in to keep this map', gateRow(email, send), error);
  email.focus();
}

const fact = (label, value) => gateRow(h('span', { class: 'muted grow' }, label), h('strong', { class: 'gist', title: value }, value));

export async function authorizePage(given) {
  const query = given || waitingOnSignIn();
  if (!query) return void (location.hash = '#/');
  keepWaiting(query);
  const asked = await post('/oauth/describe', { query });
  if (!asked.res.ok) {
    keepWaiting(null);
    return page('This client cannot connect', h('div', { class: 'muted' }, asked.body.error ?? 'Start again from the client.'));
  }
  const { client, returns_to, workspace } = asked.body;
  const me = store.token ? await whoami() : null;
  if (me?.actor.kind !== 'human') return signIn('', `Sign in to connect ${client}`);
  // This address is one workspace's own: a person signed in to another is asked to sign in to it.
  if (workspace && me.workspace.id !== workspace) return signIn('', `Sign in to ${workspace} to connect ${client}`);
  // A guest map is kept first: signing in to connect is signing in to keep it (packs/identity/kernel/guest-keep.ts).
  if (me.workspace.guest) return keepFirst(new URLSearchParams(query).get('machine') ?? undefined);
  const error = h('div', { class: 'error gate-error' });
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
    gateRow(
      h('a', { href: '#', class: 'grow small', title: 'Allow it on another workspace you belong to', onclick: (e) => (e.preventDefault(), signIn('', `Sign in to connect ${client}`)) }, 'Another workspace'),
      h('button', { onclick: answer(false) }, 'Deny'),
      h('button', { class: 'primary', title: 'It sees what you see and acts under this workspace’s rules, until you revoke it under Settings → Agents', onclick: answer(true) }, 'Allow'),
    ),
    error,
  );
}
