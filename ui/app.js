// The pelago web UI. No framework and no build step: it calls the same
// tools as the CLI through /api/<tool>.

const main = document.getElementById('main');
/**
 * Where a screen draws. A page in the menu is made of parts, one under the
 * other; a screen that is one of them draws in its own, and can draw itself
 * again without touching the rest.
 */
const part = (name) => main.querySelector(`:scope > .part[data-part="${name}"]`) ?? main;

function h(tag, attrs, ...kids) {
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
function ask({ title, message, input, action = 'OK', cancel = 'Cancel', danger = false }) {
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
const tell = (title, message) => ask({ title, message, cancel: null });

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
const store = {
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
const authHeaders = () => (store.token ? { authorization: `Bearer ${store.token}` } : {});

// The workspaces this browser has signed in to, so moving between them does
// not mean finding and pasting a token each time. Kept beside the token.
const known = {
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
function enter(token) {
  store.token = token;
  schema = undefined;
  pulse = undefined;
  seenFocus = undefined;
  if (location.hash && location.hash !== '#/map') location.hash = '#/map';
  else route();
}

class SignInNeeded extends Error {}

async function api(tool, input = {}) {
  const res = await fetch(`/api/${tool}`, { method: 'POST', headers: { 'content-type': 'application/json', ...authHeaders() }, body: JSON.stringify(input) });
  const body = await res.json();
  if (res.status === 401) throw new SignInNeeded(body.error);
  if (!res.ok) throw new Error(body.error);
  return body.result;
}

function signIn(message) {
  const input = h('input', { type: 'text', placeholder: 'pel_…', style: 'flex: 1; min-width: 260px', autocomplete: 'off' });
  const error = h('div', { class: 'error', style: 'padding: 0 14px 14px' }, message ?? '');
  const submit = async () => {
    store.token = input.value.trim();
    const res = await fetch('/whoami', { headers: authHeaders() });
    if (!res.ok) {
      store.token = '';
      return (error.textContent = 'That token was not accepted.');
    }
    schema = undefined;
    route();
  };
  input.addEventListener('keydown', (e) => e.key === 'Enter' && submit());
  const others = Object.entries(known.all());
  document.querySelector('#nav .brand').replaceChildren('Archipelago');
  document.title = 'Archipelago';
  main.replaceChildren(
    h('div', { class: 'page-head' }, h('h1', {}, 'Sign in'), h('p', { class: 'muted' }, 'This server asks for a token. It decides which workspace you see and what you may do.')),
    h(
      'section',
      { class: 'card', style: 'max-width: 620px' },
      others.length > 0 && h('div', { class: 'toolbar', style: 'padding: 14px 14px 0' }, h('span', { class: 'muted' }, 'Signed in before:'), others.map(([, w]) => h('button', { onclick: () => enter(w.token) }, w.name))),
      h('div', { class: 'toolbar', style: 'padding: 14px' }, input, h('button', { class: 'primary', onclick: submit }, 'Sign in')),
      error,
    ),
  );
  input.focus();
}

async function showIdentity() {
  const slot = document.getElementById('whoami');
  try {
    const res = await fetch('/whoami', { headers: authHeaders() });
    if (!res.ok) return slot.replaceChildren();
    const me = await res.json();
    if (me.auth !== 'tokens') return slot.replaceChildren();
    known.remember(me.workspace);
    // Which workspace this is, where it cannot be missed: under the name at the top, and on the tab.
    document.querySelector('#nav .brand').replaceChildren('Archipelago', h('div', { class: 'workspace-name' }, me.workspace.name));
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
            schema = undefined;
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

// ---- shared lookups ------------------------------------------------------

let schema;
const types = new Map();
const relations = new Map();

async function loadSchema() {
  schema = await api('schema');
  types.clear();
  relations.clear();
  for (const t of schema.types) types.set(t.id, t);
  for (const r of schema.relations) relations.set(r.id, r);
}

const typeTitle = (id) => types.get(id)?.title ?? id;
const statusesOf = (typeId) => {
  const s = types.get(typeId)?.statuses;
  return s ? [...s.open, ...s.closed] : [];
};
const isClosed = (typeId, status) => types.get(typeId)?.statuses.closed.includes(status) ?? false;
const isA = (typeId, ancestor) => {
  for (let t = typeId; t; t = types.get(t)?.flavour_of) if (t === ancestor) return true;
  return false;
};
/** Whether a type may sit at one end of a relation, given that end's allowed types. */
const fits = (allowed, typeId) => allowed.some((a) => a === '*' || isA(typeId, a));
// Relations the system keeps itself (what a session works on, who holds a resource) are not edited by hand.
const kept = (relId) => relId.startsWith('sys.') || relId === 'holds';

const when = (ts) => new Date(ts).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
const daysAgo = (ts) => {
  const days = Math.floor((Date.now() - new Date(ts).getTime()) / 86_400_000);
  return days === 0 ? 'today' : days === 1 ? 'yesterday' : `${days} days ago`;
};
// ---- Saying things briefly -------------------------------------------------
// The screens show what agents write, and agents write paragraphs. These keep
// a row to one line: a short name, a few words, a mark. The whole of it is
// always one click or one hover away.

/** How long ago, in a word: "now", "5 min", "3 h", "yesterday", "12 Oct". The exact time is the tooltip. */
const ago = (ts) => {
  const then = new Date(ts);
  const mins = Math.floor((Date.now() - then.getTime()) / 60_000);
  const text =
    mins < 1 ? 'now' : mins < 60 ? `${mins} min` : mins < 24 * 60 ? `${Math.floor(mins / 60)} h` : mins < 48 * 60 ? 'yesterday' : then.toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
  return h('span', { class: 'ago', title: when(ts) }, text);
};

/** An actor as a person would name it; what the log holds ("agent:claude-code/claude-code:pelago") is the tooltip. */
function who(actor) {
  const raw = actor ?? '';
  const [kind, ...rest] = raw.split(':');
  const name = rest.join(':').split('/').at(-1) ?? '';
  const label =
    kind === 'human' ? (name === 'local' || name === 'owner' ? 'You' : name)
    : kind === 'github' ? 'GitHub'
    : name.startsWith('automation:') ? 'Automation'
    : (name === 'pelago' || name === 'lattice') && !raw.includes('/') && !raw.includes('claude') ? 'Archipelago'
    : name.split(':').at(-1) || raw;
  return h('span', { class: `who who-${kind === 'human' ? 'human' : kind === 'github' ? 'github' : 'agent'}`, title: raw }, label);
}

/** The first clause of a reason. Agents explain at length; a row has room for the point. */
const gist = (text) => (text ?? '').split(/(?<=[.:;])\s|\n/)[0].replace(/[.:;]$/, '');

/** On whose authority, as a mark. The sentence is the tooltip. */
function authorityMark(a) {
  if (!a) return h('span', { class: 'mark mark-none', title: 'Authority not recorded' }, '?');
  const yours = a.of === 'human';
  return h('span', { class: `mark ${yours ? 'mark-human' : 'mark-agent'}`, title: authorityText(a) }, yours ? 'your word' : 'its call');
}

/** What an event did, in a word. */
const VERBS = {
  'entity.create': 'created', 'entity.update': 'changed', 'entity.archive': 'archived', 'entity.restore': 'restored', 'entity.merge': 'merged',
  'relation.link': 'linked', 'relation.unlink': 'unlinked', 'type.define': 'new type',
  'proposal.create': 'held', 'proposal.approve': 'applied', 'proposal.reject': 'declined', 'proposal.supersede': 'overtaken',
  'changeset.undo': 'undid', 'changes.seen': 'marked seen', 'questions.confirmed': 'owner answered', 'repo.push': 'push', 'recheck.done': 're-checked',
  'automation.fire': 'automation', 'run.stale': 'went quiet', 'connection.check': 'connection', 'resource.claim': 'took', 'resource.release': 'gave back',
};
const verb = (ev) => (ev.action === 'entity.update' && !Object.keys(ev.detail?.changes ?? {}).length ? 'confirmed' : (VERBS[ev.action] ?? ev.action));

/**
 * One change set as one line: who, the point of it, what it did, on whose
 * word, when. Opened, it gives the whole reason and each thing it touched.
 */
/** An event that belongs to no change set (a push heard, a session gone quiet), as the same kind of line. */
function eventLine(ev) {
  const about = describeEvent(ev);
  return h(
    'div',
    { class: 'change line' },
    who(ev.actor),
    h('span', { class: 'gist', title: ev.reason ?? '' }, h('span', { class: 'muted' }, `${verb(ev)} `), ev.target_id ? h('a', { href: `#/e/${ev.target_id}` }, ev.target_title ?? ev.target_id) : gist(ev.reason) || about),
    ago(ev.ts),
  );
}

function changeRow(g, { undone, onUndo, attention, onRead, here, fresh }) {
  const first = g.events[0];
  const work = g.events.find((e) => !e.action.startsWith('proposal.')) ?? first;
  const reason = g.events.find((e) => e.reason && e.reason !== 'Source of this change')?.reason ?? '';
  const isUndo = g.events.some((e) => e.action === 'changeset.undo');
  const approver = work.detail?.approved_by;
  // What it did, as marks: a status that moved, or how many things it touched.
  const touched = g.events.filter((e) => (e.target_type ?? '') !== 'sys.source' && e.action !== 'changeset.undo' && !e.action.startsWith('proposal.'));
  const moved = touched.filter((e) => e.action === 'entity.update' && e.detail?.changes?.status);
  const effect =
    moved.length === 1
      ? h('span', { class: 'effect' }, h('span', { class: 'pill closed' }, moved[0].detail.changes.status.from), ' \u2192 ', h('span', { class: 'pill' }, moved[0].detail.changes.status.to))
      : touched.length > 0 && h('span', { class: 'effect muted' }, `${new Set(touched.map((e) => e.target_id)).size} item${new Set(touched.map((e) => e.target_id)).size === 1 ? '' : 's'}`);
  const subject = moved.length === 1 ? moved[0] : touched.length && touched.every((e) => e.target_id === touched[0].target_id) ? touched[0] : undefined;
  // A change is a line, not a page of its own: what it changed has a page, and
  // the line leads there. One that touched several things offers each. One
  // the owner has been told about is marked, and going to what it changed is
  // reading what was said.
  const ids = [...new Set(touched.map((e) => e.target_id).filter(Boolean))];
  const read = () => attention?.length && onRead?.(attention, row);
  const nameOf = (id) => touched.find((e) => e.target_id === id)?.target_title ?? named(id);
  // On the page of the thing it changed, the line does not name that thing again.
  const only = subject?.target_id ?? (ids.length === 1 ? ids[0] : undefined);
  const one = only === here ? undefined : only;
  const row = h(
    'div',
    { class: `change line${undone || isUndo ? ' quiet' : ''}${attention?.length ? ' attn' : ''}${fresh ? ' fresh' : ''}`, title: attention?.map((n) => n.title).join(' / ') ?? '' },
    who(work.actor),
    h('span', { class: 'gist', title: reason }, one ? [h('a', { href: `#/e/${one}`, onclick: read }, h('strong', {}, nameOf(one))), reason && ` · ${gist(reason)}`] : gist(reason) || verb(first)),
    moved.length === 1 ? effect : ids.length > 1 && !here && menu(`${ids.length} items`, ids.map((id) => [nameOf(id), () => (read(), (location.hash = `#/e/${id}`))])),
    approver ? h('span', { class: 'mark mark-human', title: `Applied by ${approver}` }, 'you applied') : touched.length > 0 && authorityMark(work.detail?.authority),
    ago(first.ts),
    undone || isUndo ? h('span', { class: 'pill closed' }, isUndo ? 'undo' : 'undone') : onUndo && h('button', { class: 'quiet-button', onclick: () => onUndo(g) }, 'Undo'),
  );
  return row;
}

const chip = (typeId) => h('span', { class: 'chip', title: typeId }, typeTitle(typeId));
const pill = (typeId, status) => h('span', { class: `pill${isClosed(typeId, status) ? ' closed' : ''}` }, status);
/** Titles of the items the pages have shown, so a line that only holds an id can still say a name. */
const titles = new Map();
const named = (id) => titles.get(id) ?? id;
/** Text an agent wrote, with each item id in it as a link by the item's name: an id is something to follow, never something to read. */
const idsAsLinks = (text) => {
  const out = [];
  let from = 0;
  for (const m of text.matchAll(/\be_[a-z0-9]{8}\b/g)) {
    out.push(text.slice(from, m.index), h('a', { href: `#/e/${m[0]}`, title: 'Open it' }, titles.get(m[0]) ?? 'this item'));
    from = m.index + m[0].length;
  }
  return [...out, text.slice(from)];
};
const link = (e) => (e ? (titles.set(e.id, e.title), h('a', { href: `#/e/${e.id}` }, e.title)) : h('span', { class: 'muted' }, '(missing)'));

/** The usual one-line rendering of an entity. */
function entityRow(e, sub) {
  return h(
    'li',
    {},
    h('div', { class: 'row-top' }, chip(e.type), h('span', { class: 'grow' }, link(e)), e.due && h('span', { class: 'pill warn' }, `due ${e.due}`), pill(e.type, e.status)),
    sub && h('div', { class: 'row-sub' }, sub),
  );
}

function card(title, { wide } = {}) {
  const count = h('span', { class: 'n' });
  const body = h('div', {}, h('div', { class: 'empty' }, 'Loading…'));
  const el = h('section', { class: `card${wide ? ' wide' : ''}` }, h('header', {}, h('h2', {}, title), count), body);
  return {
    el,
    /** Fill from a promise; `render` returns [count, node]. */
    async fill(promise, render, emptyText) {
      try {
        const [n, node] = render(await promise);
        count.textContent = n ?? '';
        body.replaceChildren(n === 0 ? h('div', { class: 'empty' }, emptyText) : node);
      } catch (err) {
        body.replaceChildren(h('div', { class: 'error' }, err.message));
      }
    },
  };
}

const WHY = { depends_on: 'depends on', waits_on: 'waits on', resource_unavailable: 'needs (unavailable)', resource_held: 'needs (held by another)' };

// The count beside Changes: what that page holds for the owner, the changes
// held for them and what there is to read. A count sits only beside the page
// that shows what it counts.
async function refreshReviewCount() {
  const badge = document.getElementById('held-count');
  try {
    const [pending, notes] = await Promise.all([api('proposals'), api('view', { name: 'notifications' })]);
    badge.textContent = pending.length + notes.length;
    badge.hidden = pending.length + notes.length === 0;
  } catch {
    badge.hidden = true;
  }
}

// ---- Projects, at the top of Search ----------------------------------------

// The projects, one to a row: where each stands and how much of it is
// waiting for the owner, which is dealt with on its own page.
let todayOpen = '';

async function projects(main) {
  const here = () => main.isConnected;
  if (!main.childElementCount) main.replaceChildren(h('div', { class: 'empty' }, 'Loading…'));
  const view = (name, params) => api('view', { name, params });
  const [info, asked, needs, blockers, risk] = await Promise.all([
    api('workspace_info'),
    view('questions'),
    view('needs_me'),
    view('blockers'),
    view('at_risk'),
  ]);
  const trees = await projectTrees(asked.projects);
  if (!here()) return;

  // Which project a thing belongs to: the project itself and everything in its tree.
  const home = new Map();
  for (const pr of asked.projects) {
    const walk = (b) => {
      home.set(b.id, pr.id);
      for (const w of b.work ?? []) home.set(w.id, pr.id);
      for (const inner of b.branches ?? []) walk(inner);
    };
    home.set(pr.id, pr.id);
    for (const b of trees.get(pr.id)?.branches ?? []) walk(b);
    for (const w of trees.get(pr.id)?.unplaced ?? []) home.set(w.id, pr.id);
  }
  // A project's three numbers: questions open in it (an answer an agent has
  // offered is still one to decide), work that is the owner's, and what is blocked.
  const inProject = (id, items, of = (e) => e.id) => items.filter((x) => home.get(of(x)) === id).length;
  const counts = (pr) => ({ decide: pr.questions, todo: inProject(pr.id, needs.actionable), blocked: inProject(pr.id, blockers, (b) => b.entity.id) });
  const weight = (pr) => (pr.status === 'active' ? 1000 : 0) + pr.questions + inProject(pr.id, needs.actionable);
  const ordered = [...asked.projects].sort((a, b) => weight(b) - weight(a));

  const projectRow = (pr) => {
    const tree = trees.get(pr.id);
    const c = counts(pr);
    // A number that is nought keeps its place, so the columns line up down the list.
    const count = (n, label, cls, title) => h('span', { class: `count-of ${n ? cls : 'none'}`, title }, n > 0 && [h('strong', {}, n), ` ${label}`]);
    return h(
      'li',
      {},
      h(
        'a',
        { class: `project-row${pr.status !== 'active' ? ' resting' : ''}`, href: `#/e/${pr.id}`, title: pr.title },
        h('strong', { class: 'grow' }, pr.title),
        pr.status !== 'active' && pill(pr.type, pr.status),
        count(c.decide, 'decide', 'warn', 'Questions open in it'),
        count(c.todo, 'do', '', 'Yours to do, with nothing in the way'),
        count(c.blocked, 'blocked', 'bad', 'Blocked work in it'),
        tree?.progress.total ? progressBar(tree.progress) : h('span', { class: 'progress muted small' }, 'no tasks'),
      ),
    );
  };
  const inbox = [
    !info.owner && h('p', { class: 'error' }, 'This workspace has no owner yet, so there is nobody for this page to be about. ', h('a', { href: '#/workspace' }, 'Set the owner'), '.'),
    ordered.length ? h('section', { class: 'card' }, h('ul', { class: 'rows projects' }, ordered.map(projectRow))) : h('div', { class: 'empty' }, 'No projects yet.'),
  ].filter(Boolean);
  // What there is to read, from anywhere, behind a count at the top of the page.
  // What is about to go wrong, anywhere: a count when there is any, and the list behind it on a click.
  const others = {
    risk: {
      label: 'At risk',
      n: risk.due_soon_or_overdue.length + risk.resting_on_refuted_hypothesis.length,
      list: () => [
        ...risk.due_soon_or_overdue.map((e) => entityRow(e, [e.overdue ? 'Overdue' : `Due within ${risk.due_within_days} days`, e.blocked && ', and blocked'])),
        ...risk.resting_on_refuted_hypothesis.map((e) => entityRow(e, ['rests on a refuted hypothesis: ', h('a', { href: `#/e/${e.hypothesis}` }, e.hypothesis_title)])),
      ],
    },
  };
  if (todayOpen && !others[todayOpen]) todayOpen = '';
  const drawer = h('div', { class: 'drawer' });
  const openDrawer = () => {
    const o = others[todayOpen];
    if (!o) return drawer.replaceChildren();
    const list = o.list();
    drawer.replaceChildren(h('section', { class: 'card' }, list.length ? h('ul', { class: 'rows' }, list) : h('div', { class: 'empty' }, 'Nothing.')));
  };
  const strip = h(
    'div',
    { class: 'switch strip' },
    Object.entries(others).map(([key, o]) =>
      h(
        'button',
        {
          class: todayOpen === key ? 'on' : '',
          disabled: o.n === 0,
          onclick: () => {
            todayOpen = todayOpen === key ? '' : key;
            for (const b of strip.children) b.classList.toggle('on', b.dataset.key === todayOpen);
            openDrawer();
          },
          'data-key': key,
        },
        o.label,
        o.n != null && [' ', h('span', { class: o.warn ? 'warning' : 'muted' }, o.n)],
      ),
    ),
  );
  main.replaceChildren(
    h('div', { class: 'inbox' }, inbox),
    Object.values(others).some((o) => o.n > 0) ? strip : '',
    drawer,
  );
  openDrawer();
}

// ---- Home ----------------------------------------------------------------

// What the app opens on: each project, its open questions, answered where they
// stand, and where it is against its next release. Two things and no more;
// everything else is a click away on the item's own page.
async function home() {
  const main = part('home');
  if (!main.childElementCount) main.replaceChildren(h('div', { class: 'empty' }, 'Loading…'));
  const data = await api('view', { name: 'home' });
  const change = async (ops, reason) => {
    try {
      await api('change', { ops, reason });
      home();
    } catch (err) {
      tell('That change was not made', err.message);
    }
  };
  const confirm = async (offer, yes) => {
    try {
      await api('decide', { proposal: offer.proposal, approve: yes });
    } catch (err) {
      await tell('That was not done', err.message);
    }
    home();
    refreshReviewCount();
  };
  // A question opens to be answered where it stands: its name does what Answer does, and its page is one link inside.
  const answerable = (q) => {
    const li = questionItem(q, change, null, true);
    const name = li.querySelector('.row-top a');
    const toggle = li.querySelector('.row-top button');
    name?.addEventListener('click', (ev) => (ev.preventDefault(), toggle?.click()));
    li.querySelector('.question-more')?.append(h('div', { class: 'toolbar' }, h('a', { href: `#/e/${q.id}` }, 'Open its page')));
    return li;
  };
  const questionsOf = (p) => {
    const offered = new Set(p.offered.map((o) => o.id));
    const rows = [
      // An agent's answer waits for a yes: the question and what it proposes, on one line.
      ...p.offered.map((o) => h('li', {}, h('div', { class: 'row-top' }, h('span', { class: 'grow', title: o.reason }, link(o), ' ', h('span', { class: 'arrow' }, '→'), ' ', h('strong', {}, o.answer)), h('button', { class: 'primary', onclick: () => confirm(o, true) }, 'Confirm'), h('button', { onclick: () => confirm(o, false) }, 'No')))),
      ...p.questions.filter((q) => !offered.has(q.id)).map((q) => answerable(q)),
    ];
    return h('div', { class: 'home-half' }, h('h3', {}, 'Questions', rows.length > 0 && h('span', { class: 'n' }, rows.length)), rows.length ? h('ul', { class: 'rows' }, rows) : h('div', { class: 'muted small' }, 'None open.'));
  };
  const releaseOf = (p) => {
    const r = p.release;
    if (!r) return h('div', { class: 'home-half' }, h('h3', {}, 'Next release'), h('div', { class: 'muted small' }, 'None set.'));
    return h(
      'div',
      { class: 'home-half' },
      h('h3', { class: 'row-top' }, h('span', { class: 'grow', title: r.title }, link(r)), r.at && h('span', { class: 'pill' }, r.at)),
      h(
        'div',
        { class: 'toolbar home-marks' },
        progressBar({ done: r.done, total: r.total }),
        r.yours > 0 && h('span', { class: 'pill warn', title: 'Waiting on you to answer, act or decide' }, `${r.yours} yours`),
        r.blocked > 0 && h('span', { class: 'pill bad', title: 'Waiting on something else first' }, `${r.blocked} blocked`),
        r.done === r.total && r.to_sort === 0 && h('span', { class: 'pill ok' }, 'ready'),
      ),
      r.still.length > 0 &&
        h(
          'ul',
          { class: 'rows' },
          r.still.map((i) => h('li', { class: 'row-top tie-row' }, chip(i.type), h('span', { class: 'grow', title: i.waiting_on.length ? `Waits on: ${i.waiting_on.join('; ')}` : i.title }, link(i)), i.yours ? h('span', { class: 'pill warn' }, 'yours') : i.blocked && h('span', { class: 'pill bad' }, 'blocked'))),
          r.total - r.done > r.still.length && h('li', { class: 'more' }, h('a', { href: `#/e/${r.id}` }, `${r.total - r.done - r.still.length} more`)),
        ),
    );
  };
  main.replaceChildren(
    ...(data.projects.length
      ? data.projects.map((p) => h('section', { class: 'card home-project' }, h('header', { class: 'bar' }, h('h2', {}, link(p))), h('div', { class: 'home-cols' }, questionsOf(p), releaseOf(p))))
      : [h('div', { class: 'empty' }, 'No projects yet.')]),
  );
}

// ---- Review --------------------------------------------------------------

// What has changed, as one list, newest first: what is held for the owner
// above it, and in it what agents did since the owner last looked, marked.
// Looking is recorded; it permits nothing.
const reviewState = { origin: '' };
const ORIGINS = [['', 'Everything'], ['github', 'Pushes'], ['external', 'Tool calls']];

async function review() {
  const main = part('review');
  const from = h('select', { title: 'Where the changes came from', onchange: (e) => ((reviewState.origin = e.target.value), review()) }, ORIGINS.map(([key, text]) => h('option', { value: key, selected: reviewState.origin === key }, text)));
  const seen = h('button', { hidden: true, title: 'Record that you have looked at what agents changed' }, 'Mark all seen');
  main.replaceChildren(h('div', { class: 'page-head' }, h('h1', {}, 'Changes'), from, h('span', { class: 'grow' }), seen));
  const [pending, known, notes] = await Promise.all([api('proposals'), api('search', { limit: 200, include_archived: true }), api('view', { name: 'notifications' })]);
  const names = new Map(known.map((e) => [e.id, e]));
  // What agents and the system have told the owner is not a list of its own:
  // the change it is about is marked in the list of changes, and opening that
  // change is reading it.
  const read = async (ns, row, gone = false) => {
    if (!ns.length) return;
    try {
      await api('change', { ops: ns.map((n) => ({ op: 'update', id: n.id, status: 'read' })), reason: 'Read in the UI' });
      ns.length = 0;
      gone ? row?.remove() : row?.classList.remove('attn');
      refreshReviewCount();
    } catch (err) {
      tell('That change was not made', err.message);
    }
  };
  if (pending.length) main.append(h('h2', {}, `Held for you (${pending.length})`));
  for (const p of pending) main.append(proposalCard(p, names));
  const list = h('div');
  main.append(h('section', { class: 'card' }, list));
  drawTimeline(list, reviewState.origin, notes, read, seen).catch((err) => list.replaceChildren(h('div', { class: 'error' }, err.message)));
}

/**
 * Which change each unread notification is about: the latest change an agent
 * made to the thing it names, up to when it was sent. One that is about no
 * change in sight (a session gone quiet, a plain message) is `loose`, and
 * is a line of its own.
 */
function attentionOf(notes, events) {
  const sets = new Map();
  const loose = [];
  for (const n of notes) {
    const sent = new Date(n.created_at).getTime() + 2000;
    const ev = n.about_id && events.find((e) => e.changeset && e.target_id === n.about_id && e.actor.startsWith('agent:') && !(e.target_type ?? 'sys.').startsWith('sys.') && new Date(e.ts).getTime() <= sent);
    if (ev) sets.set(ev.changeset, [...(sets.get(ev.changeset) ?? []), n]);
    else loose.push(n);
  }
  return { sets, loose };
}

/** A notification that is about no change in the list, as a line among them. */
const noticeLine = (n, read) => {
  const line = h(
    'div',
    { class: 'change line attn' },
    who(n.from),
    h('span', { class: 'gist', title: n.body ?? '' }, n.about_id ? h('a', { href: `#/e/${n.about_id}`, onclick: () => read([n]) }, n.title) : n.title),
    ago(n.created_at),
    h('button', { class: 'quiet-button', title: 'Mark this read', onclick: () => read([n], line, true) }, 'Read'),
  );
  return line;
};

function proposalCard(p, names) {
  const ops = structuredClone(p.ops);
  const included = ops.map(() => true);
  const edited = new Set();
  const refs = new Map(ops.filter((o) => o.op === 'create' && o.ref).map((o) => [o.ref, o]));
  const nameOf = (key) => {
    const local = refs.get(key);
    if (local) return h('span', {}, local.title);
    const e = names.get(key);
    return e ? link(e) : h('span', { class: 'muted' }, key);
  };
  // An excluded create takes its links with it, as the server will.
  const dead = (op) => op.op === 'link' && [op.from, op.to].some((k) => refs.has(k) && !included[ops.indexOf(refs.get(k))]);
  // The long text of a change stays folded to its first words until asked for.
  // Which rows are unfolded is kept here, because every edit redraws the rows.
  const unfolded = new Set();
  const fold = (i, ...parts) => {
    const text = parts.flat(Infinity).filter(Boolean);
    if (!text.length) return null;
    const first = text.join('\n').replace(/\s+/g, ' ').trim();
    return h(
      'details',
      { class: 'more', open: unfolded.has(i), ontoggle: (e) => (e.target.open ? unfolded.add(i) : unfolded.delete(i)) },
      h('summary', {}, h('span', { class: 'preview' }, first.length > 90 ? `${first.slice(0, 90)}…` : first)),
      text.map((t) => h('div', { class: 'detail' }, t)),
    );
  };

  const approve = h('button', { class: 'primary' });
  const status = h('span', { class: 'muted small' });
  const body = h('tbody');
  const el = h(
    'section',
    { class: 'card proposal' },
    h(
      'div',
      { class: 'meta' },
      h('div', { class: 'row-top nowrap-row' }, h('strong', { class: 'grow gist', title: p.reason }, gist(p.reason)), who(p.actor), ago(p.ts)),
      p.source && h('div', { class: 'muted small gist', title: p.source.uri }, `source: ${p.source.title ?? p.source.uri}`),
      p.warnings.map((w) => h('div', { class: 'warning small' }, `Warning: ${w}`)),
    ),
    h('table', { class: 'ops' }, h('thead', {}, h('tr', {}, h('th', {}), h('th', {}, 'Change'), h('th', {}, 'What'), h('th', {}, 'Status'))), body),
    h(
      'div',
      { class: 'actions' },
      approve,
      h('button', { class: 'danger', onclick: () => decide(false) }, 'Decline all'),
      status,
    ),
  );

  function draw() {
    const count = ops.filter((op, i) => included[i] && !dead(op)).length;
    approve.textContent = count === ops.length ? `Apply all ${count}` : `Apply ${count} of ${ops.length}`;
    approve.disabled = count === 0;
    status.textContent = edited.size ? `${edited.size} corrected by you` : '';
    const section = (label, filter) => {
      const rows = ops.map((op, i) => [op, i]).filter(([op]) => filter(op));
      return rows.length ? [h('tr', { class: 'group-head' }, h('td', { colSpan: 4 }, `${label} (${rows.length})`)), rows.map(([op, i]) => opRow(op, i))] : [];
    };
    body.replaceChildren(
      ...[
        section('New', (o) => o.op === 'create'),
        section('Updates', (o) => o.op === 'update'),
        section('Relations', (o) => o.op === 'link' || o.op === 'unlink'),
        section('Other', (o) => !['create', 'update', 'link', 'unlink'].includes(o.op)),
      ].flat(Infinity),
    );
  }

  function opRow(op, i) {
    const off = !included[i] || dead(op);
    const check = h('input', {
      type: 'checkbox',
      checked: !off,
      disabled: dead(op),
      onchange: (e) => {
        included[i] = e.target.checked;
        draw();
      },
    });
    const mark = (cell) => (edited.has(i) ? ((cell.className += ' edited'), cell) : cell);
    const statusSelect = (typeId, current, fallback) =>
      h(
        'select',
        {
          onchange: (e) => {
            if (e.target.value) op.status = e.target.value;
            else delete op.status;
            edited.add(i);
            draw();
          },
        },
        fallback && h('option', { value: '', selected: !current }, fallback),
        statusesOf(typeId).map((s) => h('option', { value: s, selected: s === current }, s)),
      );
    let kind, what, st;
    if (op.op === 'create') {
      kind = chip(op.type);
      what = [
        h('input', {
          type: 'text',
          value: op.title,
          onchange: (e) => {
            op.title = e.target.value;
            edited.add(i);
            draw();
          },
        }),
        fold(
          i,
          op.body,
          op.props && Object.keys(op.props).length > 0 && Object.entries(op.props).map(([k, v]) => `${k}: ${v}`).join('\n'),
          op.confidence !== undefined && op.confidence < 1 && `confidence ${op.confidence}`,
        ),
      ];
      st = statusSelect(op.type, op.status, `default (${statusesOf(op.type)[0]})`);
    } else if (op.op === 'update') {
      const target = names.get(op.id);
      const { op: _op, id: _id, status: newStatus, ...changes } = op;
      kind = target ? chip(target.type) : 'update';
      what = [
        h('div', {}, nameOf(op.id), op.title && op.title !== target?.title && [' ', h('span', { class: 'arrow' }, '→'), ` ${op.title}`]),
        target && newStatus && h('div', { class: 'detail' }, `status: ${target.status} → ${newStatus}`),
        !newStatus && Object.keys(changes).length === 0 && h('div', { class: 'detail' }, 'checked: still true as written'),
        fold(i, Object.entries(changes).filter(([k]) => k !== 'title').map(([k, v]) => (k === 'replace' ? `replace: ${v.find} → ${v.with}` : `${k}: ${typeof v === 'object' ? JSON.stringify(v) : v}`))),
      ];
      st = target ? statusSelect(target.type, newStatus, `unchanged (${target.status})`) : '';
    } else if (op.op === 'link') {
      kind = h('span', { class: 'muted' }, 'link');
      what = h('div', {}, nameOf(op.from), ' ', h('span', { class: 'arrow' }, relations.get(op.type)?.title ?? op.type), ' ', nameOf(op.to));
    } else {
      kind = h('span', { class: 'muted' }, op.op.replace('_', ' '));
      what =
        op.op === 'merge'
          ? h('div', {}, nameOf(op.drop), ' into ', nameOf(op.keep))
          : op.op === 'archive' || op.op === 'restore'
            ? nameOf(op.id)
            : op.op === 'define_type'
              ? [h('strong', {}, op.type.id), op.type.extends && ` (flavour of ${op.type.extends})`, fold(i, op.type.description)]
              : JSON.stringify(op);
    }
    return h('tr', { class: off ? 'off' : '' }, h('td', { class: 'check' }, check), mark(h('td', { class: 'kind' }, kind)), h('td', {}, what), h('td', { class: 'status' }, st ?? ''));
  }

  async function decide(yes) {
    const note = yes ? undefined : await ask({ title: 'Decline this change?', message: p.reason, input: { placeholder: 'Why not? (optional, kept in the log for whoever made it)' }, action: 'Decline', danger: true });
    if (!yes && note === null) return;
    approve.disabled = true;
    try {
      await api('decide', {
        proposal: p.id,
        approve: yes,
        note: note || undefined,
        except: yes ? included.map((on, i) => (on ? null : `#${i + 1}`)).filter(Boolean) : undefined,
        ops: yes && edited.size ? ops : undefined,
      });
      el.replaceChildren(h('div', { class: 'empty' }, yes ? `Applied: ${gist(p.reason)}` : `Declined: ${gist(p.reason)}`));
      refreshReviewCount();
      if (yes && ops.some((o) => o.op === 'define_type')) await loadSchema();
    } catch (err) {
      status.textContent = '';
      el.querySelector('.actions').append(h('div', { class: 'error', style: 'white-space: pre-wrap; flex-basis: 100%' }, err.message));
      approve.disabled = false;
    }
  }
  approve.addEventListener('click', () => decide(true));
  draw();
  return el;
}

// ---- Search --------------------------------------------------------------

const mapState = { q: '', type: '', open: 'open' };
/** The system's own records that are looked for like work: the rest (sources, notifications) are found from what they are about. */
const FOUND = ['sys.automation', 'sys.run', 'sys.connection'];

/** The search box alone, above an open item or a graph: what is typed is looked for on the Search screen. */
function searchBar() {
  const go = (e) => {
    if (e.key !== 'Enter') return;
    mapState.q = e.target.value;
    location.hash = '#/map';
  };
  // Typing here is not an edit that a redraw would lose.
  part('map').replaceChildren(h('div', { class: 'toolbar' }, h('input', { type: 'search', placeholder: 'Search titles and text', style: 'flex: 1; min-width: 200px', onkeydown: go, oninput: (e) => e.stopPropagation() })));
}

function map() {
  const main = part('map');
  const results = h('div');
  const list = h('section', { class: 'card', hidden: true }, results);
  const rest = h('div', { class: 'inbox' });
  const run = async () => {
    // With nothing asked for, the page shows what there is to ask about: each kind with its count, and what moved last.
    const resting = !mapState.q.trim() && !mapState.type;
    rest.hidden = !resting;
    list.hidden = resting;
    if (resting) return atRest();
    try {
      let rows = await api('search', {
        q: mapState.q || undefined,
        type: mapState.type || undefined,
        open: mapState.open === 'all' ? undefined : mapState.open === 'open',
        limit: 200,
      });
      // Sources are provenance, not work: list them only when asked for.
      if (!mapState.type) rows = rows.filter((e) => !e.type.startsWith('sys.') || e.type === 'sys.connection');
      results.replaceChildren(
        rows.length
          ? h(
              'table',
              { class: 'list' },
              h('thead', {}, h('tr', {}, h('th', {}, 'Type'), h('th', {}, 'Title'), h('th', {}, 'Status'), h('th', {}, 'Changed'))),
              h('tbody', {}, rows.map((e) => h('tr', {}, h('td', { class: 'nowrap' }, chip(e.type)), h('td', {}, link(e), e.confidence < 1 && h('span', { class: 'muted small' }, `  confidence ${e.confidence}`)), h('td', {}, pill(e.type, e.status)), h('td', { class: 'nowrap muted' }, ago(e.updated_at))))),
            )
          : h('div', { class: 'empty' }, 'Nothing matches.'),
      );
    } catch (err) {
      results.replaceChildren(h('div', { class: 'error' }, err.message));
    }
  };
  const set = (key) => (e) => {
    mapState[key] = e.target.value;
    run();
  };
  const atRest = async () => {
    try {
      const rows = (await api('search', { open: mapState.open === 'all' ? undefined : mapState.open === 'open', limit: 200 })).filter((e) => !e.type.startsWith('sys.') || FOUND.includes(e.type));
      const counts = new Map();
      for (const e of rows) counts.set(e.type, (counts.get(e.type) ?? 0) + 1);
      // Drawn once and kept while the kinds under it are counted again, so the list does not blink.
      const top = rest.querySelector('.projects-top') ?? h('div', { class: 'projects-top' });
      projects(top).catch((err) => top.replaceChildren(h('div', { class: 'error' }, err.message)));
      rest.replaceChildren(
        top,
        h(
          'div',
          { class: 'tiles kinds' },
          [...counts].sort((a, b) => b[1] - a[1]).map(([type, n]) => h('button', { class: 'tile kind', onclick: () => ((mapState.type = type), map()) }, h('strong', {}, n), h('span', {}, typeTitle(type)))),
        ),
      );
    } catch (err) {
      rest.replaceChildren(h('div', { class: 'error' }, err.message));
    }
  };
  main.replaceChildren(
    h('div', { class: 'page-head' }, h('h1', {}, 'Search')),
    h(
      'div',
      { class: 'toolbar', style: 'margin-bottom: 12px' },
      h('input', { type: 'search', placeholder: 'Search titles and text', value: mapState.q, oninput: set('q'), autofocus: true, style: 'flex: 1; min-width: 200px' }),
      h('select', { onchange: set('type') }, h('option', { value: '' }, 'All types'), schema.types.map((t) => h('option', { value: t.id, selected: t.id === mapState.type }, `${t.title}${t.pack === 'core' ? '' : ` (${t.pack})`}`))),
      h('button', { onclick: () => (location.hash = `#/new/${mapState.type || 'task'}`) }, 'New'),
      h('button', { title: 'The whole map as a picture', onclick: () => (location.hash = '#/graph') }, 'Map'),
      h('select', { onchange: set('open') }, ['open', 'closed', 'all'].map((v) => h('option', { value: v, selected: v === mapState.open }, v === 'open' ? 'Unfinished' : v === 'closed' ? 'Finished' : 'Both'))),
    ),
    rest,
    list,
  );
  if (location.hash.startsWith('#/map')) main.querySelector('input[type=search]').focus();
  run();
}

/**
 * A body as a page, not a block, and never a wall of text. Agents write notes
 * with headings (a line in capitals, or a short line of its own at the top of
 * a paragraph), numbered points and dashes; this draws them as headings and
 * lists at a readable width. A note opens as its first paragraph and the
 * titles of what else it holds: every section, and the rest of the opening,
 * is one click away.
 */
/**
 * A table, written as lines of | cells |, with a rule of dashes under its head (| --- | --: |): a colon on the right
 * of a rule's cell sets that column to the right, on both sides to the centre. A head with no words is not drawn.
 * Read from lines[at]; null when no table starts there.
 */
const TABLE_ROW = /^\s*\|.*\|\s*$/;
const TABLE_RULE = /^\s*\|(\s*:?-{2,}:?\s*\|)+\s*$/;
function readTable(lines, at) {
  if (!TABLE_ROW.test(lines[at] ?? '') || !TABLE_RULE.test(lines[at + 1] ?? '')) return null;
  const cells = (line) => line.trim().replace(/^\||\|$/g, '').split('|').map((c) => c.trim());
  const aligns = cells(lines[at + 1]).map((c) => (c.startsWith(':') && c.endsWith(':') ? 'center' : c.endsWith(':') ? 'right' : 'left'));
  let end = at + 2;
  while (end < lines.length && TABLE_ROW.test(lines[end])) end++;
  return { end, head: cells(lines[at]), aligns, rows: lines.slice(at + 2, end).map(cells) };
}
/** A table read by readTable, each cell drawn by `cell`. */
function drawTable(t, cell) {
  // The page's policy allows no inline style: a column's side is a class.
  const td = (tag, text, i) => h(tag, { class: `align-${t.aligns[i] ?? 'left'}` }, cell(text));
  return h(
    'table',
    { class: 'text-table' },
    t.head.some(Boolean) && h('thead', {}, h('tr', {}, t.head.map((c, i) => td('th', c, i)))),
    h('tbody', {}, t.rows.map((row) => h('tr', {}, t.aligns.map((_, i) => td('td', row[i] ?? '', i))))),
  );
}

function renderBody(text) {
  const heading = (line) => /^[A-Z0-9][A-Z0-9 ,'()\/&-]{2,60}:?$/.test(line.trim()) && /[A-Z]{3}/.test(line);
  const item = (line) => /^\s*(-|\*|\d+\.|[A-Z]\.)\s+/.exec(line);
  const sections = [{ title: null, lines: [] }];
  const lines = text.split('\n');
  // A short line that opens a paragraph and does not end as a sentence is that paragraph's title.
  const titles = (line, i) => !lines[i - 1]?.trim() && Boolean(lines[i + 1]?.trim()) && line.trim().length <= 90 && !/[.;,|]$/.test(line.trim()) && !item(line);
  for (const [i, line] of lines.entries()) {
    if (heading(line) || (line.trim() && titles(line, i))) sections.push({ title: line.trim().replace(/:$/, ''), lines: [] });
    else sections.at(-1).lines.push(line);
  }
  const blocks = (lines) => {
    const out = [];
    let list;
    let para = [];
    const flush = () => {
      if (para.length) out.push(h('p', {}, idsAsLinks(para.join(' '))));
      para = [];
    };
    // A cell said in **stars** is strong.
    const cell = (text) => (/^\*\*.*\*\*$/.test(text) ? h('strong', {}, idsAsLinks(text.slice(2, -2))) : idsAsLinks(text));
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const table = readTable(lines, i);
      if (table) {
        flush();
        list = undefined;
        out.push(drawTable(table, cell));
        i = table.end - 1;
        continue;
      }
      const mark = item(line);
      if (mark) {
        flush();
        if (!list) out.push((list = h('ul', {})));
        list.append(h('li', {}, h('span', { class: 'muted' }, /^[-*]$/.test(mark[1]) ? '• ' : `${mark[1]} `), idsAsLinks(line.slice(mark[0].length))));
      } else if (!line.trim()) {
        flush();
        list = undefined;
      } else if (list && /^\s{2,}/.test(line)) {
        list.lastChild.append(...idsAsLinks(` ${line.trim()}`));
      } else {
        list = undefined;
        para.push(line.trim());
      }
    }
    flush();
    return out;
  };
  const sentence = (title) => (/[a-z]/.test(title) ? title : title.charAt(0) + title.slice(1).toLowerCase());
  // The opening is its first paragraph; what follows it before the first title is folded like a section.
  const opening = (lines) => {
    const [first, ...more] = blocks(lines);
    if (!first) return [];
    // A table that opens a note is shown whole: cut short, its cells would run together as words.
    if (first.tagName === 'TABLE') return [first, more.length > 0 && h('details', { class: 'section' }, h('summary', {}, 'More'), more)];
    // A first paragraph that is itself long is shown as its first sentences, and whole with the rest.
    const text = first.textContent;
    const long = text.length > 320 || first.tagName !== 'P';
    const start = long ? h('p', {}, `${(/^.{80,300}?[.:](?=\s)/s.exec(text)?.[0] ?? text.slice(0, 240)).trim()} …`) : first;
    const rest = long ? [first, ...more] : more;
    return [start, rest.length > 0 && h('details', { class: 'section' }, h('summary', {}, 'More'), rest)];
  };
  return h(
    'div',
    { class: 'body-text' },
    sections
      .filter((sec) => sec.title || sec.lines.some((l) => l.trim()))
      .map((sec) => (sec.title ? h('details', { class: 'section' }, h('summary', { title: sec.title }, sentence(sec.title)), blocks(sec.lines)) : opening(sec.lines))),
  );
}

/** A small menu for what is done rarely: the page keeps one or two actions in sight. */
function menu(label, items) {
  const box = h('details', { class: 'menu' }, h('summary', {}, label), h('div', { class: 'menu-items' }, items.filter(Boolean).map(([text, onclick, cls]) => h('button', { class: cls ?? '', onclick: (ev) => ((box.open = false), onclick(ev)) }, text))));
  return box;
}
document.addEventListener('click', (ev) => {
  for (const open of document.querySelectorAll('details.menu[open]')) if (!open.contains(ev.target)) open.open = false;
});

/** When an open item was last changed or confirmed, as a mark that turns as it ages. */
function ageChip(e) {
  const days = Math.floor((Date.now() - new Date(e.updated_at).getTime()) / 86_400_000);
  return h('span', { class: `mark ${days >= 14 ? 'mark-old' : 'mark-human'}`, title: `Last changed or confirmed ${when(e.updated_at)}` }, days === 0 ? 'true today' : days === 1 ? 'true yesterday' : `${days} days unconfirmed`);
}

/** Where a run was, as a person says it. */
const RAN = { 'github-actions': 'Sync agent', server: 'Reader', 'claude-code': 'Session' };
/** Which of each item's sections are unfolded, kept while the page is open. */
const unfolded = new Map();

async function entity(id, here) {
  const main = part('item');
  // Drawn again in place (after a change, a step further out), the page keeps its height and its scroll.
  if (main.dataset.item !== id) main.replaceChildren(h('div', { class: 'empty' }, 'Loading…'));
  main.dataset.item = id;
  let data;
  let past;
  try {
    [data, past] = await Promise.all([api('get', { id }), api('events', { target: id, limit: 40 })]);
  } catch (err) {
    return main.replaceChildren(h('div', { class: 'error' }, err.message));
  }
  const e = data.entity;
  const change = async (ops, reason) => {
    try {
      await api('change', { ops, reason });
      entity(id);
    } catch (err) {
      tell('That change was not made', err.message);
    }
  };
  const owner = e.owner ? await api('get', { id: e.owner }).then((r) => r.entity, () => null) : null;
  // A repository says what the agents working in it have used: the sync agent in GitHub Actions, and sessions on a machine.
  const used = isA(e.type, 'software.repo') ? await api('view', { name: 'agent_usage', params: { repo: id } }).catch(() => null) : null;
  // A session that told the story of its work is that story first.
  const story = isA(e.type, 'sys.run') && e.props.story?.length ? await api('view', { name: 'story', params: { run: id } }).catch(() => null) : null;
  // A document is read as its reader meets it: its text with the items it brings in, in their places.
  const doc = isA(e.type, 'document') ? await api('document', { id }).catch(() => null) : null;
  const links = doc ? (await api('share_list', { id }).catch(() => [])).filter((s) => !s.revoked_at) : [];
  // A note or file may keep a figure (a document shows it with the section); its own page shows it too.
  const figure = ['note', 'file'].some((t) => isA(e.type, t)) ? await api('picture', { result: id }).catch(() => null) : null;
  const relRows = (rows, direction) =>
    rows.map((r) => {
      const phrase = relations.get(r.type)?.[direction === 'out' ? 'title' : 'inverse'] ?? r.type;
      return h(
        'tr',
        {},
        h('td', { class: 'nowrap muted' }, phrase),
        h('td', {}, chip(r.entity_type), ' ', link(r)),
        h('td', {}, pill(r.entity_type, r.status)),
        h(
          'td',
          { class: 'act' },
          !e.archived_at &&
            !kept(r.type) &&
            h(
              'button',
              {
                class: 'danger',
                onclick: async () =>
                  (await ask({ title: 'Remove this relation?', message: `${e.title} ${phrase} ${r.title}`, action: 'Remove', danger: true })) && change([{ op: 'unlink', relation: r.relation }], 'Relation removed in the UI'),
              },
              'Remove',
            ),
        ),
      );
    });

  // Every way this entity can be linked, read from its side: "depends on" and
  // "blocks" are one relation in its two directions.
  const phrases = schema.relations
    .filter((r) => !kept(r.id))
    .flatMap((r) => [fits(r.from, e.type) && { rel: r.id, out: true, label: r.title, others: r.to }, fits(r.to, e.type) && r.inverse !== r.title && { rel: r.id, out: false, label: r.inverse, others: r.from }])
    .filter(Boolean);
  const adder = h('div', { class: 'add-relation', hidden: true });
  const openAdder = () => {
    dirty = true; // a live update must not close this
    const pick = h('select', { onchange: () => find() }, phrases.map((p, i) => h('option', { value: i }, p.label)));
    const q = h('input', { type: 'search', placeholder: 'Search for what to link to', oninput: () => find() });
    const found = h('div');
    let turn = 0;
    const find = async () => {
      const mine = ++turn;
      const p = phrases[pick.value];
      const text = q.value.trim();
      if (!text) return found.replaceChildren();
      const any = p.others.includes('*');
      try {
        const hits = (await Promise.all((any ? [undefined] : p.others).map((type) => api('search', { q: text, type, limit: 8 })))).flat();
        if (mine !== turn) return;
        // Sources, sessions and the like are offered only to relations that name them.
        const rows = hits.filter((x) => x.id !== id && (!any || !x.type.startsWith('sys.')));
        found.replaceChildren(
          rows.length
            ? h(
                'ul',
                { class: 'rows' },
                rows.map((x) =>
                  h(
                    'li',
                    { class: 'row-top' },
                    chip(x.type),
                    h('span', { class: 'grow' }, x.title),
                    pill(x.type, x.status),
                    h('button', { onclick: () => change([{ op: 'link', type: p.rel, from: p.out ? id : x.id, to: p.out ? x.id : id }], 'Relation added in the UI') }, 'Link'),
                  ),
                ),
              )
            : h('div', { class: 'empty' }, any ? 'Nothing matches.' : `Nothing matches among: ${p.others.map(typeTitle).join(', ')}.`),
        );
      } catch (err) {
        if (mine === turn) found.replaceChildren(h('div', { class: 'error' }, err.message));
      }
    };
    adder.replaceChildren(h('div', { class: 'toolbar' }, h('span', { class: 'muted' }, 'This'), pick, q, h('button', { onclick: () => entity(id) }, 'Cancel')), found);
    adder.hidden = false;
    q.focus();
  };

  const live = !e.archived_at && e.is_open && !e.type.startsWith('sys.');
  // What names it, less what the trail already leads to.
  const mentions = (data.mentioned_in ?? []).filter((m) => !data.trail?.some((t) => t.id === m.id) && !data.incoming.some((r) => r.id === m.id && r.type === 'part_of' && types.get(r.entity_type)?.deliverable));
  const delivers = data.incoming.filter((r) => r.type === 'part_of' && types.get(r.entity_type)?.deliverable && !isClosed(r.entity_type, r.status));
  // A project is its roadmap first: what needs the owner in it and its features, then what every item has.
  const project = isA(e.type, 'project');
  const gated = isA(e.type, 'event') && !e.archived_at;
  // What can be shown to anyone: a product, what it has built, and how we know it is correct.
  const publishable = !e.archived_at && ['project', 'software.feature', 'software.release', 'software.proof', 'software.test', 'software.test_result'].some((t) => isA(e.type, t));
  const proven = !e.archived_at && ['project', 'software.feature', 'software.proof'].some((t) => isA(e.type, t));
  const relCount = data.outgoing.length + data.incoming.length;
  // Changing relations is done rarely: the list to remove from and the form to add with open together, from the menu.
  const editor = h('section', { class: 'card', hidden: true, style: 'margin-bottom: 14px' }, h('table', { class: 'list' }, h('tbody', {}, relRows(data.outgoing, 'out'), relRows(data.incoming, 'in'))), adder);
  // What happened to it, as the same lines Changes shows.
  const sets = [];
  for (const ev of past) {
    const last = sets.at(-1);
    if (ev.changeset && last?.changeset === ev.changeset) last.events.push(ev);
    else sets.push({ changeset: ev.changeset, events: [ev] });
  }
  const lines = sets.flatMap((g) => (g.changeset ? changeRow(g, { here: id }) : g.events.map(eventLine)));
  // A section that is not the point of the page is one line until it is asked for.
  const fold = (key, title, n, open, content) =>
    h(
      'details',
      { class: 'card wide fold', open: unfolded.get(`${id}:${key}`) ?? open, ontoggle: (ev) => unfolded.set(`${id}:${key}`, ev.target.open) },
      h('summary', {}, h('h2', {}, title), n ? h('span', { class: 'n' }, n) : ''),
      content,
    );
  // The ties that hold work up: what depends on it, waits on it or needs it; and what it depends on, waits on or needs.
  const HOLDING = ['depends_on', 'waits_on', 'needs'];
  const holding = data.incoming.filter((r) => HOLDING.includes(r.type));
  const heldBy = data.outgoing.filter((r) => HOLDING.includes(r.type));
  const tieRows = (rows) => h('ul', { class: 'rows' }, rows.map((r) => h('li', { class: 'row-top tie-row' }, chip(r.entity_type), h('span', { class: 'grow', title: r.title }, link(r)), r.type !== 'depends_on' && h('span', { class: 'muted small' }, relations.get(r.type)?.title ?? r.type), pill(r.entity_type, r.status))));
  const session = isA(e.type, 'sys.run') && e.is_open && !e.archived_at;
  const automation = isA(e.type, 'sys.automation');
  const endSession = async () => {
    if (!(await ask({ title: `End "${e.title}"?`, message: 'Anything it holds is released.', action: 'End session', danger: true }))) return;
    try {
      await api('session_end', { run: id, outcome: 'cancelled', summary: 'Ended from the UI' });
    } catch (err) {
      await tell('The session was not ended', err.message);
    }
    entity(id);
  };
  const workish = !e.archived_at && ['task', 'issue', 'software.feature'].some((t) => types.get(e.type)?.flavour_of === t || e.type === t);
  // A short value is a fact to glance at; a long one (a decision's outcome, its rationale) is text to read.
  // A session's own record (where it ran, its ids, when it was heard from, what it used) is said as marks, not as fields.
  const run = isA(e.type, 'sys.run');
  const RUN_OWN = ['story', 'session_id', 'cwd', 'last_seen', 'tokens_used', 'surface'];
  const fields = Object.entries(e.props).filter(([k, v]) => v !== null && v !== '' && k !== 'story' && !(run && RUN_OWN.includes(k)));
  const runFacts = run && [
    e.props.surface && h('span', { class: 'fact', title: e.props.cwd ?? '' }, e.props.surface === 'claude-code' ? 'Claude Code' : (RAN[e.props.surface] ?? e.props.surface)),
    e.props.last_seen && h('span', { class: 'fact' }, h('span', { class: 'muted' }, 'heard from '), ago(e.props.last_seen)),
    e.props.tokens_used > 0 && h('span', { class: 'fact', title: `${e.props.tokens_used} tokens, input and output, not counting cached re-reads` }, h('span', { class: 'muted' }, 'used '), tokensText(e.props.tokens_used)),
  ];
  const short = fields.filter(([, v]) => String(v).length <= 32);
  // A field that holds an item's id says that item's name, as a way to it.
  const ID = /^e_[a-z0-9]{8}$/;
  await Promise.all(short.filter(([, v]) => ID.test(String(v)) && !titles.has(String(v))).map(([, v]) => api('get', { id: String(v) }).then((r) => titles.set(r.entity.id, r.entity.title), () => null)));
  const value = (v) => (ID.test(String(v)) ? idsAsLinks(String(v)) : String(v));
  const long = fields.filter(([, v]) => String(v).length > 32);
  const edit = () => {
    const form = entityForm(e.type, e, {
      submitLabel: 'Save',
      onCancel: () => entity(id),
      onSubmit: async (next) => {
        const props = { ...next.props };
        for (const key of Object.keys(e.props)) if (!(key in props) && !types.get(e.type)?.fields[key]?.system) props[key] = null;
        await api('change', { ops: [{ op: 'update', id, title: next.title, body: next.body, status: next.status, visibility: next.visibility || undefined, props }], reason: 'Edited in the UI' });
        entity(id);
      },
    });
    main.querySelector('.note').replaceWith(form);
    form.scrollIntoView({ block: 'nearest' });
  };
  const copyBrief = async () => {
    const brief = await api('view', { name: 'brief', params: { task: id } });
    await navigator.clipboard.writeText(brief.text);
  };
  const launch = async (mode) => {
    const what = mode === 'plan' ? 'It can read and investigate but not change anything.' : 'It can EDIT FILES in the repository with nobody approving each change. It is told not to commit, push or delete.';
    const instructions = await ask({ title: `Launch a headless Claude Code session on "${e.title}"?`, message: what, input: { placeholder: 'Anything to add to its brief? (optional)' }, action: 'Launch', danger: mode !== 'plan' });
    if (instructions === null) return;
    try {
      const started = await api('launch', { task: id, mode, instructions: instructions || undefined });
      location.hash = `#/e/${started.run}`;
    } catch (err) {
      tell('The session did not start', err.message);
    }
  };

  // A lens brought into a document is its picture, drawn live with the style kept for it, and then its note.
  const lensPart = (s) =>
    h(
      'section',
      { class: 'doc-lens' },
      h('div', { class: 'doc-lens-head' }, chip(s.type), h('a', { class: 'grow', href: `#/e/${s.id}`, title: s.title }, s.title)),
      h('div', { class: 'lens-card' }, lensView({ lens: { lens: s.id }, key: `doc:${id}:${s.id}`, bare: true, style: here ? { here } : {} })),
      s.body && renderBody(s.body),
    );
  const docPart = (p) =>
    p.section && isA(p.section.type, 'lens')
      ? lensPart(p.section)
      : p.section
      ? h(
          'details',
          { class: 'doc-section', open: unfolded.get(`${id}:${p.section.id}`) ?? Boolean(p.section.picture), ontoggle: (ev) => unfolded.set(`${id}:${p.section.id}`, ev.target.open) },
          h('summary', {}, chip(p.section.type), h('span', { class: 'grow', title: p.section.title }, h('a', { href: `#/e/${p.section.id}` }, p.section.title)), pill(p.section.type, p.section.status)),
          p.section.picture && figureOf(p.section),
          p.section.body ? renderBody(p.section.body) : h('div', { class: 'empty' }, 'No notes.'),
        )
      : p.missing
        ? h('div', { class: 'error' }, `${p.missing}: not found, archived or not yours to see`)
        : renderBody(p.text.replace(/^#{1,3}\s+/gm, '')); // a heading for the reader is a section title here
  // A section's figure is fetched with the page's token, so it is drawn from what the picture tool gives.
  const figureOf = (s) => {
    const img = h('img', { class: 'doc-figure', alt: s.title });
    api('picture', { result: s.id }).then((p) => p && (img.src = `data:${p.content_type};base64,${p.data}`), () => null);
    return img;
  };
  const shareLink = async () => {
    if (!(await ask({ title: `Make a link to "${e.title}"?`, message: 'Anyone with the link can read it and every item it brings in, with no login, until the link is revoked.', action: 'Make link' }))) return;
    try {
      const made = await api('share_create', { id });
      main.querySelector('.note').prepend(secretBox('Link to read this document. Send it to its reader.', `${location.origin}${made.path}`));
    } catch (err) {
      tell('No link was made', err.message);
    }
  };
  const stopSharing = async () => {
    if (!(await ask({ title: `Stop the ${links.length === 1 ? 'link' : `${links.length} links`} to "${e.title}"?`, message: 'They stop working at once.', action: 'Stop sharing', danger: true }))) return;
    for (const s of links) await api('share_revoke', { id: s.id }).catch(() => null);
    entity(id);
  };
  const note = doc
    ? h('section', { class: 'card wide note doc' }, doc.parts.length ? doc.parts.map(docPart) : h('div', { class: 'empty' }, 'Nothing written yet.'))
    : h(
    'section',
    { class: 'card wide note' },
    figure && h('img', { class: 'figure', src: `data:${figure.content_type};base64,${figure.data}`, alt: e.title }),
    long.length > 0 && h('dl', { class: 'fields' }, long.map(([k, v]) => [h('dt', {}, k.replaceAll('_', ' ')), h('dd', {}, String(v).length > 140 ? h('details', { class: 'long' }, h('summary', { title: String(v) }, gist(String(v))), String(v)) : String(v))])),
    e.body ? renderBody(e.body) : !long.length && h('div', { class: 'empty' }, 'No notes.'),
  );

  main.replaceChildren(
    h(
      'div',
      { class: 'page-head' },
      h('div', { class: 'row-top' }, chip(e.type), e.archived_at && h('span', { class: 'pill closed' }, 'archived'), e.confidence < 1 && h('span', { class: 'pill warn' }, `confidence ${e.confidence}`), e.private_to && h('span', { class: 'pill closed', title: 'Other members of the workspace cannot see this' }, 'private to you'), e.visibility === 'public' && h('span', { class: 'pill ok', title: 'Anyone can see its name and state, with no login' }, 'public'), links.length > 0 && h('span', { class: 'pill warn', title: `Readable with no login by whoever holds the link (${links.length})` }, 'shared by link')),
      h('h1', { style: 'margin-top: 6px' }, e.title),
      // Where it sits, outermost first, each step a way back up; the views kept about a step open with this item marked in them.
      data.trail?.length > 0 &&
        h(
          'nav',
          { class: 'trail', title: 'Where this sits' },
          data.trail.map((t, i) => [
            i > 0 && h('span', { class: 'trail-sep' }, '\u203A'),
            h('a', { class: 'trail-step', href: `#/e/${t.id}`, title: `${typeTitle(t.type)}: ${t.title}` }, t.title),
          ]),
        ),
      // The pictures it is drawn in, each a way straight back to it with this item marked, and the documents that show it.
      data.shown_in?.length > 0 &&
        h(
          'div',
          { class: 'delivers shown-in', title: 'The pictures this is drawn in' },
          h('span', { class: 'muted small' }, 'Shown in'),
          data.shown_in.map((v) => [
            h('a', { class: 'trail-view', href: `#/graph?from=${v.of.id}&lens=${v.id}&here=${id}`, title: `Open "${v.title}" of ${v.of.title}, with this marked in it` }, v.title),
            v.documents.map((d) => h('a', { class: 'deliverable', href: `#/e/${d.id}?here=${id}`, title: `"${v.title}" is drawn in this document; it opens with this marked` }, chip('document'), h('span', { class: 'gist' }, d.title))),
          ]),
        ),
      // What names it in its text: a link written as an id has its way back here.
      mentions.length > 0 &&
        h(
          'div',
          { class: 'delivers mentions', title: 'What names this in its text or fields' },
          h('span', { class: 'muted small' }, 'Mentioned in'),
          mentions.map((m) => h('span', { class: 'deliverable' }, chip(m.type), h('span', { class: 'gist', title: m.title }, link(m)))),
        ),
      // What it makes for a reader or a customer, named where it is looked for: under the title of what it is part of.
      delivers.length > 0 &&
        h(
          'div',
          { class: 'delivers', title: 'What this delivers: documents, files and releases that are part of it' },
          h('span', { class: 'muted small' }, 'Delivers'),
          delivers.map((r) => h('span', { class: 'deliverable' }, chip(r.entity_type), h('span', { class: 'gist', title: r.title }, link(r)), pill(r.entity_type, r.status))),
        ),
    ),
    h(
      'div',
      { class: 'toolbar facts' },
      h(
        'select',
        { title: 'Status', onchange: (ev) => change([{ op: 'update', id, status: ev.target.value }], `Status set to ${ev.target.value} in the UI`) },
        statusesOf(e.type).map((st) => h('option', { value: st, selected: st === e.status }, st)),
      ),
      live && ageChip(e),
      session && h('button', { title: 'Close it and release what it holds', onclick: endSession }, 'End session'),
      automation && h('span', { class: 'fact' }, automationDoes(e.props)),
      automation && e.props.last_fired && h('span', { class: `fact${String(e.props.last_result).startsWith('failed') ? ' error' : ''}`, title: String(e.props.last_result) }, `last fired ${when(e.props.last_fired)}`),
      h('span', { class: 'fact' }, owner ? link(owner) : h('span', { class: 'muted' }, 'no owner')),
      runFacts,
      short.map(([k, v]) => h('span', { class: 'fact' }, h('span', { class: 'muted' }, `${k.replaceAll('_', ' ')} `), value(v))),
      h('span', { class: 'grow' }),
      !e.archived_at && h('button', { onclick: edit }, 'Edit'),
      menu('More', [
        !e.archived_at && phrases.length > 0 && ['Edit relations', () => ((editor.hidden = false), openAdder(), editor.scrollIntoView({ block: 'nearest' }))],
        live && ['Still true as written', () => change([{ op: 'update', id }], 'Checked in the UI: still true as written')],
        // Only an address on the web: what an agent wrote there is opened by the owner's click.
        /^https?:[/][/]/i.test(e.props.link ?? '') &&['Open where it ran', () => window.open(e.props.link, '_blank', 'noopener')],
        isA(e.type, 'software.repo') && !e.archived_at && e.props.remote && ['Re-check its oldest items now', () => api('github_app', { recheck: id }).then(() => tell('The re-check has started', 'An agent on the server is checking this repository\u2019s oldest open items against its code. Its run shows here, under Tokens used, in a few minutes.'), (err) => tell('The re-check did not start', err.message))],
        data.source && [`Source: ${data.source.title.replace(/\b[a-z]_[a-z0-9]{8}\b/g, (found) => titles.get(found) ?? 'a session')}`, () => (location.hash = `#/e/${data.source.id}`)],
        workish && ['Copy session brief', copyBrief],
        workish && ['Launch a session: investigate only', () => launch('plan')],
        workish && ['Launch a session: may edit files', () => launch('acceptEdits')],
        publishable &&
          e.visibility !== 'public' && [
            'Make public',
            async () =>
              (await ask({ title: `Make "${e.title}" public?`, message: 'Anyone will be able to see its name and state, with no login. A proof question brings its tests and their results. Notes and history stay private.', action: 'Make public', danger: true })) &&
              change([{ op: 'update', id, visibility: 'public' }], 'Made public in the UI'),
          ],
        publishable && e.visibility === 'public' && ['Stop being public', () => change([{ op: 'update', id, visibility: 'private' }], 'No longer public, set in the UI')],
        e.visibility === 'public' && (project || isA(e.type, 'software.feature')) && ['Open its public page', () => window.open(`/p/${e.workspace}/${id}`, '_blank', 'noopener')],
        doc && ['Print or save as PDF', () => window.open(`/read/${id}`, '_blank')],
        doc && !e.archived_at && ['Make a link to read it', shareLink],
        links.length > 0 && ['Stop sharing', stopSharing, 'danger'],
        ['Copy id', () => navigator.clipboard.writeText(e.id)],
        !e.archived_at && ['Archive', async () => (await ask({ title: `Archive "${e.title}"?`, message: 'It leaves every view but stays in the history.', action: 'Archive', danger: true })) && change([{ op: 'archive', id }], 'Archived in the UI'), 'danger'],
      ]),
    ),
    editor,
    // Where it sits and what it holds, as a picture: the lens and the style kept for it, or the ones every item opens on. It takes no room when there is nothing to draw.
    ...(story ? [storyPart(story)].flat() : [h('section', { class: 'card lens-card', style: 'margin-bottom: 14px' }, lensView({ lens: { from: id }, quiet: true }))]),
    // What it holds up and what holds it, said outright: a picture places them, these say which way the tie runs.
    (holding.length + heldBy.length > 0 || '') &&
      h('div', { class: 'grid', style: 'margin-bottom: 14px' }, holding.length > 0 && fold('holding', 'Waiting on this', holding.length, true, tieRows(holding)), heldBy.length > 0 && fold('held', 'This waits on', heldBy.length, true, tieRows(heldBy))),
    // What a project is comes before its chart: said under the chart, it reads as a caption to it.
    project ? h('div', { class: 'grid', style: 'margin-bottom: 14px' }, note) : '',
    project ? h('div', { id: 'roadmap', 'data-root': id }) : '',
    // An event is a gate first: what it waits for, and what is still to be put on one side of it or the other.
    gated ? h('div', { id: 'gate', 'data-root': id }) : '',
    // How we know it is correct, where questions have been asked of this.
    proven ? h('div', { id: 'proof', 'data-root': id }) : '',
    h(
      'div',
      { class: 'grid' },
      // A session that tells its story keeps its log of notes behind a fold: the story is what it says.
      !project && (story ? fold('log', 'Log', 0, false, note) : note),
      used?.runs.length > 0 &&
        fold('usage', 'Tokens used here', `${tokensText(Object.values(used.month).reduce((sum, u) => sum + u.tokens, 0))} in 30 days`, false, [
          h(
            'div',
            { class: 'toolbar fold-bar usage-sums', title: 'The last 30 days, by where the agents ran' },
            Object.entries(used.month).map(([where, u]) =>
              h('span', { class: 'fact' }, h('span', { class: 'muted' }, `${RAN[where] ?? where} `), h('strong', {}, tokensText(u.tokens)), h('span', { class: 'muted' }, ` in ${u.runs} run${u.runs === 1 ? '' : 's'}${u.cost_usd > 0 ? ` · $${u.cost_usd.toFixed(2)}` : ''}`)),
            ),
          ),
          used.runs.map((run) =>
            h(
              'div',
              { class: 'change line' },
              h('span', { class: 'chip' }, RAN[run.surface] ?? run.surface),
              h('span', { class: 'gist', title: run.title }, h('a', { href: `#/e/${run.id}` }, run.title)),
              run.status === 'failed' && h('span', { class: 'pill bad' }, 'failed'),
              h('span', { class: 'muted small' }, `${tokensText(run.tokens)}${run.cost_usd ? ` · $${run.cost_usd.toFixed(2)}` : ''}`),
              ago(run.at),
            ),
          ),
        ]),
      fold('history', 'History', lines.length, false, lines),
    ),
  );
  if (project) roadmap(id).catch((err) => document.getElementById('roadmap')?.replaceChildren(h('div', { class: 'error' }, err.message)));
  if (gated) gate(id).catch((err) => document.getElementById('gate')?.replaceChildren(h('div', { class: 'error' }, err.message)));
  if (proven) proofPart(id, project).catch((err) => document.getElementById('proof')?.replaceChildren(h('div', { class: 'error' }, err.message)));
}

// ---- forms ---------------------------------------------------------------

/** A sentence of explanation, kept behind a small mark: there to be asked for, not to be read past. */
const hint = (text) => h('span', { class: 'hint', title: text, tabindex: 0 }, '?');

/** A stored field name as a person would label it: "recheck_days" is "Recheck days". */
const label = (key) => key.charAt(0).toUpperCase() + key.slice(1).replaceAll('_', ' ');

/** A form for any type, built from its schema. System-kept fields are left out. */
function entityForm(typeId, initial, { submitLabel, onSubmit, onCancel }) {
  const type = types.get(typeId);
  const state = { title: initial.title ?? '', status: initial.status ?? type.statuses.open[0], body: initial.body ?? '', visibility: initial.visibility ?? '', props: { ...(initial.props ?? {}) } };
  const bad = new Set();
  const error = h('div', { class: 'error', style: 'white-space: pre-wrap; padding: 0 14px 14px' });

  const control = (key, def) => {
    const value = state.props[key];
    const set = (v) => {
      if (v === '' || v === undefined) delete state.props[key];
      else state.props[key] = v;
    };
    switch (def.type) {
      case 'enum':
        return h('select', { onchange: (e) => set(e.target.value) }, h('option', { value: '' }, '(not set)'), def.values.map((v) => h('option', { value: v, selected: v === value }, v)));
      case 'boolean':
        return h(
          'select',
          { onchange: (e) => set(e.target.value === '' ? '' : e.target.value === 'true') },
          [['', '(not set)'], ['true', 'yes'], ['false', 'no']].map(([v, label]) => h('option', { value: v, selected: String(value ?? '') === v }, label)),
        );
      case 'number':
        return h('input', { type: 'number', value: value ?? '', oninput: (e) => set(e.target.value === '' ? '' : Number(e.target.value)) });
      case 'date':
        return h('input', { type: 'date', value: value ?? '', oninput: (e) => set(e.target.value) });
      case 'json':
        return h('textarea', {
          rows: 4,
          value: value === undefined ? '' : JSON.stringify(value, null, 2),
          placeholder: '{ }',
          oninput: (e) => {
            bad.delete(key);
            if (!e.target.value.trim()) return set('');
            try {
              set(JSON.parse(e.target.value));
            } catch {
              bad.add(key);
            }
          },
        });
      default:
        return h('input', { type: 'text', value: value ?? '', placeholder: def.type === 'datetime' ? '2026-10-07T14:00:00Z' : '', oninput: (e) => set(e.target.value) });
    }
  };

  // What a field is for is its tooltip: a sentence under every box made the form a page of reading.
  const row = (name, input, hint) => [h('dt', { title: hint ?? '', class: hint ? 'hinted' : '' }, name), h('dd', {}, input)];
  const save = h('button', { class: 'primary' }, submitLabel);
  save.addEventListener('click', async () => {
    error.textContent = '';
    if (!state.title.trim()) return (error.textContent = 'A title is required.');
    if (bad.size) return (error.textContent = `Not valid JSON: ${[...bad].join(', ')}`);
    save.disabled = true;
    try {
      await onSubmit(state);
    } catch (err) {
      error.textContent = err.message;
      save.disabled = false;
    }
  });

  return h(
    'section',
    { class: 'card wide form' },
    h('header', {}, h('h2', {}, type.title), h('span', { class: 'n' }, type.description)),
    h(
      'dl',
      { class: 'fields' },
      row('Title', h('input', { type: 'text', value: state.title, oninput: (e) => (state.title = e.target.value) })),
      row('Status', h('select', { onchange: (e) => (state.status = e.target.value) }, statusesOf(typeId).map((s) => h('option', { value: s, selected: s === state.status }, s)))),
      Object.entries(type.fields)
        .filter(([, def]) => !def.system)
        .map(([key, def]) => row(label(key), control(key, def), def.description)),
      row('Notes', h('textarea', { rows: 5, value: state.body, oninput: (e) => (state.body = e.target.value) })),
      row(
        'Who can see it',
        h(
          'select',
          { onchange: (e) => (state.visibility = e.target.value) },
          !initial.id && h('option', { value: '' }, 'Workspace default'),
          [['private', 'Only me'], ['shared', 'Everyone in the workspace'], ...(initial.visibility === 'public' ? [['public', 'Anyone, with no login']] : [])].map(([v, label]) => h('option', { value: v, selected: v === state.visibility }, label)),
        ),
        'Only matters when several people share a workspace.',
      ),
    ),
    error,
    h('div', { class: 'actions' }, save, h('button', { onclick: onCancel }, 'Cancel')),
  );
}

function newEntity(typeId) {
  const main = part('item');
  if (!types.has(typeId)) typeId = 'task';
  const draw = () => {
    const form = entityForm(typeId, {}, {
      submitLabel: 'Create',
      onCancel: () => history.back(),
      onSubmit: async (next) => {
        const result = await api('change', { ops: [{ op: 'create', ref: 'new', type: typeId, title: next.title, status: next.status, body: next.body || undefined, visibility: next.visibility || undefined, props: next.props }], reason: 'Created in the UI' });
        location.hash = `#/e/${result.created.new}`;
      },
    });
    main.replaceChildren(
      h('div', { class: 'page-head' }, h('h1', {}, 'New')),
      h(
        'div',
        { class: 'toolbar', style: 'margin-bottom: 12px' },
        h('label', { class: 'muted' }, 'Type '),
        h(
          'select',
          {
            onchange: (e) => {
              typeId = e.target.value;
              draw();
            },
          },
          schema.types.map((t) => h('option', { value: t.id, selected: t.id === typeId }, `${t.title}${t.pack === 'core' ? '' : ` (${t.pack})`}`)),
        ),
      ),
      h('div', { class: 'grid' }, form),
    );
  };
  draw();
}

/** What an automation does, in a line: when it fires and what it then does. */
const automationDoes = (p) => {
  const when = p.trigger === 'every' ? `every ${p.every_minutes} min` : p.trigger === 'daily' ? `daily at ${p.at}` : `when ${p.on_action} is logged`;
  const what = p.action === 'notify' ? `notify: ${p.message ?? '(its title)'}` : p.action === 'tool' ? `call ${p.tool}` : `launch a session (${p.input?.mode ?? 'plan'}) on ${p.input?.task}`;
  return `${when} → ${what}`;
};

// ---- Graph ---------------------------------------------------------------

// Colour says what kind of thing a node is. Seven groups, in a fixed order,
// from a palette checked for colour-blind separation in both themes. Red is
// kept for "blocked", which is also drawn as a ring and named in the tooltip.
const GROUPS = [
  { key: 'people', label: 'People and organisations', roots: ['person', 'company', 'agent'] },
  { key: 'work', label: 'Work', roots: ['project', 'task', 'goal', 'area', 'idea', 'software.feature', 'software.pull_request'] },
  { key: 'knowledge', label: 'Decisions and knowledge', roots: ['decision', 'hypothesis', 'result', 'note', 'file', 'procedure'] },
  { key: 'problems', label: 'Issues', roots: ['issue'] },
  { key: 'time', label: 'Events', roots: ['event'] },
  { key: 'resources', label: 'Resources and tools', roots: ['resource', 'software.application', 'software.repo', 'software.environment'] },
  { key: 'system', label: 'System records', roots: [] },
];
const groupOf = (root) => GROUPS.find((g) => g.roots.includes(root)) ?? GROUPS.at(-1);
const BLOCKING = ['depends_on', 'waits_on', 'needs', 'holds'];
const SVG = 'http://www.w3.org/2000/svg';
const s = (tag, attrs = {}, ...kids) => {
  const el = document.createElementNS(SVG, tag);
  for (const [k, v] of Object.entries(attrs)) if (v != null && v !== false) el.setAttribute(k, v);
  el.append(...kids.filter(Boolean));
  return el;
};

// One drawing for every picture of the map: a project's features, what is
// around an item, the whole map. They differ only in where it starts and in
// its filters (which relations, how far out, whether what is finished shows),
// never in how it looks. It is laid out, not simulated, so it looks the same
// every time. Where there is work in sight, across is tokens: each piece of
// work as long as it is expected to take, with what it has used so far, and
// down is the order it happens in: done, under way, to come.
// Where there is none, what a thing belongs to or waits on is to its left
// and what belongs to it or waits on it to its right. Anything can then be
// dragged aside.
const KINDS = { structure: ['part_of', 'serves', 'software.lives_in', 'works_at'], blocking: BLOCKING, all: null };
const KIND_LABELS = [['structure', 'Structure'], ['blocking', 'Blocking'], ['all', 'Everything']];
/** Each drawing's filters and what was dragged in it, by what it is drawn around, kept while the page is open. */
const graphPrefs = new Map();
const prefsOf = (key, defaults = {}) => {
  if (!graphPrefs.has(key)) graphPrefs.set(key, { kind: 'all', steps: 1, finished: true, fit: false, moved: new Map(), ...defaults });
  return graphPrefs.get(key);
};

/**
 * The graph around `focus` (or of the whole map without one), with its
 * filters above it. `extras` is what a page knows beyond the graph view: per
 * item (`info`: progress, place in an order, whether it is being worked on)
 * and edges to add (a feature waiting on another through their tasks).
 */
function graphView({ focus, key, defaults, extras } = {}) {
  // Two drawings around one thing (a project's work, and what else it is linked to) keep their own filters.
  const prefs = prefsOf(key ?? focus ?? '', defaults);
  const host = h('div', { class: 'graph-view' }, h('div', { class: 'empty' }, 'Loading…'));
  const draw = async () => {
    let data;
    try {
      // One step further than is drawn is asked for: what a thing in sight waits on is shown with it.
      data = await api('view', { name: 'graph', params: { focus, depth: focus ? Math.min(prefs.steps + 1, 4) : undefined, relations: 'all', include_closed: true } });
    } catch (err) {
      return host.replaceChildren(h('div', { class: 'error' }, err.message));
    }
    // A filter changed lays it out afresh; how it is sized does not.
    const set = (change, tidy = true) => () => {
      Object.assign(prefs, change);
      if (tidy) prefs.moved.clear();
      draw();
    };
    const pick = (key, options, title) => h('span', { class: 'switch', title }, options.map(([value, label]) => h('button', { class: prefs[key] === value ? 'on' : '', onclick: set({ [key]: value }) }, label)));
    // The scale of tokens is cut to the room there is, so a chart opens whole and is not scrolled across.
    prefs.width = prefs.full ? window.innerWidth - 66 : Math.max(520, (host.clientWidth || (document.querySelector('main')?.clientWidth ?? 1060) - 30) - 50);
    const shaped = shapeGraph(data, focus, prefs, extras);
    // Filling the window, it says what it is a drawing of, since the page's own head is behind it.
    host.classList.toggle('full', Boolean(prefs.full));
    host.replaceChildren(
      h(
        'div',
        { class: 'toolbar fold-bar' },
        prefs.full && h('strong', { class: 'graph-title' }, data.nodes.find((n) => n.id === focus)?.title ?? 'The whole map'),
        !extras?.workOnly && pick('kind', KIND_LABELS, 'Which relations to draw'),
        !extras?.workOnly && focus && pick('steps', [[1, 'Near'], [2, '2 steps'], [3, '3 steps']], 'How far out to draw'),
        h('span', { class: 'grow' }),
        h('button', { title: prefs.full ? 'Back to the page (Esc)' : 'Fill the window with the drawing', onclick: set({ full: !prefs.full }, false) }, prefs.full ? 'Close' : 'Full screen'),
        menu('View', [
          [prefs.finished ? 'Hide what is finished' : 'Show what is finished', set({ finished: !prefs.finished })],
          [prefs.fit ? 'Actual size' : 'Fit to width', set({ fit: !prefs.fit }, false)],
          prefs.moved.size > 0 && !shaped.axis && ['Tidy', set({})],
        ]),
      ),
      shaped.nodes.length > (focus ? 1 : 0) ? drawGraph(shaped, prefs) : h('div', { class: 'empty' }, focus ? 'Nothing is linked to it this way.' : 'Nothing to draw with these filters.'),
    );
  };
  // Esc leaves the full window, while this drawing is the one on the page.
  const leave = (ev) => {
    if (!host.isConnected) return document.removeEventListener('keydown', leave);
    if (ev.key !== 'Escape' || !prefs.full) return;
    prefs.full = false;
    draw();
  };
  document.addEventListener('keydown', leave);
  draw();
  return host;
}

/** Which nodes and edges the filters leave, and where each node goes. */
function shapeGraph(data, focus, prefs, extras = {}) {
  const BOX = { w: 224, h: 56, col: 292, gap: 12 };
  const info = extras.info ?? new Map();
  // A drawing of work alone (a project's features) leaves out what takes no tokens: people, repositories, notes.
  // Those are the project's other drawing, which leaves out the work.
  const byId = new Map(data.nodes.filter((n) => n.id === focus || ((prefs.finished || n.open) && (!extras.workOnly || n.work) && (!extras.restOnly || !n.work))).map((n) => [n.id, { ...n, ...info.get(n.id) }]));
  const seen = new Set();
  const all = [...data.edges, ...(extras.edges ?? [])].filter((e) => byId.has(e.from) && byId.has(e.to) && !seen.has(e.id) && seen.add(e.id));
  const counts = (e) => !KINDS[prefs.kind] || KINDS[prefs.kind].includes(e.type);
  const walk = all.filter(counts);

  // How many columns from the start each thing is: to the right when it
  // belongs to or waits on what it was reached from, to the left otherwise.
  const rank = new Map();
  const starts = focus ? [focus] : [...byId.keys()].filter((id) => !walk.some((e) => e.from === id) && walk.some((e) => e.to === id));
  for (const id of starts) rank.set(id, 0);
  for (let d = 0, frontier = starts; frontier.length && (!focus || d < prefs.steps); d++) {
    const at = new Set(frontier);
    const next = [];
    for (const e of walk) {
      for (const [cur, other, dir] of [[e.to, e.from, 1], [e.from, e.to, -1]]) {
        if (!at.has(cur) || rank.has(other)) continue;
        rank.set(other, rank.get(cur) + dir);
        next.push(other);
      }
    }
    frontier = next;
  }
  // What a thing in sight waits on is in sight too, though it is a step further out: a thing marked as blocked shows what by.
  if (focus) for (const e of all) if (BLOCKING.includes(e.type) && rank.has(e.from) && !rank.has(e.to)) rank.set(e.to, rank.get(e.from) - 1);
  // A project's chart is one level: its features, and its work that is under none of them. A task that is part of a feature is on that feature's page.
  if (extras.workOnly) for (const e of walk) if (e.type === 'part_of' && e.to !== focus && rank.has(e.to) && rank.has(e.from)) rank.delete(e.from);
  const nodes = [...rank.keys()].map((id) => byId.get(id));
  // What waits on what is drawn whatever the filter, among the things in sight.
  const edges = all.filter((e) => rank.has(e.from) && rank.has(e.to) && (counts(e) || BLOCKING.includes(e.type)));
  // What waits comes after what it waits on. A loop of waiting stops going round.
  for (let pass = 0; pass < 12; pass++) {
    let moved = false;
    for (const e of edges) {
      if (!BLOCKING.includes(e.type) || e.from === focus || rank.get(e.from) > rank.get(e.to)) continue;
      rank.set(e.from, rank.get(e.to) + 1);
      moved = true;
    }
    if (!moved) break;
  }

  // Where there is work in sight, across is tokens, and the work is laid along it.
  // Only around work, though: around a repository or a person it is their neighbourhood that is wanted, not a scale.
  if (nodes.filter((n) => n.work).length > 1 && (!focus || byId.get(focus).work)) {
    const { axis, drawn } = timeline(nodes, edges, byId, focus, prefs);
    return { nodes, edges: drawn, byId, focus, axis };
  }

  // Otherwise each column sits as near as it can to what it is linked to in the columns already placed, nearest the start first.
  const near = new Map(nodes.map((n) => [n.id, []]));
  for (const e of edges) {
    near.get(e.from).push(byId.get(e.to));
    near.get(e.to).push(byId.get(e.from));
  }
  const cols = new Map();
  for (const n of nodes) cols.set(rank.get(n.id), [...(cols.get(rank.get(n.id)) ?? []), n]);
  const wanted = (n) => {
    const placed = near.get(n.id).filter((p) => p.y !== undefined);
    return placed.length ? placed.reduce((sum, p) => sum + p.y, 0) / placed.length : undefined;
  };
  for (const r of [...cols.keys()].sort((a, b) => Math.abs(a) - Math.abs(b) || b - a)) {
    const want = new Map(cols.get(r).map((n) => [n, wanted(n)]));
    const ordered = [...cols.get(r)].sort((a, b) => (want.get(a) ?? Infinity) - (want.get(b) ?? Infinity) || (a.place ?? 1e9) - (b.place ?? 1e9) || a.title.localeCompare(b.title));
    let y = 0;
    for (const n of ordered) {
      n.y = Math.max(y, want.get(n) ?? y);
      y = n.y + BOX.h + BOX.gap;
    }
  }
  // The start sits level with the middle of what is around it, but never so far down that it opens out of sight.
  const centre = focus && cols.get(0).length === 1 && byId.get(focus);
  if (centre && near.get(focus).length) centre.y = Math.min(near.get(focus).reduce((sum, p) => sum + p.y, 0) / near.get(focus).length, 240);
  const left = Math.min(0, ...cols.keys());
  const top = Math.min(0, ...nodes.map((n) => n.y));
  for (const n of nodes) {
    n.x = (rank.get(n.id) - left) * BOX.col;
    n.y -= top;
    n.w = BOX.w;
    n.h = BOX.h;
    const dragged = prefs.moved.get(n.id);
    if (dragged) Object.assign(n, dragged);
  }
  return { nodes, edges, byId, focus };
}

/** A count of tokens as a person says it: 1.2M, 340k. */
const tokensText = (t) => (t >= 1e6 ? `${+(t / 1e6).toFixed(1)}M` : t >= 1000 ? `${Math.round(t / 1000)}k` : `${Math.round(t)}`);

/**
 * Where there is work in sight, across is tokens. Work is laid end to end in
 * the order it is to be done (its place on the roadmap, and after what it
 * waits on), each thing as long as it is expected to take, so where a thing
 * ends is what will have been spent by then; a thing spans what is part of
 * it. What has no estimate is given a middling length and drawn as a guess.
 * What is not work (a person, a repository, a note) has no place on the
 * scale and sits under it.
 */
function timeline(nodes, edges, byId, focus, prefs) {
  const ROW = { h: 30, gap: 10, top: 28 };
  // What a thing is part of. Part of two things in sight (a feature and its project), it sits under the nearer: the one that is itself part of something.
  const parts = edges.filter((e) => e.type === 'part_of' && byId.get(e.from).work && byId.get(e.to).work);
  const inner = new Set(parts.map((e) => e.from));
  const parentOf = new Map();
  for (const e of parts) if (!parentOf.has(e.from) || (inner.has(e.to) && !inner.has(parentOf.get(e.from)))) parentOf.set(e.from, e.to);
  const waits = edges.filter((e) => BLOCKING.includes(e.type));
  // Around one piece of work the scale is that work's own: it, and what is part of it, have a length. What it is
  // itself part of, and work that belongs elsewhere, do not: the first would only be a bar across everything.
  const within = (id) => {
    for (let at = id, far = 0; at && far < 8; at = parentOf.get(at), far++) if (at === focus) return true;
    return false;
  };
  const scaled = new Set(nodes.filter((n) => n.work && (!focus || within(n.id))).map((n) => n.id));
  // What that work waits on from outside it, or what waits on it (a decision, a person, work that belongs
  // elsewhere), takes none of the scale: it is a mark in the order, where it falls.
  const gates = new Set();
  for (let grew = Boolean(focus); grew; ) {
    grew = false;
    for (const e of waits) {
      for (const [id, other] of [[e.from, e.to], [e.to, e.from]]) {
        if (scaled.has(id) || gates.has(id) || !(scaled.has(other) || gates.has(other))) continue;
        gates.add(id);
        grew = true;
      }
    }
  }
  for (const id of gates) {
    byId.get(id).gate = true;
    parentOf.set(id, focus);
  }
  for (const id of [...parentOf.keys()]) if (!scaled.has(id) && !gates.has(id)) parentOf.delete(id);
  if (focus) parentOf.delete(focus);
  const timed = nodes.filter((n) => scaled.has(n.id));
  const kids = new Map();
  for (const [kid, parent] of parentOf) kids.set(parent, [...(kids.get(parent) ?? []), byId.get(kid)]);
  // A feature that is built is done, though it stays open until it ships.
  const done = (n) => !n.open || n.status === 'built';
  const under = (n) => n.active || (n.tokens?.used ?? 0) > 0 || ['doing', 'building', 'investigating'].includes(n.status);
  const stage = (n) => (done(n) ? 0 : under(n) ? 1 : 2);
  // How long a chain of waiting ends in a thing: nothing for what can start now, one more than the deepest thing it waits on otherwise.
  const depths = new Map();
  const depth = (id, trail = new Set()) => {
    if (depths.has(id)) return depths.get(id);
    if (trail.has(id)) return 0; // a loop of waiting: stop going round
    trail.add(id);
    const d = Math.max(0, ...waits.filter((e) => e.from === id && byId.get(e.to).open).map((e) => depth(e.to, trail) + 1));
    trail.delete(id);
    depths.set(id, d);
    return d;
  };
  const inOrder = (list) => {
    // Down the page is the order things happen in: what is done, then what is under way, then what is still to come, each in its place on the roadmap.
    // Among those with no place, what can start now comes before what waits, and what waits on more comes later.
    // Where nothing else says, the order things were written down in: it is usually the order they were thought of in.
    const sorted = [...list].sort((a, b) => stage(a) - stage(b) || (a.place ?? a.order ?? 1e9) - (b.place ?? b.order ?? 1e9) || depth(a.id) - depth(b.id) || String(a.created ?? '').localeCompare(String(b.created ?? '')) || a.title.localeCompare(b.title));
    // What waits comes after what it waits on. A loop of waiting stops going round.
    for (let pass = 0; pass < sorted.length; pass++) {
      let moved = false;
      for (const e of waits) {
        const [i, j] = [sorted.findIndex((n) => n.id === e.from), sorted.findIndex((n) => n.id === e.to)];
        if (i < 0 || j <= i) continue;
        sorted.splice(j, 0, ...sorted.splice(i, 1));
        moved = true;
      }
      if (!moved) break;
    }
    return sorted;
  };
  const known = timed.filter((n) => n.tokens?.estimated > 0 && !kids.get(n.id)?.length).map((n) => n.tokens.estimated).sort((a, b) => a - b);
  const middling = known.length ? known[Math.floor(known.length / 2)] : 50_000;
  const rows = [];
  // Every bar is exactly the stretch of the scale it takes, so no two that follow each other overlap and a
  // bar spans exactly what is part of it. A finished thing takes what it used; one under way, what it is
  // expected to or what it has used already if that is more; one to come, what it is expected to. What is
  // filled in is what has been used, and the part of that beyond the estimate is marked as over.
  const place = (n, start) => {
    if (rows.includes(n)) return start; // a loop of belonging: stop going round
    rows.push(n);
    if (n.gate) return Object.assign(n, { t0: start, len: 0, fills: [], guess: false }), start;
    let cursor = start;
    let within = 0;
    const fills = [];
    for (const kid of inOrder(kids.get(n.id) ?? [])) {
      cursor = place(kid, cursor);
      fills.push(...kid.fills);
      within += kid.tokens?.used ?? 0;
    }
    const { estimated = 0, used = 0 } = n.tokens ?? {};
    n.guess = !(estimated > 0);
    n.t0 = start;
    if (cursor > start) {
      // Over its parts it is filled where they are, and then by what was spent on it directly.
      const own = Math.max(used - within, 0);
      if (own > 0) fills.push({ t0: cursor, t1: cursor + own });
      n.len = cursor + own - start;
      if (!done(n)) n.len = Math.max(n.len, estimated);
    } else {
      const expected = estimated || (done(n) && used) || Math.max(used, middling);
      n.len = done(n) ? used || expected : Math.max(expected, used);
      const filled = done(n) ? n.len : Math.min(used, n.len);
      const expectedPart = estimated > 0 ? Math.min(estimated, filled) : filled;
      if (expectedPart > 0) fills.push({ t0: start, t1: start + expectedPart });
      if (filled > expectedPart) fills.push({ t0: start + expectedPart, t1: start + filled, over: true });
    }
    n.fills = fills;
    return start + n.len;
  };
  const roots = timed.filter((n) => !parentOf.has(n.id));
  let total = 0;
  for (const n of [...roots.filter((x) => x.id === focus), ...inOrder(roots.filter((x) => x.id !== focus))]) total = place(n, total);
  // The scale is as long as the room allows once every bar's name, written after it where it does not fit inside, is in sight too.
  const room = prefs.width ?? 1000;
  const written = (n, w) => {
    const name = Math.min((n.place ? 4 : 0) + n.title.length, 46) * 6.7;
    return 8 + (name + 20 <= w ? 0 : name + 8) + 96;
  };
  let scale = room / (total || middling);
  for (let pass = 0; pass < 4; pass++) scale = Math.min(scale, ...rows.filter((n) => n.t0 + n.len > 0).map((n) => Math.max(room - written(n, n.len * scale), 240) / (n.t0 + n.len)));
  rows.forEach((n, i) => {
    Object.assign(n, { bar: true, x: n.t0 * scale, y: ROW.top + i * (ROW.h + ROW.gap), w: n.gate ? 14 : Math.max(n.len * scale, 6), h: ROW.h, fills: n.fills.map((f) => ({ x: (f.t0 - n.t0) * scale, w: (f.t1 - f.t0) * scale, over: f.over })) });
  });
  const bottom = ROW.top + rows.length * (ROW.h + ROW.gap);
  const loose = nodes.filter((n) => !rows.includes(n)).sort((a, b) => a.title.localeCompare(b.title));
  // What has no place on the scale is set out under it, as many to a line as there is room for.
  const across = Math.max(1, Math.floor(room / 300));
  loose.forEach((n, i) => Object.assign(n, { bar: true, loose: true, x: (i % across) * 300, y: bottom + 12 + Math.floor(i / across) * (ROW.h + ROW.gap), w: 210, h: ROW.h, fills: [] }));
  // What a thing is part of is said by its bar spanning it, not by a line as well.
  // Nor is waiting that is over drawn: the order along the scale already says what came first.
  const over = (e) => BLOCKING.includes(e.type) && !byId.get(e.to).open;
  const belongs = (e) => parts.includes(e) || (e.type === 'part_of' && rows.includes(byId.get(e.from)) && rows.includes(byId.get(e.to)));
  // Nor a wait that another already says: if it waits on B, and B on A, the line to A adds nothing but a crossing.
  const on = new Map();
  for (const e of waits) on.set(e.from, [...(on.get(e.from) ?? []), e.to]);
  const said = (e) => {
    if (!waits.includes(e)) return false;
    const seen = new Set([e.from]);
    const stack = (on.get(e.from) ?? []).filter((id) => id !== e.to);
    while (stack.length) {
      const at = stack.pop();
      if (at === e.to) return true;
      if (seen.has(at)) continue;
      seen.add(at);
      stack.push(...(on.get(at) ?? []));
    }
    return false;
  };
  return { axis: { scale, total: total || middling, top: ROW.top, bottom }, drawn: edges.filter((e) => !belongs(e) && !over(e) && !said(e)) };
}

/** The drawing itself: boxes joined by lines, each box leading to its page and free to be dragged. */
function drawGraph({ nodes, edges, byId, focus, axis }, prefs) {
  const pad = 16;
  const cut = (text, max) => (text.length > max ? text.slice(0, max - 1) + '…' : text);
  // A title takes two lines in its box before it is cut, and is cut at a word.
  const wrap = (text, max) => {
    const lines = [''];
    for (const word of text.split(' ')) {
      if ((lines.at(-1) + ' ' + word).trim().length <= max) lines[lines.length - 1] = (lines.at(-1) + ' ' + word).trim();
      else if (lines.length < 2) lines.push(cut(word, max));
      else return [lines[0], cut(lines[1] + ' ' + word, max)];
    }
    return lines;
  };
  // On the scale of tokens a thing is a bar with its name in it, or beside it when it does not fit.
  const CHAR = 6.7;
  for (const n of nodes.filter((x) => x.bar)) {
    n.name = cut(n.place ? `${n.place}. ${n.title}` : n.title, 46);
    const { estimated = 0, used = 0 } = n.tokens ?? {};
    n.count = n.loose ? typeTitle(n.type) : n.gate ? `${typeTitle(n.type)}, ${n.status}` : used > 0 || !n.guess ? `${n.tokens?.assumed ? '~' : ''}${tokensText(used)} / ${n.guess ? '?' : tokensText(estimated)}${!n.guess && (n.tokens?.partial || n.len > estimated) ? '+' : ''}` : 'no estimate';
    n.inside = n.loose || n.name.length * CHAR + 20 <= n.w;
    n.reach = n.w + 8 + (n.inside ? 0 : n.name.length * CHAR + 8) + (n.loose ? 0 : n.count.length * 6 + 8);
  }
  const width = Math.max(...nodes.map((n) => n.x + (n.reach ?? n.w))) + pad * 2;
  const height = Math.max(...nodes.map((n) => n.y + n.h)) + pad * 2;
  const lineLayer = s('g', { transform: `translate(${pad},${pad})` });
  const boxLayer = s('g', { transform: `translate(${pad},${pad})` });
  const scaleLayer = s('g', { class: 'g-axis', transform: `translate(${pad},${pad})` });
  if (axis) {
    // A round number of tokens between the marks, about seven of them.
    const rough = axis.total / 7;
    const step = [1, 2, 5, 10].map((m) => m * 10 ** Math.floor(Math.log10(rough))).find((x) => x >= rough);
    for (let t = 0; t <= axis.total; t += step) {
      scaleLayer.append(s('line', { x1: t * axis.scale, x2: t * axis.scale, y1: axis.top - 8, y2: axis.bottom }), s('text', { x: t * axis.scale + 4, y: 11 }, document.createTextNode(t ? tokensText(t) : step * axis.scale < 64 ? '0' : '0 tokens')));
    }
  }
  const marker = (id, cls) => s('marker', { id, viewBox: '0 0 10 10', refX: 9, refY: 5, markerWidth: 7, markerHeight: 7, orient: 'auto-start-reverse' }, s('path', { d: 'M0,1 L10,5 L0,9 z', class: cls }));
  const svg = s(
    'svg',
    { ...(prefs.fit ? { width: '100%' } : { width, height }), viewBox: `0 0 ${width} ${height}`, role: 'img', 'aria-label': axis ? 'The work laid out by the tokens it takes' : 'Graph of the map' },
    s('defs', {}, marker('rm-arrow', 'rm-arrowhead'), marker('rm-arrow-wait', 'rm-arrowhead wait')),
    scaleLayer,
    lineLayer,
    boxLayer,
  );

  // A line leaves the side of one box that faces the other; two that overlap across are joined round their right.
  const path = (a, b) => {
    const my = (n) => n.y + n.h / 2;
    const [ar, br] = [a.x + a.w, b.x + b.w];
    if (ar > b.x + 4 && br > a.x + 4) {
      const out = Math.max(ar, br) + 46;
      return `M${ar},${my(a)} C${out},${my(a)} ${out},${my(b)} ${br + 2},${my(b)}`;
    }
    const [x1, x2] = ar <= b.x + 4 ? [ar, b.x - 2] : [a.x, br + 2];
    return `M${x1},${my(a)} C${(x1 + x2) / 2},${my(a)} ${(x1 + x2) / 2},${my(b)} ${x2},${my(b)}`;
  };
  // Along the scale a wait is a step: down from the end of what is waited on, then across into what waits. It
  // never runs through a name, which is written after its bar on the bar's own line.
  const step = (a, b) => {
    const x0 = a.x + Math.max(a.w - 14, a.w / 2);
    const down = b.y > a.y;
    const [y0, yb] = [down ? a.y + a.h : a.y, b.y + b.h / 2];
    if (b.x - 2 < x0 + 8) return `M${x0},${y0} V${down ? b.y - 2 : b.y + b.h + 2}`;
    return `M${x0},${y0} V${yb - (down ? 6 : -6)} Q${x0},${yb} ${x0 + 6},${yb} H${b.x - 2}`;
  };
  const seen = { waiting: false, met: false, lifted: false, other: false };
  const lines = edges.map((e) => {
    const blocking = BLOCKING.includes(e.type);
    // An arrow runs from what is needed to what needs it; any other line from the thing to what it belongs to.
    const [a, b] = blocking ? [byId.get(e.to), byId.get(e.from)] : [byId.get(e.from), byId.get(e.to)];
    const structure = KINDS.structure.includes(e.type);
    seen.waiting ||= blocking && a.open;
    seen.met ||= blocking && !a.open;
    seen.lifted ||= Boolean(e.lifted) && !axis;
    seen.other ||= !blocking && !structure;
    const phrase = relations.get(e.type)?.title ?? e.type;
    const el = s(
      'path',
      blocking ? { class: `rm-dep${a.open ? ' waiting' : ''}${e.lifted && !axis ? ' lifted' : ''}${axis ? ' step' : ''}`, 'marker-end': `url(#rm-arrow${a.open ? '-wait' : ''})` } : { class: `rm-link${structure ? '' : ' other'}${a.loose || b.loose ? ' faint' : ''}` },
      s('title', {}, document.createTextNode(`${byId.get(e.from).title} ${e.lifted ? 'waits, through their tasks, on' : phrase} ${byId.get(e.to).title}`)),
    );
    lineLayer.append(el);
    return { el, a, b, ends: [e.from, e.to], stepped: Boolean(axis) && blocking && !a.loose && !b.loose };
  });
  const route = (l) => l.el.setAttribute('d', l.stepped ? step(l.a, l.b) : path(l.a, l.b));
  lines.forEach(route);

  for (const n of nodes) {
    const { done = 0, total = 0 } = n.progress ?? {};
    const { estimated = 0, used = 0 } = n.tokens ?? {};
    const state = `${n.id === focus ? ' root' : ''}${n.open ? '' : ' closed'}${n.active ? ' active' : ''}${n.blocked ? ' blocked' : ''}`;
    const hint = s(
      'title',
      {},
      document.createTextNode(
        `${n.title}\n${typeTitle(n.type)}, ${n.status}${n.blocked ? ', blocked' : ''}${n.sessions?.length ? ', session open' : ''}${n.work ? `\n${n.guess ? 'No estimate' : `Estimated ${tokensText(estimated)} tokens`}, ${tokensText(used)} used${n.tokens?.assumed ? ' (finished work that was not measured is counted at its estimate)' : ''}${n.tokens?.partial ? '\nSome of what is part of it has no estimate yet, so it will take more' : ''}` : ''}`,
      ),
    );
    const after = n.w + 8;
    const box = n.bar
      ? s(
          'g',
          { class: `rm-node g-node bar group-${groupOf(n.root).key}${state}${n.guess ? ' guess' : ''}${n.loose ? ' loose' : ''}${n.gate ? ' gate' : ''}`, transform: `translate(${n.x},${n.y})` },
          hint,
          n.gate ? s('path', { class: 'box', d: `M0,${n.h / 2} L7,${n.h / 2 - 7} L14,${n.h / 2} L7,${n.h / 2 + 7} z` }) : s('rect', { class: 'box', width: n.w, height: n.h, rx: 3 }),
          ...n.fills.map((f) => s('rect', { class: f.over ? 'over' : 'used', x: f.x, y: 1, width: Math.min(f.w, n.w - f.x), height: n.h - 2 })),
          s('text', { x: n.inside ? 10 : after, y: 19 }, document.createTextNode(n.name)),
          !n.loose && s('text', { class: 'small', x: after + (n.inside ? 0 : n.name.length * CHAR + 8), y: 19 }, document.createTextNode(n.count)),
          n.loose && s('text', { class: 'small', x: after, y: 19 }, document.createTextNode(n.count)),
          // A wait drawn into it already says it is blocked, and by what: the mark is for when nothing in sight does.
          n.blocked && !n.gate && !lines.some((l) => l.stepped && l.b === n) && s('circle', { class: 'flag', cx: n.w - 3, cy: 3, r: 4.5 }),
        )
      : s(
          'g',
          { class: `rm-node g-node group-${groupOf(n.root).key}${state}`, transform: `translate(${n.x},${n.y})` },
          hint,
          s('rect', { class: 'box', width: n.w, height: n.h, rx: 7 }),
          s('rect', { class: 'stripe', x: 0, y: 8, width: 3, height: n.h - 16, rx: 1.5 }),
          ...wrap(n.place ? `${n.place}. ${n.title}` : n.title, 31).map((line, k) => s('text', { x: 12, y: 17 + k * 15 }, document.createTextNode(line))),
          total > 0 && s('rect', { class: 'track', x: 12, y: 42, width: 70, height: 5, rx: 2.5 }),
          total > 0 && s('rect', { class: 'fill', x: 12, y: 42, width: (70 * done) / total, height: 5, rx: 2.5 }),
          s('text', { class: 'small', x: total > 0 ? 88 : 12, y: 48 }, document.createTextNode(total > 0 ? `${done}/${total}` : typeTitle(n.type))),
          s('text', { class: 'small', x: n.w - 10, y: 48, 'text-anchor': 'end' }, document.createTextNode(n.status)),
          n.blocked && s('circle', { class: 'flag', cx: n.w - 4, cy: 4, r: 5 }),
        );
    boxLayer.append(box);
    // On the scale of tokens, where a bar is says when it happens and what it takes: it is not moved by hand, only followed.
    if (axis) {
      box.addEventListener('click', () => ((prefs.full = false), (location.hash = `#/e/${n.id}`)));
      continue;
    }
    // A press that moves is a drag, and the box stays where it is put; one that does not is a click, and leads to its page.
    box.addEventListener('pointerdown', (down) => {
      if (down.button !== 0) return;
      box.setPointerCapture(down.pointerId);
      const ratio = width / svg.getBoundingClientRect().width;
      const from = { x: n.x, y: n.y };
      let far = false;
      const move = (ev) => {
        const [dx, dy] = [(ev.clientX - down.clientX) * ratio, (ev.clientY - down.clientY) * ratio];
        far ||= Math.hypot(dx, dy) > 4;
        if (!far) return;
        n.x = Math.max(0, from.x + dx);
        n.y = Math.max(0, from.y + dy);
        box.setAttribute('transform', `translate(${n.x},${n.y})`);
        lines.filter((l) => l.ends.includes(n.id)).forEach(route);
      };
      const up = () => {
        box.removeEventListener('pointermove', move);
        box.removeEventListener('pointerup', up);
        if (far) prefs.moved.set(n.id, { x: n.x, y: n.y });
        // Following a box leaves the drawing, and so the full window.
        else ((prefs.full = false), (location.hash = `#/e/${n.id}`));
      };
      box.addEventListener('pointermove', move);
      box.addEventListener('pointerup', up);
    });
  }

  const key = (cls, text) => h('span', { class: 'key' }, h('span', { class: cls }), text);
  const legend = [
    axis && key('swatch g-est', 'Still to be used'),
    nodes.some((n) => n.fills?.some((f) => !f.over)) && key('swatch g-used', 'Used so far'),
    nodes.some((n) => n.fills?.some((f) => f.over)) && key('swatch g-over', 'Over its estimate'),
    nodes.some((n) => n.guess) && key('swatch g-guess', 'No estimate yet: its length is a guess'),
    nodes.some((n) => n.gate) && key('swatch g-gate', 'Waited on from outside this work'),
    seen.waiting && key('stroke waits', 'Waits on something unfinished'),
    seen.met && key('stroke blocking', 'Waited on something now finished'),
    seen.lifted && key('stroke lifted', 'Through their tasks'),
    seen.other && key('stroke dotted', 'Other relation'),
    nodes.some((n) => n.active) && key(axis ? 'swatch g-active' : 'swatch rm-active', 'Being worked on'),
    !axis && nodes.some((n) => !n.open) && key('swatch rm-closed', 'Finished'),
    nodes.some((n) => n.blocked) && key('swatch rm-blocked', 'Blocked'),
  ].filter(Boolean);
  return h('div', { class: 'graph-body' }, h('div', { class: 'graph-scroll' }, svg), legend.length > 0 && h('div', { class: 'legend' }, legend));
}

// ---- A session's story -----------------------------------------------------

// What a session has found, said whole, over a picture of only what that is
// about: a lens started from the story's finding, drawn with its ties (the
// nest, which draws lines). How it got there, beat by beat (the tell tool),
// is folded under it: a log, for whoever wants it.
function storyPart(data) {
  const found = data.beats.find((b) => b.n === data.finding);
  if (!found) return '';
  const picture = lensView({ lens: { story: data.run.id, beat: found.n }, style: { shape: 'nest' }, key: `story:${data.run.id}`, bare: true });
  // The finding names items by their ids; they read as names once the picture has said what each is called.
  const said = h('p', { class: 'finding' }, idsAsLinks(found.said));
  picture.ready.then(() => {
    for (const item of picture.answer?.items ?? []) titles.set(item.id, item.title);
    said.replaceChildren(...idsAsLinks(found.said));
  });
  const named = (box, beat) => box?.replaceChildren(...beat.about.map((id) => h('a', { href: `#/e/${id}` }, titles.get(id) ?? 'an item')));
  const rows = data.beats.map((b) =>
    h(
      'li',
      { class: `beat${b.replaced_by ? ' taken-back' : ''}${b.finding ? ' found' : ''}` },
      h(
        'details',
        // What it is about is named when it is opened: by then the picture has said what each item is called.
        { ontoggle: (ev) => ev.target.open && named(ev.target.querySelector('.beat-items'), b) },
        h('summary', { title: b.said }, h('span', { class: 'n' }, b.n), h('span', { class: 'said' }, b.said), ago(b.at)),
        h(
          'div',
          { class: 'beat-more' },
          h('p', {}, b.said),
          b.replaced_by && h('p', { class: 'muted small' }, `Taken back in beat ${b.replaced_by}.`),
          b.about.length > 0 && h('div', { class: 'beat-items' }),
        ),
      ),
    ),
  );
  return [
    h(
      'section',
      { class: 'card story', style: 'margin-bottom: 14px' },
      h('header', { class: 'toolbar fold-bar' }, h('h2', { title: 'What this session has found, as it last said it' }, 'Found'), h('span', { class: 'grow' }), ago(found.at)),
      said,
      h('div', { class: 'story-picture' }, picture),
    ),
    h(
      'details',
      { class: 'card wide fold story-beats', style: 'margin-bottom: 14px' },
      h('summary', { title: 'Each thing the session concluded, in order' }, h('h2', {}, 'How it got there'), h('span', { class: 'n' }, data.beats.filter((b) => !b.replaced_by).length)),
      h('ol', { class: 'beats' }, rows),
    ),
  ];
}

// ---- Lens ----------------------------------------------------------------

// A lens says what is in a picture and the server answers it with data of one
// shape (the `lens` view). A style says how that data looks, and is only ever
// read here: which shape, and what stays lit. One shape so far, the nest: a
// thing is a circle and what is inside it is in it, at every depth. It opens
// as it grows on the screen, and closed it says of its parts what each part
// says of itself, so every zoom is the same drawing at another scale.
const LENS_STYLE = { shape: 'nest', lit: 'all' };
const LIT = [
  ['all', 'All', 'Everything in the picture'],
  ['you', 'Needs you', 'Only what waits on you stays lit'],
  ['blocked', 'Blocked', 'Only what is blocked stays lit'],
];
/** The fields a lens may carry in an address, and which of them are lists. */
const LENS_FIELDS = { from: false, story: false, by: false, far: false, lanes: false, order: false, measure: false, kinds: true, over: true, fold: true };

/** A lens and a style, as the end of an address says them: ?from=…&far=1&lit=you. */
function readLens(query) {
  const lens = {};
  const style = {};
  for (const [key, value] of new URLSearchParams(query)) {
    // here: the item a picture was opened from, marked in it.
    if (key === 'lit' || key === 'shape' || key === 'here') style[key] = value;
    // A lens or a style kept on the map, named outright: the server reads it.
    else if ((key === 'lens' || key === 'style') && value) lens[key] = value;
    else if (!(key in LENS_FIELDS)) continue;
    else if (key === 'far') lens.far = Number(value);
    else if (key === 'over' && value === 'all') lens.over = 'all';
    else lens[key] = LENS_FIELDS[key] ? value.split(',').filter(Boolean) : value;
  }
  return { lens, style };
}

/** What a person chose for a picture is kept in their browser, by what it is a picture of. */
const keptStyle = (key) => {
  try {
    return JSON.parse(localStorage.getItem(`pelago-lens:${key}`) ?? '{}');
  } catch {
    return {};
  }
};

/**
 * The picture a lens gives, drawn in a style, under a bar that says what it
 * is a picture of: the views kept about the item (the first is the one it
 * opens on), its shortcuts, what this view lets the person change, and the
 * view's rule in words. `style` is what the page or an address asks for this
 * one look, over what the person chose before.
 */
function lensView({ lens = {}, style = {}, key = lens.story ? `story:${lens.story}` : (lens.from ?? 'map'), quiet = false, bare = false } = {}) {
  const chosen = {};
  const bar = h('div', { class: 'toolbar fold-bar lens-bar', hidden: true });
  const body = h('div', { class: 'lens-view' }, h('div', { class: 'empty' }, 'Loading…'));
  const host = h('div', { class: 'lens-wrap' }, bar, body);
  // What was opened, where the picture stood and which view was chosen outlive a redraw: the map changes under an open page.
  if (!lensPlace.has(key)) lensPlace.set(key, { opened: new Map(), ask: {} });
  const place = lensPlace.get(key);
  const keep = (change) => {
    Object.assign(chosen, change);
    try {
      localStorage.setItem(`pelago-lens:${key}`, JSON.stringify({ lit: chosen.lit }));
    } catch {
      // Without storage the choice lasts until the page is reloaded.
    }
  };
  const load = async () => {
    let answer;
    try {
      answer = await api('view', { name: 'lens', params: { ...lens, ...place.ask } });
    } catch (err) {
      return body.replaceChildren(h('div', { class: 'error' }, err.message));
    }
    host.answer = answer;
    const views = answer.views ?? [];
    const empty = answer.items.length < 2;
    if (empty && !views.length && quiet) return void ((host.closest('.lens-card') ?? host).hidden = true);
    const again = (change) => () => (Object.assign(place.ask, change), load());
    const pictures = views.filter((view) => !view.to);
    const far = answer.lens.far;
    const finished = !answer.lens.fold.includes('closed');
    const parts = [
      // The views of the item, one click apart.
      pictures.length > 1 && h('span', { class: 'switch' }, pictures.map((view) => h('button', { class: view.id === answer.view ? 'on' : '', title: view.title, onclick: again({ lens: view.id, far: undefined, fold: undefined }) }, view.title))),
      // Its shortcuts: views that start somewhere else.
      views.filter((view) => view.to).map((view) => h('a', { class: 'chip lens-pin', href: `#/e/${view.to.id}`, title: `Goes to ${view.to.title}` }, view.title)),
      // The rule of this view, in words: what is in the picture and what is not.
      h('span', { class: 'lens-rule grow', title: answer.said }, answer.said),
      answer.controls.includes('far') &&
        h(
          'span',
          { class: 'switch', title: 'How many steps down are drawn' },
          h('button', { title: 'One step fewer', disabled: far === 0, onclick: again({ far: Math.max((far ?? 4) - 1, 0) }) }, '−'),
          h('button', { class: 'on', title: 'How many steps down are drawn' }, far === undefined ? 'All' : String(far)),
          h('button', { title: 'One step more', onclick: again({ far: (far ?? 0) + 1 }) }, '+'),
        ),
      answer.controls.includes('closed') && h('button', { class: finished ? 'on' : '', title: finished ? 'Leave out what is finished' : 'Show what is finished too', onclick: again({ fold: finished ? [...answer.lens.fold, 'closed'] : answer.lens.fold.filter((f) => f !== 'closed') }) }, 'Finished'),
    ];
    bar.replaceChildren(...parts.flat().filter(Boolean));
    // A picture that says what it is in words of its own (a finding) has no bar of rules over it, and is not there when it has nothing to draw.
    bar.hidden = bare;
    if (empty && bare) return void (host.hidden = true);
    if (empty) return body.replaceChildren(h('div', { class: 'empty' }, 'Nothing to draw with this view.'));
    // Nearest wins, field by field: built in, what the map keeps for this view, what this person chose, what the address asks.
    for (const name of Object.keys(chosen)) delete chosen[name];
    Object.assign(chosen, LENS_STYLE, answer.style, keptStyle(key), style, { noLit: !answer.controls.includes('lit') });
    dress(body, chosen);
    // A style with code of its own is the drawing; without, one of those that come built in.
    (typeof chosen.code === 'string' && chosen.code.trim() ? drawCode : (LENS_SHAPES[chosen.shape] ?? LENS_SHAPES.nest))(body, answer, chosen, keep, place);
  };
  host.ready = load();
  // Light only these items (a beat's, pointed at beside the picture), or everything as the style says again: the shape draws itself anew.
  host.light = (ids) => {
    chosen.only = ids ? [...ids] : undefined;
    body.redraw?.();
  };
  return host;
}

const lensPlace = new Map();

/** A style's colours and sizes, by the name the stylesheet knows each by, with the range a size may take. */
const STYLE_COLORS = ['sea', 'land', 'inner', 'line', 'text', 'muted', 'blocked', 'you', 'session', 'done'];
const STYLE_SIZES = { text: [9, 22], radius: [0, 40], gap: [0, 40], column: [140, 640] };
/** A style's colours and sizes are handed to the stylesheet. Only a plain hex colour or a number in range is: a style is written by anyone who can change the map. */
function dress(host, style) {
  for (const name of STYLE_COLORS) {
    const colour = style.colors?.[name];
    if (typeof colour === 'string' && /^#[0-9a-f]{3,8}$/i.test(colour)) host.style.setProperty(`--ln-${name}`, colour);
    else host.style.removeProperty(`--ln-${name}`);
  }
  for (const [name, [least, most]] of Object.entries(STYLE_SIZES)) {
    if (Number.isFinite(style[name])) host.style.setProperty(`--ln-${name}-size`, `${Math.max(least, Math.min(most, style[name]))}px`);
    else host.style.removeProperty(`--ln-${name}-size`);
  }
}

/** A lens answer as a tree, each thing with what it says of itself and of all that is inside it: the same numbers at every depth. */
function lensTree(answer) {
  const me = answer.viewer;
  const byId = new Map(answer.items.map((item) => [item.id, { ...item, kids: [] }]));
  const root = { kids: [], depth: -1, x: 0, y: 0, title: 'Everything' };
  for (const n of byId.values()) (byId.get(n.inside) ?? root).kids.push(Object.assign(n, { up: byId.get(n.inside) ?? root }));
  for (const n of byId.values()) {
    n.all = 1 + n.within.items;
    n.you = (me && n.state.waits_on.includes(me) ? 1 : 0) + ((me && n.within.waits_on[me]) || 0);
    n.blk = (n.state.blocked ? 1 : 0) + n.within.blocked;
    n.work = n.size.work + n.within.work;
    n.at = n.state.sessions + n.within.sessions;
  }
  const deepen = (n, depth) => ((n.depth = depth), n.kids.sort((a, b) => a.place - b.place).forEach((kid) => deepen(kid, depth + 1)));
  deepen(root, -1);
  return { me, byId, root };
}

/** How much of a thing stays lit: what was asked for by name (style.only), else what the style's lit says; a thing that holds others, by what is in it. */
function litCount(n, style) {
  if (Array.isArray(style.only)) {
    const only = new Set(style.only);
    const any = (m) => only.has(m.id) || m.kids.some(any);
    return any(n) ? 1 : 0;
  }
  return style.lit === 'you' ? n.you : style.lit === 'blocked' ? n.blk : 1;
}

/** The switch for what stays lit, the same in every shape. */
function litSwitch(me, style, keep, redraw) {
  // A view that does not offer the choice has no switch.
  if (style.noLit) return '';
  const lit = h('span', { class: 'switch' });
  for (const [value, label, title] of LIT) {
    if (value === 'you' && !me) continue;
    lit.append(h('button', { class: style.lit === value ? 'on' : '', title, onclick: (ev) => (keep({ lit: value }), [...lit.children].forEach((b) => b.classList.toggle('on', b === ev.currentTarget)), redraw()) }, label));
  }
  return lit;
}

/** Boxes: a thing is a titled box, what is inside it is in it, and a thing with nothing inside is one line. Reads only what a lens answers with. */
function drawBoxes(host, answer, style, keep, kept) {
  const { me, byId, root } = lensTree(answer);
  const show = new Set(Array.isArray(style.show) ? style.show : ['you', 'blocked', 'count']);
  const levels = Number.isFinite(style.open) ? style.open : 1;
  const { opened } = kept;
  // Around one item, what it sits in is open down to it, and how far things open is counted from it.
  const here = byId.get(answer.lens.from);
  const above = new Set();
  for (let n = here?.up; n && n !== root; n = n.up) above.add(n.id);
  const base = here?.depth ?? 0;
  // What each thing waits on, by name, for its tooltip.
  const waits = new Map();
  for (const link of answer.links) if (BLOCKING.includes(link.kind) && byId.has(link.to)) waits.set(link.from, [...(waits.get(link.from) ?? []), byId.get(link.to).title]);
  // What a session said ties a thing to another is written on its line, after its name: boxes draw no lines.
  const ties = new Map();
  for (const link of answer.links) if (link.says && byId.has(link.to)) ties.set(link.from, [...(ties.get(link.from) ?? []), `${link.says} → ${byId.get(link.to).title}`]);
  const tied = (n) => ties.has(n.id) && h('span', { class: 'lb-said', title: ties.get(n.id).join('\n') }, ties.get(n.id).join(' · '));
  const body = h('div', { class: 'lb-top' });
  const count = (n) => litCount(n, style);
  const hint = (n) => `${n.title}\n${typeTitle(n.type)}, ${n.status}${n.all > 1 ? `\n${n.work} open, ${n.blk} blocked${me ? `, ${n.you} need you` : ''}` : n.state.blocked ? ', blocked' : ''}${waits.has(n.id) ? `\nWaits on: ${waits.get(n.id).join('; ')}` : ''}${n.at ? '\nA session is at work here' : ''}`;
  const mark = (cls, text, title) => h('span', { class: `lb-mark lb-${cls}`, title }, text);
  const marks = (n) => [
    show.has('you') && n.you > 0 && mark('you', n.all > 1 ? String(n.you) : '', n.all > 1 ? `${n.you} need you` : 'Waits on you'),
    show.has('blocked') && n.blk > 0 && mark('blocked', n.all > 1 ? String(n.blk) : '', n.all > 1 ? `${n.blk} blocked` : 'Blocked'),
    show.has('sessions') && n.at > 0 && mark('at', '', 'A session is at work here'),
    show.has('count') && n.all > 1 && mark('count', String(n.work), `${n.work} open`),
    show.has('type') && mark('word', typeTitle(n.type), 'What kind of thing it is'),
    show.has('status') && mark('word', n.status, 'Its status'),
  ];
  const thing = (n) => {
    const state = `${count(n) ? '' : ' dim'}${n.open ? '' : ' closed'}${n.state.blocked ? ' blocked' : ''}${me && n.state.waits_on.includes(me) ? ' you' : ''}${n === here || n.id === style.here ? ' here' : ''}`;
    if (n.all === 1) return h('a', { class: `lb-leaf${state}`, href: `#/e/${n.id}`, title: hint(n) }, h('span', { class: 'lb-dot' }), h('span', { class: 'lb-name' }, n.title), tied(n), ...marks(n).slice(2));
    const open = n.kids.length > 0 && (opened.get(n.id) ?? (above.has(n.id) || n.depth - base < levels));
    const leaves = n.kids.filter((kid) => kid.all === 1);
    const boxes = n.kids.filter((kid) => kid.all > 1);
    return h(
      'section',
      { class: `lb-box${state}${open ? ' open' : ''}${n.depth % 2 ? ' odd' : ''}` },
      h(
        'header',
        { title: hint(n) },
        n.kids.length > 0 && h('button', { class: 'lb-fold', title: open ? 'Close it' : 'Open it', onclick: () => (opened.set(n.id, !open), draw()) }, open ? '▾' : '▸'),
        h('a', { class: 'lb-name', href: `#/e/${n.id}` }, n.title),
        tied(n),
        ...marks(n),
      ),
      show.has('bar') && h('div', { class: 'lb-bar', title: `${n.you} need you, ${n.blk} blocked, of ${n.all}` }, h('span', { class: 'lb-you', style: `width:${(100 * n.you) / n.all}%` }), h('span', { class: 'lb-blocked', style: `width:${(100 * n.blk) / n.all}%` })),
      open && leaves.length > 0 && h('div', { class: `lb-leaves ${['row', 'chip', 'dot'].includes(style.leaf) ? style.leaf : 'row'}` }, leaves.map(thing)),
      open && boxes.length > 0 && h('div', { class: 'lb-kids' }, boxes.map(thing)),
    );
  };
  // Around one item its neighbours are gathered under the link that ties each to it, said as that item would say it.
  const start = answer.lens.from;
  const said = (lane) => {
    const [kind, inward] = String(lane).split(':');
    const phrase = lane == null ? 'near it' : ((inward ? relations.get(kind)?.inverse : relations.get(kind)?.title) ?? kind);
    return phrase[0].toUpperCase() + phrase.slice(1);
  };
  const draw = () => {
    const loose = start && answer.lens.lanes === 'link' ? root.kids.filter((n) => n.all === 1 && n.id !== start) : [];
    const lanes = new Map();
    for (const n of loose) lanes.set(n.lane ?? null, [...(lanes.get(n.lane ?? null) ?? []), n]);
    body.replaceChildren(
      // The item the page is about is not drawn again as a line of its own.
      ...root.kids.filter((n) => !loose.includes(n) && !(n.id === start && n.all === 1)).map(thing),
      ...[...lanes].map(([lane, things]) => h('section', { class: 'lb-box lane' }, h('header', {}, h('span', { class: 'lb-name' }, said(lane)), h('span', { class: 'lb-mark lb-count' }, String(things.length))), h('div', { class: 'lb-leaves row' }, things.map(thing)))),
    );
  };
  host.replaceChildren(h('div', { class: 'toolbar fold-bar' }, h('span', { class: 'grow' }), litSwitch(me, style, keep, draw)), body);
  host.redraw = draw;
  draw();
}

/** The nest: circles in circles, opened by zooming. Reads only what a lens answers with. */
function drawNest(host, answer, style, keep, kept) {
  const { me, byId, root } = lensTree(answer);

  // Sizes and places. A thing with nothing sent inside it is as big as what it stands for; one with parts, as big as they are packed.
  const pack = (n, depth) => {
    n.depth = depth;
    if (!n.kids.length) return void (n.r = 6 * Math.sqrt(1 + (n.within?.not_sent ?? 0)));
    for (const kid of n.kids) pack(kid, depth + 1);
    const gap = depth < 0 ? 34 : depth === 0 ? 7 : 3.5;
    const placed = [];
    for (const kid of [...n.kids].sort((a, b) => b.r - a.r || a.place - b.place)) {
      for (let a = 0, far = 0; ; a += 0.3, far += Math.max(0.5, kid.r / 28)) {
        const [x, y] = [Math.cos(a) * far, Math.sin(a) * far];
        if (placed.some((p) => Math.hypot(p.px - x, p.py - y) < p.r + kid.r + gap)) continue;
        Object.assign(kid, { px: x, py: y });
        break;
      }
      placed.push(kid);
    }
    // Centred on what it holds, with room at the rim.
    const [cx, cy] = [(Math.min(...placed.map((p) => p.px - p.r)) + Math.max(...placed.map((p) => p.px + p.r))) / 2, (Math.min(...placed.map((p) => p.py - p.r)) + Math.max(...placed.map((p) => p.py + p.r))) / 2];
    for (const p of placed) Object.assign(p, { px: p.px - cx, py: p.py - cy });
    const reach = Math.max(...placed.map((p) => Math.hypot(p.px, p.py) + p.r));
    n.r = reach + Math.max(5, reach * 0.12);
  };
  pack(root, -1);
  const settle = (n) => n.kids.forEach((kid) => (Object.assign(kid, { x: n.x + kid.px, y: n.y + kid.py }), settle(kid)));
  settle(root);

  // What is drawn: a sea, the lines, then each thing over what it is inside.
  const lineLayer = s('g', { class: 'ln-lines' });
  const landLayer = s('g');
  const svg = s('svg', { class: 'ln-sea', role: 'img', 'aria-label': 'The map, each thing inside what it is part of' }, s('defs', {}, ...['ln-arrow', 'ln-arrow-said'].map((id) => s('marker', { id, viewBox: '0 0 10 10', refX: 9, refY: 5, markerWidth: 7, markerHeight: 7, orient: 'auto' }, s('path', { d: 'M0,1 L10,5 L0,9 z' })))), landLayer, lineLayer);
  const make = (n) => {
    const holds = n.all > 1;
    n.g = s('g', { class: `ln-thing${holds ? ' holds' : ' leaf'}${n.depth % 2 ? ' odd' : ''}${n.state.blocked && !holds ? ' blocked' : ''}${n.you && !holds ? ' you' : ''}${n.open ? '' : ' closed'}`, 'data-id': n.id });
    n.hint = s('title');
    n.circle = s('circle', { class: 'land' });
    n.youArc = holds && n.you > 0 && s('circle', { class: 'arc you' });
    n.blkArc = holds && n.blk > 0 && s('circle', { class: 'arc blocked' });
    n.boat = n.at > 0 && s('circle', { class: 'boat', r: 4.5 });
    n.label = s('text', { class: 'name' });
    n.g.append(n.hint, n.circle, ...[n.youArc, n.blkArc, n.boat].filter(Boolean), n.label);
    n.hint.textContent = `${n.title}\n${typeTitle(n.type)}, ${n.status}${holds ? `\n${n.work} open, ${n.blk} blocked${me ? `, ${n.you} need you` : ''}` : n.state.blocked ? ', blocked' : ''}${n.at ? '\nA session is at work here' : ''}`;
    landLayer.append(n.g);
    n.kids.forEach(make);
  };
  root.kids.forEach(make);

  const trail = h('span', { class: 'lens-trail' });
  const lit = litSwitch(me, style, keep, () => frame());
  const page = h('button', { title: 'Open its page' }, 'Open');
  host.replaceChildren(h('div', { class: 'toolbar fold-bar' }, trail, h('span', { class: 'grow' }), page, lit), svg);

  const view = { x: 0, y: 0, k: 1 };
  let [W, H] = [800, 500];
  let focus = root;
  const clamp = (v) => Math.max(0, Math.min(1, v));
  // The whole of a thing in sight, with some sea around it.
  const fit = (n) => {
    if (n !== root) return { x: n.x, y: n.y, k: (Math.min(W, H) * 0.92) / (2 * n.r) };
    const [x0, x1, y0, y1] = [Math.min(...root.kids.map((p) => p.x - p.r)), Math.max(...root.kids.map((p) => p.x + p.r)), Math.min(...root.kids.map((p) => p.y - p.r)), Math.max(...root.kids.map((p) => p.y + p.r))];
    return { x: (x0 + x1) / 2, y: (y0 + y1) / 2, k: Math.min(W / (x1 - x0), H / (y1 - y0)) * 0.9 };
  };
  const cut = (text, room) => (room < 4 ? '' : text.length > room ? text.slice(0, room - 1).trimEnd() + '…' : text);
  const lines = (text, room, most) => {
    const out = [''];
    for (const word of text.split(' ')) {
      if ((out.at(-1) + ' ' + word).trim().length <= room) out[out.length - 1] = (out.at(-1) + ' ' + word).trim();
      else if (out.length < most) out.push(cut(word, room));
      else return [...out.slice(0, -1), cut(out.at(-1) + ' ' + word, room)];
    }
    return out;
  };
  const write = (n, rows, x, y, cls) => {
    const said = `${cls}|${rows.join('|')}`;
    if (n.said !== said) {
      n.said = said;
      n.label.setAttribute('class', `name ${cls}`);
      n.label.replaceChildren(...rows.map((row, i) => s('tspan', { dy: i ? 13 : 0, class: i && cls !== 'leaf' ? 'count' : null }, document.createTextNode(row))));
    }
    for (const span of n.label.children) span.setAttribute('x', x);
    n.label.setAttribute('y', y);
  };
  const drawn = new Map();
  const few = byId.size <= 24;
  const frame = () => {
    const shut = Math.min(W, H) * 0.34;
    const place = (n, shown, seen) => {
      const [sr, sx, sy] = [n.r * view.k, (n.x - view.x) * view.k + W / 2, (n.y - view.y) * view.k + H / 2];
      // A thing opens as it grows on the screen: its own marks fade and its parts come in.
      const open = n.kids.length ? clamp((sr - shut) / (shut * 0.12)) : 0;
      Object.assign(n, { sr, sx, sy, seen, opened: open > 0.5 });
      const inSight = shown > 0.03 && sx + sr > 0 && sx - sr < W && sy + sr > 0 && sy - sr < H;
      n.g.style.display = inSight ? '' : 'none';
      if (inSight) {
        const count = litCount(n, style);
        n.g.setAttribute('opacity', shown * (count ? 1 : 0.2));
        n.g.classList.toggle('open', open > 0.5);
        for (const [key, value] of [['cx', sx], ['cy', sy], ['r', Math.max(sr, 1.5)]]) n.circle.setAttribute(key, value);
        // Closed, it shows the share of what it holds that needs you, then the share that is blocked.
        const rim = Math.max(sr - Math.max(3, Math.min(sr * 0.16, 9)), 1);
        const round = 2 * Math.PI * rim;
        let from = 0;
        for (const [arc, share] of [[n.youArc, n.you / n.all], [n.blkArc, n.blk / n.all]]) {
          if (!arc) continue;
          const len = Math.max(share * round, 3);
          for (const [key, value] of [['cx', sx], ['cy', sy], ['r', rim], ['stroke-width', Math.max(2, Math.min(sr * 0.13, 7))], ['stroke-dasharray', `${len} ${round}`], ['stroke-dashoffset', -from], ['transform', `rotate(-90 ${sx} ${sy})`], ['opacity', (1 - open) * (sr > 7 ? 1 : 0)]]) arc.setAttribute(key, value);
          from += len + 2;
        }
        if (n.boat) for (const [key, value] of [['cx', sx + sr * 0.71], ['cy', sy - sr * 0.71], ['opacity', sr > 9 ? 1 : 0]]) n.boat.setAttribute(key, value);
        // Its name: across its top when it is open, in its middle with a count when it is closed, wrapped when it holds nothing.
        const cx = Math.max(Math.min(sx, W - 70), 70);
        if (open > 0.5) write(n, [cut(n.title, Math.floor(Math.min(sr * 1.5, W - 40) / 7))], cx, Math.max(sy - sr + 17, 16), 'top');
        else if (n.all > 1 && sr >= 22 && !(few && n.title.length > Math.floor((sr * 1.8) / 6.6))) write(n, [cut(n.title, Math.floor((sr * 1.8) / 6.6)), sr >= 36 ? (style.lit === 'you' ? `${n.you} need you` : style.lit === 'blocked' ? `${n.blk} blocked` : `${n.work} open`) : ''].filter(Boolean), sx, sy + (sr >= 36 ? -2 : 4), 'mid');
        else if (n.all === 1 && sr >= 26) {
          const rows = lines(n.title, Math.floor((sr * 1.7) / 6.1), Math.max(1, Math.min(4, Math.floor((sr * 1.5) / 13))));
          write(n, rows, sx, sy + 4 - ((rows.length - 1) * 13) / 2, 'leaf');
        } else if (few && sr >= 3) {
          // A picture of a few things names each one, beside it when it is too small to hold its name.
          // As much of it as the room to the right of it holds.
          const rows = lines(n.title, Math.max(8, Math.min(26, Math.floor((W - sx - sr - 10) / 6))), 2);
          write(n, rows, sx + sr + 6, sy + 4 - ((rows.length - 1) * 13) / 2, 'beside');
        } else write(n, [], sx, sy, 'none');
      }
      for (const kid of n.kids) place(kid, shown * open, seen && open > 0.5);
    };
    for (const top of root.kids) place(top, 1, true);

    // A link runs between the nearest things in sight that stand for its ends, so a closed thing gathers the links of its parts.
    const stand = (id) => {
      let n = byId.get(id);
      while (n && !n.seen) n = n.up === root ? undefined : n.up;
      return n;
    };
    const wanted = new Map();
    for (const link of answer.links) {
      const [a, b] = [stand(link.from), stand(link.to)];
      if (!a || !b || a === b) continue;
      // A tie a session drew keeps its own words, so two drawn between the same two things are two lines.
      const key = `${link.kind} ${a.id} ${b.id}${link.says ? ` ${link.says}` : ''}`;
      const line = wanted.get(key) ?? { kind: link.kind, a, b, n: 0, says: link.says };
      line.n += link.n;
      wanted.set(key, line);
    }
    for (const [key, el] of drawn) if (!wanted.has(key)) (el.remove(), el.words?.remove(), drawn.delete(key));
    // Asked to light some things by name, a line stays lit only between two of them.
    const only = Array.isArray(style.only) ? new Set(style.only) : null;
    for (const [key, { kind, a, b, n, says }] of wanted) {
      let el = drawn.get(key);
      if (!el) {
        el = s('line', { class: `ln-line${BLOCKING.includes(kind) ? ' waits' : ''}${says ? ' said' : ''}`, 'marker-end': says ? 'url(#ln-arrow-said)' : BLOCKING.includes(kind) ? 'url(#ln-arrow)' : null }, s('title'));
        // What a session said ties the two is written on the line.
        if (says) el.words = s('text', { class: 'said', 'text-anchor': 'middle' }, document.createTextNode(says.length > 28 ? says.slice(0, 27) + '…' : says));
        drawn.set(key, el);
        lineLayer.append(el, ...(el.words ? [el.words] : []));
      }
      const len = Math.hypot(b.sx - a.sx, b.sy - a.sy) || 1;
      const [ux, uy] = [(b.sx - a.sx) / len, (b.sy - a.sy) / len];
      const lit = only ? (litCount(a, style) && litCount(b, style) ? 0.9 : 0.12) : style.lit === 'you' ? 0.15 : 0.75;
      const shown = len < a.sr + b.sr + 8 ? 0 : lit;
      for (const [k, v] of [['x1', a.sx + ux * (a.sr + 2)], ['y1', a.sy + uy * (a.sr + 2)], ['x2', b.sx - ux * (b.sr + 4)], ['y2', b.sy - uy * (b.sr + 4)], ['opacity', shown]]) el.setAttribute(k, v);
      if (el.words) for (const [k, v] of [['x', (a.sx + ux * a.sr + b.sx - ux * b.sr) / 2], ['y', (a.sy + uy * a.sr + b.sy - uy * b.sr) / 2 - 5], ['opacity', len > a.sr + b.sr + 60 ? shown : 0]]) el.words.setAttribute(k, v);
      el.firstChild.textContent = `${a.title} ${says ?? relations.get(kind)?.title ?? kind} ${b.title}${n > 1 ? `, ${n} times over` : ''}`;
    }

    // Where the picture is: the deepest open thing that holds the middle of it.
    let at = root;
    for (let next; (next = at.kids.find((kid) => kid.opened && Math.hypot(kid.sx - W / 2, kid.sy - H / 2) < kid.sr)); ) at = next;
    if (at !== focus || !trail.firstChild) {
      focus = at;
      const path = [];
      for (let n = at; n !== root; n = n.up) path.unshift(n);
      trail.replaceChildren(...[root, ...path].flatMap((n, i) => [i > 0 && h('span', { class: 'sep' }, '›'), h('button', { class: n === at ? 'here' : '', title: n === root ? 'The whole picture' : n.title, onclick: () => zoomTo(n) }, n === root ? 'All' : n.title)]).filter(Boolean));
      page.hidden = at === root;
      page.onclick = () => (location.hash = `#/e/${at.id}`);
    }
  };

  host.redraw = frame;
  let moving;
  // What was last gone to, until the picture is moved by hand: it is fitted again when the room changes.
  let aim = byId.get(kept.aim) ?? root;
  const zoomTo = (n, glide = true) => {
    aim = n;
    kept.aim = n.id;
    const [from, to, t0] = [{ ...view }, fit(n), performance.now()];
    cancelAnimationFrame(moving);
    if (!glide) return void (Object.assign(view, to), frame());
    const step = (now) => {
      const t = clamp((now - t0) / 600);
      const e = t < 0.5 ? 4 * t ** 3 : 1 - (-2 * t + 2) ** 3 / 2;
      Object.assign(view, { x: from.x + (to.x - from.x) * e, y: from.y + (to.y - from.y) * e, k: from.k * (to.k / from.k) ** e });
      frame();
      if (t < 1 && host.isConnected) moving = requestAnimationFrame(step);
    };
    moving = requestAnimationFrame(step);
  };

  // A press that moves drags the picture; one that does not is a click: into a closed thing, to the page of one that holds nothing, out from the sea.
  svg.addEventListener('pointerdown', (down) => {
    if (down.button !== 0) return;
    svg.setPointerCapture(down.pointerId);
    const from = { ...view };
    const target = down.target;
    let far = false;
    const move = (ev) => {
      // Only the pointer that pressed, and only while it is down.
      if (ev.pointerId !== down.pointerId || !(ev.buttons & 1)) return;
      const [dx, dy] = [ev.clientX - down.clientX, ev.clientY - down.clientY];
      far ||= Math.hypot(dx, dy) > 4;
      if (!far) return;
      cancelAnimationFrame(moving);
      aim = undefined;
      Object.assign(view, { x: from.x - dx / view.k, y: from.y - dy / view.k });
      frame();
    };
    const up = () => {
      svg.removeEventListener('pointermove', move);
      svg.removeEventListener('pointerup', up);
      if (far) return;
      const n = byId.get(target.closest?.('[data-id]')?.dataset.id);
      if (!n) return zoomTo(focus.up ?? root);
      if (!n.kids.length) return void (location.hash = `#/e/${n.id}`);
      if (n.opened && target.closest('text')) return void (location.hash = `#/e/${n.id}`);
      zoomTo(n === focus ? (n.up ?? root) : n);
    };
    svg.addEventListener('pointermove', move);
    svg.addEventListener('pointerup', up);
  });
  // The wheel zooms about the pointer, no further out than the whole picture.
  svg.addEventListener(
    'wheel',
    (ev) => {
      ev.preventDefault();
      cancelAnimationFrame(moving);
      aim = undefined;
      const box = svg.getBoundingClientRect();
      const [px, py] = [ev.clientX - box.left - W / 2, ev.clientY - box.top - H / 2];
      const k = Math.max(fit(root).k * 0.7, Math.min(view.k * Math.exp(-ev.deltaY * 0.0016), 60));
      Object.assign(view, { x: view.x + px / view.k - px / k, y: view.y + py / view.k - py / k, k });
      frame();
    },
    { passive: false },
  );
  // It is drawn to the room it has, and again when that changes.
  let sized = false;
  new ResizeObserver(() => {
    const [w, hgt] = [svg.clientWidth, svg.clientHeight];
    if (!w || !hgt || (w === W && hgt === H && sized)) return;
    [W, H] = [w, hgt];
    sized = true;
    aim ? zoomTo(aim, false) : frame();
  }).observe(svg);
}
/**
 * A style that carries its own code is the drawing: the page runs it in a
 * frame that is sandboxed (an origin of its own, nothing loaded from outside,
 * nothing sent anywhere), hands it the lens answer, the style's fields and the
 * page's colours, and listens for two things: open this item, and what went
 * wrong. A new frame for each picture, so nothing of the last is left running.
 */
function drawCode(host, answer, style, keep) {
  const { code, ...fields } = style;
  const { style: _kept, ...data } = answer;
  const error = h('div', { class: 'lens-error', hidden: true });
  const stage = h('div');
  const colours = () => Object.fromEntries(STYLE_COLORS.map((name) => [name, getComputedStyle(host).getPropertyValue(`--ln-${name}`).trim()]));
  let frame;
  const draw = () => {
    error.hidden = true;
    frame = h('iframe', { class: 'lens-frame', sandbox: 'allow-scripts', src: '/draw.html', title: 'The map, drawn by this style' });
    stage.replaceChildren(frame);
    // A frame that never says it is ready was not let in by the browser: say so, not a blank.
    const mine = frame;
    setTimeout(() => mine === frame && !mine.ready && host.isConnected && ((error.textContent = 'This style has code of its own, and the browser did not start the frame it runs in.'), (error.hidden = false)), 5000);
  };
  const hear = (ev) => {
    if (!host.isConnected) return void (frame && window.removeEventListener('message', hear));
    if (ev.source !== frame?.contentWindow) return;
    const said = ev.data ?? {};
    // The frame has no origin to name, so it is spoken to by its window alone; what goes in is only what it is to draw.
    if (said.type === 'ready') frame.ready = true;
    if (said.type === 'ready') frame.contentWindow.postMessage({ type: 'draw', code, answer: data, style: fields, theme: { ...colours(), dark: matchMedia('(prefers-color-scheme: dark)').matches } }, '*');
    // It may ask for an item's page and nothing else: an id is the only address taken from it.
    else if (said.type === 'open' && /^e_[a-z0-9]{8}$/.test(said.id)) location.hash = `#/e/${said.id}`;
    // The first thing that went wrong is the one to read: what follows is usually its echo.
    else if (said.type === 'error' && error.hidden) ((error.textContent =`This style's code stopped: ${String(said.message).slice(0, 300)}`), (error.title = error.textContent), (error.hidden = false));
  };
  window.addEventListener('message', hear);
  host.replaceChildren(h('div', { class: 'toolbar fold-bar' }, h('span', { class: 'grow' }), litSwitch(answer.viewer, style, (change) => (keep(change), Object.assign(fields, change)), draw)), error, stage);
  draw();
}

/** The colours a grid gives the values of the field it colours by, in the order the field declares them, when the style names none. */
const GRID_HUES = ['#2e7d4f', '#2f5fb3', '#a86a12', '#6f43b0', '#59636e', '#0f7c86', '#b23a48', '#7a6a1c'];
/** A stored value as a person reads it: "set_up" is "Set up". */
const inWords = (value) => (value == null ? 'Unfiled' : String(value).charAt(0).toUpperCase() + String(value).slice(1).replaceAll('_', ' '));

/**
 * A grid: rows are the things the start holds (what is in each, at any depth, is in its row; what the start holds
 * directly is a row of its own), columns are the lanes the lens files by, in the lens's order. Each thing is a card
 * that leads to its page, coloured by one of its shown fields (style.color_by), with a second line from another
 * (style.detail) and a date marked (style.mark). Links are drawn as lines between cards, each numbered, with its
 * words in a key under the grid. Reads only what a lens answers with.
 */
function drawGrid(host, answer, style, keep, kept) {
  const { me, byId, root } = lensTree(answer);
  const start = byId.get(answer.lens.from) ?? root;
  const labels = style.labels && typeof style.labels === 'object' ? style.labels : {};
  const name = (value) => (typeof labels[value] === 'string' ? labels[value] : inWords(value));
  // Rows: each thing the start holds that holds others; then what the start holds directly.
  const groups = start.kids.filter((n) => n.kids.length > 0);
  const loose = start.kids.filter((n) => n.kids.length === 0);
  const under = (n) => n.kids.flatMap((kid) => (kid.kids.length ? under(kid) : [kid]));
  // Rows by a kind of link (style.rows link:<kind>): a row for each thing such links lead to, in the order the tree
  // gives them, a card in it for each thing that links there, with the link's words as its second line. A thing tied
  // to two is in both rows; things of the same kinds tied to none are a last row of their own.
  const byLink = typeof style.rows === 'string' && style.rows.startsWith('link:') ? style.rows.slice(5) : null;
  const order = new Map();
  const walk = (n) => (order.set(n.id, order.size), n.kids.forEach(walk));
  root.kids.forEach(walk);
  const says = new Map();
  let rows;
  if (byLink) {
    const tied = answer.links.filter((link) => link.kind === byLink && byId.has(link.from) && byId.has(link.to));
    const heads = [...new Set(tied.map((link) => link.to))].sort((a, b) => order.get(a) - order.get(b)).map((to) => byId.get(to));
    rows = heads.map((head) => ({
      head,
      cards: tied.filter((link) => link.to === head.id).map((link) => (link.says && says.set(`${head.id} ${link.from}`, link.says), byId.get(link.from))),
    }));
    const kinds = new Set(tied.map((link) => byId.get(link.from).type));
    const untied = [...byId.values()].filter((n) => kinds.has(n.type) && !tied.some((link) => link.from === n.id));
    if (untied.length) rows.push({ head: null, cards: untied });
  } else rows = [...groups.map((g) => ({ head: g, cards: under(g) })), ...(loose.length ? [{ head: null, cards: loose }] : [])];
  // Columns: the lanes in the lens's order, then any value it did not name, then what has none.
  const seen = [...new Set(rows.flatMap((r) => r.cards.map((n) => n.lane ?? null)))];
  const lanes = [...(answer.lanes ?? []), ...seen.filter((v) => v !== null && !(answer.lanes ?? []).includes(v)), ...(seen.includes(null) ? [null] : [])];
  // Colour: by a shown field, in the order its type declares the values; a style may name its own.
  const field = typeof style.color_by === 'string' ? style.color_by : null;
  const declared = field ? [...new Set(answer.items.flatMap((n) => types.get(n.type)?.fields?.[field]?.values ?? []))] : [];
  const palette = style.palette && typeof style.palette === 'object' ? style.palette : {};
  const hue = (value) => {
    const named = palette[value];
    if (typeof named === 'string' && /^#[0-9a-f]{3,8}$/i.test(named)) return named;
    const at = declared.indexOf(value);
    return GRID_HUES[(at < 0 ? declared.length + [...String(value)].length : at) % GRID_HUES.length];
  };
  const detail = typeof style.detail === 'string' ? style.detail : null;
  const markField = typeof style.mark === 'string' ? style.mark : null;
  const day = (value) => new Date(`${value}T12:00:00`).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
  // The links between two cards, numbered in the order the key gives them.
  const cardIds = new Set(rows.flatMap((r) => r.cards.map((n) => n.id)));
  // With rows by a kind of link, a card can stand in several rows: its links are the rows, and no lines are drawn.
  const lines = byLink ? [] : answer.links.filter((link) => cardIds.has(link.from) && cardIds.has(link.to) && link.kind !== answer.lens.by);
  const numbers = new Map();
  lines.forEach((link, i) => {
    for (const end of [link.from, link.to]) numbers.set(end, [...(numbers.get(end) ?? []), i + 1]);
  });

  const cardEls = new Map();
  const card = (n, head) => {
    const value = field ? n.fields?.[field] : undefined;
    const colour = value !== undefined ? hue(value) : 'var(--ln-line)';
    const date = markField && n.fields?.[markField];
    const note = markField && n.fields?.[`${markField}_note`];
    const el = h(
      'a',
      {
        class: `lg-card${litCount(n, style) ? '' : ' dim'}${n.open ? '' : ' closed'}${me && n.state.waits_on.includes(me) ? ' you' : ''}${n.id === style.here ? ' here' : ''}`,
        href: `#/e/${n.id}`,
        title: [n.title, value !== undefined && name(value), n.fields?.[detail], n.status].filter(Boolean).join('\n'),
        style: `--lg-hue: ${colour}`,
      },
      h('span', { class: 'lg-title' }, n.title),
      says.has(`${head?.id} ${n.id}`)
        ? h('span', { class: 'lg-detail', title: says.get(`${head.id} ${n.id}`) }, says.get(`${head.id} ${n.id}`))
        : detail && n.fields?.[detail] && h('span', { class: 'lg-detail' }, String(n.fields[detail])),
      (date || numbers.has(n.id)) &&
        h(
          'span',
          { class: 'lg-marks' },
          date && h('span', { class: 'lg-due', title: `${note ? `${note} ` : ''}${date}` }, `${note ? `${note} ` : ''}${day(date)}`),
          (numbers.get(n.id) ?? []).map((k) => h('span', { class: 'lg-num', title: lines[k - 1].says ?? relations.get(lines[k - 1].kind)?.title ?? lines[k - 1].kind }, String(k))),
        ),
    );
    cardEls.set(n.id, el);
    return el;
  };

  const grid = h('div', { class: 'lg-grid', style: `grid-template-columns: minmax(120px, 0.7fr) repeat(${lanes.length}, minmax(170px, 1fr)); min-width: ${120 + lanes.length * 176}px` });
  grid.append(h('div', { class: 'lg-corner' }), ...lanes.map((lane) => h('div', { class: 'lg-lane' }, name(lane))));
  for (const row of rows) {
    grid.append(
      row.head
        ? h('a', { class: 'lg-row', href: `#/e/${row.head.id}`, title: row.head.title }, row.head.title)
        : byLink
          ? h('div', { class: 'lg-row loose', title: `Tied to nothing by ${relations.get(byLink)?.title ?? byLink}` }, 'Not tied yet')
          : h('div', { class: 'lg-row loose', title: `What ${start.title} holds directly` }, 'Across all'),
    );
    for (const lane of lanes) grid.append(h('div', { class: 'lg-cell' }, row.cards.filter((n) => (n.lane ?? null) === lane).sort((a, b) => a.place - b.place || a.title.localeCompare(b.title)).map((n) => card(n, row.head))));
  }

  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('class', 'lg-lines');
  const stage = h('div', { class: 'lg-stage' }, grid, svg);
  const key = lines.length
    ? h(
        'ol',
        { class: 'lg-key' },
        lines.map((link) =>
          h(
            'li',
            { onmouseenter: () => light(link), onmouseleave: () => light(null) },
            h('span', { class: 'lg-said' }, link.says ?? `${byId.get(link.from).title} ${relations.get(link.kind)?.title ?? link.kind} ${byId.get(link.to).title}`),
            h('span', { class: 'muted small' }, ` ${byId.get(link.from).title} → ${byId.get(link.to).title}`),
          ),
        ),
      )
    : '';
  const legend = field && declared.length ? h('div', { class: 'lg-legend' }, declared.map((value) => h('span', { class: 'lg-swatch', style: `--lg-hue: ${hue(value)}` }, name(value)))) : '';
  const light = (link) => {
    for (const [id, el] of cardEls) el.classList.toggle('lg-off', Boolean(link) && id !== link.from && id !== link.to);
    for (const path of svg.querySelectorAll('g')) path.classList.toggle('lg-on', Boolean(link) && path.dataset.n === String(lines.indexOf(link) + 1));
  };

  // The lines are laid over the grid once it has its size, and again whenever it changes.
  const draw = () => {
    // Measured against the stage's whole scrolled area, so the lines stay on their cards when it scrolls sideways.
    const outer = stage.getBoundingClientRect();
    const box = { left: outer.left - stage.scrollLeft, top: outer.top - stage.scrollTop };
    svg.setAttribute('width', String(stage.scrollWidth));
    svg.setAttribute('height', String(stage.scrollHeight));
    svg.replaceChildren();
    const ns = 'http://www.w3.org/2000/svg';
    const make = (tag, attrs) => {
      const el = document.createElementNS(ns, tag);
      for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, String(v));
      return el;
    };
    const defs = make('defs', {});
    const head = make('marker', { id: 'lg-head', viewBox: '0 0 10 10', refX: 9, refY: 5, markerWidth: 7, markerHeight: 7, orient: 'auto-start-reverse' });
    head.append(make('path', { d: 'M0 0 L10 5 L0 10 z', class: 'lg-arrow' }));
    defs.append(head);
    svg.append(defs);
    lines.forEach((link, i) => {
      const a = cardEls.get(link.from).getBoundingClientRect();
      const b = cardEls.get(link.to).getBoundingClientRect();
      const ax = a.left + a.width / 2 - box.left;
      const ay = a.top + a.height / 2 - box.top;
      const bx = b.left + b.width / 2 - box.left;
      const by = b.top + b.height / 2 - box.top;
      // From the edge of one card to the edge of the other, bowed so lines between neighbours do not lie on each other.
      const edge = (r, x, y, tx, ty) => {
        const dx = tx - x;
        const dy = ty - y;
        const t = Math.min(Math.abs(dx) > 0 ? r.width / 2 / Math.abs(dx) : Infinity, Math.abs(dy) > 0 ? r.height / 2 / Math.abs(dy) : Infinity);
        return [x + dx * Math.min(t, 1), y + dy * Math.min(t, 1)];
      };
      const [sx, sy] = edge(a, ax, ay, bx, by);
      const [ex, ey] = edge(b, bx, by, ax, ay);
      const mx = (sx + ex) / 2 - (ey - sy) * 0.15;
      const my = (sy + ey) / 2 + (ex - sx) * 0.15;
      const g = make('g', { 'data-n': i + 1 });
      const path = make('path', { d: `M ${sx} ${sy} Q ${mx} ${my} ${ex} ${ey}`, class: 'lg-line', 'marker-end': 'url(#lg-head)' });
      const title = make('title', {});
      title.textContent = link.says ?? relations.get(link.kind)?.title ?? link.kind;
      path.append(title);
      const cx = (sx + 2 * mx + ex) / 4;
      const cy = (sy + 2 * my + ey) / 4;
      const dot = make('circle', { cx, cy, r: 9, class: 'lg-dot' });
      const num = make('text', { x: cx, y: cy + 4, class: 'lg-dotnum' });
      num.textContent = String(i + 1);
      g.append(path, dot, num);
      g.addEventListener('mouseenter', () => light(link));
      g.addEventListener('mouseleave', () => light(null));
      svg.append(g);
    });
  };
  host.replaceChildren(stage, legend, key);
  new ResizeObserver(() => requestAnimationFrame(draw)).observe(stage);
  // Opened from an item's page, the picture is brought to that item.
  if (style.here && cardEls.has(style.here)) requestAnimationFrame(() => cardEls.get(style.here).scrollIntoView({ block: 'center', inline: 'center' }));
  host.redraw = () => {
    for (const [id, el] of cardEls) el.classList.toggle('dim', !litCount(byId.get(id), style));
  };
}

const LENS_SHAPES = { nest: drawNest, boxes: drawBoxes, grid: drawGrid };

/**
 * The map as a picture: the lens its address names (what follows a ?), or
 * the whole map as it opens, drawn in the style kept for it.
 */
async function graph(query = '') {
  const { lens, style } = readLens(query);
  const view = lensView({ lens, style });
  // One already there stays until the new one is drawn: the map changing under it does not blank the page.
  if (part('graph').querySelector('.lens-wrap')) await view.ready;
  part('graph').replaceChildren(h('section', { class: 'card lens-card' }, view));
}

// ---- Workspace -----------------------------------------------------------

/** Show a new token's secret once, with a way to copy it. */
function secretBox(label, token) {
  return h(
    'div',
    { class: 'secret' },
    h('div', {}, h('strong', {}, label)),
    h('code', {}, token),
    h('div', { class: 'toolbar' }, h('button', { onclick: (e) => navigator.clipboard.writeText(token).then(() => (e.target.textContent = 'Copied')) }, 'Copy'), h('span', { class: 'muted small' }, 'Shown once. It is not stored and cannot be shown again.')),
  );
}

// Connecting an agent is done once per machine: this server's address and the
// new token go into two environment variables, and every project whose
// .mcp.json reads them is connected. A setting kept inside Claude Code's own
// files can be overwritten by a running session; the machine's environment
// cannot.
function connectBox(made) {
  // One command, copied and run in the project's folder on the machine the agent will work on. It carries the
  // address and the token in, the setup script keeps them for that machine, and the same script sets the project up.
  // The same command the server gives a session whose project is behind (setupCommand in src/connect.ts).
  const fetchIt = `node -e "fetch('${location.origin}/connect/setup.mjs').then(r=>r.text()).then(t=>import('data:text/javascript,'+encodeURIComponent(t)))"`;
  const first = {
    windows: `$env:PELAGO_URL='${location.origin}'; $env:PELAGO_AGENT_TOKEN='${made.token}'; $env:PELAGO_SETUP_SAVE='1'; ${fetchIt}`,
    unix: `PELAGO_URL='${location.origin}' PELAGO_AGENT_TOKEN='${made.token}' PELAGO_SETUP_SAVE=1 ${fetchIt}`,
  };
  const copy = (text, label) => h('button', { class: 'primary', onclick: (e) => navigator.clipboard.writeText(text).then(() => (e.target.textContent = 'Copied')) }, label);
  const box = h('div', { class: 'secret' });
  const draw = (os) =>
    box.replaceChildren(
      h(
        'div',
        { class: 'toolbar' },
        h('strong', { class: 'grow' }, `Connect Claude Code as "${made.name}"`),
        h('span', { class: 'switch', title: 'The machine the agent will work on' }, [['windows', 'Windows'], ['unix', 'Mac or Linux']].map(([key, label]) => h('button', { class: os === key ? 'on' : '', onclick: () => draw(key) }, label))),
      ),
      h('div', { class: 'muted small' }, `1. On that machine, in ${os === 'windows' ? 'PowerShell' : 'a terminal'}, in the project's folder. Then quit Claude Code completely and open it in that folder.`),
      h('code', { style: 'white-space: pre-wrap; word-break: break-all' }, first[os].replace(made.token, `${made.token.slice(0, 12)}…`)),
      h('div', { class: 'toolbar' }, copy(first[os], 'Copy command'), h('span', { class: 'muted small' }, 'Shown once: it holds the token. Revoke it below to disconnect.')),
      h('div', { class: 'muted small', style: 'margin-top: 10px' }, '2. For each other project on that machine, in its folder. It holds no secret.'),
      h('code', { style: 'white-space: pre-wrap; word-break: break-all' }, fetchIt),
      h(
        'div',
        { class: 'toolbar' },
        copy(fetchIt, 'Copy command'),
        // The command fetches a script and runs it: it shows what it will change and asks first. These are the ways
        // to look before that, and to take it out again.
        h('a', { href: '/connect/setup.mjs', target: '_blank', title: 'The script the command fetches and runs. It shows what it will change and asks before it writes.' }, 'Read it first'),
        menu('More', [
          ['Copy the dry run', () => navigator.clipboard.writeText(`${fetchIt} -- --dry-run`)],
          ['Copy the removal', () => navigator.clipboard.writeText(`${fetchIt} -- --remove`)],
        ]),
      ),
    );
  draw(/win/i.test(navigator.platform) ? 'windows' : 'unix');
  return box;
}

/** A chosen file's bytes in base64, which is how a backup file is sent. */
const base64 = (blob) =>
  new Promise((done, fail) => {
    const reader = new FileReader();
    reader.onload = () => done(reader.result.slice(reader.result.indexOf(',') + 1));
    reader.onerror = () => fail(new Error('That file could not be read.'));
    reader.readAsDataURL(blob);
  });

// Bring a map kept somewhere else into this one, as often as wanted: the
// server says what the file would add and change, and does it only on a yes.
function importCard(done) {
  const file = h('input', { type: 'file', accept: '.gz' });
  const result = h('div');
  const say = (cls, text) => result.replaceChildren(h('div', { class: cls, style: 'padding: 0 14px 12px' }, text));
  const list = (titles, n) => (titles.length ? `: ${titles.slice(0, 5).join(', ')}${n > 5 ? ', \u2026' : ''}` : '');
  const start = async () => {
    try {
      if (!file.files[0]) return say('error', 'Choose a backup file first.');
      const backup = await base64(file.files[0]);
      const p = await api('import_backup', { backup });
      const e = p.entities;
      // The file's owner may be this workspace's owner under another id.
      const same_owner =
        Boolean(p.owners) &&
        Boolean(
          await ask({
            title: `Is "${p.owners.file.title}" you?`,
            message: `The backup belongs to "${p.owners.file.title}". This workspace belongs to "${p.owners.here.title}". If they are one person, "${p.owners.here.title}" becomes "${p.owners.file.title}" here, keeping every token and everything private, and later imports of the same map line up.`,
            action: 'Yes, one person',
            cancel: 'No, keep both',
          }),
        );
      const nothing = !e.added && !e.updated && !p.relations.added && !p.relations.ended && !p.events.added && !p.proposals.added && !p.proposals.decided && !p.types_added.length;
      if (nothing && same_owner) {
        await api('import_backup', { backup, apply: true, same_owner });
        file.value = '';
        say('muted small', `"${p.owners.here.title}" and "${p.owners.file.title}" are now one person. Nothing else in the backup was new.`);
        return done?.();
      }
      if (nothing)
        return say('muted small', `Nothing to import: this map already has everything in the backup of "${p.from.name}" taken ${new Date(p.taken).toLocaleString()}.`);
      const message = [
        `From the backup of "${p.from.name}" taken ${new Date(p.taken).toLocaleString()}.`,
        `Added: ${e.added}${list(p.examples.added, e.added)}`,
        `Replaced by the file's later edit: ${e.updated}${list(p.examples.updated, e.updated)}`,
        `Kept, because edited later here: ${e.kept_newer_here}${list(p.examples.kept_newer_here, e.kept_newer_here)}`,
        `Relations: ${p.relations.added} added, ${p.relations.ended} ended. Activity: ${p.events.added} events. Proposals: ${p.proposals.added} added, ${p.proposals.decided} decided.`,
        p.types_added.length ? `Types added: ${p.types_added.join(', ')}` : '',
        p.left_out.open_sessions ? `Left out: ${p.left_out.open_sessions} sessions still open there.` : '',
        'Nothing is deleted. The server backs this map up first.',
      ]
        .filter(Boolean)
        .join('\n');
      if (!(await ask({ title: 'Merge this backup into the map?', message, action: 'Merge' }))) return;
      const r = await api('import_backup', { backup, apply: true, same_owner });
      file.value = '';
      say('muted small', `Merged: ${r.entities.added} added, ${r.entities.updated} replaced, ${r.entities.kept_newer_here} kept as they are here, ${r.events.added} events.${r.backed_up_first ? '' : ' Backups are off on this server, so none was taken first.'}`);
      done?.();
    } catch (err) {
      say('error', err.message);
    }
  };
  return h(
    'section',
    { class: 'card wide' },
    h('header', {}, h('h2', { class: 'hinted', title: 'Merge a map kept elsewhere into this one.' }, 'Import a backup')),
    h('div', { class: 'toolbar', style: 'padding: 0 14px 12px' }, file, h('button', { class: 'primary', onclick: start }, 'Import\u2026')),
    result,
  );
}

// GitHub tells this workspace when a repository is pushed to. The secret it
// signs with is made here and shown once, with where to put it.
function githubCard() {
  const body = h('div', {}, h('div', { class: 'empty' }, 'Loading\u2026'));
  const draw = async (made) => {
    const s = made ?? (await api('github'));
    // The app, where the server can have one: repositories are chosen on GitHub and nothing is set up in them.
    const app = await api('github_app').catch(() => ({ available: false }));
    const go = (what) => () =>
      api('github_app', { [what]: true })
        .then((to) => (location.href = to.url))
        .catch(fail);
    const unhook = async () => {
      if (!(await ask({ title: 'Stop hearing from GitHub?', message: 'Pushes to the repositories chosen there no longer reach this map. The app stays installed on GitHub until it is removed there.', action: 'Disconnect', danger: true }))) return;
      api('github_app', { disconnect: true }).then(() => draw()).catch(fail);
    };
    // What reads the pushes: the agent on this server, once the workspace has given it a key to run on.
    const setKey = async () => {
      const key = await ask({ title: 'Anthropic key', message: 'The agent on this server reads each push against the map, and re-checks old items, on this key. It is kept on the server and never shown again.', input: { placeholder: 'sk-ant-\u2026', secret: true }, action: 'Save' });
      if (key) api('github_app', { key }).then(() => draw()).catch(fail);
    };
    const reading =
      app.available &&
      app.installation &&
      h(
        'div',
        { class: 'toolbar', style: 'padding: 10px 14px 0' },
        h('span', { class: `pill ${app.reader?.key ? 'ok' : 'warn'}`, title: app.reader?.key ? 'An agent on this server reads each push against the open work' : 'Pushes are recorded, but nothing reads them until there is a key' }, app.reader?.key ? 'pushes are read' : 'pushes are not read'),
        h('span', { class: 'grow muted small' }, app.reader?.key ? app.reader.model : ''),
        h('button', { class: app.reader?.key ? '' : 'primary', onclick: setKey }, app.reader?.key ? 'New key' : 'Set Anthropic key'),
        app.reader?.key && menu('More', [['Remove the key', () => api('github_app', { forget_key: true }).then(() => draw()).catch(fail), 'danger']]),
      );
    const appBar =
      app.available &&
      (app.installation
        ? h('div', { class: 'toolbar', style: 'padding: 12px 14px 0' }, h('span', { class: 'pill ok' }, 'connected'), h('span', { class: 'grow' }, app.installation.account || app.app.name), h('button', { title: 'Choose on GitHub which repositories this map hears from', onclick: go('connect') }, 'Choose repositories'), menu('More', [!s.connected && ['Use a webhook as well', () => fresh()], ['Disconnect', unhook, 'danger']]))
        : app.app
          ? h('div', { class: 'toolbar', style: 'padding: 12px 14px 0' }, h('span', { class: 'grow muted' }, app.app.name), h('button', { class: 'primary', title: 'Choose repositories on GitHub; each is put in the map and its pushes are heard', onclick: go('connect') }, 'Connect GitHub'), !s.connected && menu('More', [['Use a webhook instead', () => fresh()]]))
          : app.can_create && h('div', { class: 'toolbar', style: 'padding: 12px 14px 0' }, h('span', { class: 'grow' }), h('button', { class: 'primary', title: 'Once for this server: GitHub asks for a name, and the server then has its app', onclick: go('create') }, 'Create the GitHub App'), !s.connected && menu('More', [['Use a webhook instead', () => fresh()]])));
    const url = location.origin + s.webhook_path;
    const fresh = async () => {
      if (s.connected && !(await ask({ title: 'Make a new secret?', message: 'The one GitHub has now stops working until you replace it in each repository\'s webhook.', action: 'New secret', danger: true }))) return;
      draw(await api('github', { new_secret: true })).catch(fail);
    };
    body.replaceChildren(
      appBar || '',
      reading || '',
      made?.secret
        ? h(
            'div',
            { style: 'padding: 12px 14px 0' },
            h(
              'div',
              { class: 'secret' },
              h('div', {}, h('strong', {}, 'Webhook secret')),
              h('code', {}, made.secret),
              h('div', { class: 'toolbar' }, h('button', { onclick: (e) => navigator.clipboard.writeText(made.secret).then(() => (e.target.textContent = 'Copied')) }, 'Copy'), h('span', { class: 'muted small' }, 'Shown once. If it is lost, make a new one.')),
            ),
            h('div', { class: 'muted small', style: 'margin-top: 8px' }, 'In each repository on GitHub: Settings, Webhooks, Add webhook. Payload URL: ', h('code', {}, url), '. Content type: application/json. Secret: the one above. Events: just the push event.'),
          )
        : '',
      h(
        'ul',
        { class: 'rows' },
        s.repos.map((r) =>
          h(
            'li',
            { class: 'row-top' },
            h('span', { class: 'grow' }, link(r), r.github && [' ', h('span', { class: 'muted small' }, r.github)]),
            h('span', { class: 'muted small' }, !r.github ? 'no GitHub address' : r.last_push ? `pushed ${when(r.last_push.at)}` : 'no push heard yet'),
          ),
        ),
      ),
      (s.connected || !appBar) && h('div', { class: 'toolbar', style: 'padding: 12px 14px' }, s.connected && h('code', { class: 'grow' }, url), h('button', { title: 'A webhook added by hand in each repository, signed with a secret made here', class: s.connected ? '' : 'primary', onclick: fresh }, s.connected ? 'New secret' : 'Connect GitHub')),
      appBar && !s.connected && h('div', { style: 'height: 12px' }),
    );
  };
  const fail = (err) => body.replaceChildren(h('div', { class: 'error' }, err.message));
  draw().catch(fail);
  return h('section', { class: 'card wide' }, h('header', {}, h('h2', { class: 'hinted', title: 'Pushes keep the map current.' }, 'GitHub')), body);
}

// The operator runs the installation: they make workspaces and hand each its
// first sign-in token, and can read none of them. The secret is kept only in
// this page's memory, so it is asked for again after a reload.
let operatorSecret = '';

function operatorCard(current) {
  const body = h('div');
  const call = async (method, payload, path = '') => {
    const res = await fetch(`/operator/workspaces${path}`, {
      method,
      headers: { authorization: `Bearer ${operatorSecret}`, ...(payload && { 'content-type': 'application/json' }) },
      body: payload && JSON.stringify(payload),
    });
    const json = await res.json();
    if (!res.ok) throw new Error(json.error);
    return json.result;
  };
  const draw = async (made) => {
    if (!operatorSecret) {
      const secret = h('input', { type: 'password', placeholder: 'Operator secret', autocomplete: 'off', style: 'flex: 1; min-width: 220px' });
      const error = h('div');
      const open = async () => {
        operatorSecret = secret.value.trim();
        try {
          await draw();
        } catch (err) {
          operatorSecret = '';
          error.replaceChildren(h('div', { class: 'error' }, err.message));
        }
      };
      return body.replaceChildren(
        h('div', { class: 'empty' }, 'Needs the operator secret. ', hint('It was printed the first time the server started with tokens on. If it is lost, run "node src/cli.ts operator-reset" on the server.')),
        h('div', { class: 'toolbar', style: 'padding: 0 14px 12px' }, secret, h('button', { onclick: open }, 'Show workspaces')),
        error,
      );
    }
    const list = await call('GET');
    const id = h('input', { type: 'text', placeholder: 'id, e.g. acme', style: 'flex: 1; min-width: 140px' });
    const name = h('input', { type: 'text', placeholder: 'Name', style: 'flex: 1; min-width: 160px' });
    const error = h('div');
    // With a backup file chosen, the new workspace starts as the map in that file.
    const file = h('input', { type: 'file', accept: '.gz', title: 'Optional: a backup file (.json.gz) to start the workspace from' });
    const create = async () => {
      try {
        const backup = file.files[0] && (await base64(file.files[0]));
        await draw(await call('POST', { id: id.value.trim(), name: name.value.trim(), ...(backup && { backup }) }));
      } catch (err) {
        error.replaceChildren(h('div', { class: 'error' }, err.message));
      }
    };
    body.replaceChildren(
      made?.restored
        ? h('div', { class: 'muted small', style: 'padding: 12px 14px 0' }, `Restored ${made.restored.entities} entities and ${made.restored.events} events from the backup of "${made.restored.from.name}" taken ${new Date(made.restored.taken).toLocaleString()}. Tokens from where it came from do not work here.`)
        : '',
      made ? h('div', { style: 'padding: 12px 14px 0' }, secretBox(`Owner token for "${made.workspace.name}". Send it to its owner privately.`, made.owner_token)) : '',
      h(
        'ul',
        { class: 'rows' },
        list.map((w) =>
          h(
            'li',
            { class: 'row-top' },
            h('strong', {}, w.name),
            h('span', { class: 'grow muted' }, w.id),
            w.id === current && h('span', { class: 'pill ok' }, 'this one'),
            h(
              'button',
              {
                title: 'For an owner who has lost theirs',
                onclick: async () =>
                  (await ask({ title: `Issue a new owner token for "${w.name}"?`, message: 'It gives full control of that workspace. Tokens already issued keep working until its owner revokes them.', action: 'Issue token' })) &&
                  call('POST', {}, `/${encodeURIComponent(w.id)}/owner-token`)
                    .then((r) => draw(r))
                    .catch((err) => error.replaceChildren(h('div', { class: 'error' }, err.message))),
              },
              'New owner token',
            ),
          ),
        ),
      ),
      h('div', { class: 'toolbar', style: 'padding: 12px 14px 0' }, id, name, h('button', { class: 'primary', onclick: create }, 'Create workspace'), h('button', { onclick: () => ((operatorSecret = ''), draw()) }, 'Forget secret')),
      h('label', { class: 'toolbar muted small', style: 'padding: 8px 14px 12px' }, 'From a backup file (optional):', file),
      error,
    );
  };
  draw().catch((err) => {
    operatorSecret = '';
    body.replaceChildren(h('div', { class: 'error' }, err.message));
  });
  return h('section', { class: 'card wide' }, h('header', {}, h('h2', { class: 'hinted', title: 'Every workspace on this server. For whoever runs it.' }, 'Installation')), body);
}

// Whose workspace this is. "Needs you now" and the other standing questions
// are asked about the owner, so a new workspace is not much use until one is set.
function ownerCard(owner, redraw) {
  const name = h('input', { type: 'text', placeholder: 'Your name', style: 'flex: 1; min-width: 180px' });
  const email = h('input', { type: 'text', placeholder: 'Email (optional)', style: 'flex: 1; min-width: 180px' });
  const error = h('div');
  const set = () =>
    name.value.trim() &&
    api('init', { name: name.value.trim(), email: email.value.trim() || undefined })
      .then(redraw)
      .catch((err) => error.replaceChildren(h('div', { class: 'error' }, err.message)));
  return h(
    'section',
    { class: 'card wide' },
    h('header', {}, h('h2', {}, 'Owner')),
    owner
      ? h('ul', { class: 'rows' }, h('li', { class: 'row-top' }, chip('person'), h('span', { class: 'grow' }, link(owner))))
      : [h('div', { class: 'empty' }, 'No owner yet. ', hint('Enter your name to become it; a person is created for you in the map.')), h('div', { class: 'toolbar', style: 'padding: 0 14px 12px' }, name, email, h('button', { class: 'primary', onclick: set }, 'Set owner')), error],
  );
}

async function workspace() {
  const main = part('workspace');
  const me = await (await fetch('/whoami', { headers: authHeaders() })).json();
  const head = h('div', { class: 'page-head' }, h('h1', {}, 'Workspace'), h('p', { class: 'muted' }, me.workspace.name));
  if (me.auth !== 'tokens') {
    const { owner } = await api('workspace_info');
    return main.replaceChildren(
      head,
      h('div', { class: 'grid', style: 'margin-bottom: 14px' }, costsCard(), ownerCard(owner, workspace)),
      h(
        'section',
        { class: 'card' },
        h(
          'div',
          { class: 'empty' },
          h('strong', {}, 'Single user'), h('span', { class: 'muted', title: 'One workspace, no sign-in; everything done here is done as its owner. To share it, set "auth": "tokens" in pelago.config.json and restart: the first start prints your token.' }, ' \u00b7 no sign-in on this server'),
        ),
      ),
    );
  }
  const [info, tokens, people] = await Promise.all([api('workspace_info'), api('token_list'), api('search', { type: 'person', limit: 200 })]);
  const personName = (id) => people.find((p) => p.id === id)?.title;
  const notice = h('div');
  const fail = (err) => notice.replaceChildren(h('div', { class: 'error', style: 'padding: 10px 14px' }, err.message));
  const live = tokens.filter((t) => !t.revoked_at);

  const tokenRow = (t) =>
    h(
      'li',
      {},
      h(
        'div',
        { class: 'row-top' },
        h('span', { class: 'chip' }, t.kind),
        h('span', { class: 'grow' }, h('strong', {}, t.name), t.admin && [' ', h('span', { class: 'pill' }, 'admin')], t.id === me.actor.token && [' ', h('span', { class: 'pill ok' }, 'this session')], t.repos?.length && [' ', h('span', { class: 'pill', title: `It can change only the work of: ${t.repos.map((id) => named(id)).join(', ')}` }, `${t.repos.length === 1 ? named(t.repos[0]) : `${t.repos.length} repositories`} only`)]),
        t.kind === 'agent' && h('span', { class: 'muted small', title: [t.last_used ? `Last used ${when(t.last_used)}` : 'Never used', t.seen?.length ? `from ${t.seen.length} place${t.seen.length === 1 ? '' : 's'}: ${t.seen.join(', ')}` : ''].filter(Boolean).join(', ') }, t.expires_at ? `expires ${when(t.expires_at)}` : 'never expires'),
        h(
          'button',
          {
            class: 'danger',
            disabled: t.id === me.actor.token,
            title: t.id === me.actor.token ? 'This is the token you are signed in with' : '',
            onclick: async () => (await ask({ title: `Revoke the token "${t.name}"?`, message: 'Whoever uses it is signed out at once.', action: 'Revoke', danger: true })) && api('token_revoke', { id: t.id }).then(workspace, fail),
          },
          'Revoke',
        ),
      ),
      h('div', { class: 'row-sub' }, t.entity_id && `${personName(t.entity_id) ?? t.entity_id} · `, `${t.hint} · `, t.last_used ? ['used ', ago(t.last_used)] : 'never used', t.expires_at && ` · expires ${when(t.expires_at)}`),
    );

  const agentName = h('input', { type: 'text', placeholder: 'Name (claude-code)', style: 'flex: 1; min-width: 180px' });
  // A new agent token ends by itself unless it is said not to, and can be held to the repositories it is for.
  const agentLife = h('select', { title: 'When the token stops working by itself' }, [[90, '90 days'], [30, '30 days'], [365, 'A year'], [0, 'Never expires']].map(([days, label]) => h('option', { value: days }, label)));
  const repoList = await api('search', { type: 'software.repo', limit: 100 }).catch(() => []);
  for (const r of repoList) titles.set(r.id, r.title);
  const agentRepos = new Set();
  const limitLabel = h('summary', { title: 'What the token may change. Limited, it reads the map as you do and changes only those repositories\u2019 work.' }, 'Any repository');
  const agentLimit =
    repoList.length > 0 &&
    h(
      'details',
      { class: 'menu' },
      limitLabel,
      h(
        'div',
        { class: 'menu-items' },
        repoList.map((r) =>
          h('label', { style: 'display: flex; gap: 8px; padding: 5px 12px; white-space: nowrap; cursor: pointer' }, h('input', { type: 'checkbox', onchange: (ev) => (ev.target.checked ? agentRepos.add(r.id) : agentRepos.delete(r.id), (limitLabel.textContent = agentRepos.size ? `${agentRepos.size} repositor${agentRepos.size === 1 ? 'y' : 'ies'} only` : 'Any repository')) }), r.title),
        ),
      ),
    );
  const agentToken = (fallback) => ({ kind: 'agent', name: agentName.value.trim() || fallback, ...(Number(agentLife.value) > 0 && { expires_days: Number(agentLife.value) }), ...(agentRepos.size > 0 && { repos: [...agentRepos] }) });
  const memberName = h('input', { type: 'text', placeholder: 'Name', style: 'flex: 1; min-width: 160px' });
  const memberEmail = h('input', { type: 'text', placeholder: 'Email (optional)', style: 'flex: 1; min-width: 160px' });
  const memberAdmin = h('input', { type: 'checkbox' });
  const accepts = h('input', { type: 'text', value: info.accepts_from.join(', '), placeholder: 'workspace ids, separated by commas', style: 'flex: 1; min-width: 220px' });

  main.replaceChildren(
    head,
    notice,
    h(
      'div',
      { class: 'grid' },
      costsCard(),
      (me.actor.admin || !info.owner) && ownerCard(info.owner, workspace),
      h(
        'section',
        { class: 'card wide' },
        h('header', {}, h('h2', { class: 'hinted', title: 'An agent with one of these acts for you: it sees what you see and proposes to you.' }, 'Agent tokens')),
        h('ul', { class: 'rows' }, live.filter((t) => t.kind === 'agent').map(tokenRow)),
        h(
          'div',
          { class: 'toolbar', style: 'padding: 12px 14px' },
          agentName,
          agentLimit,
          agentLife,
          h(
            'button',
            {
              class: 'primary',
              onclick: () =>
                api('token_create', agentToken('claude-code'))
                  .then((made) => workspace().then(() => main.children[1].replaceChildren(connectBox(made))))
                  .catch(fail),
            },
            'Connect an agent',
          ),
          h(
            'button',
            {
              title: 'For an agent that is not Claude Code: the bare token, to send as Authorization: Bearer',
              onclick: () =>
                api('token_create', agentToken('agent'))
                  .then((made) => workspace().then(() => main.children[1].replaceChildren(secretBox(`Token for ${made.name}`, made.token))))
                  .catch(fail),
            },
            'Token only',
          ),
        ),
      ),
      me.actor.admin &&
        h(
          'section',
          { class: 'card wide' },
          h('header', {}, h('h2', { class: 'hinted', title: 'People who can sign in to this workspace.' }, 'Members')),
          h('ul', { class: 'rows' }, live.filter((t) => t.kind === 'human').map(tokenRow)),
          h(
            'div',
            { class: 'toolbar', style: 'padding: 12px 14px' },
            memberName,
            memberEmail,
            h('label', {}, memberAdmin, ' Admin'),
            h(
              'button',
              {
                class: 'primary',
                onclick: () =>
                  api('member_add', { name: memberName.value.trim(), email: memberEmail.value.trim() || undefined, admin: memberAdmin.checked })
                    .then((made) => workspace().then(() => main.children[1].replaceChildren(secretBox(`Sign-in token for ${memberName.value.trim()}. Send it to them privately.`, made.token))))
                    .catch(fail),
              },
              'Add member',
            ),
          ),
        ),
      me.actor.admin &&
        h(
          'section',
          { class: 'card wide' },
          h('header', {}, h('h2', {}, 'Settings')),
          h(
            'dl',
            { class: 'fields' },
            h('dt', {}, 'New things are'),
            h(
              'dd',
              {},
              h(
                'select',
                { onchange: (e) => api('workspace_set', { default_visibility: e.target.value }).then(workspace, fail) },
                [['private', 'Private to their author unless shared'], ['shared', 'Shared with everyone unless made private']].map(([v, label]) => h('option', { value: v, selected: v === info.default_visibility }, label)),
              ),
            ),
            h('dt', {}, 'What agents change'),
            h(
              'dd',
              {},
              h(
                'select',
                { onchange: (e) => api('workspace_set', { agent_changes: e.target.value }).then(workspace, fail) },
                [['hold', 'Is held until I have looked'], ['apply', 'Takes effect as they make it']].map(([v, label]) => h('option', { value: v, selected: v === info.agent_changes }, label)),
              ),
              hint('Either way every change is in the log with who made it and why, and can be undone. Held, the answer to a decision or a hypothesis waits for you too. Taking effect, an agent can settle one: it has to say what was chosen and why, and you are notified on Home.'),
            ),
            h('dt', {}, 'Accept notifications from'),
            h(
              'dd',
              {},
              h(
                'div',
                { class: 'toolbar' },
                accepts,
                h('button', { onclick: () => api('workspace_set', { accepts_from: accepts.value.split(',').map((s) => s.trim()).filter(Boolean) }).then(workspace, fail) }, 'Save'),
              ),
              hint(`Other workspaces on this server that may send this one notifications. This workspace's id is "${info.id}".`),
            ),
          ),
        ),
      me.actor.admin && githubCard(),
      me.actor.admin && importCard(),
      operatorCard(info.id),
    ),
  );
}

// ---- Activity ------------------------------------------------------------

// On whose authority a change was made, as the log has it.
function authorityText(a) {
  if (!a) return '';
  if (a.of === 'agent') return `on the agent's own judgment${a.basis ? `: ${a.basis}` : ''}`;
  return a.stated_by ? `on a human's word, as ${a.stated_by} reports it: ${a.basis}` : `on the authority of ${a.who}`;
}

function describeEvent(ev) {
  const d = ev.detail ?? {};
  if (ev.origin === 'external') return `${d.ok === false ? 'failed' : 'ok'}${d.durationMs != null ? ` in ${d.durationMs} ms` : ''}`;
  const short = (v) => (v == null ? 'none' : String(typeof v === 'object' ? JSON.stringify(v) : v).replaceAll('\n', ' ').slice(0, 80));
  // A rewritten note is said to be rewritten; printing both versions is what made a row a paragraph.
  if (ev.action === 'entity.update')
    return (
      Object.entries(d.changes ?? {})
        .map(([k, c]) => (k === 'body' ? 'notes rewritten' : `${k.replace(/^props./, '')}: ${short(c.from)} → ${short(c.to)}`))
        .join('; ') || 'checked: still true as written'
    );
  if (ev.action === 'changeset.undo') return `undid ${d.undoes}${d.skipped?.length ? `, ${d.skipped.length} left alone` : ''}`;
  if (ev.action === 'relation.link' || ev.action === 'relation.unlink') return `${relations.get(d.type)?.title ?? d.type} ${named(d.to)}`;
  if (ev.action === 'entity.create') return `${typeTitle(d.type)}, ${d.status ?? ''}`;
  if (ev.action === 'proposal.supersede') return `${d.proposal} asked only for what ${d.by} had already made so`;
  if (ev.action.startsWith('proposal.')) return `${d.proposal}${d.revised ? ', with corrections' : ''}`;
  if (ev.action === 'connection.check') return `${d.from} → ${d.to}`;
  if (ev.action.startsWith('resource.')) return d.holder_title ?? d.holder ?? '';
  return '';
}

/** The whole record, or one strand of it, as lines into `list`. */
async function drawTimeline(list, origin, notes = [], read, seen) {
  const again = () => drawTimeline(list, origin, notes, read, seen);
  const events = await api('events', { limit: 500, origin: origin || undefined });
  const undoneSets = new Set(events.filter((e) => e.action === 'changeset.undo').map((e) => e.detail?.undoes));
  const undo = async (g) => {
    if (!(await ask({ title: 'Undo this change set?', message: 'The opposite is applied as a new change; nothing is erased from the log.', action: 'Undo' }))) return;
    try {
      const r = await api('undo', { changeset: g.changeset });
      if (r.skipped.length) await tell('Undone, except:', `- ${r.skipped.join('\n- ')}`);
      again();
    } catch (err) {
      tell('That was not undone', err.message);
    }
  };
  // Fold each changeset into one line: one decision, many effects.
  const groups = [];
  for (const ev of events) {
    const last = groups.at(-1);
    if (ev.changeset && last?.changeset === ev.changeset) last.events.push(ev);
    else groups.push({ changeset: ev.changeset, events: [ev] });
  }
  const needs = attentionOf(notes, events);
  // What an agent did by itself since the owner last looked is marked: not what a human applied, nor a session keeping its own record.
  const seenUpto = events.find((e) => e.action === 'changes.seen')?.detail?.upto ?? 0;
  const fresh = (g) => g.events.some((e) => e.seq > seenUpto) && g.events.every((e) => e.actor.startsWith('agent:') && !e.detail?.approved_by) && !g.events.every((e) => (e.target_type ?? 'sys.').startsWith('sys.')) && !undoneSets.has(g.changeset);
  const unseen = origin ? [] : groups.filter((g) => g.changeset && fresh(g));
  const marked = new Set(unseen.map((g) => g.changeset));
  list.replaceChildren(
    ...needs.loose.map((n) => noticeLine(n, read)),
    ...groups.flatMap((g) => (g.changeset ? changeRow(g, { undone: undoneSets.has(g.changeset), onUndo: undo, attention: needs.sets.get(g.changeset), onRead: read, fresh: marked.has(g.changeset) }) : g.events.map(eventLine))),
  );
  if (seen) {
    seen.hidden = !unseen.length && !notes.length;
    seen.textContent = unseen.length ? `Mark ${unseen.length} seen` : 'Mark all seen';
    seen.onclick = () => api('seen', { upto: events[0].seq }).then(() => read?.([...notes])).then(review, (err) => tell('That was not recorded', err.message));
  }
  if (!events.length) list.replaceChildren(h('div', { class: 'empty' }, 'Nothing here.'));
}

/** The old address of the record: it lives on Changes now. */
function activity() {
  reviewState.origin = '';
  location.hash = '#/review';
}

// ---- Gate ----------------------------------------------------------------

// Which streams are unfolded, which unsorted items are ticked, and which gates show all of what is unsorted.
const gateOpen = new Set();
const gateTicked = new Set();
const gateAll = new Set();

/**
 * An event as a gate, on the event's own page: what is not yet sorted (to be
 * put behind the gate or let follow), what holds it by stream, and what can
 * follow. Nothing, for an event that waits for nothing.
 */
async function gate(eventId) {
  const main = document.getElementById('gate');
  if (main?.dataset.root !== eventId) return;
  const data = await api('view', { name: 'gate', params: { event: eventId } });
  if (!main.isConnected) return;
  const { counts } = data;
  if (!counts.holding && !counts.to_sort && !counts.can_follow && !data.proof) return main.replaceChildren();
  const change = async (ops, reason) => {
    try {
      await api('change', { ops, reason });
      gate(eventId);
    } catch (err) {
      tell('That change was not made', err.message);
    }
  };
  const hold = (ids) => change(ids.map((id) => ({ op: 'link', type: 'depends_on', from: eventId, to: id })), 'Put behind the gate in the UI');
  const defer = (ids) => change(ids.map((id) => ({ op: 'link', type: 'defers', from: eventId, to: id })), 'Left to follow the event in the UI');
  /** From one side of the gate to the other. */
  const across = (x, to) => change([{ op: 'unlink', relation: x.relation }, { op: 'link', type: to, from: eventId, to: x.id }], to === 'defers' ? 'Left to follow the event in the UI' : 'Put behind the gate in the UI');
  const names = (list) => list.map((x) => x.title).join('\n');

  const unsorted = data.to_sort;
  for (const id of [...gateTicked]) if (!unsorted.some((x) => x.id === id)) gateTicked.delete(id);
  const chosen = () => (gateTicked.size ? unsorted.filter((x) => gateTicked.has(x.id)) : unsorted).map((x) => x.id);
  const holdAll = h('button', { title: 'The event waits for these', onclick: () => hold(chosen()) });
  const deferAll = h('button', { title: 'The event goes ahead without these', onclick: () => defer(chosen()) });
  const label = () => {
    const n = gateTicked.size;
    holdAll.textContent = n ? `${n} hold it` : 'All hold it';
    deferAll.textContent = n ? `${n} can follow` : 'All can follow';
  };
  label();
  const FIRST = 8;
  const whole = gateAll.has(eventId);
  const sortRow = (x) =>
    h(
      'li',
      { class: 'row-top' },
      h('input', { type: 'checkbox', title: 'Sort several at once', checked: gateTicked.has(x.id), onchange: (ev) => ((ev.target.checked ? gateTicked.add(x.id) : gateTicked.delete(x.id)), label()) }),
      chip(x.type),
      h('span', { class: 'grow', title: x.title }, link(x)),
      x.stream && h('span', { class: 'chip stream', title: `Part of ${x.stream.title}` }, x.stream.title),
      h('button', { title: 'The event waits for this', onclick: () => hold([x.id]) }, 'Holds it'),
      h('button', { title: 'The event goes ahead without this', onclick: () => defer([x.id]) }, 'Can follow'),
    );
  const heldRow = (x) =>
    h(
      'li',
      { class: 'row-top' },
      chip(x.type),
      h('span', { class: 'grow', title: x.title }, link(x)),
      x.yours && h('span', { class: 'pill warn', title: x.waiting_on.length ? `Waits on:\n${names(x.waiting_on)}` : 'Yours to answer' }, 'yours'),
      x.blocked && !x.yours && h('span', { class: 'pill bad', title: `Waits on:\n${names(x.waiting_on)}` }, 'blocked'),
      pill(x.type, x.status),
      x.relation && h('button', { class: 'quiet', title: 'The event goes ahead without this', onclick: () => across(x, 'defers') }, 'Can follow'),
    );
  // How we know: the questions asked of what this ships, answered or not on the build that is released.
  const asked = data.proof;
  const unanswered = asked ? asked.counts.questions - asked.counts.answered : 0;
  const proofRow =
    asked &&
    h(
      'li',
      {},
      h(
        'details',
        { open: gateOpen.has(`${eventId}:proof`), ontoggle: (ev) => (ev.target.open ? gateOpen.add(`${eventId}:proof`) : gateOpen.delete(`${eventId}:proof`)) },
        h(
          'summary',
          {},
          h('span', { class: 'grow' }, 'How we know'),
          asked.build && h('span', { class: 'chip', title: asked.named ? 'The build this release names as its version' : 'The release names no version: this is the build last reported' }, asked.build),
          unanswered > 0 ? h('span', { class: 'pill warn' }, `${unanswered} unanswered`) : h('span', { class: 'pill ok' }, 'answered'),
          h('span', { class: 'progress', title: `${asked.counts.answered} of ${asked.counts.questions} questions answered` }, h('span', { class: 'bar' }, h('span', { style: `width: ${Math.round((asked.counts.answered / asked.counts.questions) * 100)}%` })), h('span', { class: 'muted small' }, `${asked.counts.answered}/${asked.counts.questions}`)),
        ),
        h(
          'ul',
          { class: 'rows work' },
          asked.questions.map((q) =>
            h('li', { class: 'row-top' }, chip(q.type), h('span', { class: 'grow', title: q.title }, link(q)), q.answered ? h('span', { class: 'pill ok' }, 'answered') : q.total ? h('span', { class: `pill ${q.failed ? 'bad' : 'warn'}` }, `${q.passed}/${q.total} passed`) : h('span', { class: 'pill closed' }, 'no tests')),
          ),
        ),
      ),
    );
  const stream = (s) => {
    const key = `${eventId}:${s.id}`;
    const open = s.items.filter((x) => !x.done);
    const closed = s.items.length - open.length;
    return h(
      'li',
      {},
      h(
        'details',
        { open: gateOpen.has(key), ontoggle: (ev) => (ev.target.open ? gateOpen.add(key) : gateOpen.delete(key)) },
        h(
          'summary',
          {},
          h('span', { class: 'grow', title: s.title ?? '' }, s.id ? link(s) : h('span', { class: 'muted' }, 'On its own')),
          s.yours > 0 && h('span', { class: 'pill warn' }, `${s.yours} yours`),
          !open.length && h('span', { class: 'pill ok' }, 'clear'),
          progressBar(s.progress),
          s.relation && h('button', { class: 'quiet', title: 'The event goes ahead without all of this', onclick: (ev) => (ev.preventDefault(), across(s, 'defers')) }, 'Can follow'),
        ),
        h('ul', { class: 'rows work' }, open.map(heldRow), closed > 0 && h('li', { class: 'row-top muted small', title: names(s.items.filter((x) => x.done)) }, `${closed} done`)),
      ),
    );
  };

  main.replaceChildren(
    h(
      'div',
      { class: 'grid gated', style: 'margin-bottom: 14px' },
      unsorted.length > 0 &&
        h(
          'section',
          { class: 'card wide' },
          h('header', { class: 'bar' }, h('h2', { title: 'Open work under what this ships, not yet put behind the gate or left to follow' }, 'To sort'), h('span', { class: 'n' }, unsorted.length), h('span', { class: 'grow' }), holdAll, deferAll),
          h(
            'ul',
            { class: 'rows' },
            (whole ? unsorted : unsorted.slice(0, FIRST)).map(sortRow),
            unsorted.length > FIRST && h('li', { class: 'more' }, h('button', { class: 'quiet', onclick: () => ((whole ? gateAll.delete(eventId) : gateAll.add(eventId)), gate(eventId)) }, whole ? 'fewer' : `${unsorted.length - FIRST} more`)),
          ),
        ),
      (counts.holding > 0 || asked) &&
        h(
          'section',
          { class: 'card wide' },
          h(
            'header',
            { class: 'bar' },
            h('h2', { title: 'What the event waits for, by the feature or project it is part of' }, 'Holds it'),
            progressBar({ done: counts.holding - counts.open, total: counts.holding }),
            counts.open > 0 && h('span', { class: 'pill' }, `${counts.open} open`),
            counts.yours > 0 && h('span', { class: 'pill warn' }, `${counts.yours} yours`),
            unanswered > 0 && h('span', { class: 'pill warn', title: 'Proof questions not answered on the build' }, `${unanswered} unanswered`),
            data.clear && h('span', { class: 'pill ok' }, 'clear to go'),
          ),
          h('ul', { class: 'tree top' }, proofRow, data.streams.map(stream)),
        ),
      data.can_follow.length > 0 &&
        h(
          'details',
          { class: 'card wide fold', open: unfolded.get(`${eventId}:follow`) ?? false, ontoggle: (ev) => unfolded.set(`${eventId}:follow`, ev.target.open) },
          h('summary', {}, h('h2', { title: 'What the event goes ahead without' }, 'Can follow'), h('span', { class: 'n' }, data.can_follow.length)),
          h('ul', { class: 'rows' }, data.can_follow.map((x) => h('li', { class: `row-top${x.open ? '' : ' finished'}` }, chip(x.type), h('span', { class: 'grow', title: x.title }, link(x)), pill(x.type, x.status), h('button', { class: 'quiet', title: 'The event waits for this after all', onclick: () => across(x, 'depends_on') }, 'Holds it')))),
        ),
    ),
  );
}

// ---- Costs ---------------------------------------------------------------

/** What the work costs over thirty days: each regular payment and its share, and what agents spent by where they ran. */
function costsCard() {
  const c = card('Costs', { wide: true });
  const money = (n) => `$${n.toFixed(2)}`;
  c.fill(
    api('view', { name: 'costs', params: { days: 30 } }),
    (d) => {
      const paid = d.recurring.items.map((i) =>
        h(
          'li',
          { class: 'row-top' },
          chip(i.type),
          h('span', { class: 'grow', title: i.title }, link(i)),
          i.vendor && h('span', { class: 'muted small' }, i.vendor),
          i.amount === null ? h('span', { class: 'pill warn', title: 'Nobody has said what is paid' }, 'not priced') : h('span', { class: 'muted small', title: `${i.amount} ${i.currency} every ${i.every}` }, i.currency === 'USD' ? `${money(i.per_month)}/mo` : `${i.per_month} ${i.currency}/mo`),
          i.share !== null && i.currency === 'USD' && h('strong', {}, money(i.share)),
        ),
      );
      const spent = d.agents.by.map((s) =>
        h(
          'li',
          { class: 'row-top' },
          h('span', { class: 'chip' }, 'Agents'),
          h('span', { class: 'grow' }, RAN[s.surface] ?? s.surface),
          h('span', { class: 'muted small' }, `${s.runs} run${s.runs === 1 ? '' : 's'} \u00b7 ${tokensText(s.tokens)}`),
          s.unpriced_tokens > 0 && s.cost_usd === 0 ? h('span', { class: 'pill closed', title: 'These runs count tokens and do not say what they cost' }, 'tokens only') : h('strong', {}, money(s.cost_usd)),
        ),
      );
      const node = h(
        'div',
        {},
        h(
          'div',
          { class: 'toolbar fold-bar usage-sums' },
          h('span', { class: 'fact', title: 'What a month costs at this rate: the regular payments, and what agents spent scaled to a month' }, h('span', { class: 'muted' }, 'a month '), h('strong', {}, money(d.per_month))),
          h('span', { class: 'fact', title: 'Paid to run agents through the API, where a run says what it cost' }, h('span', { class: 'muted' }, 'agents '), h('strong', {}, money(d.agents.cost_usd))),
          h('span', { class: 'fact', title: 'Hosting, subscriptions and the like: their share of these days' }, h('span', { class: 'muted' }, 'regular '), h('strong', {}, money(d.recurring.cost_usd))),
          d.agents.unpriced_tokens > 0 && h('span', { class: 'fact', title: 'Used by runs that count tokens and do not say what they cost, such as a session on a subscription: not in the dollars' }, h('span', { class: 'muted' }, 'not priced '), tokensText(d.agents.unpriced_tokens)),
          h('span', { class: 'grow' }),
          h('a', { class: 'button', href: '#/new/cost', title: 'Hosting, a subscription, a licence, a domain' }, 'Add a cost'),
        ),
        (paid.length > 0 || spent.length > 0) && h('ul', { class: 'rows costs' }, paid, spent),
      );
      return [`${money(d.total_usd)} in ${d.days} days`, node];
    },
    '',
  );
  return c.el;
}

// ---- Proof ---------------------------------------------------------------

// Which questions are unfolded, and which build each page is looking at.
const proofOpen = new Set();
const proofBuild = new Map();
// Pictures already fetched, by result and when it was reported.
const proofPictures = new Map();

/**
 * How we know it is correct, on the page of whatever the questions belong to
 * (a project, a feature, or one question): each question with how many of its
 * tests passed on one build, opening to the tests as pictures. Nothing, where
 * no question has been asked.
 */
async function proofPart(rootId, withLog = false) {
  const main = document.getElementById('proof');
  if (main?.dataset.root !== rootId) return;
  const data = await api('view', { name: 'proof', params: { of: rootId, build: proofBuild.get(rootId) } });
  if (!main.isConnected) return;
  const { counts } = data;
  const log = withLog ? await api('view', { name: 'changelog', params: { of: rootId } }).catch(() => null) : null;
  if (!main.isConnected) return;
  const shown = log?.features ?? [];
  if (!counts.questions && !shown.length) return main.replaceChildren();
  const bar = (done, total) => h('span', { class: 'progress', title: `${done} of ${total} tests passed` }, h('span', { class: 'bar' }, h('span', { style: `width: ${total ? Math.round((done / total) * 100) : 0}%` })), h('span', { class: 'muted small' }, `${done}/${total}`));
  const mark = (t) => {
    const r = t.result;
    const limit = t.tolerance ? `Must be ${t.tolerance}` : '';
    if (r?.passed) return h('span', { class: 'pill ok', title: limit }, r.value ?? 'passed');
    if (r) return h('span', { class: 'pill bad', title: limit }, r.value ?? 'failed');
    if (t.status === 'draft') return h('span', { class: 'pill closed', title: 'Wanted, not yet written' }, 'not written');
    return h('span', { class: 'pill warn', title: t.before ? `Last run on ${t.before.build}: ${t.before.passed ? 'passed' : 'failed'}` : 'Never run' }, 'not run');
  };
  // A picture kept here is asked for with the page's own token, which an image address cannot carry.
  const kept = (r) => {
    const img = h('img', { alt: '' });
    const key = `${r.id}:${r.at}`;
    if (!proofPictures.has(key)) proofPictures.set(key, api('picture', { result: r.id }).then((p) => (p ? `data:${p.content_type};base64,${p.data}` : '')));
    proofPictures.get(key).then((src) => src && (img.src = src), () => {});
    return img;
  };
  const tile = (t) =>
    h(
      'a',
      { class: 'ptile', href: `#/e/${t.id}`, title: [t.title, t.compares, t.environment].filter(Boolean).join('\n') },
      t.result?.stored ? kept(t.result) : t.result?.picture ? h('span', { class: 'shot muted small', title: `In the repository, not sent here: ${t.result.picture}` }, 'on disk') : h('span', { class: 'shot muted small' }, 'no picture'),
      h('span', { class: 'cap' }, t.title),
      mark(t),
    );
  const question = (q) => {
    const key = `${rootId}:${q.id}`;
    return h(
      'li',
      {},
      h(
        'details',
        { open: proofOpen.has(key), ontoggle: (ev) => (ev.target.open ? proofOpen.add(key) : proofOpen.delete(key)) },
        h(
          'summary',
          {},
          h('span', { class: 'grow', title: q.title }, link(q)),
          q.public && h('span', { class: 'chip', title: 'Anyone can see this question, its tests and their results' }, 'public'),
          q.failed > 0 && h('span', { class: 'pill bad' }, `${q.failed} failed`),
          q.not_run > 0 && h('span', { class: 'pill warn' }, `${q.not_run} not run`),
          q.answered && h('span', { class: 'pill ok' }, 'answered'),
          q.total > 0 ? bar(q.passed, q.total) : h('span', { class: 'muted small nowrap' }, 'no tests'),
        ),
        q.total > 0 && h('div', { class: 'ptiles' }, q.tests.map(tile)),
      ),
    );
  };
  const builds = data.builds.length > 1 ? menu(data.build, data.builds.map((b) => [b, () => (proofBuild.set(rootId, b), proofPart(rootId, withLog))])) : data.build && h('span', { class: 'chip', title: 'The build these results are from' }, data.build);
  main.replaceChildren(
    h(
      'div',
      { class: 'grid proofs', style: 'margin-bottom: 14px' },
      counts.questions > 0 &&
      h(
        'section',
        { class: 'card wide' },
        h(
          'header',
          { class: 'bar' },
          h('h2', { title: 'What a user would ask before trusting it, and the tests that answer each' }, 'How we know'),
          builds,
          counts.tests > 0 && bar(counts.passed, counts.tests),
          h('span', { class: `pill${counts.answered === counts.questions ? ' ok' : ''}` }, `${counts.answered}/${counts.questions} answered`),
          counts.failed > 0 && h('span', { class: 'pill bad' }, `${counts.failed} failed`),
          data.to_send?.length > 0 && h('span', { class: 'pill warn', title: `Public results whose picture is still only in its repository:\n${data.to_send.map((p) => p.picture).join('\n')}` }, `${data.to_send.length} picture${data.to_send.length === 1 ? '' : 's'} to send`),
        ),
        h('ul', { class: 'tree top' }, data.proofs.map(question)),
      ),
      shown.length > 0 &&
        h(
          'details',
          { class: 'card wide fold', open: unfolded.get(`${rootId}:changelog`) ?? false, ontoggle: (ev) => unfolded.set(`${rootId}:changelog`, ev.target.open) },
          h('summary', {}, h('h2', { title: 'What is built or shipped; what is only planned is not here' }, 'Changelog'), h('span', { class: 'n' }, shown.length)),
          h(
            'ul',
            { class: 'rows' },
            shown.map((f) =>
              h('li', { class: 'row-top' }, h('span', { class: 'grow', title: f.title }, link(f)), f.release && h('a', { class: 'chip', href: `#/e/${f.release.id}`, title: f.release.title }, f.release.version ?? f.release.title), pill(f.type, f.status), ago(f.at)),
            ),
          ),
        ),
    ),
  );
}

// ---- Projects ------------------------------------------------------------

/** Each project's roadmap tree, by project id. `all` is the project list of the `questions` view. */
async function projectTrees(all) {
  return new Map(await Promise.all(all.map(async (pr) => [pr.id, await api('view', { name: 'tree', params: { root: pr.id, tree: 'software.roadmap' } }).catch(() => null)])));
}

// ---- Roadmap -------------------------------------------------------------

// Which features are unfolded, kept across redraws.
const roadmapOpen = new Set();

function progressBar({ done, total }) {
  if (!total) return h('span', { class: 'muted small nowrap' }, 'no tasks');
  return h('span', { class: 'progress', title: `${done} of ${total} tasks and issues closed` }, h('span', { class: 'bar' }, h('span', { style: `width: ${Math.round((done / total) * 100)}%` })), h('span', { class: 'muted small' }, `${done}/${total}`));
}

const roadmapState = {
  get graph() {
    try {
      return localStorage.getItem('pelago-roadmap-as') !== 'list';
    } catch {
      return true;
    }
  },
  set graph(value) {
    try {
      localStorage.setItem('pelago-roadmap-as', value ? 'graph' : 'list');
    } catch {
      // Without storage the graph is shown each time.
    }
  },
  // Features alone are the overview; their tasks are one tick away.
  work: false,
};

/** Which roadmaps show the whole of what needs the owner. */
const roadmapAll = new Set();

/**
 * What in one project needs the owner: answers to confirm, questions to
 * decide (what holds up the most first), work that is theirs, and what
 * others are waiting on them for. The same list Home shows across every
 * project, here for one. Nothing, when nothing does.
 */
async function projectNeeds(rootId, data, change, redraw) {
  const [pending, asked, needs, mine] = await Promise.all([api('proposals'), api('view', { name: 'questions', params: { project: rootId } }), api('view', { name: 'needs_me' }), api('view', { name: 'blocked_on_me' })]);
  const inside = new Set([rootId]);
  const walk = (b) => {
    inside.add(b.id);
    for (const w of b.work ?? []) inside.add(w.id);
    for (const inner of b.branches ?? []) walk(inner);
  };
  data.branches.forEach(walk);
  for (const w of data.unplaced) inside.add(w.id);
  const questions = asked.open;
  for (const q of questions) inside.add(q.id);
  const byId = new Map(questions.map((q) => [q.id, q]));
  const answerOf = (pr) => (pr.ops.length === 1 && pr.ops[0].op === 'update' && pr.ops[0].status && inside.has(pr.ops[0].id) ? pr.ops[0] : null);
  const answers = pending.filter(answerOf);
  const answered = new Set(answers.map((pr) => answerOf(pr).id));
  const decide = async (pr, yes) => {
    try {
      await api('decide', { proposal: pr.id, approve: yes });
    } catch (err) {
      await tell('That was not done', err.message);
    }
    redraw();
    refreshReviewCount();
  };
  const shown = new Set([...answered, ...questions.map((q) => q.id)]);
  const todo = needs.actionable.filter((e) => inside.has(e.id) && !shown.has(e.id));
  for (const e of todo) shown.add(e.id);
  const holding = mine.filter((r) => inside.has(r.entity.id) && !shown.has(r.entity.id));
  const rows = [
    ...answers.map((pr) => {
      const op = answerOf(pr);
      const e = byId.get(op.id) ?? { id: op.id, title: named(op.id) };
      return h('li', {}, h('div', { class: 'row-top' }, h('span', { class: 'grow', title: pr.reason }, link(e), ' ', h('span', { class: 'arrow' }, '\u2192'), ' ', h('strong', {}, op.props?.outcome ?? op.status)), h('button', { class: 'primary', onclick: () => decide(pr, true) }, 'Confirm'), h('button', { onclick: () => decide(pr, false) }, 'No')));
    }),
    ...questions.filter((q) => !answered.has(q.id)).map((q) => questionItem(q, change, null, true)),
    ...todo.map((e) => h('li', {}, h('div', { class: 'row-top' }, chip(e.type), h('span', { class: 'grow' }, link(e)), e.due && h('span', { class: 'pill warn' }, `due ${e.due}`)))),
    ...holding.map((r) => h('li', {}, h('div', { class: 'row-top' }, chip(r.entity.type), h('span', { class: 'grow' }, link(r.entity)), h('span', { class: 'muted small', title: r.holding_up.map((x) => x.title).join('\n') }, `holds up ${r.holding_up.length}`)))),
  ];
  if (!rows.length) return null;
  const NOW = 5;
  const all = roadmapAll.has(rootId);
  return h(
    'section',
    { class: 'card wide needs' },
    h('header', {}, h('h2', {}, 'Needs you'), h('span', { class: 'n' }, rows.length)),
    h('ul', { class: 'rows' }, all ? rows : rows.slice(0, NOW), rows.length > NOW && h('li', { class: 'more' }, h('button', { class: 'quiet', onclick: () => ((all ? roadmapAll.delete(rootId) : roadmapAll.add(rootId)), redraw()) }, all ? 'fewer' : `${rows.length - NOW} more`))),
  );
}

async function roadmap(rootId) {
  const main = document.getElementById('roadmap');
  // Drawn only on the page of the project it is the roadmap of.
  if (main?.dataset.root !== rootId) return;
  const data = await api('view', { name: 'tree', params: { tree: 'software.roadmap', root: rootId } });
  const change = async (ops, reason) => {
    try {
      await api('change', { ops, reason });
      roadmap(rootId);
    } catch (err) {
      tell('That change was not made', err.message);
    }
  };
  // Moving one feature renumbers its siblings, so the order is always 1, 2, 3.
  const move = (siblings, from, to) => {
    const next = [...siblings];
    next.splice(to, 0, ...next.splice(from, 1));
    change(next.map((b, i) => (b.order === i + 1 ? null : { op: 'update', id: b.id, props: { order: i + 1 } })).filter(Boolean), 'Roadmap order changed in the UI');
  };
  const working = (x) => x.sessions.map((s) => h('a', { class: 'pill ok', href: `#/e/${s.id}`, title: s.title }, 'session open'));
  const workRow = (w) => h('li', { class: `row-top${w.open ? '' : ' finished'}` }, chip(w.type), h('span', { class: 'grow' }, link(w)), w.blocked && h('span', { class: 'pill bad' }, 'blocked'), working(w), pill(w.type, w.status));
  const branch = (b, i, siblings) =>
    h(
      'li',
      { class: b.active ? 'active' : '' },
      h(
        'details',
        { open: roadmapOpen.has(b.id), ontoggle: (e) => (e.target.open ? roadmapOpen.add(b.id) : roadmapOpen.delete(b.id)) },
        h(
          'summary',
          {},
          h('span', { class: 'place muted' }, i + 1),
          h('span', { class: 'grow' }, link(b)),
          b.blocked && h('span', { class: 'pill bad' }, 'blocked'),
          working(b),
          progressBar(b.progress),
          pill(b.type, b.status),
          h('span', { class: 'moves' }, h('button', { title: 'Earlier', disabled: i === 0, onclick: (e) => (e.preventDefault(), move(siblings, i, i - 1)) }, '↑'), h('button', { title: 'Later', disabled: i === siblings.length - 1, onclick: (e) => (e.preventDefault(), move(siblings, i, i + 1)) }, '↓')),
        ),
        b.branches.length > 0 && h('ul', { class: 'tree' }, b.branches.map(branch)),
        b.work.length > 0 && h('ul', { class: 'rows work' }, b.work.map(workRow)),
        !b.branches.length && !b.work.length && h('div', { class: 'empty' }, 'Nothing is part of this feature yet. Open a task and add "is part of" this feature, or move one here from the list below.'),
      ),
    );

  const flat = (bs) => bs.flatMap((b) => [b, ...flat(b.branches)]);
  const features = flat(data.branches);
  const title = h('input', { type: 'text', placeholder: 'A new feature', style: 'flex: 1; min-width: 200px' });
  const add = () =>
    title.value.trim() &&
    change(
      [
        { op: 'create', ref: 'f', type: 'software.feature', title: title.value.trim(), props: { order: data.branches.length + 1 } },
        { op: 'link', type: 'part_of', from: 'f', to: rootId },
      ],
      'Feature added to the roadmap in the UI',
    );
  const statuses = statusesOf('software.feature').filter((st) => data.by_status[st]);
  const asGraph = roadmapState.graph;
  // What the roadmap knows that the graph does not: each feature's progress and place, what is being worked on,
  // and a feature that waits on another only through their tasks.
  const info = new Map([[rootId, { progress: data.progress }]]);
  const featureOf = new Map();
  const learn = (b, i) => {
    info.set(b.id, { progress: b.progress, place: i + 1, active: b.active, sessions: b.sessions });
    featureOf.set(b.id, b.id);
    for (const w of b.work) {
      featureOf.set(w.id, b.id);
      info.set(w.id, { active: w.active, sessions: w.sessions });
    }
    b.branches.forEach(learn);
  };
  data.branches.forEach(learn);
  const through = data.depends
    .map((d) => ({ from: featureOf.get(d.from), to: featureOf.get(d.to), direct: featureOf.get(d.from) === d.from && featureOf.get(d.to) === d.to }))
    .filter((d) => d.from && d.to && d.from !== d.to && !d.direct)
    .map((d) => ({ id: `through:${d.from}:${d.to}`, type: 'depends_on', from: d.from, to: d.to, lifted: true }));
  const inProgress = menu(`${data.now.length} in progress`, data.now.map((n) => [`${n.title}${n.sessions?.length ? '  · session open' : ''}`, () => (location.hash = `#/e/${n.id}`)]));
  inProgress.classList.add('ok');
  const needsYou = await projectNeeds(rootId, data, change, () => roadmap(rootId)).catch(() => null);
  if (!main.isConnected) return;

  main.replaceChildren(
    h(
      'div',
      { class: 'grid' },
      needsYou,
      h(
        'section',
        { class: 'card wide' },
        h(
          'header',
          { class: 'bar' },
          h('h2', {}, 'Features'),
          progressBar(data.progress),
          statuses.map((st) => h('span', { class: `pill${isClosed('software.feature', st) ? ' closed' : ''}` }, `${data.by_status[st]} ${st}`)),
          h('span', { class: 'grow' }),
          // What is being worked on is marked in the drawing; the names are one click away, not a paragraph of links.
          data.now.length > 0 && inProgress,
          h('span', { class: 'switch' }, [['Graph', true], ['List', false]].map(([label, graph]) => h('button', { class: asGraph === graph ? 'on' : '', onclick: () => ((roadmapState.graph = graph), roadmap(rootId)) }, label))),
        ),
        !data.branches.length ? h('div', { class: 'empty' }, 'No features yet.') : asGraph ? graphView({ focus: rootId, defaults: { kind: 'structure', steps: 1 }, extras: { info, edges: through, workOnly: true } }) : h('ul', { class: 'tree top' }, data.branches.map(branch)),
        h('div', { class: 'toolbar', style: 'padding: 12px 14px; border-top: 1px solid var(--line)' }, title, h('button', { class: 'primary', onclick: add }, 'Add feature')),
      ),
      data.unplaced.length > 0 &&
        !asGraph &&
        h(
          'section',
          { class: 'card wide' },
          h('header', {}, h('h2', {}, 'Not under any feature'), h('span', { class: 'n' }, data.unplaced.length)),
          h(
            'ul',
            { class: 'rows' },
            data.unplaced.map((w) =>
              h(
                'li',
                { class: `row-top${w.open ? '' : ' finished'}` },
                chip(w.type),
                h('span', { class: 'grow' }, link(w)),
                working(w),
                pill(w.type, w.status),
                features.length > 0 &&
                  h(
                    'select',
                    { title: 'Make this part of a feature', onchange: (e) => e.target.value && change([{ op: 'link', type: 'part_of', from: w.id, to: e.target.value }], 'Placed under a feature in the UI') },
                    h('option', { value: '' }, 'Move to feature…'),
                    features.map((f) => h('option', { value: f.id }, f.title)),
                  ),
              ),
            ),
          ),
        ),
    ),
  );
}

// ---- Questions -----------------------------------------------------------

const openQuestions = new Set();
const listed = (label, items, extra) => items.length > 0 && h('div', { class: 'row-sub' }, `${label}: `, items.map((x, i) => [i > 0 && ', ', link(x), extra?.(x)]));

function questionItem(q, change, where, plain = false) {
  const closed = types.get(q.type)?.statuses.closed ?? [];
  let answer;
  if (q.kind === 'decision') {
    const outcome = h('input', { type: 'text', placeholder: 'What is decided', style: 'flex: 1; min-width: 220px' });
    const why = h('input', { type: 'text', placeholder: 'Why (optional)', style: 'flex: 1; min-width: 220px' });
    const option = h('input', { type: 'text', placeholder: 'Add an option', class: 'option-new' });
    const picks = h('div', { class: 'toolbar options' });
    const pick = (o, button) => {
      outcome.value = o;
      dirty = true; // a choice not yet confirmed must survive a live update
      for (const b of picks.querySelectorAll('button')) b.classList.toggle('on', b === button);
    };
    picks.append(
      ...q.options.map((o) => {
        const button = h('button', { onclick: () => pick(o, button) }, o);
        return button;
      }),
      option,
    );
    option.addEventListener('keydown', (e) => e.key === 'Enter' && option.value.trim() && change([{ op: 'update', id: q.id, props: { options: [...q.options, option.value.trim()] } }], 'Option added in the UI'));
    const decide = () => {
      if (!outcome.value.trim()) return outcome.focus();
      change([{ op: 'update', id: q.id, status: closed[0], props: { outcome: outcome.value.trim(), rationale: why.value.trim() || null, decided_on: new Date().toISOString().slice(0, 10) } }], 'Decided in the UI');
    };
    answer = [picks, h('div', { class: 'toolbar' }, outcome, why, h('button', { class: 'primary', onclick: decide }, 'Decide'))];
  } else {
    answer = h(
      'div',
      { class: 'toolbar' },
      h('span', { class: 'muted' }, 'It turned out to be'),
      closed.map((st) => h('button', { onclick: async () => (await ask({ title: `Mark this ${st}?`, message: q.title, action: `Mark ${st}` })) && change([{ op: 'update', id: q.id, status: st }], `Marked ${st} in the UI`) }, st)),
    );
  }
  // Asking is not deciding: it leaves the question open and makes a task about
  // it, which any agent listening hears at once.
  const wish = h('input', { type: 'text', placeholder: 'Ask an agent to look into something first', style: 'flex: 1; min-width: 220px' });
  const askAgent = () =>
    wish.value.trim() &&
    change(
      [
        { op: 'create', ref: 'ask', type: 'task', title: wish.value.trim(), body: `Asked by the owner on the question "${q.title}". Write what you find into that question's notes or options, then mark this done.` },
        { op: 'link', type: 'about', from: 'ask', to: q.id },
      ],
      'Asked an agent in the UI',
    );
  wish.addEventListener('keydown', (e) => e.key === 'Enter' && askAgent());
  // Folded to one line until it is to be answered. What is unfolded is kept
  // across redraws, which happen on every change to the map.
  // No preview of the notes: a sentence cut in half says nothing. The title is the question; the rest opens.
  const preview = null;
  const more = h(
    'div',
    { class: 'question-more', hidden: !openQuestions.has(q.id) },
    q.body && renderBody(q.body),
    listed('Waiting on this', q.waiting),
    listed('Rests on this', q.assumed_by),
    listed('Being tested by', q.tests, (x) => ` (${x.status})`),
    listed('Evidence', q.evidence, (x) => ` (${x.says})`),
    listed('Asked of an agent', q.asks, (x) => ` (${x.status})`),
    answer,
    h('div', { class: 'toolbar' }, wish, h('button', { onclick: askAgent }, 'Ask an agent')),
  );
  const toggle = h(
    'button',
    {
      onclick: () => {
        more.hidden = !more.hidden;
        if (more.hidden) openQuestions.delete(q.id);
        else openQuestions.add(q.id);
        if (preview) preview.hidden = !more.hidden;
        toggle.textContent = more.hidden ? 'Answer' : 'Close';
      },
    },
    openQuestions.has(q.id) ? 'Close' : 'Answer',
  );
  return h(
    'li',
    { class: 'question' },
    plain
      ? h('div', { class: 'row-top' }, h('span', { class: 'grow' }, link(q)), q.due && h('span', { class: 'pill warn' }, `due ${q.due}`), q.holds_up > 0 && h('span', { class: 'muted small', title: 'How many things wait on this' }, `holds up ${q.holds_up}`), toggle)
      : h('div', { class: 'row-top' }, chip(q.type), h('strong', { class: 'grow' }, link(q)), where, q.due && h('span', { class: 'pill warn' }, `due ${q.due}`), q.holds_up > 0 && h('span', { class: 'pill bad', title: q.waiting.map((w) => w.title).join('\n') }, `holds up ${q.holds_up}`), toggle),
    preview,
    more,
  );
};

// ---- live updates --------------------------------------------------------

// The server's pulse moves whenever the map or the review queue does. The page
// is drawn again when it moves, unless that would throw away something half
// done (typed text, ticked boxes, an open question, a graph being explored);
// then a notice offers the refresh instead.
let pulse;
let dirty = false;
let uiFiles;
let outdated = false;
const stale = h('div', { id: 'stale', hidden: true }, 'The map has changed.', h('button', { onclick: () => (outdated ? location.reload() : route()) }, 'Refresh'));
document.body.append(stale);
main.addEventListener('input', (e) => {
  if (e.target.tagName !== 'SELECT') dirty = true;
});

// Following: an agent can point this page at what it is working on (the `show`
// tool, and every change it makes). With "Follow agents" on, the page goes
// there; a line at the bottom says who sent it and why. Anything half done on
// the page is kept, and the line offers the jump instead.
const following = {
  get on() {
    try {
      return localStorage.getItem('pelago-follow') !== 'off';
    } catch {
      return true;
    }
  },
  set on(value) {
    try {
      localStorage.setItem('pelago-follow', value ? 'on' : 'off');
    } catch {
      // Without storage the choice lasts until the page is reloaded.
    }
  },
  // Which kinds of step are followed (as it was before there was a choice: what is shown and what is changed), and whose are not.
  list(key, otherwise) {
    try {
      const kept = JSON.parse(localStorage.getItem(`pelago-follow-${key}`));
      return Array.isArray(kept) ? kept : otherwise;
    } catch {
      return otherwise;
    }
  },
  keep(key, list) {
    try {
      localStorage.setItem(`pelago-follow-${key}`, JSON.stringify(list));
    } catch {
      // Without storage the choice lasts until the page is reloaded.
    }
  },
};
/** The kinds of step an agent takes, as the server names them and as a person reads them. */
const STEP_KINDS = [
  ['show', 'What they show you'],
  ['change', 'What they change'],
  ['story', 'The story they tell'],
  ['read', 'What they read'],
  ['view', 'Views and pictures they ask for'],
  ['search', 'What they search for'],
  ['other', 'Sessions and the rest'],
];
const followBox = document.querySelector('#follow input');
followBox.checked = following.on;
followBox.addEventListener('change', () => (following.on = followBox.checked));
const chosen = { kinds: new Set(following.list('kinds', ['show', 'change', 'story'])), muted: new Set(following.list('muted', [])) };
/** The agents heard from while the page is open, with those left out before: each can be left out. */
const heardFrom = new Set(chosen.muted);
function followMenu() {
  const tick = (label, title, on, set) => h('label', { title }, h('input', { type: 'checkbox', checked: on, onchange: (ev) => set(ev.target.checked) }), h('span', {}, label));
  const flip = (key, value) => (yes) => (chosen[key][yes === (key === 'kinds') ? 'add' : 'delete'](value), following.keep(key, [...chosen[key]]));
  document.querySelector('#follow-what > .menu-items').replaceChildren(
    ...STEP_KINDS.map(([kind, label]) => tick(label, label, chosen.kinds.has(kind), flip('kinds', kind))),
    ...(heardFrom.size ? [h('hr')] : []),
    ...[...heardFrom].sort().map((actor) => tick(actor.split('/').at(-1), `Follow ${actor}`, !chosen.muted.has(actor), flip('muted', actor))),
  );
}
followMenu();
// An agent first heard from while the menu was open is in it the next time it opens.
document.getElementById('follow-what').addEventListener('toggle', (ev) => ev.target.open && followMenu());
const followed = h('div', { id: 'followed', hidden: true });
document.body.append(followed);
let seenStep;
let followedTimer;
/** Where each agent that tells a story tells it: following it goes there, not from item to item. */
const storyOf = new Map();

function follow(steps = []) {
  // The first answer only says where things stand; an old step is not followed.
  const fresh = seenStep === undefined ? [] : steps.filter((s) => s.at > seenStep);
  seenStep = steps.at(-1)?.at ?? seenStep ?? 0;
  for (const s of steps) {
    heardFrom.add(s.actor);
    if (s.kind === 'story') storyOf.set(s.actor, s.hash);
  }
  if (!following.on) return;
  const wanted = fresh.filter((s) => chosen.kinds.has(s.kind) && !chosen.muted.has(s.actor));
  // The line says the last thing done; the page goes to the last that has a place. A step may have none: then the page stays.
  const to = wanted.at(-1);
  if (!to) return;
  const place = wanted.findLast((s) => s.hash || storyOf.has(s.actor));
  const there = place && `#/${storyOf.get(place.actor) ?? place.hash}`;
  const busy = dirty || document.querySelector('dialog[open]');
  followed.replaceChildren(
    ...[
      // One line: who, and the first few words of why. The whole reason is on the page it brought you to.
      h('strong', {}, to.actor.split('/').at(-1)),
      h('span', { class: 'grow', title: to.did ?? '' }, to.did ? to.did.split(/(?<=[.:;])\s/)[0] : busy ? 'is working somewhere else' : 'brought you here'),
      busy && there && location.hash !== there && h('button', { onclick: () => ((location.hash = there), (followed.hidden = true)) }, 'Go there'),
      h('button', { title: 'Stop following agents', onclick: () => ((following.on = followBox.checked = false), (followed.hidden = true)) }, 'Stop following'),
    ].filter(Boolean),
  );
  followed.hidden = false;
  clearTimeout(followedTimer);
  followedTimer = setTimeout(() => (followed.hidden = true), 12000);
  if (!busy && there && location.hash !== there) location.hash = there;
}

async function checkPulse() {
  if (document.hidden) return;
  let now;
  try {
    const beat = await api('pulse');
    now = beat.stamp;
    // The page's own files changed on the server: load them, unless that would
    // throw away something half done.
    if (uiFiles !== undefined && beat.ui !== uiFiles) {
      if (!dirty && !document.querySelector('dialog[open]')) return location.reload();
      outdated = true;
      stale.firstChild.textContent = 'Archipelago has been updated.';
      stale.hidden = false;
    }
    uiFiles ??= beat.ui;
    // Whether an agent will hear what is done here the moment it is done.
    const ear = document.getElementById('listening');
    ear.hidden = !beat.listening;
    ear.textContent = beat.listening > 1 ? `${beat.listening} agents are listening` : 'An agent is listening';
    follow(beat.steps);
  } catch {
    return;
  }
  const moved = pulse !== undefined && now !== pulse;
  pulse = now;
  if (!moved) return;
  if (dirty || document.querySelector('dialog[open]') || /^#\/new/.test(location.hash)) {
    refreshReviewCount();
    stale.hidden = false;
    return;
  }
  // Hold the page's height while it is redrawn, so the scroll position stays.
  main.style.minHeight = `${main.offsetHeight}px`;
  await route(true);
  setTimeout(() => (main.style.minHeight = ''), 1000);
}
setInterval(checkPulse, 2000);
document.addEventListener('visibilitychange', checkPulse);

// ---- routing -------------------------------------------------------------

// Each page in the menu is its parts, one under the other. What used to be a
// page of its own (a project's roadmap, the list of automations) is on the
// page of the thing it is about or in the search, and its old address leads
// there. Search is one thing at a time under its search box: the search, an
// item, or a graph.
// ---- Time ------------------------------------------------------------------

// Hours worked, a week at a time: each day with what was done and its total, a line to log more, and beside it what
// is owed: time not yet invoiced, invoices out and late, and drafts. Every entry and invoice is an item; this page
// points at them and writes through the same tools an agent uses.
const timeState = { from: null };
const LAST_WORK = 'pelago-time-work';
const localDay = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const shiftDay = (day, n) => {
  const d = new Date(`${day}T12:00:00`);
  d.setDate(d.getDate() + n);
  return localDay(d);
};
const mondayOf = (day) => shiftDay(day, -((new Date(`${day}T12:00:00`).getDay() + 6) % 7));
const dayName = (day, opts = { weekday: 'short', day: 'numeric', month: 'short' }) => new Date(`${day}T12:00:00`).toLocaleDateString(undefined, opts);
const hoursText = (n) => `${Math.round(n * 100) / 100} h`;
const moneyText = (n, currency = 'CAD') => new Intl.NumberFormat('en-CA', { style: 'currency', currency }).format(Number(n) || 0);
const remember = (key, value) => {
  try {
    if (value === undefined) return JSON.parse(localStorage.getItem(key) ?? 'null');
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Without storage, the last work is forgotten on reload.
  }
  return null;
};

/** A field that finds the work time is for, as it is typed: projects, tasks and clients. */
function workPicker(initial, onPick) {
  let picked = initial ?? null;
  let turn = 0;
  const input = h('input', { type: 'search', class: 'tq-work', placeholder: 'Project or task', value: picked?.title ?? '', title: 'The project, task or client this time was for', autocomplete: 'off' });
  const list = h('div', { class: 'tq-picks', hidden: true });
  const find = async () => {
    const mine = ++turn;
    const q = input.value.trim();
    if (!q) return void (list.hidden = true);
    const hits = (await Promise.all(['project', 'task', 'company'].map((type) => api('search', { q, type, open: true, limit: 6 }).catch(() => [])))).flat();
    if (mine !== turn) return;
    list.replaceChildren(
      ...hits.slice(0, 8).map((x) =>
        h(
          'button',
          {
            type: 'button',
            onmousedown: (ev) => {
              ev.preventDefault();
              picked = { id: x.id, title: x.title };
              input.value = x.title;
              list.hidden = true;
              onPick?.(picked);
            },
          },
          chip(x.type),
          h('span', { class: 'gist' }, x.title),
        ),
      ),
    );
    list.hidden = !hits.length;
  };
  input.oninput = () => ((picked = null), find());
  input.onblur = () => setTimeout(() => (list.hidden = true), 150);
  return { el: h('span', { class: 'tq-picker' }, input, list), get: () => picked };
}

/** Hours since midnight as a time of day: 13.5 is 13:30. */
const clockText = (n) => {
  const m = Math.round(n * 60);
  if (m === 1440) return '24:00';
  return `${String(Math.floor(m / 60) % 24).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
};

/** A moment from a day and the hours since its midnight, as this browser keeps time. */
const atHour = (day, hour) => {
  const d = new Date(`${day}T00:00:00`);
  d.setMinutes(Math.round(hour * 60));
  return d.toISOString();
};

/** Ask what a block drawn on the calendar was for: the work, a few words, and whether it is only planned. */
function blockDialog(when, planned) {
  return new Promise((resolve) => {
    const picker = workPicker(remember(LAST_WORK), (w) => remember(LAST_WORK, w));
    const what = h('input', { type: 'text', maxlength: '60', placeholder: 'What', title: 'A few words: the block’s name', required: true });
    const plan = h('input', { type: 'checkbox', checked: planned });
    const dialog = h(
      'dialog',
      { class: 'ask cal-ask' },
      h(
        'form',
        { method: 'dialog' },
        h('h2', {}, when),
        picker.el,
        what,
        h('label', { class: 'tq-bill', title: 'Time set aside, not yet worked: it counts once you confirm it' }, plan, 'Planned'),
        h('div', { class: 'toolbar' }, h('button', { value: 'cancel', formNoValidate: true }, 'Cancel'), h('button', { value: 'ok', class: 'primary' }, 'Add')),
      ),
    );
    const done = (value) => (dialog.remove(), resolve(value));
    dialog.firstChild.addEventListener('submit', (e) => {
      if (e.submitter?.value !== 'ok') return done(null);
      const work = picker.get();
      if (!work) {
        e.preventDefault();
        return picker.el.querySelector('input').focus();
      }
      done({ work, what: what.value.trim(), planned: plan.checked });
    });
    dialog.addEventListener('cancel', () => done(null));
    document.body.append(dialog);
    dialog.showModal();
    (picker.get() ? what : picker.el.querySelector('input')).focus();
  });
}

/** A moment as this browser's time of day: 09:30. */
const timeOfDay = (iso) => {
  const d = new Date(iso);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
};

/**
 * Ask what planned time actually was, before it counts: the work, a few words, the day and when it began and ended (or
 * its hours, for time planned without a time of day). Resolves to the ops that confirm it so, or null.
 */
function happenedDialog(b) {
  return new Promise((resolve) => {
    const picker = workPicker(b.work_id ? { id: b.work_id, title: b.work } : null);
    const what = h('input', { type: 'text', maxlength: '60', value: b.what, title: 'A few words: the block’s name', required: true });
    const day = h('input', { type: 'date', value: b.date, title: 'The day it happened', required: true });
    const timed = Boolean(b.start && b.end);
    const from = h('input', { type: 'time', step: '300', value: timed ? timeOfDay(b.start) : '', title: 'When it began', required: true });
    const to = h('input', { type: 'time', step: '300', value: timed ? timeOfDay(b.end) : '', title: 'When it ended', required: true });
    const hrs = h('input', { type: 'number', class: 'tq-hours', min: '0.25', max: '24', step: '0.25', value: String(b.hours), title: 'Hours spent', required: true });
    const check = () => to.setCustomValidity(timed && from.value && to.value && to.value <= from.value ? 'It ends before it begins' : '');
    from.oninput = to.oninput = check;
    const dialog = h(
      'dialog',
      { class: 'ask cal-ask' },
      h(
        'form',
        { method: 'dialog' },
        h('h2', {}, 'What happened'),
        picker.el,
        what,
        h('div', { class: 'cal-when' }, day, timed ? [from, h('span', { class: 'muted' }, '–'), to] : hrs),
        h('div', { class: 'toolbar' }, h('button', { value: 'cancel', formNoValidate: true }, 'Cancel'), h('button', { value: 'ok', class: 'primary' }, 'Confirm')),
      ),
    );
    const done = (value) => (dialog.remove(), resolve(value));
    dialog.firstChild.addEventListener('submit', (e) => {
      if (e.submitter?.value !== 'ok') return done(null);
      const work = picker.get();
      if (!work) {
        e.preventDefault();
        return picker.el.querySelector('input').focus();
      }
      const start = timed && new Date(`${day.value}T${from.value}:00`).toISOString();
      const end = timed && new Date(`${day.value}T${to.value}:00`).toISOString();
      const hours = timed ? Math.round(((Date.parse(end) - Date.parse(start)) / 3_600_000) * 100) / 100 : Number(hrs.value);
      const ops = [{ op: 'update', id: b.id, status: 'logged', title: what.value.trim(), props: { date: day.value, hours, ...(timed && { start, end }) } }];
      // Done for other work than was planned: it is moved there.
      if (work.id !== b.work_id) ops.push(...(b.link ? [{ op: 'unlink', relation: b.link }] : []), { op: 'link', type: 'part_of', from: b.id, to: work.id });
      done(ops);
    });
    dialog.addEventListener('cancel', () => done(null));
    document.body.append(dialog);
    dialog.showModal();
    what.focus();
  });
}

/**
 * The week as a calendar: a column for each day, split into the owner's lane and a narrow lane for each agent at work at
 * once; time runs down, and each block is coloured by the project it counts toward. Time logged as hours alone has no
 * place in the day, so it is a strip above it. In the owner's lane a block is drawn by dragging, and moved or stretched
 * the same way; time ahead is planned, and counts only once it is confirmed.
 */
/** The hours and days the calendar opens on; the rest is one toggle away. */
const CAL_HOURS = [6, 22];
const CAL_DAYS = 5;
const CAL_FULL = 'pelago-cal-full';
/** Whether the week has anything outside the hours and days shown by default. */
const calHidden = (wk) =>
  wk.days.some((d, i) => {
    const all = [...d.owner, ...d.agents.flat()];
    if (i >= CAL_DAYS) return all.length > 0;
    return all.some((b) => b.from_hour != null && (b.from_hour < CAL_HOURS[0] || b.to_hour > CAL_HOURS[1]));
  });

function weekCalendar(wk, today, act, full) {
  const hueOf = new Map(wk.projects.map((p, i) => [p.id, GRID_HUES[i % GRID_HUES.length]]));
  const titleOf = new Map(wk.projects.map((p) => [p.id, p.title]));
  // The waking day on weekdays, unless the whole of it is asked for; a block that runs past the edge is cut there.
  const [top, bottom] = full ? [0, 24] : CAL_HOURS;
  const days = full ? wk.days : wk.days.slice(0, CAL_DAYS);
  const span = bottom - top;
  const seen = (b) => b.to_hour > top && b.from_hour < bottom;
  const place = (from, to) => {
    const [a, z] = [Math.max(from, top), Math.min(to, bottom)];
    return `top: ${((a - top) / span) * 100}%; height: max(2px, ${((z - a) / span) * 100}%)`;
  };
  const colour = (b) => `--cal-hue: ${hueOf.get(b.project) ?? 'var(--closed)'}`;
  const tip = (b) =>
    [
      [titleOf.get(b.project), b.what].filter(Boolean).join(' · '),
      b.work && b.work !== b.what && b.work !== titleOf.get(b.project) ? b.work : null,
      b.from_hour != null ? `${clockText(b.from_hour)}–${clockText(b.to_hour)} · ${hoursText(b.hours)}` : hoursText(b.hours),
      b.status === 'planned' ? 'Planned' : null,
      b.session && b.session !== b.what ? `Agent: ${b.session}${b.open ? ' (running)' : ''}` : b.session ? `Agent${b.open ? ', running' : ''}` : null,
    ]
      .filter(Boolean)
      .join('\n');
  const hours = [...Array(span)].map((_, i) => top + i);
  const snap = (n) => Math.min(bottom, Math.max(top, Math.round(n * 4) / 4));
  const hourAt = (lane, y) => {
    const r = lane.getBoundingClientRect();
    return snap(top + ((y - r.top) / r.height) * span);
  };
  const laneAt = (x) =>
    [...document.querySelectorAll('.cal-owner')].find((l) => {
      const r = l.parentElement.getBoundingClientRect();
      return x >= r.left && x < r.right;
    });

  // An owner's block is moved by dragging it, and stretched by its lower edge; a click opens it.
  const mineEl = (b) => {
    const el = h(
      'a',
      { class: `cal-block cal-mine${b.status === 'planned' ? ' cal-planned' : ''}`, href: `#/e/${b.id}`, title: tip(b), style: `${place(b.from_hour, b.to_hour)}; ${colour(b)}` },
      b.to_hour - b.from_hour >= 0.75 ? h('span', { class: 'cal-what' }, b.what) : null,
    );
    if (!act || b.status === 'invoiced' || b.start == null) return el;
    el.append(h('span', { class: 'cal-grip', title: 'Drag to change when it ends' }));
    let drag = null;
    el.addEventListener('pointerdown', (ev) => {
      if (ev.button !== 0) return;
      ev.preventDefault();
      el.setPointerCapture(ev.pointerId);
      dirty = true;
      drag = { y: ev.clientY, x: ev.clientX, moved: false, grip: ev.target.classList.contains('cal-grip'), from: b.from_hour, to: b.to_hour, lane: el.parentElement, at: hourAt(el.parentElement, ev.clientY) };
    });
    el.addEventListener('pointermove', (ev) => {
      if (!drag) return;
      if (!drag.moved && Math.abs(ev.clientY - drag.y) + Math.abs(ev.clientX - drag.x) < 5) return;
      drag.moved = true;
      if (drag.grip) {
        drag.to = Math.max(drag.from + 0.25, hourAt(drag.lane, ev.clientY));
      } else {
        const lane = laneAt(ev.clientX) ?? drag.lane;
        if (lane !== el.parentElement) lane.append(el);
        drag.lane = lane;
        const length = b.to_hour - b.from_hour;
        drag.from = Math.min(bottom - length, Math.max(top, snap(b.from_hour + hourAt(lane, ev.clientY) - drag.at)));
        drag.to = drag.from + length;
      }
      el.style.top = `${((drag.from - top) / span) * 100}%`;
      el.style.height = `${((drag.to - drag.from) / span) * 100}%`;
    });
    const finish = () => {
      const was = drag;
      drag = null;
      dirty = false;
      if (!was?.moved) return;
      // The click that ends a drag does not open the block.
      el.addEventListener('click', (e) => e.preventDefault(), { once: true });
      const day = was.lane.dataset.date;
      if (day === b.date && was.from === b.from_hour && was.to === b.to_hour) return;
      act.move(b, day, was.from, was.to);
    };
    el.addEventListener('pointerup', finish);
    el.addEventListener('pointercancel', finish);
    return el;
  };

  // A new block is drawn by dragging down the owner's lane; a click alone sets aside an hour.
  const ownerLane = (d) => {
    const lane = h('div', { class: 'cal-lane cal-owner', 'data-date': d.date, title: act ? 'Drag to add a block' : '' }, d.owner.filter((b) => b.from_hour != null && seen(b)).map((b) => mineEl({ ...b, date: d.date })));
    if (!act) return lane;
    let draw = null;
    lane.addEventListener('pointerdown', (ev) => {
      if (ev.button !== 0 || ev.target !== lane) return;
      ev.preventDefault();
      lane.setPointerCapture(ev.pointerId);
      dirty = true;
      const at = hourAt(lane, ev.clientY);
      draw = { at, from: at, to: at, ghost: h('div', { class: 'cal-block cal-ghost', style: place(at, at + 0.25) }) };
      lane.append(draw.ghost);
    });
    lane.addEventListener('pointermove', (ev) => {
      if (!draw) return;
      const at = hourAt(lane, ev.clientY);
      [draw.from, draw.to] = at < draw.at ? [at, draw.at] : [draw.at, at];
      draw.ghost.style.cssText = place(draw.from, Math.max(draw.to, draw.from + 0.25));
    });
    const finish = async () => {
      if (!draw) return;
      const { from, to, ghost } = draw;
      draw = null;
      const end = to - from < 0.25 ? Math.min(bottom, from + 1) : to;
      ghost.style.cssText = place(from, end);
      await act.add(d.date, from, end);
      ghost.remove();
      dirty = false;
    };
    lane.addEventListener('pointerup', finish);
    lane.addEventListener('pointercancel', () => (draw?.ghost.remove(), (draw = null), (dirty = false)));
    return lane;
  };

  return h(
    'section',
    { class: 'card cal' },
    h(
      'header',
      { class: 'cal-legend' },
      wk.projects.length ? wk.projects.map((p) => h('a', { class: 'cal-key', href: `#/e/${p.id}`, title: p.title, style: `--cal-hue: ${hueOf.get(p.id)}` }, p.title)) : h('span', { class: 'muted small' }, 'Nothing this week.'),
    ),
    h(
      'div',
      { class: 'cal-scroll' },
      h(
        'div',
        { class: 'cal-grid', style: `grid-template-columns: 44px repeat(${days.length}, minmax(64px, 1fr))` },
        h('div', { class: 'cal-axis' }, h('div', { class: 'cal-head' }), h('div', { class: 'cal-loose' }), h('div', { class: 'cal-body' }, [...hours, bottom].filter((n) => n === top || n === bottom || span <= 16 || n % 2 === 0).map((n) => h('span', { class: `cal-hour${n === top ? ' cal-first' : n === bottom ? ' cal-last' : ''}`, style: `top: ${((n - top) / span) * 100}%` }, clockText(n))))),
        days.map((d) => {
          const loose = d.owner.filter((b) => b.from_hour == null);
          const lanes = d.agents.length;
          const said = [`${hoursText(d.hours)} of your time`, d.planned && `${hoursText(d.planned)} planned`, lanes && `${lanes} agent${lanes === 1 ? '' : 's'} at once at most`, d.reported && `${d.reported} run${d.reported === 1 ? '' : 's'} reported when done`].filter(Boolean).join(', ');
          return h(
            'div',
            { class: `cal-day${d.date === today ? ' cal-today' : ''}` },
            h('div', { class: 'cal-head', title: said }, h('span', { class: 'gist' }, dayName(d.date, { weekday: 'short', day: 'numeric' })), d.hours ? h('span', { class: 'tq-h muted small' }, hoursText(d.hours)) : null),
            h('div', { class: 'cal-loose' }, loose.map((b) => h('a', { class: `cal-chip${b.status === 'planned' ? ' cal-planned' : ''}`, href: `#/e/${b.id}`, title: tip(b), style: `flex-grow: ${b.hours}; ${colour(b)}` }))),
            h(
              'div',
              { class: 'cal-body', style: `--cal-agents: ${lanes}` },
              hours.map((n) => h('span', { class: 'cal-rule', style: `top: ${((n - top) / span) * 100}%` })),
              ownerLane(d),
              d.agents.map((lane) => h('div', { class: 'cal-lane cal-agent' }, lane.filter(seen).map((b) => h('a', { class: 'cal-block cal-run', href: `#/e/${b.id}`, title: tip(b), style: `${place(b.from_hour, b.to_hour)}; ${colour(b)}` })))),
            ),
          );
        }),
      ),
    ),
  );
}

async function time() {
  const main = part('time');
  const today = localDay();
  const from = timeState.from ?? mondayOf(today);
  const to = shiftDay(from, 6);
  let sheet, wk;
  try {
    [sheet, wk] = await Promise.all([api('timesheet', { from, to }), api('week', { from })]);
  } catch (err) {
    return main.replaceChildren(h('div', { class: 'error' }, err.message));
  }
  const again = () => ((dirty = false), time());
  const week = (n) => () => ((timeState.from = n === 0 ? null : shiftDay(from, n * 7)), again());
  const write = async (ops, reason) => {
    try {
      await api('change', { ops, reason });
      again();
    } catch (err) {
      tell('That was not saved', err.message);
    }
  };

  // The line to log more: the day (today when this week is shown), hours, the work, what was done, a note, whether it is billed.
  const picker = workPicker(remember(LAST_WORK), (w) => remember(LAST_WORK, w));
  const date = h('input', { type: 'date', value: today >= from && today <= to ? today : from, title: 'The day the work was done', required: true });
  const hours = h('input', { type: 'number', class: 'tq-hours', min: '0.25', max: '24', step: '0.25', placeholder: 'Hours', title: 'Hours spent', required: true });
  const what = h('input', { type: 'text', class: 'tq-what', maxlength: '60', placeholder: 'What you did', title: 'A few words: the entry\u2019s name', required: true });
  const note = h('input', { type: 'text', class: 'tq-note', placeholder: 'Note', title: 'More about the work, if there is more to say' });
  const billable = h('input', { type: 'checkbox', checked: true });
  const add = h(
    'form',
    {
      class: 'tq-add card',
      onsubmit: async (ev) => {
        ev.preventDefault();
        const work = picker.get();
        if (!work) return tell('Which work was it for?', 'Choose a project, task or client from the list as you type.');
        try {
          const made = await api('time_log', { work: work.id, hours: Number(hours.value), what: what.value.trim(), note: note.value.trim() || undefined, date: date.value, billable: billable.checked ? undefined : false });
          if (!made.client) await tell('Logged, with no client', made.note ?? 'This work involves no company, so it is not invoiced.');
          again();
        } catch (err) {
          tell('That was not logged', err.message);
        }
      },
    },
    date,
    hours,
    picker.el,
    what,
    note,
    h('label', { class: 'tq-bill', title: 'Goes on an invoice' }, billable, 'Billable'),
    h('button', { type: 'submit', class: 'primary' }, 'Log'),
  );

  // One line per entry; in place, its fields to change. What is invoiced is kept as billed.
  const entryRow = (e) => {
    const li = h('li', { class: 'row-top tq-entry' });
    // The parts of the line, less those that say nothing: replaceChildren would write them out as words.
    const show = () =>
      li.replaceChildren(
        ...[
        h('a', { class: 'gist tq-what-text', href: `#/e/${e.id}`, title: [e.what, e.note].filter(Boolean).join('\n') }, e.what),
        e.note && h('span', { class: 'gist muted small tq-note-text', title: e.note }, e.note),
        e.work_id ? h('a', { class: 'gist muted small tq-work-text', href: `#/e/${e.work_id}`, title: e.client ? `${e.work} \u2192 billed to ${e.client}` : `${e.work}: no client` }, e.work) : h('span', { class: 'muted small tq-work-text', title: 'Not tied to any work, so it has no client' }, 'no work'),
        e.billable === false && h('span', { class: 'pill closed', title: 'Not invoiced' }, 'not billable'),
        e.status !== 'logged' && h('span', { class: 'pill closed', title: 'On an invoice' }, e.status),
        h('span', { class: 'tq-h' }, hoursText(e.hours)),
        e.status === 'logged' &&
          menu('\u22ef', [
            ['Edit', edit],
            [
              'Remove',
              async () => (await ask({ title: `Remove "${e.what}"?`, message: `${hoursText(e.hours)} on ${dayName(e.date ?? day)}`, action: 'Remove', danger: true })) && write([{ op: 'archive', id: e.id }], 'Removed on the Time screen'),
              'danger',
            ],
          ]),
        ].filter(Boolean),
      );
    const edit = () => {
      dirty = true;
      const d = h('input', { type: 'date', value: e.date });
      const hrs = h('input', { type: 'number', class: 'tq-hours', min: '0.25', max: '24', step: '0.25', value: String(e.hours) });
      const w = h('input', { type: 'text', class: 'tq-what', maxlength: '60', value: e.what });
      const n = h('input', { type: 'text', class: 'tq-note', value: e.note ?? '', placeholder: 'Note' });
      const b = h('input', { type: 'checkbox', checked: e.billable !== false });
      li.replaceChildren(
        h(
          'form',
          {
            class: 'tq-edit',
            onsubmit: (ev) => (
              ev.preventDefault(),
              write([{ op: 'update', id: e.id, title: w.value.trim(), body: n.value.trim(), props: { date: d.value, hours: Number(hrs.value), billable: b.checked ? null : false } }], 'Edited on the Time screen')
            ),
          },
          d,
          hrs,
          w,
          n,
          h('label', { class: 'tq-bill' }, b, 'Billable'),
          h('button', { type: 'submit', class: 'primary' }, 'Save'),
          h('button', { type: 'button', onclick: () => ((dirty = false), show()) }, 'Cancel'),
        ),
      );
      w.focus();
    };
    show();
    return li;
  };

  // The days of the week that have time, and today.
  const byDay = new Map(sheet.days.map((d) => [d.date, d]));
  let day;
  const days = [...Array(7)]
    .map((_, i) => shiftDay(from, i))
    .filter((d) => byDay.has(d) || d === today)
    .map((d) => {
      day = d;
      const one = byDay.get(d) ?? { hours: 0, entries: [] };
      return h(
        'section',
        { class: 'card tq-day' },
        h('header', { class: 'tq-dayhead' }, h('span', { class: 'grow' }, dayName(d, { weekday: 'long', day: 'numeric', month: 'long' })), h('span', { class: 'tq-h' }, hoursText(one.hours))),
        one.entries.length ? h('ul', { class: 'rows' }, one.entries.map((e) => entryRow({ ...e, date: d }))) : h('div', { class: 'empty' }, 'Nothing logged yet.'),
      );
    });

  // The calendar writes through the same tools: a drawn block is logged (or planned, when it is ahead), a moved one updated.
  const calendarActs = {
    add: async (day, from, to) => {
      const start = atHour(day, from);
      const end = atHour(day, to);
      const said = await blockDialog(`${dayName(day)}, ${clockText(from)}\u2013${clockText(to)}`, Date.parse(end) > Date.now());
      if (!said) return;
      try {
        await api('time_log', { work: said.work.id, what: said.what, start, end, ...(said.planned && { planned: true }) });
        again();
      } catch (err) {
        tell('That was not added', err.message);
      }
    },
    move: (b, day, from, to) => write([{ op: 'update', id: b.id, props: { start: atHour(day, from), end: atHour(day, to), date: day, hours: Math.round((to - from) * 100) / 100 } }], 'Moved on the calendar'),
  };

  // Planned time whose end has passed: the owner says it happened (and it counts), or drops it.
  const due = wk.to_confirm ?? [];
  const clock = (iso) => new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  const confirmRow = (b) =>
    h(
      'li',
      { class: 'row-top' },
      h('a', { class: 'muted small tq-h', href: '#/time', title: 'Show its week', onclick: (ev) => (ev.preventDefault(), (timeState.from = mondayOf(b.date)), again()) }, dayName(b.date, { weekday: 'short', day: 'numeric' })),
      h('a', { class: 'gist grow', href: `#/e/${b.id}`, title: [b.what, b.work, b.start && `${clock(b.start)}\u2013${clock(b.end)}`].filter(Boolean).join('\n') }, b.what),
      h('span', { class: 'tq-h' }, hoursText(b.hours)),
      h('button', { title: 'It happened as planned: count it', onclick: () => write([{ op: 'update', id: b.id, status: 'logged' }], 'Confirmed on the Time screen') }, 'Confirm'),
      h('button', { title: 'Say what actually happened, then count it', onclick: async () => {
        const ops = await happenedDialog(b);
        if (ops) write(ops, 'Confirmed on the Time screen, as it happened');
      } }, 'Adjust'),
      menu('\u22ef', [['Drop', () => write([{ op: 'archive', id: b.id }], 'Dropped on the Time screen: it did not happen'), 'danger']]),
    );
  const confirm = due.length
    ? h(
        'section',
        { class: 'card tq-money' },
        h(
          'header',
          { class: 'tq-dayhead' },
          h('span', { class: 'grow' }, `To confirm ${due.length}`),
          due.length > 1 && h('button', { title: 'Every one happened as planned', onclick: () => write(due.map((b) => ({ op: 'update', id: b.id, status: 'logged' })), 'Confirmed on the Time screen') }, 'Confirm all'),
        ),
        h('ul', { class: 'rows' }, due.map(confirmRow)),
      )
    : null;

  // What is owed: time not yet invoiced, by client; invoices sent and not paid; drafts.
  const inv = sheet.invoices;
  const draft = async (client) => {
    try {
      const made = await api('invoice_draft', { client: client.id });
      location.hash = `#/e/${made.created.inv}`;
    } catch (err) {
      tell('No invoice was drafted', err.message);
    }
  };
  const paid = async (i) => {
    const said = await ask({ title: `Payment on ${i.number}`, message: `${moneyText(i.owing, i.currency)} is owed. Give the amount received and how it came, e.g. "${i.owing} EFT". Left empty, the whole amount.`, input: { placeholder: `${i.owing} EFT` }, action: 'Record payment' });
    if (said === null) return;
    const amount = /^\s*\$?([\d,]+(?:\.\d+)?)/.exec(said)?.[1];
    const method = said.replace(/^\s*\$?[\d,]+(?:\.\d+)?\s*/, '').trim();
    try {
      await api('invoice_paid', { id: i.id, ...(amount && { amount: Number(amount.replaceAll(',', '')) }), ...(method && { method }) });
      again();
    } catch (err) {
      tell('The payment was not recorded', err.message);
    }
  };
  const block = (title, rows, empty) => h('section', { class: 'card tq-money' }, h('header', { class: 'tq-dayhead' }, h('span', { class: 'grow' }, title)), rows.length ? h('ul', { class: 'rows' }, rows) : h('div', { class: 'empty' }, empty));
  const money = h(
    'aside',
    { class: 'tq-side' },
    confirm,
    block(
      'Not invoiced',
      sheet.not_invoiced.map((c) =>
        h('li', { class: 'row-top' }, h('span', { class: 'gist grow', title: c.client }, c.client), h('span', { class: 'tq-h' }, hoursText(c.hours)), c.id ? h('button', { title: `Draft an invoice to ${c.client} for this time`, onclick: () => draft(c) }, 'Draft invoice') : h('span', { class: 'muted small', title: 'This time is for work that involves no company' }, 'no client')),
      ),
      'All billed.',
    ),
    block(
      `Owed ${moneyText(inv.owed_total)}`,
      inv.outstanding.map((i) =>
        h(
          'li',
          { class: 'row-top' },
          h('a', { class: 'gist grow', href: `#/e/${i.id}`, title: `${i.number} to ${i.client}: ${moneyText(i.total, i.currency)}, ${moneyText(i.paid, i.currency)} paid` }, `${i.number} \u00b7 ${i.client}`),
          i.overdue_days ? h('span', { class: 'pill bad', title: `Due ${i.due}` }, `${i.overdue_days} d late`) : h('span', { class: 'muted small', title: 'Due' }, i.due ? dayName(i.due, { day: 'numeric', month: 'short' }) : ''),
          h('span', { class: 'tq-h' }, moneyText(i.owing, i.currency)),
          h('button', { onclick: () => paid(i) }, 'Mark paid'),
        ),
      ),
      'Nothing owed.',
    ),
    block(
      'Drafts',
      inv.drafts.map((i) =>
        h(
          'li',
          { class: 'row-top' },
          h('a', { class: 'gist grow', href: `#/e/${i.id}`, title: `${i.number} to ${i.client}` }, `${i.number} \u00b7 ${i.client}`),
          h('span', { class: 'tq-h' }, moneyText(i.total, i.currency)),
          h('button', { title: 'Open it to print or save as a PDF', onclick: () => window.open(`/read/${i.id}`, '_blank') }, 'PDF'),
          h('button', { title: 'Mark it sent to the client', onclick: () => write([{ op: 'update', id: i.id, status: 'sent' }], `Marked ${i.number} sent on the Time screen`) }, 'Sent'),
        ),
      ),
      'No drafts.',
    ),
  );

  const thisWeek = from === mondayOf(today);
  const full = remember(CAL_FULL) === true;
  main.replaceChildren(
    h(
      'div',
      { class: 'page-head' },
      h('h1', {}, 'Time'),
      h(
        'span',
        { class: 'switch' },
        h('button', { title: 'The week before', onclick: week(-1) }, '\u2039'),
        h('button', { class: 'on', title: `${from} to ${to}` }, `${dayName(from, { day: 'numeric', month: 'short' })} \u2013 ${dayName(to, { day: 'numeric', month: 'short' })}`),
        h('button', { title: 'The week after', onclick: week(1) }, '\u203a'),
      ),
      !thisWeek && h('button', { onclick: week(0) }, 'This week'),
      h(
        'button',
        {
          class: `${full ? 'on' : ''}${!full && calHidden(wk) ? ' cal-more' : ''}`,
          title: full ? 'Show weekdays, 06:00 to 22:00' : `Show the whole day and the weekend${calHidden(wk) ? ': there is more there this week' : ''}`,
          onclick: () => (remember(CAL_FULL, !full), again()),
        },
        'Full week',
      ),
      h('span', { class: 'fact', title: 'Hours this week' }, h('strong', {}, hoursText(sheet.total))),
    ),
    weekCalendar(wk, today, calendarActs, full),
    h('div', { class: 'tq-grid' }, h('div', { class: 'tq-main' }, add, days.length ? days : h('div', { class: 'empty card' }, 'Nothing logged this week.')), money),
  );
}

const PAGES = { home: ['home'], review: ['review'], map: ['map', 'item', 'graph'], time: ['time'], workspace: ['workspace'] };
const UNDER = { e: 'map', new: 'map', graph: 'map' };
/** The part an address names, where that is not the address's own name. */
const PART = { e: 'item', new: 'item' };
/** `pulse`: the map changed under the page, which is drawn again where it stands. */
async function route(pulse = false) {
  // What follows a ? says how the page is to be drawn (a lens and a style), not which page it is.
  const [where, query = ''] = location.hash.split('?');
  const [, name = 'home', arg] = where.split('/');
  // Addresses that have been folded into another screen still lead somewhere.
  if (name === 'activity') return activity();
  // The app opens on Home: each project's questions and its next release.
  if (name === 'projects' || name === 'today') return void (location.hash = '#/home');
  // Automations are found like any other kind of item.
  // The graph around an item is its relations, drawn further out, on its own page.
  if (name === 'graph' && arg) return void (location.hash = `#/graph?from=${arg}`);
  if (name === 'automations') return void ((mapState.type = 'sys.automation'), (location.hash = '#/map'));
  // A project's roadmap and its questions are on the project's own page.
  if (name === 'roadmap' || name === 'questions') return void (location.hash = arg ? `#/e/${arg}` : '#/map');
  const page = PAGES[UNDER[name] ?? name] ? (UNDER[name] ?? name) : 'map';
  dirty = false;
  stale.hidden = true;
  for (const a of document.querySelectorAll('#nav a')) a.classList.toggle('active', a.dataset.route === page);
  const draw = {
    home,
    review,
    map: name === 'map' || page !== 'map' ? map : searchBar,
    // The graph around an item is drawn on that item's page, under it.
    item: name === 'e' && arg ? () => entity(arg, new URLSearchParams(query).get('here') ?? undefined) : name === 'new' && (() => newEntity(arg)),
    graph: name === 'graph' && (() => graph(query)),
    time,
    workspace,
  };
  const wanted = PAGES[page];
  if ([...main.children].map((c) => c.dataset.part).join() !== wanted.join()) main.replaceChildren(...wanted.map((p) => h('div', { class: 'part', 'data-part': p })));
  const named = PART[name] ?? name;
  let signedOut;
  try {
    if (!schema) await loadSchema();
  } catch (err) {
    if (err instanceof SignInNeeded) return signIn(store.token ? 'Your token is no longer accepted.' : '');
    return main.replaceChildren(h('div', { class: 'error' }, err.message));
  }
  await Promise.all(
    wanted.map(async (p) => {
      const el = part(p);
      el.hidden = !draw[p];
      if (!draw[p]) return el.replaceChildren();
      // The graph is as someone has arranged it: a change elsewhere does not draw it again.
      // The whole map is as someone has arranged it: a change elsewhere does not draw it again.
      if (pulse && el.childElementCount && p === 'graph' && !query) return;
      try {
        await draw[p]();
      } catch (err) {
        if (err instanceof SignInNeeded) signedOut = true;
        else el.replaceChildren(h('div', { class: 'error' }, err.message));
      }
      if (!pulse && p === named && el.isConnected) p === wanted[0] || page === 'map' ? scrollTo(0, 0) : el.scrollIntoView();
    }),
  );
  if (signedOut) return signIn(store.token ? 'Your token is no longer accepted.' : '');
  // The parts above the one asked for have their final height only now, and a list in them a moment later.
  const settle = () => location.hash.split('/')[1] === name && part(named).scrollIntoView();
  if (!pulse && named !== wanted[0] && page !== 'map' && part(named) !== main) (settle(), setTimeout(settle, 700));
  refreshReviewCount();
  showIdentity();
}

window.addEventListener('hashchange', () => route());

route();
