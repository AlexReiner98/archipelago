// Sign up to save your map (the owner, 14 Nov 2026; e_9ewt9kc6): one screen for a guest map's owner, at #/sign-up and
// wherever saving it is asked first (a client waiting to connect: ./authorize.js). The terms are ticked on it, and the
// address is proved by Google, GitHub or a code typed inline; the map is the same workspace, now theirs, and the page
// lands on its canvas. The other ways in (Google, GitHub, a passkey) are offered on the sign-in page too, and each comes
// back here with a ticket (#/sign-up?ticket=, #/sign-in?ticket=) the server trades once
// (packs/identity/kernel/verified.ts). The host's: it enters a token, which no pack's code may do.

import { authHeaders, enter, gate, gateRow, h, keepLanding, postJson, whoami, workspaceOf } from './base.js';
import { passkeyTicket, passkeysHere } from './passkey.js';

const TITLE = 'Sign up to save your map';
const PROVIDERS = { google: 'Google', github: 'GitHub' };

const posted = async (path, body, headers = {}) => {
  const res = await postJson(path, body, headers);
  const said = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(said.error ?? 'That did not work.');
  return said;
};
/** The ways this server signs people in beside a code: the providers it has a client for, and passkeys. */
const ways = () => fetch('/connect/ways').then((r) => (r.ok ? r.json() : { social: [] }), () => ({ social: [] }));

/** A saved map opens on its canvas, unless a client is waiting to connect (enter goes to Allow first). */
function landSaved(token) {
  keepLanding(workspaceOf(token), '#/');
  enter(token);
}

/** The documents a person agrees to, as one tick: the box, and what it agrees to when ticked. */
function terms(documents, changed) {
  if (!documents.length) return { row: null, agreed: () => undefined };
  const box = h('input', { type: 'checkbox' });
  box.addEventListener('change', () => changed(box.checked));
  const link = (d) => h('a', { href: d.url, target: '_blank', rel: 'noopener' }, d.title);
  const links = documents.flatMap((d, i) => [i === 0 ? '' : i === documents.length - 1 ? ' and the ' : ', the ', link(d)]);
  return { row: h('label', { class: 'gate-agree' }, box, h('span', {}, 'I agree to the ', ...links)), agreed: () => (box.checked ? documents.map(({ id, version }) => ({ id, version })) : undefined) };
}

/** #/sign-up: the one screen, or its end (a ticket back from Google or GitHub, or why not). `machine`: the installer's id for the computer. */
export async function signUpPage(query = '', { machine } = {}) {
  const params = new URLSearchParams(query);
  machine ??= params.get('machine') ?? undefined;
  // What came back leaves the address at once: a ticket is not left in the history.
  if (params.get('ticket') || params.get('failed')) history.replaceState(null, '', '#/sign-up');
  if (params.get('ticket')) return finish(params.get('ticket'), 'keep');
  const me = await whoami().catch(() => null);
  if (!me?.workspace?.guest) return void (location.hash = '#/');
  const error = h('div', { class: 'error gate-error' }, params.get('failed') ?? '');
  const fail = (err) => (error.textContent = err.message ?? String(err));
  const [{ agreements = [] }, { social = [] }] = await Promise.all([fetch('/connect/agreements').then((r) => r.json(), () => ({})), ways()]);
  const buttons = [];
  const { row, agreed } = terms(agreements, (on) => buttons.forEach((b) => (b.disabled = !on)));
  const ready = !row;
  const button = (label, onclick, primary = false) => {
    const b = h('button', { class: primary ? 'primary grow' : 'grow', disabled: !ready, title: ready ? '' : 'Tick the box first', onclick }, label);
    buttons.push(b);
    return gateRow(b);
  };
  const withProvider = (provider) => async (e) => {
    e.target.disabled = true;
    try {
      const said = await posted('/connect/social', { provider, for: 'keep', agree: agreed(), ...(machine && { machine }) }, authHeaders());
      location.assign(said.url);
    } catch (err) {
      fail(err);
      e.target.disabled = false;
    }
  };
  // By email: the address and the code, typed here, the rest of the screen kept.
  const byEmail = h('div', { hidden: true });
  const email = h('input', { type: 'email', placeholder: 'Email', autocomplete: 'email', spellcheck: false });
  const send = h('button', { class: 'primary', title: 'A code is mailed to it' }, 'Email me a code');
  const code = h('input', { type: 'text', placeholder: 'Code from the email', autocomplete: 'one-time-code', autocapitalize: 'characters', spellcheck: false });
  const go = h('button', { class: 'primary' }, 'Sign up');
  const codeRow = gateRow(code, go);
  codeRow.hidden = true;
  const keep = (body) => posted('/connect/keep', { ...body, agree: agreed(), ...(machine && { machine }) }, authHeaders());
  const ask = async () => {
    if (!email.value.trim()) return email.focus();
    send.disabled = true;
    try {
      await keep({ email: email.value.trim() });
      send.textContent = 'Send again';
      codeRow.hidden = false;
      fail('');
      code.focus();
    } catch (err) {
      fail(err);
    }
    send.disabled = false;
  };
  const typed = async () => {
    go.disabled = true;
    try {
      const said = await keep({ email: email.value.trim(), code: code.value.trim() });
      if (said.agree) throw new Error('Tick the box to agree first.');
      landSaved(said.token);
    } catch (err) {
      fail(err);
      go.disabled = false;
    }
  };
  send.onclick = ask;
  go.onclick = typed;
  email.addEventListener('keydown', (e) => e.key === 'Enter' && ask());
  code.addEventListener('keydown', (e) => e.key === 'Enter' && typed());
  byEmail.append(gateRow(email, send), codeRow, gateRow(h('span', { class: 'muted grow small' }, 'Not there? Check spam or junk.')));
  const emailButton = button('Sign up with email', () => {
    emailButton.hidden = true;
    byEmail.hidden = false;
    email.focus();
  });
  gate(
    TITLE,
    row,
    ...social.filter((p) => PROVIDERS[p]).map((p) => button(`Sign up with ${PROVIDERS[p]}`, withProvider(p), true)),
    emailButton,
    byEmail,
    error,
  );
}

/** A ticket traded: a token entered, or the agreement, the workspace or the start it waits on. `purpose`: keep or sign-in. */
async function finish(ticket, purpose, more = {}) {
  const error = h('div', { class: 'error gate-error' });
  gate(purpose === 'keep' ? TITLE : 'Sign in', gateRow(h('span', { class: 'muted grow' }, 'Signing you in…')), error);
  try {
    const said = await posted('/connect/verified', { ticket, ...more });
    if (said.token) return purpose === 'keep' ? landSaved(said.token) : enter(said.token);
    if (said.agree) {
      const { row, agreed } = terms(said.agree, (on) => (next.disabled = !on));
      const next = h('button', { class: 'primary', disabled: true, onclick: () => finish(ticket, purpose, { ...more, agree: agreed() }) }, 'Continue');
      return gate('Agree to our terms', row, gateRow(h('span', { class: 'grow' }), next), error);
    }
    if (said.workspaces) return gate('Open which workspace?', ...said.workspaces.map((w) => gateRow(h('span', { class: 'grow gist', title: w.name }, w.name), h('button', { class: 'primary', onclick: () => finish(ticket, purpose, { ...more, workspace: w.id }) }, 'Open'))), error);
    if (said.none) return gate('No map here yet', gateRow(h('span', { class: 'muted grow gist', title: said.none }, said.none)), gateRow(h('span', { class: 'grow' }), h('a', { class: 'primary', href: '#/try', title: 'Make a map with your agent, then sign up to save it' }, 'Try it with your agent')));
    throw new Error('That did not work.');
  } catch (err) {
    error.textContent = err.message;
  }
}

/** #/sign-in?ticket= or ?failed=: back from Google or GitHub on the sign-in page. Answers false where there is neither. */
export function signInBack(query = '') {
  const params = new URLSearchParams(query);
  if (!params.get('ticket') && !params.get('failed')) return false;
  history.replaceState(null, '', '#/');
  if (params.get('ticket')) finish(params.get('ticket'), 'sign-in');
  else gate('Sign in', h('div', { class: 'error gate-error' }, params.get('failed')), gateRow(h('span', { class: 'grow' }), h('a', { href: '#/' }, 'Try again')));
  return true;
}

/** The sign-in page's other ways in, beside the code: Google, GitHub, a passkey. Rows for it to draw; none where none is offered. */
export function otherWays(fail) {
  const rows = h('div', { class: 'gate-ways' });
  ways().then(({ social = [] }) => {
    const provider = (p) => async (e) => {
      e.target.disabled = true;
      try {
        location.assign((await posted('/connect/social', { provider: p, for: 'sign-in' })).url);
      } catch (err) {
        fail(err.message);
        e.target.disabled = false;
      }
    };
    const passkey = async (e) => {
      e.target.disabled = true;
      try {
        await finish(await passkeyTicket(), 'sign-in');
      } catch (err) {
        fail(err.name === 'NotAllowedError' ? 'No passkey was used.' : err.message);
        e.target.disabled = false;
      }
    };
    rows.replaceChildren(
      ...social.filter((p) => PROVIDERS[p]).map((p) => gateRow(h('button', { class: 'grow', onclick: provider(p) }, `Sign in with ${PROVIDERS[p]}`))),
      ...(passkeysHere() ? [gateRow(h('button', { class: 'grow', title: 'If you added one on this device', onclick: passkey }, 'Sign in with a passkey'))] : []),
    );
  });
  return rows;
}

/** On a guest map, Sign up in the bar, loud: the one thing the page asks of its owner. Gone once the map is saved. */
export async function signUpOffer() {
  const me = await whoami().catch(() => null);
  const there = document.querySelector('#nav .sign-up');
  if (!me?.workspace?.guest || me.actor.kind !== 'human') return there?.remove();
  if (there) return;
  document.getElementById('more')?.before(h('a', { class: 'start-own sign-up', href: '#/sign-up', title: 'A guest map is deleted after a week: sign up to keep it' }, 'Sign up'));
}
