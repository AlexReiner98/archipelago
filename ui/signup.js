// Buying a workspace: a name and an address, then the seller's checkout; and the page the checkout sends the buyer
// back to, which signs this browser in to the new workspace as soon as it is made (src/signup.ts). No login needed.

import { enter, gate, gateRow, h, postJson } from './base.js';

/** Where this browser keeps the request it began, until the workspace is made. */
const KEPT = 'pelago-signup';
const keepRequest = (value) => {
  try {
    if (value) localStorage.setItem(KEPT, JSON.stringify(value));
    else localStorage.removeItem(KEPT);
  } catch {}
};
const keptRequest = () => {
  try {
    return JSON.parse(localStorage.getItem(KEPT) ?? 'null');
  } catch {
    return null;
  }
};

const page = gate;

export async function signupPage() {
  const offer = await fetch('/connect/signup').then((r) => r.json(), () => ({ open: false }));
  if (!offer.open) return page('Sign up', h('div', { class: 'muted' }, 'This server does not sell workspaces.'));
  const name = h('input', { type: 'text', placeholder: 'Workspace name', maxlength: 60, autocomplete: 'organization' });
  const email = h('input', { type: 'email', placeholder: 'Your email', autocomplete: 'email' });
  const error = h('div', { class: 'error gate-error' });
  const go = h('button', { class: 'primary', title: 'Pay on Lemon Squeezy, then come back here signed in' }, 'Continue to payment');
  go.onclick = async () => {
    go.disabled = true;
    const res = await postJson('/connect/signup', { name: name.value.trim(), email: email.value.trim() });
    const body = await res.json().catch(() => ({}));
    go.disabled = false;
    if (!res.ok) return (error.textContent = body.error ?? 'That did not work.');
    keepRequest({ request: body.request, secret: body.secret });
    location.href = body.checkout;
  };
  page(
    'Sign up',
    gateRow(h('span', { class: 'muted grow gist' }, 'A workspace for your people and agents'), offer.price && h('strong', {}, offer.price)),
    gateRow(name),
    gateRow(email, go),
    error,
  );
  name.focus();
}

/** Back from the checkout: wait for the workspace, then sign in to it. */
export async function welcome() {
  const kept = keptRequest();
  if (!kept) return page('Welcome', h('div', { class: 'muted' }, 'Sign in with the email address you paid with.'), gateRow(h('a', { href: '#/' }, 'Sign in')));
  const said = h('div', { class: 'muted' }, 'Making your workspace…');
  page('Welcome', said);
  for (let tries = 0; tries < 100; tries++) {
    const res = await fetch(`/connect/signup/${kept.request}`, { method: 'POST', headers: { authorization: `Bearer ${kept.secret}` } }).catch(() => null);
    const body = await res?.json().catch(() => ({}));
    if (body?.state === 'ready') {
      keepRequest(null);
      return enter(body.token);
    }
    if (res?.status === 410) {
      keepRequest(null);
      return said.replaceChildren('This sign-up has been used or has run out. Sign in with the email address you paid with.');
    }
    await new Promise((r) => setTimeout(r, 3000));
  }
  said.replaceChildren('Your workspace is taking longer than it should. Sign in with the email address you paid with in a few minutes.');
}
