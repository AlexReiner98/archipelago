// The page itself: how it is drawn (h), how it asks (ask, tell), how it calls the server (api) and who it is signed in as.
// What more than one module writes is kept on `state`; `route` is the router, set by app.js.

import { applyTheme } from './theme.js';

export const state = { schema: undefined, pulse: undefined, dirty: false, selfDrawn: false };
export const hooks = {};
export const route = (pulse) => hooks.route(pulse);

export const main = document.getElementById('main');
/**
 * Where a screen draws. A page in the menu is made of parts, one under the
 * other; a screen that is one of them draws in its own, and can draw itself
 * again without touching the rest.
 */
// A part may be inside another: a screen holds the page the kernel still draws itself as a part of its own.
export const part = (name) => main.querySelector(`.part[data-part="${name}"]`) ?? main;

export function h(tag, attrs, ...kids) {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs ?? {})) {
    if (value == null || value === false) continue;
    if (key.startsWith('on')) el.addEventListener(key.slice(2), value);
    else if (key === 'class') el.className = value;
    else if (key in el) el[key] = value;
    else el.setAttribute(key, value);
  }
  for (const kid of kids.flat(Infinity)) {
    if (kid == null || kid === false) continue;
    el.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
  }
  return el;
}

// Questions are asked in the page rather than with confirm() and prompt(), so
// they can be styled and browser automation can answer them. Resolves to null
// when dismissed; otherwise true, or the text typed when `input` is given.
export function ask({ title, message, input, action = 'OK', cancel = 'Cancel', danger = false }) {
  return new Promise((resolve) => {
    // A secret is typed into a field that does not show it, and that the browser is asked not to remember.
    const field = input && (input.secret ? h('input', { type: 'password', autocomplete: 'off', spellcheck: false, placeholder: input.placeholder ?? '', style: 'width: 100%' }) : h('textarea', { rows: 3, placeholder: input.placeholder ?? '' }));
    const dialog = h(
      'dialog',
      { class: 'ask' },
      h(
        'form',
        { method: 'dialog' },
        h('h2', {}, title),
        message && h('p', { class: 'ask-message' }, message),
        field,
        h('div', { class: 'toolbar' }, cancel && h('button', { value: 'cancel' }, cancel), h('button', { value: 'ok', class: danger ? 'danger' : 'primary' }, action)),
      ),
    );
    // Answered on the button press itself: the browser holds the dialog's close
    // event until it next paints, which a window nobody can see never does.
    const answer = (ok) => {
      dialog.remove();
      resolve(ok ? (field ? field.value.trim() : true) : null);
    };
    dialog.firstChild.addEventListener('submit', (e) => answer(e.submitter?.value === 'ok'));
    dialog.addEventListener('cancel', () => answer(false));
    document.body.append(dialog);
    dialog.showModal();
  });
}
export const tell = (title, message) => ask({ title, message, cancel: null });

// What this browser kept while this was called Lattice (the token, the workspaces, two choices) is carried over.
try {
  for (const key of ['token', 'workspaces', 'roadmap-as', 'follow']) {
    const was = localStorage.getItem(`lattice-${key}`);
    if (was !== null && localStorage.getItem(`pelago-${key}`) === null) localStorage.setItem(`pelago-${key}`, was);
    localStorage.removeItem(`lattice-${key}`);
  }
} catch {
  // Storage can be blocked: then nothing was kept to carry.
}

// The token, when the server wants one. Kept for this browser only.
export const store = {
  get token() {
    try {
      return localStorage.getItem('pelago-token') ?? '';
    } catch {
      return this.memory ?? '';
    }
  },
  set token(value) {
    this.memory = value;
    try {
      if (value) localStorage.setItem('pelago-token', value);
      else localStorage.removeItem('pelago-token');
    } catch {
      // Storage can be blocked; the token then lasts until the page is closed.
    }
  },
};
export const authHeaders = () => (store.token ? { authorization: `Bearer ${store.token}` } : {});

// The workspaces this browser has signed in to, so moving between them does
// not mean finding and pasting a token each time. Kept beside the token.
export const known = {
  all() {
    try {
      return JSON.parse(localStorage.getItem('pelago-workspaces') ?? '{}');
    } catch {
      return {};
    }
  },
  save(map) {
    try {
      localStorage.setItem('pelago-workspaces', JSON.stringify(map));
    } catch {
      // Without storage there is only the workspace signed in to now.
    }
  },
  remember(ws) {
    this.save({ ...this.all(), [ws.id]: { name: ws.name, token: store.token } });
  },
  forget(id) {
    const map = this.all();
    delete map[id];
    this.save(map);
  },
};

/** Become whoever a token says, starting from Home: nothing on the page belongs to the new workspace. */
export function enter(token) {
  store.token = token;
  state.schema = undefined;
  state.pulse = undefined;
  // A sign-in opens on Home, as the app does: a new workspace's first steps are there.
  if (location.hash && location.hash !== '#/home') location.hash = '#/home';
  else route();
}

export class SignInNeeded extends Error {}

export async function api(tool, input = {}) {
  const res = await fetch(`/api/${tool}`, { method: 'POST', headers: { 'content-type': 'application/json', ...authHeaders() }, body: JSON.stringify(input) });
  const body = await res.json();
  if (res.status === 401) throw new SignInNeeded(body.error);
  if (!res.ok) throw new Error(body.error);
  return body.result;
}

export function signIn(message) {
  // Signed out, the style is not read with the rest: its colours are asked for on their own.
  fetch('/connect/theme').then((r) => r.json()).then(applyTheme, () => undefined);
  const email = h('input', { type: 'text', inputmode: 'email', placeholder: 'Email', style: 'flex: 1; min-width: var(--input-wide)', autocomplete: 'email' });
  const input = h('input', { type: 'text', placeholder: 'pel_…', style: 'flex: 1; min-width: var(--input-wide)', autocomplete: 'off' });
  const error = h('div', { class: 'error', style: 'padding: 0 var(--space-8) var(--space-8)' }, message ?? '');
  const byEmail = h('div', { class: 'toolbar', style: 'padding: var(--space-8)' });
  const sendLink = async () => {
    const res = await fetch('/connect/sign-in', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: email.value.trim() }) });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) return (error.textContent = body.error ?? 'That did not work.');
    error.textContent = '';
    // The mail's link opens in the browser mail opens in; its code can be typed here, in whichever browser asked.
    const code = h('input', { type: 'text', placeholder: 'Code from the email', style: 'flex: 1', autocomplete: 'one-time-code', autocapitalize: 'characters' });
    const typed = async () => {
      const res = await fetch('/connect/code', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: body.sent_to, code: code.value }) });
      const given = await res.json().catch(() => ({}));
      if (!res.ok) return (error.textContent = given.error ?? 'That code was not accepted.');
      enter(given.token);
    };
    code.addEventListener('keydown', (e) => e.key === 'Enter' && typed());
    byEmail.replaceChildren(h('span', { class: 'muted grow', title: `If ${body.sent_to} is a member here, a sign-in link and a code are on their way to it` }, `Check ${body.sent_to}`), code, h('button', { class: 'primary', onclick: typed }, 'Sign in'));
    code.focus();
  };
  const submit = async () => {
    store.token = input.value.trim();
    const res = await fetch('/whoami', { headers: authHeaders() });
    if (!res.ok) {
      store.token = '';
      return (error.textContent = 'That token was not accepted.');
    }
    state.schema = undefined;
    route();
  };
  email.addEventListener('keydown', (e) => e.key === 'Enter' && sendLink());
  input.addEventListener('keydown', (e) => e.key === 'Enter' && submit());
  byEmail.replaceChildren(email, h('button', { class: 'primary', onclick: sendLink }, 'Email me a link'));
  const others = Object.entries(known.all());
  document.querySelector('#nav .brand').replaceChildren('Archipelago');
  document.title = 'Archipelago';
  main.replaceChildren(
    h('div', { class: 'page-head' }, h('h1', {}, 'Sign in')),
    h(
      'section',
      { class: 'card', style: 'max-width: var(--card-most)' },
      others.length > 0 && h('div', { class: 'toolbar', style: 'padding: var(--space-8) var(--space-8) 0' }, h('span', { class: 'muted' }, 'Signed in before:'), others.map(([, w]) => h('button', { onclick: () => enter(w.token) }, w.name))),
      byEmail,
      h('details', { class: 'fold-bar' }, h('summary', { class: 'muted small', title: 'For an agent, or a workspace’s first sign-in' }, 'With a token'), h('div', { class: 'toolbar fold-bar' }, input, h('button', { onclick: submit }, 'Sign in'))),
      error,
    ),
  );
  email.focus();
}

/** Open a sign-in link: its code is traded once for this person's token, which the browser keeps. */
export async function join(code) {
  // The code leaves the address at once: it is not left in the history for the next person at this machine.
  history.replaceState(null, '', '#/');
  const res = await fetch('/connect/join', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ code }) });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) return signIn(body.error ?? 'That sign-in link did not work.');
  enter(body.token);
}

export async function showIdentity() {
  const slot = document.getElementById('whoami');
  try {
    const res = await fetch('/whoami', { headers: authHeaders() });
    if (!res.ok) return slot.replaceChildren();
    const me = await res.json();
    if (me.auth !== 'tokens') return slot.replaceChildren();
    known.remember(me.workspace);
    // Which workspace this is, where it cannot be missed: under the name at the top, and on the tab.
    // A workspace that has ended says so under its name on every page: until when, and where its backup is.
    const ended = me.actor.kind === 'human' ? await api('workspace_info').then((info) => info.ended, () => null) : null;
    const until = ended && h('a', { class: 'small error', href: '#/workspace?at=backup', title: `Ended ${ended.since.slice(0, 10)}: read-only, and deleted from the server on ${ended.delete_at.slice(0, 10)}. Download its backup before then.${ended.note ? ` ${ended.note}` : ''}` }, `Deleted on ${new Date(ended.delete_at).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}`);
    document.querySelector('#nav .brand').replaceChildren('Archipelago', h('div', { class: 'workspace-name' }, me.workspace.name), until || '');
    document.title = `${me.workspace.name} · Archipelago`;
    const others = Object.entries(known.all()).filter(([id]) => id !== me.workspace.id);
    slot.replaceChildren(
      h('div', {}, h('strong', {}, me.workspace.name)),
      h('div', { class: 'muted small' }, `${me.actor.name} (${me.actor.kind})`),
      h(
        'select',
        {
          class: 'small',
          title: 'Workspaces this browser has signed in to',
          onchange: (e) => (e.target.value === '+' ? signIn() : e.target.value && enter(known.all()[e.target.value].token)),
        },
        h('option', { value: '' }, 'Switch workspace…'),
        others.map(([id, w]) => h('option', { value: id }, w.name)),
        h('option', { value: '+' }, 'Sign in to another…'),
      ),
      h(
        'a',
        {
          href: '#',
          class: 'small',
          title: 'Forget this workspace on this browser',
          onclick: (e) => {
            e.preventDefault();
            known.forget(me.workspace.id);
            store.token = '';
            state.schema = undefined;
            route();
          },
        },
        'Sign out',
      ),
    );
  } catch {
    slot.replaceChildren();
  }
}
