// The page itself: how it is drawn (h), how it asks (ask, tell), how it calls the server (api) and who it is signed in as.
// What more than one module writes is kept on `state`; `route` is the router, set by app.js.

import { applyTheme } from './theme.js';

export const state = { workspace: undefined, schema: undefined, may: undefined, stamp: undefined, pos: undefined, seq: undefined, dirty: false, selfDrawn: false, trying: null };

/**
 * Whether this session may do something (/whoami `may`, held on `state.may` once a sign-in): 'write' changes the map,
 * 'admin' the workspace. A control that does it is drawn only where it may; not yet known, nothing is allowed.
 */
export const may = (what) => state.may?.includes(what) === true;
/** What this session may do, asked of the server once a sign-in (the page's route waits for it before drawing). */
export const loadMay = async () => (state.may ??= (await whoami())?.may ?? ['read']);

export const hooks = {};
export const route = (pulse) => hooks.route(pulse);
/**
 * The first view drawn on this page (drawn, empty or failed), or a page that draws none: reads no drawing needs (who
 * is at work, the saved views, the names in the bar, what is around the answer) wait for it, so a server that answers
 * one read at a time answers the drawing's own first.
 */
let drew;
export const firstDrawn = new Promise((resolve) => (drew = resolve));
export const drawnNone = () => drew();
addEventListener('view-drawn', () => drew(), { once: true });

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

/** A lens's sets of words, each its own Find term: one or several (the find bar's Shift+Enter adds a set, e_e3k797d3). */
export const wordsOf = (filter) => (filter?.find ?? []).filter((t) => t.startsWith('text ')).map((t) => t.slice(5));
/** The filter with its words these sets, in the place words have among Find's terms. */
export const withWords = (filter, sets) => ({ ...filter, find: [...new Set(sets.map((s) => s.trim()).filter(Boolean))].map((w) => `text ${w}`).concat((filter.find ?? []).filter((t) => !t.startsWith('text '))) });
/** The items a filter names by id. */
export const idsOf = (filter) => (filter?.find ?? []).filter((t) => t.startsWith('id ')).map((t) => t.slice(3));
/** The filter with these items named too. */
export const withIds = (filter, ids) => ({ ...filter, find: [...new Set([...(filter.find ?? []), ...ids.map((id) => `id ${id}`)])] });
/** What Not leaves out unless the lens says otherwise. */
export const notOf = (filter) => filter?.not ?? ['kind system'];

// The sandbox of a frame drawing code runs in. Only a dev server started with PELAGO_UNSANDBOXED=1 marks the page to
// drop it, for a browser that loads no sandboxed frame (the desktop app's pane); the worker inside is still a wall.
export const frameSandbox = () => (document.documentElement.dataset.drawSandbox === 'off' ? null : 'allow-scripts');
// At the drawing host the page was marked with (packs/walls/kernel/draw-host.ts), the frame keeps that host's origin, so it may keep a service
// worker; never at the page's own, where an origin would be the page's: then it has none, as anywhere else.
export const drawOrigin = () => { const at = document.documentElement.dataset.drawOrigin; return at && at !== location.origin ? at : null; };
/** The frame every drawing runs in (ui/layout.js): at the drawing host with that host's origin, else at the page's with none. */
export const drawFrame = () => {
  const at = drawOrigin(), walled = frameSandbox();
  return { src: `${at ?? ''}/draw.html`, sandbox: at && walled ? `${walled} allow-same-origin` : walled };
};

// Whether the owner turned the sandbox off for a layout's code here (workspace_info drawings_open): read once a page, and
// again once the setting is changed. Anything but a yes keeps the sandbox.
let opened;
export const drawingsOpen = () => (opened ??= api('workspace_info').then((info) => info?.drawings_open === true, () => false));
export const drawingsChanged = () => void (opened = undefined);

// Questions are asked in the page rather than with confirm() and prompt(), so
// they can be styled and browser automation can answer them. Resolves to null
// when dismissed; otherwise true, or the text typed when `input` is given, or,
// given `choices` ([value, label, title?] each, a short list), the value chosen.
export function ask({ title, message, input, choices, action = 'OK', cancel = 'Cancel', danger = false }) {
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
        choices && h('div', { class: 'ask-choices', style: 'display: flex; flex-direction: column; gap: var(--space-3)' }, choices.map(([value, label, hint], n) => h('button', { value: `choice:${n}`, title: hint ?? label, class: n === 0 ? 'primary cut' : 'cut', style: 'text-align: left' }, label))),
        h('div', { class: 'toolbar' }, cancel && h('button', { value: 'cancel' }, cancel), !choices && h('button', { value: 'ok', class: danger ? 'danger' : 'primary' }, action)),
      ),
    );
    // Answered on the button press itself: the browser holds the dialog's close
    // event until it next paints, which a window nobody can see never does.
    const answer = (ok) => {
      dialog.remove();
      resolve(ok ? (field ? field.value.trim() : true) : null);
    };
    dialog.firstChild.addEventListener('submit', (e) => {
      const chose = /^choice:(\d+)$/.exec(e.submitter?.value ?? '')?.[1];
      if (chose === undefined) return answer(e.submitter?.value === 'ok');
      dialog.remove();
      resolve(choices[Number(chose)][0]);
    });
    dialog.addEventListener('cancel', () => answer(false));
    document.body.append(dialog);
    dialog.showModal();
  });
}
export const tell = (title, message) => ask({ title, message, cancel: null });

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
    asked = undefined;
    try {
      if (value) localStorage.setItem('pelago-token', value);
      else localStorage.removeItem('pelago-token');
    } catch {
      // Storage can be blocked; the token then lasts until the page is closed.
    }
  },
};
export const authHeaders = () => (store.token ? { authorization: `Bearer ${store.token}` } : {});

// A dev server lets a page try a narrower session than its sign-in (?may=read in the page's address, before the #): the
// server answers only that much, and the page draws as such a session would. Elsewhere the server ignores it.
const trying = () => {
  const narrow = new URLSearchParams(location.search).get('may');
  return narrow ? `?may=${encodeURIComponent(narrow)}` : '';
};
/** Who this page is signed in as (/whoami), asked once a sign-in: its answer, or null where it is refused; a failure to reach the server rejects. */
let asked;
export const whoami = () =>
  (asked ??= (early('whoami') ?? fetch(`/whoami${trying()}`, { headers: authHeaders() })).then(
    (r) => (r.ok ? r.json() : null),
    (err) => {
      asked = undefined;
      throw err;
    },
  ));

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

/** A client's request to connect, kept across a sign-in, whose mail's link may open in another tab: for half an hour. */
const WAITING = 'pelago-authorize';
export function keepWaiting(query) {
  try {
    if (query) localStorage.setItem(WAITING, JSON.stringify({ query, at: Date.now() }));
    else localStorage.removeItem(WAITING);
  } catch {}
}
export function waitingOnSignIn() {
  try {
    const kept = JSON.parse(localStorage.getItem(WAITING) ?? 'null');
    return kept && Date.now() - kept.at < 30 * 60_000 ? kept.query : null;
  } catch {
    return null;
  }
}

/** The workspace a sign-in's token is of (pel_<workspace>_…), or undefined. */
export const workspaceOf = (token) => /^pel_([a-z0-9][a-z0-9-]{0,39})_/.exec(token ?? '')?.[1];
/** Where a link from outside the app (ui/item-link.js) was going when it asked for a sign-in to its workspace: for half an hour. */
const LANDING = 'pelago-link';
export function keepLanding(ws, hash) {
  try {
    if (ws) localStorage.setItem(LANDING, JSON.stringify({ ws, hash, at: Date.now() }));
    else localStorage.removeItem(LANDING);
  } catch {}
}
/** The address a sign-in to workspace `ws` lands on, kept by such a link, taken once. */
function landingIn(ws) {
  try {
    const kept = JSON.parse(localStorage.getItem(LANDING) ?? 'null');
    keepLanding(null);
    return kept && kept.ws === ws && Date.now() - kept.at < 30 * 60_000 ? kept.hash : null;
  } catch {
    return null;
  }
}

/**
 * Become whoever a token says, starting from Home: nothing on the page belongs to the new workspace. The page is loaded
 * again, so every part of it that holds what it read (the saved views, the replica, a drawing) starts empty: one kept
 * from the workspace before showed its views in this one (10 Nov 2026).
 */
export function enter(token) {
  store.token = token;
  // A sign-in opens on Home, as the app does: a new workspace's first steps are there; one a link asked for, on its item.
  history.replaceState(null, '', waitingOnSignIn() ? '#/authorize' : landingIn(workspaceOf(token)) ?? '#/home');
  location.reload();
}

export class SignInNeeded extends Error {}

/** A JSON body posted: the response, for the caller to read. */
export const postJson = (path, body, headers = {}) => fetch(path, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) });
/** A tool's response read: its result, or an error saying why not. */
async function answerOf(res) {
  const body = await res.json();
  if (res.status === 401) throw new SignInNeeded(body.error);
  if (!res.ok) throw new Error(body.error);
  return body.result;
}
/** A tool called at this address with these headers: its result, or an error saying why not. */
export const call = async (path, input, headers) => answerOf(await postJson(path, input, headers));

/** A read ui/early.js asked for as the page started, taken once, while the page would still ask it so: its response. */
function early(name) {
  const asked = globalThis.pelagoEarly;
  if (!asked?.[name] || asked.token !== store.token) return undefined;
  const res = asked[name];
  delete asked[name];
  return res;
}
/** A tool's answer from the read ui/early.js asked for it (`name`), else from `ask`; one that failed is asked again. */
export const apiFirst = (name, ask) => {
  const res = early(name);
  return res ? res.then(answerOf).catch(ask) : ask();
};
export const api = (tool, input = {}) => call(`/api/${tool}`, input, authHeaders());

// Signed out, the style is not read with the rest: its colours are asked for on their own.
const themeSignedOut = () => fetch('/connect/theme').then((r) => r.json()).then(applyTheme, () => undefined);

/**
 * A page for whoever is not in a workspace yet, or is asked something before they are (sign in, agree, sign up,
 * Allow a client): one column in the middle, with no canvas, tabs or find behind it (ui/shell.css, [data-gate]).
 */
export function gate(title, ...kids) {
  themeSignedOut();
  document.body.dataset.gate = 'on';
  document.body.dataset.sheet = 'open';
  document.querySelector('#nav .brand').replaceChildren('Archipelago');
  document.title = title === 'Sign in' ? 'Archipelago' : `${title} · Archipelago`;
  main.replaceChildren(h('div', { class: 'gate' }, h('img', { class: 'gate-mark', src: '/favicon.png', alt: '' }), h('h1', {}, title), ...kids));
}
/** Into the workspace: the page is the app again. */
export const ungate = () => delete document.body.dataset.gate;
/** One line of a gate's page: a field and its button, or words and a link; never wraps. */
export const gateRow = (...kids) => h('div', { class: 'gate-row' }, ...kids);

/** `back`: drawn from inside a workspace (Another workspace, in the menu), so there is a way back to it; `email`: the address to start from. */
export function signIn(message, title = 'Sign in', { back = false, email: given = '' } = {}) {
  const error = h('div', { class: 'error gate-error' }, message ?? '');
  const fail = (text) => (error.textContent = text);
  // Someone a client sent here to connect, with no account yet, came by MCP: where they begin says so (?ref=mcp).
  const ref = waitingOnSignIn() ? 'mcp' : undefined;
  const email = h('input', { type: 'email', placeholder: 'Email', autocomplete: 'email', spellcheck: false, value: given });
  const send = h('button', { class: 'primary' }, 'Email me a code');

  // Where a person with no account begins (/connect/start), once known: offered again after asking, since an address
  // with no workspace is sent no mail, and the page says the same to everyone.
  let startAt;
  // Step two: a code is in the mail, typed here, in whichever browser asked.
  const codeStep = (sentTo) => {
    const code = h('input', { type: 'text', placeholder: 'Code from the email', autocomplete: 'one-time-code', autocapitalize: 'characters', spellcheck: false });
    const go = h('button', { class: 'primary' }, 'Sign in');
    const typed = async (agree) => {
      go.disabled = true;
      const res = await postJson('/connect/code', { email: sentTo, code: code.value.trim(), ...(agree && { agree }) });
      const given = await res.json().catch(() => ({}));
      go.disabled = false;
      if (!res.ok) return fail(given.error ?? 'That code was not accepted.');
      if (given.agree) return agreeFirst(given.agree, (agree) => postJson('/connect/code', { email: sentTo, code: code.value.trim(), agree }));
      enter(given.token);
    };
    go.onclick = () => typed();
    code.addEventListener('keydown', (e) => e.key === 'Enter' && typed());
    const again = h('a', { href: '#', title: 'Send a new code' }, 'Send again');
    again.onclick = (e) => (e.preventDefault(), ask(sentTo).then(() => (again.textContent = 'Sent'), () => undefined));
    const change = h('a', { href: '#', title: 'Use another email address' }, 'Change');
    change.onclick = (e) => (e.preventDefault(), first());
    gate(
      'Check your email',
      gateRow(h('span', { class: 'muted grow gist', title: `A sign-in code is on its way to ${sentTo}, if it has a workspace here` }, sentTo), change, again),
      gateRow(code, go),
      gateRow(h('span', { class: 'muted grow' }, 'Not there? Check spam or junk.')),
      error,
      startAt && gateRow(h('span', { class: 'muted grow' }, 'No code?'), h('a', { href: startAt, title: 'An address with no workspace here is sent nothing: make one of your own' }, 'Start a workspace')),
    );
    code.focus();
  };
  const ask = async (address) => {
    send.disabled = true;
    const res = await postJson('/connect/sign-in', { email: address, ref });
    const body = await res.json().catch(() => ({}));
    send.disabled = false;
    if (!res.ok) throw fail(body.error ?? 'That did not work.');
    fail('');
    return body.sent_to;
  };
  const sendLink = () => email.value.trim() && ask(email.value.trim()).then(codeStep, () => undefined);
  send.onclick = sendLink;
  email.addEventListener('keydown', (e) => e.key === 'Enter' && (password.value ? withPassword() : sendLink()));

  // Or the address and its password, for whoever set one (packs/identity/kernel/passwords.ts). A member of several picks one.
  const password = h('input', { type: 'password', placeholder: 'Password', autocomplete: 'current-password', title: 'If you set a password; otherwise ask for an email' });
  const passwordGo = h('button', { title: 'Sign in with your email and password' }, 'Sign in');
  const withPassword = async (more = {}) => {
    const address = email.value.trim();
    if (!address || !password.value) return fail(address ? 'Type your password, or ask for an email.' : 'Type your email address.');
    const post = (agree) => postJson('/connect/password', { email: address, password: password.value, ...more, ...(agree && { agree }) });
    passwordGo.disabled = true;
    const res = await post();
    const body = await res.json().catch(() => ({}));
    passwordGo.disabled = false;
    if (!res.ok) return fail(body.error ?? 'That did not work.');
    if (body.workspaces) return gate('Open which workspace?', ...body.workspaces.map((w) => gateRow(h('span', { class: 'grow gist', title: w.name }, w.name), h('button', { class: 'primary', onclick: () => withPassword({ workspace: w.id }) }, 'Open'))), error);
    if (body.agree) return agreeFirst(body.agree, post);
    enter(body.token);
  };
  passwordGo.onclick = () => withPassword();
  password.addEventListener('keydown', (e) => e.key === 'Enter' && withPassword());

  // Where a person with no account begins, if this server offers it; a client waiting to connect is returned to after.
  const begin = h('div', { hidden: true });
  fetch('/connect/start').then((r) => r.json()).then(({ url }) => {
    if (!url) return;
    const to = new URL(url, location.origin);
    if (ref) to.searchParams.set('ref', ref);
    startAt = to.href;
    const tip = 'Make a workspace of your own; a client waiting to connect is asked again once you are in';
    // Sent here by a client, in a browser that has never signed in: most likely they have no account, so it leads.
    const start = newcomer ? h('button', { class: 'primary', title: tip, onclick: () => location.assign(to.href) }, 'Start a workspace') : h('a', { href: to.href, title: tip }, 'Start a workspace');
    begin.replaceWith(gateRow(h('span', { class: 'muted grow' }, 'New here?'), start));
  }, () => undefined);

  // From inside a workspace the menu lists them already; signed out, they are the quickest way back in.
  const others = back ? [] : Object.values(known.all());
  const newcomer = Boolean(ref) && !back && others.length === 0;
  const first = () => {
    if (error.textContent !== (message ?? '')) fail('');
    gate(
      title,
      newcomer && begin,
      newcomer && gateRow(h('span', { class: 'muted grow' }, 'Have one? Sign in')),
      gateRow(email, send),
      gateRow(password, passwordGo),
      error,
      others.length > 0 && gateRow(h('span', { class: 'muted' }, 'Signed in before'), h('span', { class: 'grow gist gate-others' }, others.map((w) => h('a', { href: '#', title: `Open ${w.name}`, onclick: (e) => (e.preventDefault(), enter(w.token)) }, w.name)))),
      !newcomer && begin,
      back && gateRow(h('a', { href: '#', class: 'small', onclick: (e) => (e.preventDefault(), ungate(), route()) }, state.workspace?.name ? `Back to ${state.workspace.name}` : 'Back')),
    );
    email.focus();
  };
  first();
}

/** Open a sign-in link: its code is traded once for this person's token, which the browser keeps. */
export async function join(code) {
  // The code leaves the address at once: it is not left in the history for the next person at this machine.
  history.replaceState(null, '', '#/');
  const res = await postJson('/connect/join', { code });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) return signIn(body.error ?? 'That sign-in link did not work.');
  if (body.agree) return agreeFirst(body.agree, (agree) => postJson('/connect/join', { code, agree }));
  enter(body.token);
}

/**
 * Before a sign-in goes through, the documents this person has not agreed to at their current version: each a link,
 * one box to tick for all of them, and the sign-in sent again with what was agreed to.
 */
function agreeFirst(documents, again) {
  const box = h('input', { type: 'checkbox', id: 'agree' });
  const error = h('div', { class: 'error gate-error' });
  const go = h('button', { class: 'primary', disabled: true }, 'Continue');
  box.addEventListener('change', () => (go.disabled = !box.checked));
  const link = (d) => h('a', { href: d.url, target: '_blank', rel: 'noopener' }, d.title);
  // Each document, then the same in its other languages, named in their own.
  const links = documents.flatMap((d, i) => [i === 0 ? '' : i === documents.length - 1 ? ' and the ' : ', the ', link(d), ...(d.also?.length ? [' (', ...d.also.flatMap((o, j) => [j ? ', ' : '', link(o)]), ')'] : [])]);
  go.onclick = async () => {
    go.disabled = true;
    const res = await again(documents.map(({ id, version }) => ({ id, version })));
    const body = await res.json().catch(() => ({}));
    if (res.ok && body.token) return enter(body.token);
    if (res.ok && body.agree) return agreeFirst(body.agree, again);
    error.textContent = body.error ?? 'That did not work.';
    go.disabled = false;
  };
  gate(documents.length === 1 ? `Agree to the ${documents[0].title}` : 'Agree to our terms', h('label', { class: 'gate-agree' }, box, h('span', {}, 'I agree to the ', ...links)), gateRow(h('span', { class: 'grow' }), go), error);
}

export async function showIdentity() {
  const slot = document.getElementById('whoami');
  try {
    const me = await whoami();
    if (me?.auth !== 'tokens') return slot.replaceChildren();
    known.remember(me.workspace);
    state.workspace = me.workspace; // a token made here names it (ui/workspace-cards.js)
    // Which workspace this is, where it cannot be missed: under the name at the top, and on the tab.
    // A workspace that has ended says so under its name on every page: until when, and where its backup is.
    const ended = me.actor.kind === 'human' ? await api('workspace_info').then((info) => info.ended, () => null) : null;
    const until = ended && h('a', { class: 'small error', href: '#/workspace?at=backup', title: `Ended ${ended.since.slice(0, 10)}: read-only, and deleted from the server on ${ended.delete_at.slice(0, 10)}. Download its backup before then.${ended.note ? ` ${ended.note}` : ''}` }, `Deleted on ${new Date(ended.delete_at).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}`);
    document.querySelector('#nav .brand').replaceChildren('Archipelago', h('div', { class: 'workspace-name' }, me.workspace.name), until || '');
    document.title = `${me.workspace.name} · Archipelago`;
    // Every workspace this browser is signed in to, a row each: this one marked, another a click away; then a way into
    // one more, by email, and out of this one.
    const shut = () => slot.closest('details')?.removeAttribute('open');
    const go = (fn) => (e) => (e.preventDefault(), shut(), fn());
    const row = ([id, w]) =>
      id === me.workspace.id
        ? h('div', { class: 'ws-row here', title: `${w.name}: the workspace this page is in` }, h('span', { class: 'gist' }, w.name), h('span', { class: 'ws-mark', 'aria-label': 'this one' }, '✓'))
        : h('a', { href: '#', class: 'ws-row', title: `Open ${w.name}`, onclick: go(() => enter(w.token)) }, h('span', { class: 'gist' }, w.name));
    const signedOut = () => {
      known.forget(me.workspace.id);
      store.token = '';
      state.schema = state.may = undefined;
      route();
    };
    const who = /@/.test(me.actor.name) ? me.actor.name : '';
    slot.replaceChildren(
      h('div', { class: 'ws-head', id: 'ws-head' }, 'Signed in to'),
      h('div', { class: 'ws-rows', role: 'group', 'aria-labelledby': 'ws-head' }, Object.entries({ [me.workspace.id]: me.workspace, ...known.all() }).map(row)),
      h('a', { href: '#', class: 'ws-row ws-add', title: 'Sign in by email to a workspace you belong to; this one stays a click away', onclick: go(() => signIn('', 'Sign in to another workspace', { back: true, email: who })) }, h('span', { class: 'gist' }, '+ Sign in to another workspace')),
      me.actor.kind === 'human' && who && h('a', { href: '#', class: 'ws-row', title: `Sign in as ${who} with a password as well as by email`, onclick: go(() => import('./password.js').then((m) => m.passwordPage())) }, h('span', { class: 'gist' }, 'Password')),
      h('div', { class: 'ws-foot' }, h('span', { class: 'muted small gist', title: `Signed in as ${me.actor.name}` }, me.actor.name), h('a', { href: '#', class: 'small gist', title: `Sign out of ${me.workspace.name} on this browser; the others stay signed in`, onclick: go(signedOut) }, `Sign out of ${me.workspace.name}`)),
    );
  } catch {
    slot.replaceChildren();
  }
}
