// The lattice web UI. No framework and no build step: it calls the same
// tools as the CLI through /api/<tool>.

const main = document.getElementById('main');

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
    const field = input && h('textarea', { rows: 3, placeholder: input.placeholder ?? '' });
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

// The token, when the server wants one. Kept for this browser only.
const store = {
  get token() {
    try {
      return localStorage.getItem('lattice-token') ?? '';
    } catch {
      return this.memory ?? '';
    }
  },
  set token(value) {
    this.memory = value;
    try {
      if (value) localStorage.setItem('lattice-token', value);
      else localStorage.removeItem('lattice-token');
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
      return JSON.parse(localStorage.getItem('lattice-workspaces') ?? '{}');
    } catch {
      return {};
    }
  },
  save(map) {
    try {
      localStorage.setItem('lattice-workspaces', JSON.stringify(map));
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
  if (location.hash && location.hash !== '#/today') location.hash = '#/today';
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
  const input = h('input', { type: 'text', placeholder: 'lat_…', style: 'flex: 1; min-width: 260px', autocomplete: 'off' });
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
  document.querySelector('#nav .brand').replaceChildren('Lattice');
  document.title = 'Lattice';
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
    document.querySelector('#nav .brand').replaceChildren('Lattice', h('div', { class: 'workspace-name' }, me.workspace.name));
    document.title = `${me.workspace.name} · Lattice`;
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
const chip = (typeId) => h('span', { class: 'chip', title: typeId }, typeTitle(typeId));
const pill = (typeId, status) => h('span', { class: `pill${isClosed(typeId, status) ? ' closed' : ''}` }, status);
const link = (e) => (e ? h('a', { href: `#/e/${e.id}` }, e.title) : h('span', { class: 'muted' }, '(missing)'));

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

const WHY = { depends_on: 'depends on', resource_unavailable: 'needs (unavailable)', resource_held: 'needs (held by another)' };

// The count beside Home: changes held for the owner and notifications not yet read.
async function refreshReviewCount() {
  const badge = document.getElementById('notice-count');
  try {
    const [pending, notes] = await Promise.all([api('proposals'), api('view', { name: 'notifications' })]);
    badge.textContent = pending.length + notes.length;
    badge.hidden = pending.length + notes.length === 0;
  } catch {
    badge.hidden = true;
  }
}

// ---- Home ----------------------------------------------------------------

// What needs the owner, project by project: under each project, what there
// is to read, to decide and to do in it, each dealt with where it stands.
// Proposals come first. The rest of what the map knows about today is a row
// of counts, opened one at a time.
let todayOpen = '';
/** The lists on Home shown in full; the others stop at the first two. */
const todayAll = new Set();

async function today() {
  const here = () => location.hash === '' || location.hash.startsWith('#/today');
  if (!main.querySelector('.inbox')) main.replaceChildren(h('div', { class: 'page-head' }, h('h1', {}, 'Home')), h('div', { class: 'inbox' }, h('div', { class: 'empty' }, 'Loading…')));
  const view = (name, params) => api('view', { name, params });
  const change = async (ops, reason) => {
    try {
      await api('change', { ops, reason });
      dirty = false;
      today();
      refreshReviewCount();
    } catch (err) {
      tell('That change was not made', err.message);
    }
  };
  const [info, pending, notes, asked, needs, mine, blockers, waiting, risk, sessions] = await Promise.all([
    api('workspace_info'),
    api('proposals'),
    view('notifications'),
    view('questions'),
    view('needs_me'),
    view('blocked_on_me'),
    view('blockers'),
    view('waiting_on'),
    view('at_risk'),
    view('sessions'),
  ]);
  // Every project's open questions as one list, what holds up the most first.
  const perProject = await Promise.all(asked.projects.filter((pr) => pr.questions > 0).map((pr) => view('questions', { project: pr.id }).then((d) => d.open.map((q) => ({ ...q, project: pr })))));
  const seen = new Set();
  const undecided = perProject
    .flat()
    .filter((q) => !seen.has(q.id) && seen.add(q.id))
    .sort((a, b) => b.holds_up - a.holds_up);
  const trees = await projectTrees(asked.projects);
  if (!here()) return;

  // The top of each list is what matters most; the rest is one click away.
  const rows = (key, items, render) =>
    h(
      'ul',
      { class: 'rows' },
      (todayAll.has(key) ? items : items.slice(0, 2)).map(render),
      items.length > 2 && h('li', { class: 'more' }, h('button', { class: 'quiet', onclick: () => ((todayAll.has(key) ? todayAll.delete(key) : todayAll.add(key)), today()) }, todayAll.has(key) ? 'fewer' : `${items.length - 2} more`)),
    );
  const decide = async (pr, yes) => {
    const note = yes ? undefined : await ask({ title: 'Decline this change?', message: pr.reason, input: { placeholder: 'Why not? (optional, kept in the log for whoever made it)' }, action: 'Decline', danger: true });
    if (!yes && note === null) return;
    try {
      await api('decide', { proposal: pr.id, approve: yes, note: note || undefined });
      if (yes && pr.ops.some((o) => o.op === 'define_type')) await loadSchema();
    } catch (err) {
      await tell('That was not done', err.message);
    }
    today();
    refreshReviewCount();
  };
  const markRead = (ids) => change(ids.map((id) => ({ op: 'update', id, status: 'read' })), 'Read in the UI');
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
  const todo = needs.actionable.filter((e) => !seen.has(e.id));
  const shown = new Set([...seen, ...todo.map((e) => e.id)]);
  const holding = mine.filter((r) => !shown.has(r.entity.id));
  // A proposal that settles one thing is an answer offered by an agent: it is
  // shown at that thing, to be confirmed with one press, not in the pile above.
  const answerOf = (pr) => (pr.ops.length === 1 && pr.ops[0].op === 'update' && pr.ops[0].status ? pr.ops[0] : null);
  const answers = pending.filter(answerOf);
  const bulk = pending.filter((pr) => !answerOf(pr));
  const asked_ = new Map(undecided.map((q) => [q.id, q]));
  const named = answers.some((pr) => !asked_.has(answerOf(pr).id)) ? new Map((await api('search', { limit: 200, include_archived: true })).map((e) => [e.id, e])) : new Map();
  if (!here()) return;
  const answered = new Set(answers.map((pr) => answerOf(pr).id));
  const projectOf = (id) => asked_.get(id)?.project.id ?? home.get(id) ?? '';
  // What needs the owner, under the project it belongs to ('' for none).
  const mineIn = (id) => ({
    confirm: answers.filter((pr) => projectOf(answerOf(pr).id) === id),
    read: notes.filter((n) => (home.get(n.about_id) ?? '') === id),
    decide: undecided.filter((q) => (id ? q.project.id === id : false) && !answered.has(q.id)),
    todo: todo.filter((e) => (home.get(e.id) ?? '') === id),
    holding: holding.filter((r) => (home.get(r.entity.id) ?? '') === id),
  });
  const amount = (m) => m.confirm.length + m.read.length + m.decide.length + m.todo.length + m.holding.length;
  const part = (title, items, list) => items.length > 0 && [h('div', { class: 'sub' }, title, ' ', items.length), list];
  const plainRow = (e, sub) => h('li', {}, h('div', { class: 'row-top' }, h('span', { class: 'grow' }, link(e)), e.due && h('span', { class: 'pill warn' }, `due ${e.due}`)), sub && h('div', { class: 'row-sub' }, sub));
  const noteRow = (n) =>
    h(
      'li',
      {},
      h(
        'div',
        { class: 'row-top' },
        n.level && n.level !== 'info' && h('span', { class: `pill ${n.level === 'urgent' ? 'bad' : 'warn'}` }, n.level),
        h('span', { class: 'grow' }, n.about_id ? h('a', { href: `#/e/${n.about_id}` }, n.title) : h('strong', {}, n.title)),
        h('button', { onclick: () => markRead([n.id]) }, 'Mark read'),
      ),
    );
  const answerRow = (pr) => {
    const op = answerOf(pr);
    const e = asked_.get(op.id) ?? named.get(op.id) ?? { id: op.id, title: op.id };
    return h(
      'li',
      {},
      h(
        'div',
        { class: 'row-top' },
        h('span', { class: 'grow' }, link(e), ' ', h('span', { class: 'arrow' }, '\u2192'), ' ', h('strong', {}, op.props?.outcome ?? op.status)),
        h('button', { class: 'primary', onclick: () => decide(pr, true) }, 'Confirm'),
        h('button', { onclick: () => decide(pr, false) }, 'No'),
      ),
      h('div', { class: 'row-sub' }, pr.reason),
    );
  };
  const parts = (key, m) => [
    part('To confirm', m.confirm, rows(`${key}:confirm`, m.confirm, answerRow)),
    part('To read', m.read, rows(`${key}:read`, m.read, noteRow)),
    part(key ? h('a', { href: `#/questions/${key}` }, 'To decide') : 'To decide', m.decide, rows(`${key}:decide`, m.decide, (q) => questionItem(q, change, null, true))),
    part('To do', m.todo, rows(`${key}:todo`, m.todo, (e) => plainRow(e))),
    part('Others are waiting on', m.holding, rows(`${key}:holding`, m.holding, (r) => plainRow(r.entity, ['holding up: ', r.holding_up.map((e, i) => [i > 0 && ', ', link(e)])]))),
  ];
  const projectCard = (pr) => {
    const tree = trees.get(pr.id);
    const m = mineIn(pr.id);
    return h(
      'section',
      { class: 'card project' },
      h(
        'header',
        {},
        h('h2', {}, h('a', { href: `#/roadmap/${pr.id}` }, pr.title)),
        tree?.branches.length > 0 && progressBar(tree.progress),
        pr.status !== 'active' && pill(pr.type, pr.status),
      ),
      amount(m) > 0 && parts(pr.id, m),
    );
  };
  const loose = mineIn('');
  const inbox = [
    !info.owner && h('p', { class: 'error' }, 'This workspace has no owner yet, so there is nobody for this page to be about. ', h('a', { href: '#/workspace' }, 'Set the owner'), '.'),
    bulk.length > 0 &&
      h(
        'section',
        { class: 'card' },
        h('header', {}, h('h2', {}, 'Held for you'), h('span', { class: 'n' }, bulk.length)),
        rows('approve', bulk, (pr) =>
          h(
            'li',
            {},
            h(
              'div',
              { class: 'row-top' },
              h('strong', { class: 'grow' }, pr.reason),
              h('a', { href: '#/review' }, `${pr.ops.length} change${pr.ops.length === 1 ? '' : 's'}`),
              h('button', { class: 'primary', onclick: () => decide(pr, true) }, 'Apply'),
              h('button', { onclick: () => decide(pr, false) }, 'Decline'),
            ),
            h('div', { class: 'row-sub' }, pr.actor, pr.warnings.length > 0 && [' · ', h('span', { class: 'warning' }, `${pr.warnings.length} warning${pr.warnings.length === 1 ? '' : 's'}`)]),
          ),
        ),
      ),
    // The project with the most waiting for the owner comes first.
    [...asked.projects].sort((a, b) => amount(mineIn(b.id)) - amount(mineIn(a.id))).map(projectCard),
    amount(loose) > 0 && h('section', { class: 'card project' }, h('header', {}, h('h2', {}, 'Not in a project')), parts('', loose)),
  ]
    .flat()
    .filter(Boolean);

  // Everything else: a count each, and the list behind it on a click.
  const others = {
    blocked: {
      label: 'Blocked',
      n: blockers.length,
      list: () => blockers.map((b) => entityRow(b.entity, ['waiting on: ', b.root_blockers.map((r, i) => [i > 0 && ', ', chip(r.type), ' ', link(r)])])),
    },
    waiting: {
      label: 'Waiting on others',
      n: waiting.blocked_by_others.length + waiting.owed_to_me.length,
      list: () => [...waiting.blocked_by_others.map((r) => entityRow(r.entity, ['waiting on: ', r.waiting_on.map((e, i) => [i > 0 && ', ', link(e)])])), ...waiting.owed_to_me.map((e) => entityRow(e, 'owed to you'))],
    },
    risk: {
      label: 'At risk',
      n: risk.due_soon_or_overdue.length + risk.resting_on_refuted_hypothesis.length,
      list: () => [
        ...risk.due_soon_or_overdue.map((e) => entityRow(e, [e.overdue ? 'Overdue' : `Due within ${risk.due_within_days} days`, e.blocked && ', and blocked'])),
        ...risk.resting_on_refuted_hypothesis.map((e) => entityRow(e, ['rests on a refuted hypothesis: ', h('a', { href: `#/e/${e.hypothesis}` }, e.hypothesis_title)])),
      ],
    },
    sessions: {
      label: 'Sessions',
      n: sessions.open.length,
      warn: sessions.open.some((r) => r.stale),
      list: () =>
        sessions.open.map((r) =>
          h(
            'li',
            {},
            h(
              'div',
              { class: 'row-top' },
              h('span', { class: 'grow' }, link(r)),
              r.stale && h('span', { class: 'pill bad', title: `No report for over ${sessions.stale_after_minutes} minutes` }, 'gone quiet'),
              h(
                'button',
                {
                  onclick: async () => {
                    if (!(await ask({ title: `End "${r.title}"?`, message: 'Anything it holds is released.', action: 'End session', danger: true }))) return;
                    await api('session_end', { run: r.id, outcome: 'cancelled', summary: 'Ended from the UI' });
                    today();
                  },
                },
                'End',
              ),
            ),
            h('div', { class: 'row-sub' }, r.working_on.length ? r.working_on.map((e, i) => [i > 0 && ', ', link(e)]) : 'no task named', r.holds.length > 0 && [' · holds: ', r.holds.map((e, i) => [i > 0 && ', ', link(e)])], ` · last heard ${when(r.last_seen)}`),
          ),
        ),
    },
    resources: { label: 'Resources', n: null, list: null },
  };
  if (todayOpen && !others[todayOpen]) todayOpen = '';
  const drawer = h('div', { class: 'drawer' });
  const openDrawer = async () => {
    const o = others[todayOpen];
    if (!o) return drawer.replaceChildren();
    const list = o.list ? o.list() : await resourceRows(view);
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
    h('div', { class: 'page-head' }, h('h1', {}, 'Home')),
    h('div', { class: 'inbox' }, inbox, h('div', {}, h('button', { onclick: () => (location.hash = '#/new/project') }, 'New project'))),
    strip,
    drawer,
  );
  openDrawer();
}

/** Connections, resources and who holds them, as rows. */
async function resourceRows(view) {
  const [connections, now, all] = await Promise.all([api('check_connections'), view('available_now'), api('search', { type: 'resource', limit: 100 })]);
  const connIds = new Set(connections.map((c) => c.id));
  const heldBy = new Map(now.held_resources.map((r) => [r.resource, r]));
  return [
    ...connections.map((c) => h('li', {}, h('div', { class: 'row-top' }, h('span', { class: 'grow' }, link(c)), h('span', { class: `pill ${c.status === 'available' ? 'ok' : 'bad'}` }, c.status === 'available' ? 'reachable' : 'not reachable')))),
    ...all
      .filter((r) => !connIds.has(r.id))
      .map((r) => {
        const held = heldBy.get(r.id);
        const state = r.status !== 'available' ? ['bad', r.status] : held ? ['warn', 'held'] : ['ok', 'free'];
        return h(
          'li',
          {},
          h('div', { class: 'row-top' }, h('span', { class: 'grow' }, link(r)), h('span', { class: `pill ${state[0]}` }, state[1])),
          held && h('div', { class: 'row-sub' }, 'held by ', h('a', { href: `#/e/${held.held_by}` }, held.held_by_title), ` since ${when(held.since)}`),
        );
      }),
    ...now.waiting_on_resource.map((t) => entityRow(t, ['cannot run: ', t.waiting_on.map((w) => `${WHY[w.why]} ${w.resource}`).join(', ')])),
  ];
}

// ---- Review --------------------------------------------------------------

// What agents have changed: first what is held for the owner, then what took
// effect as it was made, since the owner last looked, each to be undone if it
// is wrong. Looking is recorded; it permits nothing.
async function review() {
  main.replaceChildren(h('div', { class: 'page-head' }, h('h1', {}, 'Changes')));
  const [pending, known, events] = await Promise.all([api('proposals'), api('search', { limit: 200, include_archived: true }), api('events', { limit: 500 })]);
  const names = new Map(known.map((e) => [e.id, e]));
  if (pending.length) main.append(h('h2', {}, `Held for you (${pending.length})`));
  for (const p of pending) main.append(proposalCard(p, names));
  main.append(appliedCard(events));
}

function appliedCard(events) {
  const seenUpto = events.find((e) => e.action === 'changes.seen')?.detail?.upto ?? 0;
  const undoneSets = new Set(events.filter((e) => e.action === 'changeset.undo').map((e) => e.detail?.undoes));
  const sets = new Map();
  for (const ev of events) {
    if (!ev.changeset || ev.seq <= seenUpto) continue;
    if (!sets.has(ev.changeset)) sets.set(ev.changeset, []);
    sets.get(ev.changeset).push(ev);
  }
  // An agent's own change sets: not the ones a human applied, and not a
  // session keeping its own record.
  const groups = [...sets.entries()]
    .map(([changeset, evs]) => ({ changeset, events: evs }))
    .filter((g) => g.events.every((e) => e.actor.startsWith('agent:') && !e.detail?.approved_by) && !g.events.every((e) => (e.target_type ?? 'sys.').startsWith('sys.')));
  const undo = async (g) => {
    if (!(await ask({ title: 'Undo this change set?', message: 'The opposite is applied as a new change; nothing is erased from the log.', action: 'Undo' }))) return;
    try {
      const r = await api('undo', { changeset: g.changeset });
      if (r.skipped.length) await tell('Undone, except:', `- ${r.skipped.join('\n- ')}`);
    } catch (err) {
      await tell('That was not undone', err.message);
    }
    review();
  };
  return h(
    'section',
    { class: 'card' },
    h(
      'header',
      {},
      h('h2', {}, 'Applied by agents'),
      h('span', { class: 'n' }, groups.length),
      groups.length > 0 && h('button', { onclick: () => api('seen', { upto: events[0].seq }).then(review, (err) => tell('That was not recorded', err.message)) }, 'Mark all seen'),
    ),
    !groups.length && h('div', { class: 'empty' }, seenUpto ? 'Nothing new from agents since you last looked.' : 'Nothing applied by agents.'),
    groups.map((g) => {
      const isUndo = g.events.some((e) => e.action === 'changeset.undo');
      return h(
        'details',
        { class: 'group' },
        h(
          'summary',
          {},
          h('span', { class: 'muted nowrap' }, when(g.events[0].ts)),
          h('span', {}, g.events[0].actor, h('span', { class: 'muted' }, `, ${authorityText(g.events.find((e) => e.detail?.authority)?.detail.authority) || 'authority not recorded'}`)),
          h('strong', { class: 'grow', style: 'flex-basis: 100%' }, g.events.find((e) => e.reason && e.reason !== 'Source of this change')?.reason ?? g.events[0].action),
          h('span', { class: 'chip' }, `${g.events.length} change${g.events.length === 1 ? '' : 's'}`),
          isUndo || undoneSets.has(g.changeset) ? h('span', { class: 'pill closed' }, isUndo ? 'an undo' : 'undone') : h('button', { onclick: (click) => (click.preventDefault(), undo(g)) }, 'Undo'),
        ),
        h('div', { class: 'inner' }, eventTable(g.events)),
      );
    }),
  );
}

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
      h('div', {}, h('strong', {}, p.reason)),
      h('div', { class: 'muted small' }, `${p.actor} · ${when(p.ts)} · ${p.id}`, p.source && ` · source: ${p.source.title ?? p.source.uri}`),
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
        fold(i, Object.entries(changes).filter(([k]) => k !== 'title').map(([k, v]) => `${k}: ${typeof v === 'object' ? JSON.stringify(v) : v}`)),
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
      el.replaceChildren(h('div', { class: 'empty' }, yes ? `Applied: ${p.reason}` : `Declined: ${p.reason}`));
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

/** Finding something in the map, or seeing how the map came to be. */
const mapTabs = (on) =>
  h(
    'span',
    { class: 'switch' },
    [['Search', 'map'], ['Activity', 'activity']].map(([label, to]) => h('button', { class: on === to ? 'on' : '', onclick: () => (location.hash = `#/${to}`) }, label)),
  );

const mapState = { q: '', type: '', open: 'open' };

function map() {
  const results = h('div');
  const list = h('section', { class: 'card', hidden: true }, results);
  const run = async () => {
    // Nothing is listed until something is asked for: words, or a type.
    list.hidden = !mapState.q.trim() && !mapState.type;
    if (list.hidden) return;
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
              h('thead', {}, h('tr', {}, h('th', {}, 'Type'), h('th', {}, 'Title'), h('th', {}, 'Status'), h('th', {}, 'Updated'))),
              h('tbody', {}, rows.map((e) => h('tr', {}, h('td', { class: 'nowrap' }, chip(e.type)), h('td', {}, link(e), e.confidence < 1 && h('span', { class: 'muted small' }, `  confidence ${e.confidence}`)), h('td', {}, pill(e.type, e.status)), h('td', { class: 'nowrap muted' }, when(e.updated_at))))),
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
  main.replaceChildren(
    h('div', { class: 'page-head' }, h('h1', {}, 'Search'), mapTabs('map')),
    h(
      'div',
      { class: 'toolbar', style: 'margin-bottom: 12px' },
      h('input', { type: 'search', placeholder: 'Search titles and text', value: mapState.q, oninput: set('q'), autofocus: true, style: 'flex: 1; min-width: 200px' }),
      h('select', { onchange: set('type') }, h('option', { value: '' }, 'All types'), schema.types.map((t) => h('option', { value: t.id, selected: t.id === mapState.type }, `${t.title}${t.pack === 'core' ? '' : ` (${t.pack})`}`))),
      h('button', { onclick: () => (location.hash = `#/new/${mapState.type || 'task'}`) }, 'New'),
      h('select', { onchange: set('open') }, ['open', 'closed', 'all'].map((v) => h('option', { value: v, selected: v === mapState.open }, v === 'open' ? 'Unfinished' : v === 'closed' ? 'Finished' : 'Both'))),
    ),
    list,
  );
  main.querySelector('input[type=search]').focus();
  run();
}

async function entity(id) {
  main.replaceChildren(h('div', { class: 'empty' }, 'Loading…'));
  let data;
  try {
    data = await api('get', { id });
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

  main.replaceChildren(
    h(
      'div',
      { class: 'page-head' },
      h('div', { class: 'row-top' }, chip(e.type), e.archived_at && h('span', { class: 'pill closed' }, 'archived'), e.confidence < 1 && h('span', { class: 'pill warn' }, `confidence ${e.confidence}`), e.private_to && h('span', { class: 'pill closed', title: 'Other members of the workspace cannot see this' }, 'private to you')),
      h('h1', { style: 'margin-top: 6px' }, e.title),
    ),
    h(
      'div',
      { class: 'toolbar', style: 'margin-bottom: 14px' },
      h('label', { class: 'muted' }, 'Status '),
      h(
        'select',
        { onchange: (ev) => change([{ op: 'update', id, status: ev.target.value }], `Status set to ${ev.target.value} in the UI`) },
        statusesOf(e.type).map((s) => h('option', { value: s, selected: s === e.status }, s)),
      ),
      !e.archived_at &&
        h(
          'button',
          {
            onclick: () => {
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
              main.querySelector('.grid').firstChild.replaceWith(form);
            },
          },
          'Edit',
        ),
      h('button', { onclick: () => (location.hash = `#/graph/${id}`) }, 'Graph'),
      !e.archived_at &&
        ['task', 'issue', 'software.feature'].some((t) => types.get(e.type)?.flavour_of === t || e.type === t) &&
        h(
          'button',
          {
            onclick: async (ev) => {
              const brief = await api('view', { name: 'brief', params: { task: id } });
              await navigator.clipboard.writeText(brief.text);
              ev.target.textContent = 'Brief copied';
            },
            title: 'Copy what a session needs to start on this: context, blockers, resources and rules',
          },
          'Copy session brief',
        ),
      !e.archived_at &&
        ['task', 'issue', 'software.feature'].some((t) => types.get(e.type)?.flavour_of === t || e.type === t) &&
        h(
          'span',
          { class: 'toolbar' },
          h('select', { id: 'launch-mode', title: 'What the session may do with nobody there to approve it' }, h('option', { value: 'plan' }, 'Investigate only'), h('option', { value: 'acceptEdits' }, 'May edit files')),
          h(
            'button',
            {
              onclick: async () => {
                const mode = document.getElementById('launch-mode').value;
                const what = mode === 'plan' ? 'It can read and investigate but not change anything.' : 'It can EDIT FILES in the repository with nobody approving each change. It is told not to commit, push or delete.';
                const instructions = await ask({
                  title: `Launch a headless Claude Code session on "${e.title}"?`,
                  message: what,
                  input: { placeholder: 'Anything to add to its brief? (optional)' },
                  action: 'Launch',
                  danger: mode !== 'plan',
                });
                if (instructions === null) return;
                try {
                  const started = await api('launch', { task: id, mode, instructions: instructions || undefined });
                  location.hash = `#/e/${started.run}`;
                } catch (err) {
                  tell('The session did not start', err.message);
                }
              },
            },
            'Launch session',
          ),
        ),
      !e.archived_at &&
        h('button', { class: 'danger', onclick: async () => (await ask({ title: `Archive "${e.title}"?`, message: 'It leaves every view but stays in the history.', action: 'Archive', danger: true })) && change([{ op: 'archive', id }], 'Archived in the UI') }, 'Archive'),
    ),
    h(
      'div',
      { class: 'grid' },
      h(
        'section',
        { class: 'card wide' },
        h(
          'dl',
          { class: 'fields' },
          h('dt', {}, 'Owner'),
          h('dd', {}, owner ? link(owner) : h('span', { class: 'muted' }, 'nobody')),
          Object.entries(e.props).map(([k, v]) => [h('dt', {}, k.replaceAll('_', ' ')), h('dd', {}, String(v))]),
          h('dt', {}, 'Source'),
          h('dd', {}, data.source ? h('a', { href: `#/e/${data.source.id}` }, data.source.title) : h('span', { class: 'muted' }, 'none recorded')),
          h('dt', {}, 'Updated'),
          h('dd', {}, when(e.updated_at)),
          h('dt', {}, 'Id'),
          h('dd', { class: 'muted' }, e.id),
        ),
        e.body && h('div', { class: 'body-text' }, e.body),
      ),
      h(
        'section',
        { class: 'card wide' },
        h(
          'header',
          {},
          h('h2', {}, 'Relations'),
          h('span', { class: 'toolbar' }, h('span', { class: 'n' }, data.outgoing.length + data.incoming.length), !e.archived_at && phrases.length > 0 && h('button', { onclick: openAdder }, 'Add')),
        ),
        data.outgoing.length + data.incoming.length
          ? h('table', { class: 'list' }, h('tbody', {}, relRows(data.outgoing, 'out'), relRows(data.incoming, 'in')))
          : h('div', { class: 'empty' }, 'Not linked to anything.'),
        adder,
      ),
      h('section', { class: 'card wide' }, h('header', {}, h('h2', {}, 'History')), eventTable(data.recent_events, false)),
    ),
  );
}

// ---- forms ---------------------------------------------------------------

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

  const row = (label, input, hint) => [h('dt', {}, label), h('dd', {}, input, hint && h('div', { class: 'muted small' }, hint))];
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
        .map(([key, def]) => row(key.replaceAll('_', ' '), control(key, def), def.description)),
      row('Notes', h('textarea', { rows: 5, value: state.body, oninput: (e) => (state.body = e.target.value) })),
      row(
        'Who can see it',
        h(
          'select',
          { onchange: (e) => (state.visibility = e.target.value) },
          !initial.id && h('option', { value: '' }, 'Workspace default'),
          [['private', 'Only me'], ['shared', 'Everyone in the workspace']].map(([v, label]) => h('option', { value: v, selected: v === state.visibility }, label)),
        ),
        'Only matters when several people share a workspace.',
      ),
    ),
    error,
    h('div', { class: 'actions' }, save, h('button', { onclick: onCancel }, 'Cancel')),
  );
}

function newEntity(typeId) {
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
      h('div', { class: 'page-head' }, h('h1', {}, 'New'), h('p', { class: 'muted' }, 'You are creating this directly, so it is applied at once.')),
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

// ---- Automations ---------------------------------------------------------

async function automations() {
  const rows = await api('search', { type: 'sys.automation', limit: 200 });
  const describe = (p) => {
    const when = p.trigger === 'every' ? `every ${p.every_minutes} min` : p.trigger === 'daily' ? `daily at ${p.at}` : `when ${p.on_action} is logged`;
    const what = p.action === 'notify' ? `notify: ${p.message ?? '(its title)'}` : p.action === 'tool' ? `call ${p.tool}` : `launch a session (${p.input?.mode ?? 'plan'}) on ${p.input?.task}`;
    return `${when} → ${what}`;
  };
  const toggle = async (a) => {
    await api('change', { ops: [{ op: 'update', id: a.id, status: a.status === 'enabled' ? 'paused' : 'enabled' }], reason: `${a.status === 'enabled' ? 'Paused' : 'Enabled'} in the UI` });
    automations();
  };
  main.replaceChildren(
    h(
      'div',
      { class: 'page-head' },
      h('h1', {}, 'Automations'),
    ),
    h('div', { class: 'toolbar', style: 'margin-bottom: 12px' }, h('button', { class: 'primary', onclick: () => (location.hash = '#/new/sys.automation') }, 'New automation')),
    h(
      'section',
      { class: 'card' },
      rows.length
        ? h(
            'ul',
            { class: 'rows' },
            rows.map((a) =>
              h(
                'li',
                {},
                h('div', { class: 'row-top' }, h('span', { class: 'grow' }, link(a)), h('span', { class: `pill ${a.status === 'enabled' ? 'ok' : 'closed'}` }, a.status), h('button', { onclick: () => toggle(a) }, a.status === 'enabled' ? 'Pause' : 'Enable')),
                h('div', { class: 'row-sub' }, describe(a.props)),
                a.props.last_fired && h('div', { class: `row-sub${String(a.props.last_result).startsWith('failed') ? ' error' : ''}` }, `last fired ${when(a.props.last_fired)} · ${a.props.last_result}`),
              ),
            ),
          )
        : h('div', { class: 'empty' }, 'No automations yet.'),
    ),
  );
}

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
const BLOCKING = ['depends_on', 'needs', 'holds'];
const SVG = 'http://www.w3.org/2000/svg';
const s = (tag, attrs = {}, ...kids) => {
  const el = document.createElementNS(SVG, tag);
  for (const [k, v] of Object.entries(attrs)) if (v != null && v !== false) el.setAttribute(k, v);
  el.append(...kids.filter(Boolean));
  return el;
};

const graphState = { relations: '', depth: 2, closed: false };

/** Place nodes so linked ones sit together and nothing overlaps. Runs to rest before drawing. */
function layout(nodes, edges, width, height) {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  nodes.forEach((n, i) => {
    const angle = (i / nodes.length) * Math.PI * 2;
    const spread = Math.min(width, height) * 0.35;
    n.x = width / 2 + Math.cos(angle) * spread;
    n.y = height / 2 + Math.sin(angle) * spread;
    n.vx = n.vy = 0;
  });
  const ideal = Math.max(70, Math.min(150, Math.sqrt((width * height) / Math.max(nodes.length, 1)) * 0.8));
  for (let step = 0; step < 320; step++) {
    const heat = 1 - step / 320;
    for (let i = 0; i < nodes.length; i++) {
      const a = nodes[i];
      for (let j = i + 1; j < nodes.length; j++) {
        const b = nodes[j];
        let dx = a.x - b.x || 0.01;
        let dy = a.y - b.y || 0.01;
        const d2 = dx * dx + dy * dy;
        // Only near neighbours push apart, or separate clusters drive each other off the page.
        if (d2 > ideal * ideal * 9) continue;
        const push = (ideal * ideal) / d2;
        a.vx += dx * push * 0.05;
        a.vy += dy * push * 0.05;
        b.vx -= dx * push * 0.05;
        b.vy -= dy * push * 0.05;
      }
      a.vx += (width / 2 - a.x) * 0.02;
      a.vy += (height / 2 - a.y) * 0.03;
    }
    for (const e of edges) {
      const a = byId.get(e.from);
      const b = byId.get(e.to);
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const d = Math.hypot(dx, dy) || 1;
      const pull = ((d - ideal) / d) * 0.06;
      a.vx += dx * pull;
      a.vy += dy * pull;
      b.vx -= dx * pull;
      b.vy -= dy * pull;
    }
    for (const n of nodes) {
      const speed = Math.hypot(n.vx, n.vy);
      const cap = 40 * heat + 1;
      if (speed > cap) {
        n.vx *= cap / speed;
        n.vy *= cap / speed;
      }
      n.x += n.vx;
      n.y += n.vy;
      n.vx *= 0.6;
      n.vy *= 0.6;
    }
  }
}

async function graph(focus) {
  const params = { focus: focus || undefined, depth: focus ? graphState.depth : undefined, relations: graphState.relations || undefined, include_closed: graphState.closed };
  const data = await api('view', { name: 'graph', params });
  const focused = focus ? data.nodes.find((n) => n.id === focus) : undefined;
  const redraw = () => graph(focus);

  const width = 1000;
  const height = 640;
  const { nodes, edges } = data;
  layout(nodes, edges, width, height);
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const degree = new Map();
  for (const e of edges) for (const id of [e.from, e.to]) degree.set(id, (degree.get(id) ?? 0) + 1);
  const radius = (n) => 6 + Math.min(degree.get(n.id) ?? 0, 8) * 0.6;
  // Label everything when there is room; otherwise the hubs, and the rest on hover.
  const labelled = (n) => nodes.length <= 45 || n.id === focus || (degree.get(n.id) ?? 0) >= 4;

  const tip = h('div', { class: 'graph-tip', hidden: true });
  const viewport = s('g');
  const svg = s('svg', { viewBox: `0 0 ${width} ${height}`, class: 'graph', role: 'img', 'aria-label': 'Graph of the map' },
    s('defs', {}, s('marker', { id: 'arrow', viewBox: '0 0 10 10', refX: 10, refY: 5, markerWidth: 7, markerHeight: 7, orient: 'auto-start-reverse' }, s('path', { d: 'M0,1 L10,5 L0,9 z', class: 'arrowhead' }))),
    viewport,
  );
  const edgeEls = new Map();
  const nodeEls = new Map();

  const place = (e) => {
    const a = byId.get(e.from);
    const b = byId.get(e.to);
    const d = Math.hypot(b.x - a.x, b.y - a.y) || 1;
    // Stop the line at the edge of each circle so the arrowhead is not hidden.
    const [ax, ay] = [a.x + ((b.x - a.x) / d) * radius(a), a.y + ((b.y - a.y) / d) * radius(a)];
    const [bx, by] = [b.x - ((b.x - a.x) / d) * (radius(b) + 3), b.y - ((b.y - a.y) / d) * (radius(b) + 3)];
    for (const line of edgeEls.get(e.id)) for (const [k, v] of Object.entries({ x1: ax, y1: ay, x2: bx, y2: by })) line.setAttribute(k, v);
  };
  const showTip = (event, ...content) => {
    tip.replaceChildren(...content);
    tip.hidden = false;
    const box = svg.parentElement.getBoundingClientRect();
    tip.style.left = `${Math.min(event.clientX - box.left + 14, box.width - 260)}px`;
    tip.style.top = `${event.clientY - box.top + 14}px`;
  };
  const highlight = (ids) => {
    for (const [id, el] of nodeEls) {
      el.classList.toggle('dim', Boolean(ids) && !ids.has(id));
      el.classList.toggle('near', Boolean(ids) && ids.has(id));
    }
    for (const e of edges) for (const line of edgeEls.get(e.id)) line.classList.toggle('dim', Boolean(ids) && !(ids.has(e.from) && ids.has(e.to)));
  };

  for (const e of edges) {
    const line = s('line', { class: `edge${BLOCKING.includes(e.type) ? ' blocking' : ''}`, 'marker-end': 'url(#arrow)' });
    const hit = s('line', { class: 'edge-hit' });
    hit.addEventListener('mousemove', (ev) => showTip(ev, h('div', {}, byId.get(e.from).title), h('div', { class: 'muted' }, relations.get(e.type)?.title ?? e.type), h('div', {}, byId.get(e.to).title)));
    hit.addEventListener('mouseleave', () => (tip.hidden = true));
    edgeEls.set(e.id, [line, hit]);
    viewport.append(line, hit);
  }
  for (const n of nodes) {
    const group = groupOf(n.root);
    const title = n.title.length > 30 ? n.title.slice(0, 29) + '…' : n.title;
    const el = s(
      'g',
      { class: `node group-${group.key}${n.open ? '' : ' closed'}${n.id === focus ? ' focus' : ''}`, transform: `translate(${n.x},${n.y})` },
      n.blocked && s('circle', { r: radius(n) + 4, class: 'blocked-ring' }),
      s('circle', { r: radius(n), class: 'dot' }),
      s('text', { x: radius(n) + 5, y: 4, class: `label${labelled(n) ? '' : ' quiet'}` }, document.createTextNode(title)),
    );
    const near = new Set([n.id, ...edges.filter((e) => e.from === n.id || e.to === n.id).flatMap((e) => [e.from, e.to])]);
    el.addEventListener('mousemove', (ev) => {
      highlight(near);
      showTip(ev, h('div', {}, chip(n.type), ' ', pill(n.type, n.status), n.blocked && [' ', h('span', { class: 'pill bad' }, 'blocked')]), h('strong', {}, n.title), h('div', { class: 'muted small' }, 'Click to open · double-click to centre the graph here'));
    });
    el.addEventListener('mouseleave', () => {
      highlight(null);
      tip.hidden = true;
    });
    // Drag to move a node; a press without movement is a click.
    el.addEventListener('pointerdown', (down) => {
      down.stopPropagation();
      el.setPointerCapture(down.pointerId);
      let moved = false;
      const scale = () => width / svg.getBoundingClientRect().width / zoom.k;
      const move = (ev) => {
        if (Math.abs(ev.clientX - down.clientX) + Math.abs(ev.clientY - down.clientY) > 3) moved = true;
        n.x += ev.movementX * scale();
        n.y += ev.movementY * scale();
        el.setAttribute('transform', `translate(${n.x},${n.y})`);
        for (const e of edges) if (e.from === n.id || e.to === n.id) place(e);
      };
      const up = () => {
        el.removeEventListener('pointermove', move);
        el.removeEventListener('pointerup', up);
        if (!moved) location.hash = `#/e/${n.id}`;
      };
      el.addEventListener('pointermove', move);
      el.addEventListener('pointerup', up);
    });
    el.addEventListener('dblclick', () => (location.hash = `#/graph/${n.id}`));
    nodeEls.set(n.id, el);
    viewport.append(el);
  }
  edges.forEach(place);

  // Pan by dragging the background; zoom with the wheel, about the pointer.
  const zoom = { k: 1, x: 0, y: 0 };
  const apply = () => viewport.setAttribute('transform', `translate(${zoom.x},${zoom.y}) scale(${zoom.k})`);
  // Start with everything in view, leaving room on the right for labels.
  if (nodes.length) {
    const xs = nodes.map((n) => n.x);
    const ys = nodes.map((n) => n.y);
    const [x0, x1, y0, y1] = [Math.min(...xs) - 30, Math.max(...xs) + 190, Math.min(...ys) - 30, Math.max(...ys) + 30];
    zoom.k = Math.min(width / (x1 - x0), height / (y1 - y0), 1.6);
    zoom.x = (width - (x1 - x0) * zoom.k) / 2 - x0 * zoom.k;
    zoom.y = (height - (y1 - y0) * zoom.k) / 2 - y0 * zoom.k;
    apply();
  }
  svg.addEventListener('wheel', (ev) => {
    ev.preventDefault();
    const box = svg.getBoundingClientRect();
    const px = ((ev.clientX - box.left) / box.width) * width;
    const py = ((ev.clientY - box.top) / box.height) * height;
    const k = Math.min(4, Math.max(0.3, zoom.k * (ev.deltaY < 0 ? 1.15 : 1 / 1.15)));
    zoom.x = px - ((px - zoom.x) / zoom.k) * k;
    zoom.y = py - ((py - zoom.y) / zoom.k) * k;
    zoom.k = k;
    apply();
  }, { passive: false });
  svg.addEventListener('pointerdown', (down) => {
    svg.setPointerCapture(down.pointerId);
    const ratio = width / svg.getBoundingClientRect().width;
    const move = (ev) => {
      zoom.x += ev.movementX * ratio;
      zoom.y += ev.movementY * ratio;
      apply();
    };
    const up = () => {
      svg.removeEventListener('pointermove', move);
      svg.removeEventListener('pointerup', up);
    };
    svg.addEventListener('pointermove', move);
    svg.addEventListener('pointerup', up);
  });

  const present = new Set(nodes.map((n) => groupOf(n.root).key));
  const preset = data.preset;
  main.replaceChildren(
    h(
      'div',
      { class: 'page-head' },
      h('h1', {}, focused ? ['Around: ', focused.title] : 'Graph'),
    ),
    h(
      'div',
      { class: 'toolbar', style: 'margin-bottom: 12px' },
      h(
        'select',
        {
          title: 'Which relations to draw',
          onchange: (e) => {
            graphState.relations = e.target.value;
            redraw();
          },
        },
        [['blocking', 'What blocks what'], ['structure', 'What belongs to what'], ['all', 'Every relation']].map(([v, label]) => h('option', { value: v, selected: v === preset }, label)),
      ),
      focus &&
        h(
          'select',
          {
            title: 'How far out from the centre to go',
            onchange: (e) => {
              graphState.depth = Number(e.target.value);
              redraw();
            },
          },
          [1, 2, 3, 4].map((d) => h('option', { value: d, selected: d === graphState.depth }, `${d} step${d === 1 ? '' : 's'} out`)),
        ),
      h(
        'label',
        {},
        h('input', {
          type: 'checkbox',
          checked: graphState.closed,
          onchange: (e) => {
            graphState.closed = e.target.checked;
            redraw();
          },
        }),
        ' Include finished',
      ),
      focus && h('button', { onclick: () => (location.hash = '#/graph') }, 'Show the whole map'),
      h('span', { class: 'muted small' }, `${nodes.length} entities, ${edges.length} relations`, data.truncated && ` (showing ${data.truncated.shown} of ${data.truncated.of})`),
    ),
    h(
      'section',
      { class: 'card graph-card' },
      nodes.length ? [svg, tip] : h('div', { class: 'empty' }, 'Nothing to draw with these settings.'),
      h(
        'div',
        { class: 'legend' },
        GROUPS.filter((g) => present.has(g.key)).map((g) => h('span', { class: 'key' }, h('span', { class: `swatch group-${g.key}` }), g.label)),
        nodes.some((n) => !n.open) && h('span', { class: 'key' }, h('span', { class: 'swatch hollow' }), 'Finished'),
        nodes.some((n) => n.blocked) && h('span', { class: 'key' }, h('span', { class: 'swatch ringed' }), 'Blocked'),
        edges.some((e) => BLOCKING.includes(e.type)) && h('span', { class: 'key' }, h('span', { class: 'stroke blocking' }), 'Blocking relation (arrow points at what is needed)'),
        edges.some((e) => !BLOCKING.includes(e.type)) && h('span', { class: 'key' }, h('span', { class: 'stroke' }), 'Other relation'),
      ),
    ),
  );
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
  const windows = /win/i.test(navigator.platform);
  const set = windows
    ? `setx LATTICE_URL "${location.origin}"\nsetx LATTICE_AGENT_TOKEN "${made.token}"`
    : `echo 'export LATTICE_URL="${location.origin}"' >> ~/.zshenv\necho 'export LATTICE_AGENT_TOKEN="${made.token}"' >> ~/.zshenv`;
  const file = `{\n  "mcpServers": {\n    "lattice": {\n      "type": "http",\n      "url": "\${LATTICE_URL:-http://127.0.0.1:3100}/mcp",\n      "headers": { "Authorization": "Bearer \${LATTICE_AGENT_TOKEN:-none}" }\n    }\n  }\n}`;
  const copy = (text, label) => h('button', { onclick: (e) => navigator.clipboard.writeText(text).then(() => (e.target.textContent = 'Copied')) }, label);
  return h(
    'div',
    { class: 'secret' },
    h('div', {}, h('strong', {}, `Connect Claude Code as "${made.name}"`)),
    h('div', { class: 'muted small' }, `1. Once on this machine, in a terminal${windows ? '' : ' (zsh; for the desktop app on a Mac also run each with "launchctl setenv NAME value")'}. Then quit Claude Code completely and open it again.`),
    h('code', { style: 'white-space: pre-wrap' }, set),
    h('div', { class: 'toolbar' }, copy(set, 'Copy commands'), h('span', { class: 'muted small' }, 'Shown once: they hold the token. Revoke it below to disconnect.')),
    h('div', { class: 'muted small', style: 'margin-top: 10px' }, '2. Once in each project: a file named .mcp.json in its folder with this in it. It holds no secret, so it can be committed.'),
    h('code', { style: 'white-space: pre-wrap' }, file),
    h('div', { class: 'toolbar' }, copy(file, 'Copy file')),
  );
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
    h('header', {}, h('h2', {}, 'Import a backup'), h('span', { class: 'n' }, 'Merge a map kept elsewhere into this one.')),
    h('div', { class: 'empty' }, 'Matched by id. What the file has and this map lacks is added; where both have something, the later edit wins; nothing is deleted. You are shown what would change first.'),
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
    const url = location.origin + s.webhook_path;
    const fresh = async () => {
      if (s.connected && !(await ask({ title: 'Make a new secret?', message: 'The one GitHub has now stops working until you replace it in each repository\'s webhook.', action: 'New secret', danger: true }))) return;
      draw(await api('github', { new_secret: true })).catch(fail);
    };
    body.replaceChildren(
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
      h('div', { class: 'toolbar', style: 'padding: 12px 14px' }, s.connected && h('code', { class: 'grow' }, url), h('button', { class: s.connected ? '' : 'primary', onclick: fresh }, s.connected ? 'New secret' : 'Connect GitHub')),
    );
  };
  const fail = (err) => body.replaceChildren(h('div', { class: 'error' }, err.message));
  draw().catch(fail);
  return h('section', { class: 'card wide' }, h('header', {}, h('h2', {}, 'GitHub'), h('span', { class: 'n' }, 'Pushes keep the map current.')), body);
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
        h('div', { class: 'empty' }, 'Creating and listing workspaces needs the operator secret, printed the first time the server started with tokens on. If it is lost, run "node src/cli.ts operator-reset" on the server.'),
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
  return h('section', { class: 'card wide' }, h('header', {}, h('h2', {}, 'Installation'), h('span', { class: 'n' }, 'Every workspace on this server. For whoever runs it.')), body);
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
    h('header', {}, h('h2', {}, 'Owner'), h('span', { class: 'n' }, 'Whose work Home is about.')),
    owner
      ? h('ul', { class: 'rows' }, h('li', { class: 'row-top' }, chip('person'), h('span', { class: 'grow' }, link(owner))))
      : [h('div', { class: 'empty' }, 'This workspace has no owner yet. Enter your name to become it; a person is created for you in the map.'), h('div', { class: 'toolbar', style: 'padding: 0 14px 12px' }, name, email, h('button', { class: 'primary', onclick: set }, 'Set owner')), error],
  );
}

async function workspace() {
  const me = await (await fetch('/whoami', { headers: authHeaders() })).json();
  const head = h('div', { class: 'page-head' }, h('h1', {}, 'Workspace'), h('p', { class: 'muted' }, me.workspace.name, ' \u00b7 ', h('a', { href: '#/automations' }, 'Automations')));
  if (me.auth !== 'tokens') {
    const { owner } = await api('workspace_info');
    return main.replaceChildren(
      head,
      h('div', { class: 'grid', style: 'margin-bottom: 14px' }, ownerCard(owner, workspace)),
      h(
        'section',
        { class: 'card' },
        h(
          'div',
          { class: 'empty' },
          'This server is in single-user mode: one workspace, no sign-in, and everything you do here is done as its owner. To share it with other people or separate customers, set "auth": "tokens" in lattice.config.json and restart; the first start prints your token.',
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
        h('span', { class: 'grow' }, h('strong', {}, t.name), t.admin && [' ', h('span', { class: 'pill' }, 'admin')], t.id === me.actor.token && [' ', h('span', { class: 'pill ok' }, 'this session')]),
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
      h('div', { class: 'row-sub' }, t.entity_id ? `for ${personName(t.entity_id) ?? t.entity_id}` : 'not tied to a person', ` · ends in ${t.hint} · `, t.last_used ? `last used ${when(t.last_used)}` : 'never used', t.expires_at && ` · expires ${when(t.expires_at)}`),
    );

  const agentName = h('input', { type: 'text', placeholder: 'Name (claude-code)', style: 'flex: 1; min-width: 180px' });
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
      (me.actor.admin || !info.owner) && ownerCard(info.owner, workspace),
      h(
        'section',
        { class: 'card wide' },
        h('header', {}, h('h2', {}, 'Agent tokens'), h('span', { class: 'n' }, 'An agent with one of these acts for you: it sees what you see and proposes to you.')),
        h('ul', { class: 'rows' }, live.filter((t) => t.kind === 'agent').map(tokenRow)),
        h(
          'div',
          { class: 'toolbar', style: 'padding: 12px 14px' },
          agentName,
          h(
            'button',
            {
              class: 'primary',
              onclick: () =>
                api('token_create', { kind: 'agent', name: agentName.value.trim() || 'claude-code' })
                  .then((made) => workspace().then(() => document.getElementById('main').children[1].replaceChildren(connectBox(made))))
                  .catch(fail),
            },
            'Connect an agent',
          ),
          h(
            'button',
            {
              title: 'For an agent that is not Claude Code: the bare token, to send as Authorization: Bearer',
              onclick: () =>
                api('token_create', { kind: 'agent', name: agentName.value.trim() || 'agent' })
                  .then((made) => workspace().then(() => document.getElementById('main').children[1].replaceChildren(secretBox(`Token for ${made.name}`, made.token))))
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
          h('header', {}, h('h2', {}, 'Members'), h('span', { class: 'n' }, 'People who can sign in to this workspace.')),
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
                    .then((made) => workspace().then(() => document.getElementById('main').children[1].replaceChildren(secretBox(`Sign-in token for ${memberName.value.trim()}. Send it to them privately.`, made.token))))
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
              h('div', { class: 'muted small' }, 'Either way every change is in the log with who made it and why, and can be undone. Held, the answer to a decision or a hypothesis waits for you too. Taking effect, an agent can settle one: it has to say what was chosen and why, and you are notified on Home.'),
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
              h('div', { class: 'muted small' }, `Other workspaces on this server that may send this one notifications. This workspace's id is "${info.id}".`),
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
  if (ev.action === 'entity.update') return Object.entries(d.changes ?? {}).map(([k, c]) => `${k}: ${short(c.from)} → ${short(c.to)}`).join('; ');
  if (ev.action === 'changeset.undo') return `undid ${d.undoes}${d.skipped?.length ? `, ${d.skipped.length} left alone` : ''}`;
  if (ev.action === 'relation.link' || ev.action === 'relation.unlink') return `${relations.get(d.type)?.title ?? d.type} ${d.to}`;
  if (ev.action === 'entity.create') return `${typeTitle(d.type)}, ${d.status ?? ''}`;
  if (ev.action === 'proposal.supersede') return `${d.proposal} asked only for what ${d.by} had already made so`;
  if (ev.action.startsWith('proposal.')) return `${d.proposal}${d.revised ? ', with corrections' : ''}`;
  if (ev.action === 'connection.check') return `${d.from} → ${d.to}`;
  if (ev.action.startsWith('resource.')) return d.holder_title ?? d.holder ?? '';
  return '';
}

function eventTable(events, withTarget = true) {
  if (!events.length) return h('div', { class: 'empty' }, 'No activity.');
  return h(
    'table',
    { class: `list events${withTarget ? '' : ' no-target'}` },
    h(
      'tbody',
      {},
      events.map((ev) =>
        h(
          'tr',
          {},
          h('td', { class: 'nowrap muted' }, when(ev.ts)),
          h('td', { class: 'nowrap' }, ev.actor),
          h('td', { class: 'nowrap' }, ev.action),
          withTarget && h('td', {}, ev.target_id ? h('a', { href: `#/e/${ev.target_id}` }, ev.target_title ?? ev.target_id) : ''),
          h('td', { class: 'muted' }, describeEvent(ev), ev.detail?.approved_by && ` · applied by ${ev.detail.approved_by}`, !withTarget && ev.reason && ` · ${ev.reason}`),
        ),
      ),
    ),
  );
}

const activityState = { origin: '' };

async function activity() {
  const list = h('div');
  const run = async () => {
    const events = await api('events', { limit: 500, origin: activityState.origin || undefined });
    const undoneSets = new Set(events.filter((e) => e.action === 'changeset.undo').map((e) => e.detail?.undoes));
    // Fold each changeset into one line: one decision, many effects.
    const groups = [];
    for (const ev of events) {
      const last = groups.at(-1);
      if (ev.changeset && last?.changeset === ev.changeset) last.events.push(ev);
      else groups.push({ changeset: ev.changeset, events: [ev] });
    }
    list.replaceChildren(
      ...groups.map((g) => {
        const first = g.events[0];
        if (!g.changeset) return eventTable(g.events);
        const undone = g.events.some((e) => e.action === 'changeset.undo') || undoneSets.has(g.changeset);
        // The newest event in an approved changeset is the approval itself;
        // the line should name who made the change, then who approved it.
        const work = g.events.find((e) => !e.action.startsWith('proposal.')) ?? first;
        const approver = work.detail?.approved_by;
        return h(
          'details',
          { class: 'group' },
          h('summary', {}, h('span', { class: 'muted nowrap' }, when(first.ts)), h('span', {}, work.actor, approver && h('span', { class: 'muted' }, `, applied by ${approver}`), !approver && work.detail?.authority && h('span', { class: 'muted' }, `, ${authorityText(work.detail.authority)}`)), h('strong', { class: 'grow', style: 'flex-basis: 100%' }, g.events.find((e) => e.reason && e.reason !== 'Source of this change')?.reason ?? first.action), h('span', { class: 'chip' }, `${g.events.length} change${g.events.length === 1 ? '' : 's'}`),
            undone
              ? h('span', { class: 'pill closed' }, g.events.some((e) => e.action === 'changeset.undo') ? 'an undo' : 'undone')
              : h(
                  'button',
                  {
                    onclick: async (click) => {
                      click.preventDefault();
                      if (!(await ask({ title: 'Undo this change set?', message: 'The opposite is applied as a new change; nothing is erased from the log.', action: 'Undo' }))) return;
                      try {
                        const r = await api('undo', { changeset: g.changeset });
                        if (r.skipped.length) await tell('Undone, except:', `- ${r.skipped.join('\n- ')}`);
                        run();
                      } catch (err) {
                        tell('That was not undone', err.message);
                      }
                    },
                  },
                  'Undo',
                ),
          ),
          h('div', { class: 'inner' }, eventTable(g.events)),
        );
      }),
    );
    if (!events.length) list.replaceChildren(h('div', { class: 'empty' }, 'No activity.'));
  };
  main.replaceChildren(
    h('div', { class: 'page-head' }, h('h1', {}, 'Activity'), mapTabs('activity')),
    h(
      'div',
      { class: 'toolbar', style: 'margin-bottom: 12px' },
      h(
        'select',
        {
          onchange: (e) => {
            activityState.origin = e.target.value;
            run();
          },
        },
        [['', 'Everything'], ['lattice', 'Changes to the map'], ['github', 'Pushes heard from GitHub'], ['external', 'External tool calls']].map(([v, label]) => h('option', { value: v, selected: v === activityState.origin }, label)),
      ),
    ),
    h('section', { class: 'card' }, list),
  );
  run().catch((err) => list.replaceChildren(h('div', { class: 'error' }, err.message)));
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

// The roadmap drawn so that position means order of work: the project on the
// left, then each feature one column to the right of everything it waits on.
// Arrows run from what is needed to what needs it. A feature also waits on
// another when one of its tasks waits on one of the other's. It is laid out,
// not simulated, so it looks the same every time.
function roadmapGraph(data, withWork) {
  const COL = 310;
  const BOX = { w: 232, h: 42 };
  const ROW = 20;
  const cut = (text, max) => (text.length > max ? text.slice(0, max - 1) + '…' : text);

  const nodes = [];
  const owner = new Map();
  const titles = new Map();
  const add = (b, parent, i) => {
    const n = { ...b, kind: 'branch', place: i + 1, parent, work: withWork ? b.work : [], needs: new Map() };
    nodes.push(n);
    owner.set(b.id, n);
    titles.set(b.id, b.title);
    for (const w of b.work) {
      owner.set(w.id, n);
      titles.set(w.id, w.title);
    }
    b.branches.forEach((k, j) => add(k, n, j));
  };
  data.branches.forEach((b, i) => add(b, null, i));
  for (const d of data.depends) {
    const [a, b] = [owner.get(d.from), owner.get(d.to)];
    if (!a || !b || a === b) continue;
    const direct = a.id === d.from && b.id === d.to;
    const known = a.needs.get(b) ?? { direct: false, why: [] };
    a.needs.set(b, { direct: known.direct || direct, why: direct ? known.why : [...known.why, `${titles.get(d.from)} waits on ${titles.get(d.to)}`] });
  }

  // A feature's column is one past the furthest thing it waits on (or is part of).
  const level = (n, trail = new Set()) => {
    if (n.level !== undefined) return n.level;
    if (trail.has(n)) return 0; // a loop of dependencies: stop going round
    trail.add(n);
    let at = n.parent ? level(n.parent, trail) + 1 : 0;
    for (const p of n.needs.keys()) at = Math.max(at, level(p, trail) + 1);
    trail.delete(n);
    return (n.level = at);
  };
  const cols = [];
  for (const n of nodes) (cols[level(n)] ??= []).push(n);
  const tall = (n) => BOX.h + (n.work.length ? n.work.length * ROW + 8 : 0);
  // The first column keeps roadmap order. Each later one sits as near as it can
  // to what it waits on, so arrows stay short.
  let bottom = 0;
  cols.forEach((col, i) => {
    const near = (n) => {
      const from = [...n.needs.keys(), ...(n.parent ? [n.parent] : [])].filter((p) => p.y !== undefined);
      return from.length ? from.reduce((sum, p) => sum + p.y, 0) / from.length : undefined;
    };
    const wanted = new Map(col.map((n) => [n, i ? near(n) : undefined]));
    const ordered = i ? [...col].sort((a, b) => (wanted.get(a) ?? Infinity) - (wanted.get(b) ?? Infinity) || col.indexOf(a) - col.indexOf(b)) : col;
    let y = 0;
    for (const n of ordered) {
      n.x = (i + 1) * COL;
      n.y = Math.max(y, wanted.get(n) ?? y);
      y = n.y + tall(n) + 12;
    }
    bottom = Math.max(bottom, y);
  });
  const first = cols[0] ?? [];
  const root = { ...data.root, kind: 'root', open: true, progress: data.progress, work: withWork ? data.unplaced : [], x: 0 };
  root.y = first.length ? Math.max(0, (first.at(-1).y + BOX.h) / 2 - BOX.h / 2) : 0;
  bottom = Math.max(bottom, root.y + tall(root) + 12);

  const pad = 16;
  const width = cols.length * COL + BOX.w + 40 + pad * 2;
  const height = bottom + pad * 2;
  const inner = s('g', { transform: `translate(${pad},${pad})` });
  const mid = (n) => n.y + BOX.h / 2;
  const curve = (x1, y1, x2, y2) => `M${x1},${y1} C${(x1 + x2) / 2},${y1} ${(x1 + x2) / 2},${y2} ${x2},${y2}`;
  let waiting = false;
  let met = false;
  let lifted = false;
  for (const n of nodes) {
    // Belonging: to the project when nothing else places it, or to the feature it is part of.
    if (n.parent) inner.append(s('path', { class: 'rm-link', d: curve(n.parent.x + BOX.w, mid(n.parent), n.x, mid(n)) }));
    else if (!n.needs.size) inner.append(s('path', { class: 'rm-link', d: curve(BOX.w, mid(root), n.x, mid(n)) }));
    for (const [p, info] of n.needs) {
      waiting ||= p.open;
      met ||= !p.open;
      lifted ||= !info.direct;
      inner.append(
        s(
          'path',
          { class: `rm-dep${p.open ? ' waiting' : ''}${info.direct ? '' : ' lifted'}`, 'marker-end': `url(#rm-arrow${p.open ? '-wait' : ''})`, d: curve(p.x + BOX.w, mid(p), n.x - 2, mid(n)) },
          s('title', {}, document.createTextNode([`${n.title} waits on ${p.title}${p.open ? '' : ' (finished)'}`, ...info.why].join('\n'))),
        ),
      );
    }
  }
  for (const n of [root, ...nodes]) {
    const state = (x) => `${x.open ? '' : ' closed'}${x.active ? ' active' : ''}${x.blocked ? ' blocked' : ''}`;
    const hint = (x) => s('title', {}, document.createTextNode(`${x.title}\n${typeTitle(x.type)}, ${x.status}${x.blocked ? ', blocked' : ''}${x.sessions?.length ? ', session open' : ''}`));
    const open = (x) => () => (location.hash = `#/e/${x.id}`);
    const { done, total } = n.progress;
    const box = s(
      'g',
      { class: `rm-node ${n.kind}${state(n)}`, transform: `translate(${n.x},${n.y})` },
      hint(n),
      s('rect', { class: 'box', width: BOX.w, height: BOX.h, rx: 7 }),
      s('text', { x: 10, y: 17 }, document.createTextNode(cut(n.place ? `${n.place}. ${n.title}` : n.title, 34))),
      total > 0 && s('rect', { class: 'track', x: 10, y: 27, width: 80, height: 5, rx: 2.5 }),
      total > 0 && s('rect', { class: 'fill', x: 10, y: 27, width: (80 * done) / total, height: 5, rx: 2.5 }),
      s('text', { class: 'small', x: total ? 96 : 10, y: 33 }, document.createTextNode(total ? `${done}/${total}` : 'no tasks')),
      s('text', { class: 'small', x: BOX.w - 10, y: 33, 'text-anchor': 'end' }, document.createTextNode(n.kind === 'root' ? '' : n.status)),
      n.blocked && s('circle', { class: 'flag', cx: BOX.w - 4, cy: 4, r: 5 }),
    );
    box.addEventListener('click', open(n));
    inner.append(box);
    n.work.forEach((w, j) => {
      const el = s('g', { class: `rm-node work${state(w)}`, transform: `translate(${n.x + 12},${n.y + BOX.h + 8 + j * ROW + ROW / 2})` }, hint(w), s('circle', { cx: 6, r: 4.5 }), s('text', { x: 17, y: 4 }, document.createTextNode(cut(w.title, 36))));
      el.addEventListener('click', open(w));
      inner.append(el);
    });
  }
  const marker = (id, cls) => s('marker', { id, viewBox: '0 0 10 10', refX: 9, refY: 5, markerWidth: 7, markerHeight: 7, orient: 'auto-start-reverse' }, s('path', { d: 'M0,1 L10,5 L0,9 z', class: cls }));
  const svg = s('svg', { width, height, viewBox: `0 0 ${width} ${height}`, role: 'img', 'aria-label': 'The roadmap, laid out by what waits on what' }, s('defs', {}, marker('rm-arrow', 'rm-arrowhead'), marker('rm-arrow-wait', 'rm-arrowhead wait')), inner);
  const everything = [root, ...nodes].flatMap((n) => [n, ...n.work]);
  return h(
    'div',
    {},
    h('div', { class: 'roadmap-graph' }, svg),
    h(
      'div',
      { class: 'legend' },
      h('span', { class: 'key' }, 'Left to right: what has to come first'),
      waiting && h('span', { class: 'key' }, h('span', { class: 'stroke waits' }), 'Waits on something unfinished'),
      met && h('span', { class: 'key' }, h('span', { class: 'stroke blocking' }), 'Waited on something now finished'),
      lifted && h('span', { class: 'key' }, h('span', { class: 'stroke lifted' }), 'Through their tasks'),
      everything.some((n) => n.active) && h('span', { class: 'key' }, h('span', { class: 'swatch rm-active' }), 'Being worked on'),
      everything.some((n) => !n.open) && h('span', { class: 'key' }, h('span', { class: 'swatch rm-closed' }), 'Finished'),
      everything.some((n) => n.blocked) && h('span', { class: 'key' }, h('span', { class: 'swatch rm-blocked' }), 'Blocked'),
    ),
  );
}

const roadmapState = {
  get graph() {
    try {
      return localStorage.getItem('lattice-roadmap-as') === 'graph';
    } catch {
      return false;
    }
  },
  set graph(value) {
    try {
      localStorage.setItem('lattice-roadmap-as', value ? 'graph' : 'list');
    } catch {
      // Without storage the list is shown each time.
    }
  },
  work: true,
};

async function roadmap(rootId) {
  const remembered = () => {
    try {
      return localStorage.getItem('lattice-roadmap') ?? '';
    } catch {
      return '';
    }
  };
  const { roots } = await api('view', { name: 'tree', params: { tree: 'software.roadmap' } });
  if (!rootId) {
    const last = roots.find((r) => r.id === remembered()) ?? roots.find((r) => r.branches > 0);
    if (last) return void (location.hash = `#/roadmap/${last.id}`);
    return main.replaceChildren(h('div', { class: 'page-head' }, h('h1', {}, 'Roadmap')), h('section', { class: 'card' }, h('div', { class: 'empty' }, 'No project has features yet. Create a feature and make it part of a project.')));
  }
  try {
    localStorage.setItem('lattice-roadmap', rootId);
  } catch {
    // Remembering the project is a convenience only.
  }
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
          h('span', { class: 'grow' }, link(b), b.active && [' ', h('span', { class: 'pill warn' }, 'working here')]),
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

  main.replaceChildren(
    h(
      'div',
      { class: 'page-head' },
      h('h1', {}, 'Roadmap'),
    ),
    h(
      'div',
      { class: 'toolbar', style: 'margin-bottom: 14px' },
      h('select', { onchange: (e) => (location.hash = `#/roadmap/${e.target.value}`) }, roots.map((r) => h('option', { value: r.id, selected: r.id === rootId }, `${r.title} (${r.branches})`))),
      h('a', { href: `#/questions/${rootId}` }, 'Questions'),
      h('a', { href: `#/e/${rootId}` }, 'Open project'),
      h(
        'span',
        { class: 'switch' },
        [['List', false], ['Graph', true]].map(([label, graph]) => h('button', { class: asGraph === graph ? 'on' : '', onclick: () => ((roadmapState.graph = graph), roadmap(rootId)) }, label)),
      ),
      asGraph && h('label', {}, h('input', { type: 'checkbox', checked: roadmapState.work, onchange: (e) => ((roadmapState.work = e.target.checked), roadmap(rootId)) }), ' Tasks'),
      h('span', { class: 'grow' }),
      statuses.map((st) => h('span', { class: `pill${isClosed('software.feature', st) ? ' closed' : ''}` }, `${data.by_status[st]} ${st}`)),
      progressBar(data.progress),
    ),
    h(
      'div',
      { class: 'grid' },
      h(
        'section',
        { class: 'card wide' },
        h('header', {}, h('h2', {}, 'Working now'), h('span', { class: 'n' }, data.now.length)),
        data.now.length
          ? h('ul', { class: 'rows' }, data.now.map((n) => h('li', {}, h('div', { class: 'row-top' }, chip(n.type), h('span', { class: 'grow' }, link(n)), working(n), pill(n.type, n.status)), n.path.length > 0 && h('div', { class: 'row-sub' }, n.path.join(' › ')))))
          : h('div', { class: 'empty' }, 'Nothing is marked as being built, and no session is open on anything here.'),
      ),
      h(
        'section',
        { class: 'card wide' },
        h('header', {}, h('h2', {}, 'Features'), h('span', { class: 'n' }, features.length)),
        !data.branches.length ? h('div', { class: 'empty' }, 'No features yet.') : asGraph ? roadmapGraph(data, roadmapState.work) : h('ul', { class: 'tree top' }, data.branches.map(branch)),
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
  const first = (q.body ?? '').replace(/\s+/g, ' ').trim();
  const preview = !plain && first && h('div', { class: 'row-sub', hidden: openQuestions.has(q.id) }, first.length > 150 ? `${first.slice(0, 150)}\u2026` : first);
  const more = h(
    'div',
    { class: 'question-more', hidden: !openQuestions.has(q.id) },
    q.body && h('div', { class: 'question-body' }, q.body),
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
      : h('div', { class: 'row-top' }, chip(q.type), h('strong', { class: 'grow' }, link(q)), where, q.due && h('span', { class: 'pill warn' }, `due ${q.due}`), q.holds_up > 0 && h('span', { class: 'pill bad' }, `holds up ${q.holds_up}`), toggle),
    preview,
    more,
  );
};

// One project's open questions, to be worked through from the top: what holds
// up the most comes first, and each is answered where it stands.
async function questions(rootId) {
  const remembered = () => {
    try {
      return localStorage.getItem('lattice-roadmap') ?? '';
    } catch {
      return '';
    }
  };
  const { projects } = await api('view', { name: 'questions' });
  if (!rootId) {
    const last = projects.find((p) => p.id === remembered()) ?? projects.find((p) => p.questions > 0) ?? projects[0];
    if (last) return void (location.hash = `#/questions/${last.id}`);
    return main.replaceChildren(h('div', { class: 'page-head' }, h('h1', {}, 'Questions')), h('section', { class: 'card' }, h('div', { class: 'empty' }, 'There are no projects yet.')));
  }
  try {
    localStorage.setItem('lattice-roadmap', rootId);
  } catch {
    // Remembering the project is a convenience only.
  }
  const data = await api('view', { name: 'questions', params: { project: rootId } });
  const change = async (ops, reason) => {
    try {
      await api('change', { ops, reason });
      dirty = false;
      questions(rootId);
    } catch (err) {
      tell('That change was not made', err.message);
    }
  };
  const question = (q) => questionItem(q, change);
  const settledRow = (q) =>
    h(
      'li',
      {},
      h(
        'div',
        { class: 'row-top' },
        chip(q.type),
        h('span', { class: 'grow' }, link(q), q.outcome && [' ', h('span', { class: 'arrow' }, '→'), ' ', h('strong', {}, q.outcome)]),
        pill(q.type, q.status),
        h('button', { onclick: async () => (await ask({ title: 'Open this question again?', message: q.title, action: 'Reopen' })) && change([{ op: 'update', id: q.id, status: statusesOf(q.type)[0], ...(q.kind === 'decision' && { props: { outcome: null, rationale: null, decided_on: null } }) }], 'Reopened in the UI') }, 'Reopen'),
      ),
      (q.rationale || q.decided_on) && h('div', { class: 'row-sub' }, [q.rationale, q.decided_on && `decided ${q.decided_on}`].filter(Boolean).join(' · ')),
    );

  const held = new Set(data.open.flatMap((q) => q.waiting.map((w) => w.id))).size;
  main.replaceChildren(
    h('div', { class: 'page-head' }, h('h1', {}, 'Questions')),
    h(
      'div',
      { class: 'toolbar', style: 'margin-bottom: 14px' },
      h('select', { onchange: (e) => (location.hash = `#/questions/${e.target.value}`) }, projects.map((p) => h('option', { value: p.id, selected: p.id === rootId }, `${p.title} (${p.questions})`))),
      h('a', { href: `#/e/${rootId}` }, 'Open project'),
      h('a', { href: `#/roadmap/${rootId}` }, 'Roadmap'),
      h('span', { class: 'grow' }),
      h('span', { class: 'muted' }, `${data.open.length} open`, held > 0 && `, ${held} thing${held === 1 ? '' : 's'} waiting on them`),
    ),
    h(
      'div',
      { class: 'grid' },
      h(
        'section',
        { class: 'card wide' },
        h('header', {}, h('h2', {}, 'Open'), h('span', { class: 'n' }, data.open.length)),
        data.open.length ? h('ul', { class: 'rows' }, data.open.map(question)) : h('div', { class: 'empty' }, 'Nothing is undecided here.'),
      ),
      data.settled.length > 0 && h('section', { class: 'card wide' }, h('header', {}, h('h2', {}, 'Settled lately'), h('span', { class: 'n' }, data.settled.length)), h('ul', { class: 'rows' }, data.settled.map(settledRow))),
    ),
  );
}

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
      return localStorage.getItem('lattice-follow') !== 'off';
    } catch {
      return true;
    }
  },
  set on(value) {
    try {
      localStorage.setItem('lattice-follow', value ? 'on' : 'off');
    } catch {
      // Without storage the choice lasts until the page is reloaded.
    }
  },
};
const followBox = document.querySelector('#follow input');
followBox.checked = following.on;
followBox.addEventListener('change', () => (following.on = followBox.checked));
const followed = h('div', { id: 'followed', hidden: true });
document.body.append(followed);
let seenFocus;
let followedTimer;

function follow(focus) {
  // The first answer only says where things stand; an old pointer is not followed.
  const fresh = seenFocus !== undefined && focus && focus.at !== seenFocus;
  seenFocus = focus?.at ?? 0;
  if (!fresh || !following.on) return;
  const there = `#/${focus.hash}`;
  const busy = dirty || document.querySelector('dialog[open]');
  followed.replaceChildren(
    ...[
      h('strong', {}, focus.actor),
      h('span', { class: 'grow' }, focus.note ?? (busy ? 'is working somewhere else' : 'brought you here')),
      busy && location.hash !== there && h('button', { onclick: () => ((location.hash = there), (followed.hidden = true)) }, 'Go there'),
      h('button', { title: 'Stop following agents', onclick: () => ((following.on = followBox.checked = false), (followed.hidden = true)) }, 'Stop following'),
    ].filter(Boolean),
  );
  followed.hidden = false;
  clearTimeout(followedTimer);
  followedTimer = setTimeout(() => (followed.hidden = true), 12000);
  if (!busy && location.hash !== there) location.hash = there;
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
      stale.firstChild.textContent = 'Lattice has been updated.';
      stale.hidden = false;
    }
    uiFiles ??= beat.ui;
    // Whether an agent will hear what is done here the moment it is done.
    const ear = document.getElementById('listening');
    ear.hidden = !beat.listening;
    ear.textContent = beat.listening > 1 ? `${beat.listening} agents are listening` : 'An agent is listening';
    follow(beat.focus);
  } catch {
    return;
  }
  const moved = pulse !== undefined && now !== pulse;
  pulse = now;
  if (!moved) return;
  if (dirty || document.querySelector('dialog[open]') || /^#\/(graph|new)/.test(location.hash)) {
    refreshReviewCount();
    stale.hidden = false;
    return;
  }
  // Hold the page's height while it is redrawn, so the scroll position stays.
  main.style.minHeight = `${main.offsetHeight}px`;
  await route();
  setTimeout(() => (main.style.minHeight = ''), 1000);
}
setInterval(checkPulse, 2000);
document.addEventListener('visibilitychange', checkPulse);

// ---- routing -------------------------------------------------------------

// Projects are on Home now; the old address still leads there.
const ROUTES = { today, review, map, activity, automations, graph, roadmap, questions, workspace, projects: () => void (location.hash = '#/today') };
// Where each screen sits in the menu, for the ones that are not in it themselves.
const UNDER = { e: 'map', new: 'map', activity: 'map', graph: 'map', review: 'today', roadmap: 'today', questions: 'today', projects: 'today', automations: 'workspace' };

async function route() {
  const [, name = 'today', arg] = location.hash.split('/');
  dirty = false;
  stale.hidden = true;
  for (const a of document.querySelectorAll('#nav a')) a.classList.toggle('active', a.dataset.route === (UNDER[name] ?? name));
  try {
    if (!schema) await loadSchema();
    if (name === 'e' && arg) await entity(arg);
    else if (name === 'graph') await graph(arg);
    else if (name === 'roadmap') await roadmap(arg);
    else if (name === 'questions') await questions(arg);
    else if (name === 'new') newEntity(arg);
    else await (ROUTES[name] ?? today)();
  } catch (err) {
    if (err instanceof SignInNeeded) return signIn(store.token ? 'Your token is no longer accepted.' : '');
    main.replaceChildren(h('div', { class: 'error' }, err.message));
  }
  refreshReviewCount();
  showIdentity();
}

window.addEventListener('hashchange', route);
route();
