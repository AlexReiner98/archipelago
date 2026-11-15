// Sign up to save your map (the owner, 14 Nov 2026; e_9ewt9kc6): one screen for a guest map's owner, at #/sign-up and
// wherever saving it is asked first (a client waiting to connect: ./authorize.js). The terms are ticked on it, and the
// address is proved by Google, GitHub or a code typed inline; the map is the same workspace, now theirs, and the page
// lands on its canvas. The other ways in (Google, GitHub, a passkey) are offered on the sign-in page too, and each comes
// back here with a ticket (#/sign-up?ticket=, #/sign-in?ticket=) the server trades once
// (packs/identity/kernel/verified.ts). The host's: it enters a token, which no pack's code may do.

import { authHeaders, enter, gate, gateRow, h, keepLanding, postJson, whoami, workspaceOf } from './base.js';
import { autofillHere, passkeyTicket, passkeysHere } from './passkey.js';

const TITLE = 'Sign up to save your map';
const PROVIDERS = { google: 'Google', github: 'GitHub' };
/** Each provider's mark, one path in the button's own colour (simple-icons' Google, GitHub's Octicons), and its box. */
const MARKS = {
  google: ['0 0 24 24', 'M12.48 10.92v3.28h7.84c-.24 1.84-.853 3.187-1.787 4.133-1.147 1.147-2.933 2.4-6.053 2.4-4.827 0-8.6-3.893-8.6-8.72s3.773-8.72 8.6-8.72c2.6 0 4.507 1.027 5.907 2.347l2.307-2.307C18.747 1.44 16.133 0 12.48 0 5.867 0 .307 5.387.307 12s5.56 12 12.173 12c3.573 0 6.267-1.173 8.373-3.36 2.16-2.16 2.84-5.213 2.84-7.667 0-.76-.053-1.467-.173-2.053H12.48z'],
  github: ['0 0 16 16', 'M8 0c4.42 0 8 3.58 8 8a8.013 8.013 0 0 1-5.45 7.59c-.4.08-.55-.17-.55-.38 0-.27.01-1.13.01-2.2 0-.75-.25-1.23-.54-1.48 1.78-.2 3.65-.88 3.65-3.95 0-.88-.31-1.59-.82-2.15.08-.2.36-1.02-.08-2.12 0 0-.67-.22-2.2.82-.64-.18-1.32-.27-2-.27-.68 0-1.36.09-2 .27-1.53-1.03-2.2-.82-2.2-.82-.44 1.1-.16 1.92-.08 2.12-.51.56-.82 1.28-.82 2.15 0 3.06 1.86 3.75 3.64 3.95-.23.2-.44.55-.51 1.07-.46.21-1.61.55-2.33-.66-.15-.24-.6-.83-1.23-.82-.67.01-.27.38.01.53.34.19.73.9.82 1.13.16.45.68 1.31 2.69.94 0 .67.01 1.3.01 1.49 0 .21-.15.45-.55.38A7.995 7.995 0 0 1 0 8c0-4.42 3.58-8 8-8Z'],
};
const SVG = 'http://www.w3.org/2000/svg';
/** A provider's mark, drawn before its name on a button. */
function markOf(provider) {
  const [box, d] = MARKS[provider];
  const svg = document.createElementNS(SVG, 'svg');
  const path = document.createElementNS(SVG, 'path');
  svg.setAttribute('viewBox', box);
  svg.setAttribute('class', 'way-mark');
  svg.setAttribute('aria-hidden', 'true');
  path.setAttribute('d', d);
  path.setAttribute('fill', 'currentColor');
  svg.append(path);
  return svg;
}

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
  const button = (label, onclick, provider) => {
    const b = h('button', { class: 'grow', disabled: !ready, title: ready ? '' : 'Tick the box first', onclick }, provider && markOf(provider), label);
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
  const byEmail = h('div', { class: 'gate-ways' });
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
      codeRow.hidden = hint.hidden = false;
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
  const hint = gateRow(h('span', { class: 'muted grow small' }, 'Not there? Check spam or junk.'));
  hint.hidden = true;
  byEmail.append(gateRow(email, send), codeRow, hint);
  // Mail is blocked too often to lean on (the owner, 15 Nov 2026): by email only where the server has no provider.
  const providers = social.filter((p) => PROVIDERS[p]);
  gate(TITLE, row, ...providers.map((p) => button(`Sign up with ${PROVIDERS[p]}`, withProvider(p), p)), !providers.length && byEmail, error, gateRow(h('a', { href: '#/', class: 'small', title: 'It is kept for a week unsaved' }, 'Back to your map')));
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

/**
 * The sign-in page's other ways in (`top`): Google and GitHub, then a line and "or"; a passkey offered in the email
 * field's autofill and as a link under the form (`below`). Where the server has no provider, the page mails codes
 * (`withCodes`).
 */
export function otherWays(fail, { withCodes }) {
  const rows = h('div', { class: 'gate-ways' });
  const below = h('div', { class: 'gate-ways' });
  ways().then(async ({ social = [] }) => {
    const provider = (p) => async (e) => {
      e.target.disabled = true;
      try {
        location.assign((await posted('/connect/social', { provider: p, for: 'sign-in' })).url);
      } catch (err) {
        fail(err.message);
        e.target.disabled = false;
      }
    };
    const passkey = (autofill) =>
      passkeyTicket({ autofill }).then(
        (ticket) => finish(ticket, 'sign-in'),
        // Autofill is offered quietly: where it cannot be (an address passkeys are not kept for), nothing is said.
        (err) => !autofill && fail(err.name === 'NotAllowedError' ? 'No passkey was used.' : err.message),
      );
    const providers = social.filter((p) => PROVIDERS[p]);
    if (!providers.length) withCodes();
    rows.replaceChildren(...providers.map((p) => gateRow(h('button', { class: 'grow', onclick: provider(p) }, markOf(p), `Sign in with ${PROVIDERS[p]}`))));
    if (providers.length) rows.append(h('div', { class: 'gate-or' }, 'or'));
    if (!passkeysHere()) return;
    below.append(gateRow(h('a', { href: '#', class: 'small', title: 'If you added one, on this device or your phone', onclick: (e) => (e.preventDefault(), passkey(false)) }, 'Use a passkey')));
    if (await autofillHere()) passkey(true);
  });
  return { top: rows, below };
}

/** On a guest map, Sign up in the bar, loud: the one thing the page asks of its owner. Gone once the map is saved. */
export async function signUpOffer() {
  const me = await whoami().catch(() => null);
  const there = document.querySelector('#nav .sign-up');
  if (!me?.workspace?.guest || me.actor.kind !== 'human') return there?.remove();
  if (there) return;
  document.getElementById('more')?.before(h('a', { class: 'start-own sign-up', href: '#/sign-up', title: 'A guest map is deleted after a week: sign up to keep it' }, 'Sign up'));
}
