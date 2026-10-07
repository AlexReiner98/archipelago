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
  main.replaceChildren(
    h('div', { class: 'page-head' }, h('h1', {}, 'Sign in'), h('p', { class: 'muted' }, 'This server asks for a token. It decides which workspace you see and what you may do.')),
    h('section', { class: 'card', style: 'max-width: 620px' }, h('div', { class: 'toolbar', style: 'padding: 14px' }, input, h('button', { class: 'primary', onclick: submit }, 'Sign in')), error),
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
    slot.replaceChildren(
      h('div', {}, h('strong', {}, me.workspace.name)),
      h('div', { class: 'muted small' }, `${me.actor.name} (${me.actor.kind})`),
      h(
        'a',
        {
          href: '#',
          class: 'small',
          onclick: (e) => {
            e.preventDefault();
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

async function refreshReviewCount() {
  const set = async (id, count) => {
    const badge = document.getElementById(id);
    try {
      const n = await count();
      badge.textContent = n;
      badge.hidden = n === 0;
    } catch {
      badge.hidden = true;
    }
  };
  set('review-count', async () => (await api('proposals')).length);
  set('notice-count', async () => (await api('view', { name: 'notifications' })).length);
}

// ---- Today ---------------------------------------------------------------

function today() {
  const needs = card('Needs you now');
  const blocked = card('Blocked, and what has to move first');
  const waiting = card('Waiting on others');
  const risk = card('At risk');
  const mine = card('You are holding up');
  const resources = card('Resources and connections');
  const running = card('Sessions', { wide: true });
  const notices = card('Notifications', { wide: true });
  main.replaceChildren(
    h('div', { class: 'page-head' }, h('h1', {}, 'Today'), h('p', { class: 'muted' }, 'Derived from the map each time you open this page.')),
    h('div', { class: 'grid' }, notices.el, running.el, needs.el, blocked.el, mine.el, waiting.el, risk.el, resources.el),
  );

  const markRead = async (ids) => {
    await api('change', { ops: ids.map((id) => ({ op: 'update', id, status: 'read' })), reason: 'Read in the UI' });
    today();
    refreshReviewCount();
  };
  notices
    .fill(
      api('view', { name: 'notifications' }),
      (rows) => [
        rows.length,
        h(
          'ul',
          { class: 'rows' },
          rows.map((n) =>
            h(
              'li',
              {},
              h(
                'div',
                { class: 'row-top' },
                h('span', { class: `pill ${n.level === 'urgent' ? 'bad' : n.level === 'warning' ? 'warn' : ''}` }, n.level ?? 'info'),
                h('span', { class: 'grow' }, h('strong', {}, n.title)),
                h('button', { onclick: () => markRead([n.id]) }, 'Mark read'),
              ),
              h('div', { class: 'row-sub' }, n.body && [n.body, ' · '], n.about_id && [h('a', { href: `#/e/${n.about_id}` }, n.about_title), ' · '], `${n.from ?? ''} · ${when(n.created_at)}`),
            ),
          ),
          rows.length > 1 && h('li', {}, h('button', { onclick: () => markRead(rows.map((n) => n.id)) }, `Mark all ${rows.length} read`)),
        ),
      ],
      '',
    )
    .then(() => {
      // Nothing unread: the card would only be noise.
      if (notices.el.querySelector('.n').textContent === '0') notices.el.remove();
    });

  running.fill(
    api('view', { name: 'sessions' }),
    (v) => [
      v.open.length,
      h(
        'ul',
        { class: 'rows' },
        v.open.map((r) =>
          h(
            'li',
            {},
            h(
              'div',
              { class: 'row-top' },
              h('span', { class: 'chip' }, r.surface ?? 'session'),
              h('span', { class: 'grow' }, link(r)),
              r.stale && h('span', { class: 'pill bad', title: `No report for over ${v.stale_after_minutes} minutes` }, 'gone quiet'),
              h('span', { class: `pill ${r.status === 'waiting' ? 'warn' : 'ok'}` }, r.status),
              h(
                'button',
                {
                  onclick: async () => {
                    if (!confirm(`End "${r.title}"? Anything it holds is released.`)) return;
                    await api('session_end', { run: r.id, outcome: 'cancelled', summary: 'Ended from the UI' });
                    today();
                  },
                },
                'End',
              ),
            ),
            h(
              'div',
              { class: 'row-sub' },
              r.working_on.length ? ['working on: ', r.working_on.map((e, i) => [i > 0 && ', ', link(e)])] : 'no task named',
              r.holds.length > 0 && [' · holds: ', r.holds.map((e, i) => [i > 0 && ', ', link(e)])],
              r.repo && [' · ', link(r.repo)],
              ` · last heard ${when(r.last_seen)}`,
            ),
          ),
        ),
      ),
    ],
    'No sessions are running.',
  );
  const view = (name, params) => api('view', { name, params });

  needs.fill(view('needs_me'), (v) => [v.actionable.length, h('ul', { class: 'rows' }, v.actionable.map((e) => entityRow(e)))], 'Nothing is waiting on you.');

  blocked.fill(
    view('blockers'),
    (rows) => [
      rows.length,
      h(
        'ul',
        { class: 'rows' },
        rows.map((b) => entityRow(b.entity, ['waiting on: ', b.root_blockers.map((r, i) => [i > 0 && ', ', chip(r.type), ' ', link(r)])])),
      ),
    ],
    'Nothing is blocked.',
  );

  mine.fill(
    view('blocked_on_me'),
    (rows) => [rows.length, h('ul', { class: 'rows' }, rows.map((r) => entityRow(r.entity, ['holding up: ', r.holding_up.map((e, i) => [i > 0 && ', ', link(e)])])))],
    'You are not holding anything up.',
  );

  waiting.fill(
    view('waiting_on'),
    (v) => [
      v.blocked_by_others.length + v.owed_to_me.length,
      h(
        'ul',
        { class: 'rows' },
        v.blocked_by_others.map((r) => entityRow(r.entity, ['waiting on: ', r.waiting_on.map((e, i) => [i > 0 && ', ', link(e)])])),
        v.owed_to_me.map((e) => entityRow(e, 'owed to you')),
      ),
    ],
    'You are not waiting on anyone.',
  );

  risk.fill(
    view('at_risk'),
    (v) => [
      v.due_soon_or_overdue.length + v.resting_on_refuted_hypothesis.length,
      h(
        'ul',
        { class: 'rows' },
        v.due_soon_or_overdue.map((e) => entityRow(e, [e.overdue ? 'Overdue' : `Due within ${v.due_within_days} days`, e.blocked && ', and blocked'])),
        v.resting_on_refuted_hypothesis.map((e) => entityRow(e, ['rests on a refuted hypothesis: ', h('a', { href: `#/e/${e.hypothesis}` }, e.hypothesis_title)])),
      ),
    ],
    'Nothing is due soon, and no open work rests on a refuted hypothesis.',
  );

  resources.fill(
    Promise.all([api('check_connections'), view('available_now'), api('search', { type: 'resource', limit: 100 })]),
    ([connections, now, all]) => {
      const connIds = new Set(connections.map((c) => c.id));
      const heldBy = new Map(now.held_resources.map((r) => [r.resource, r]));
      const rows = [
        ...connections.map((c) =>
          h('li', {}, h('div', { class: 'row-top' }, h('span', { class: 'chip' }, 'Connection'), h('span', { class: 'grow' }, link(c)), h('span', { class: `pill ${c.status === 'available' ? 'ok' : 'bad'}` }, c.status === 'available' ? 'reachable' : 'not reachable')), h('div', { class: 'row-sub' }, c.url)),
        ),
        ...all
          .filter((r) => !connIds.has(r.id))
          .map((r) => {
            const held = heldBy.get(r.id);
            const state = r.status !== 'available' ? ['bad', r.status] : held ? ['warn', 'held'] : ['ok', 'free'];
            return h(
              'li',
              {},
              h('div', { class: 'row-top' }, h('span', { class: 'chip' }, 'Resource'), h('span', { class: 'grow' }, link(r)), h('span', { class: `pill ${state[0]}` }, state[1])),
              held && h('div', { class: 'row-sub' }, 'held by ', h('a', { href: `#/e/${held.held_by}` }, held.held_by_title), ` since ${when(held.since)}`),
            );
          }),
        ...now.waiting_on_resource.map((t) => entityRow(t, ['cannot run: ', t.waiting_on.map((w) => `${WHY[w.why]} ${w.resource}`).join(', ')])),
      ];
      return [rows.length, h('ul', { class: 'rows' }, rows)];
    },
    'No resources or connections in the map.',
  );
}

// ---- Review --------------------------------------------------------------

async function review() {
  main.replaceChildren(h('div', { class: 'page-head' }, h('h1', {}, 'Review'), h('p', { class: 'muted' }, 'Changes agents have proposed. Nothing here is in the map until you approve it.')));
  const [pending, known] = await Promise.all([api('proposals'), api('search', { limit: 200, include_archived: true })]);
  const names = new Map(known.map((e) => [e.id, e]));
  if (!pending.length) main.append(h('section', { class: 'card' }, h('div', { class: 'empty' }, 'Nothing to review.')));
  for (const p of pending) main.append(proposalCard(p, names));
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
      h('button', { class: 'danger', onclick: () => decide(false) }, 'Reject all'),
      status,
    ),
  );

  function draw() {
    const count = ops.filter((op, i) => included[i] && !dead(op)).length;
    approve.textContent = count === ops.length ? `Approve all ${count}` : `Approve ${count} of ${ops.length}`;
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
        op.body && h('div', { class: 'detail' }, op.body),
        op.props && Object.keys(op.props).length > 0 && h('div', { class: 'detail' }, Object.entries(op.props).map(([k, v]) => `${k}: ${v}`).join('\n')),
        op.confidence !== undefined && op.confidence < 1 && h('div', { class: 'detail' }, `confidence ${op.confidence}`),
      ];
      st = statusSelect(op.type, op.status, `default (${statusesOf(op.type)[0]})`);
    } else if (op.op === 'update') {
      const target = names.get(op.id);
      const { op: _op, id: _id, status: newStatus, ...changes } = op;
      kind = target ? chip(target.type) : 'update';
      what = [
        h('div', {}, nameOf(op.id), op.title && op.title !== target?.title && [' ', h('span', { class: 'arrow' }, '→'), ` ${op.title}`]),
        target && newStatus && h('div', { class: 'detail' }, `status: ${target.status} → ${newStatus}`),
        Object.entries(changes).filter(([k]) => k !== 'title').map(([k, v]) => h('div', { class: 'detail' }, `${k}: ${typeof v === 'object' ? JSON.stringify(v) : v}`)),
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
              ? [h('strong', {}, op.type.id), op.type.extends && ` (flavour of ${op.type.extends})`, h('div', { class: 'detail' }, op.type.description)]
              : JSON.stringify(op);
    }
    return h('tr', { class: off ? 'off' : '' }, h('td', { class: 'check' }, check), mark(h('td', { class: 'kind' }, kind)), h('td', {}, what), h('td', { class: 'status' }, st ?? ''));
  }

  async function decide(yes) {
    const note = yes ? undefined : prompt('Why reject it? (optional, recorded in the log)');
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
      el.replaceChildren(h('div', { class: 'empty' }, yes ? `Approved: ${p.reason}` : `Rejected: ${p.reason}`));
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

// ---- Map -----------------------------------------------------------------

const mapState = { q: '', type: '', open: 'open' };

function map() {
  const results = h('div');
  const run = async () => {
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
    h('div', { class: 'page-head' }, h('h1', {}, 'Map'), h('p', { class: 'muted' }, 'Everything in the map. A type includes its flavours. Sources, sessions and other system records are listed only when you pick their type.')),
    h(
      'div',
      { class: 'toolbar', style: 'margin-bottom: 12px' },
      h('input', { type: 'search', placeholder: 'Search titles and text', value: mapState.q, oninput: set('q'), style: 'flex: 1; min-width: 200px' }),
      h('select', { onchange: set('type') }, h('option', { value: '' }, 'All types'), schema.types.map((t) => h('option', { value: t.id, selected: t.id === mapState.type }, `${t.title}${t.pack === 'core' ? '' : ` (${t.pack})`}`))),
      h('button', { onclick: () => (location.hash = `#/new/${mapState.type || 'task'}`) }, 'New'),
      h('select', { onchange: set('open') }, ['open', 'closed', 'all'].map((v) => h('option', { value: v, selected: v === mapState.open }, v === 'open' ? 'Unfinished' : v === 'closed' ? 'Finished' : 'Both'))),
    ),
    h('section', { class: 'card' }, results),
  );
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
      alert(err.message);
    }
  };
  const owner = e.owner ? await api('get', { id: e.owner }).then((r) => r.entity, () => null) : null;
  const relRows = (rows, direction) =>
    rows.map((r) =>
      h('tr', {}, h('td', { class: 'nowrap muted' }, relations.get(r.type)?.[direction === 'out' ? 'title' : 'inverse'] ?? r.type), h('td', {}, chip(r.entity_type), ' ', link(r)), h('td', {}, pill(r.entity_type, r.status))),
    );

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
                const instructions = prompt(`Launch a headless Claude Code session on "${e.title}"?\n\n${what}\n\nAnything to add to its brief? (optional)`);
                if (instructions === null) return;
                try {
                  const started = await api('launch', { task: id, mode, instructions: instructions || undefined });
                  location.hash = `#/e/${started.run}`;
                } catch (err) {
                  alert(err.message);
                }
              },
            },
            'Launch session',
          ),
        ),
      !e.archived_at &&
        h('button', { class: 'danger', onclick: () => confirm(`Archive "${e.title}"? It leaves every view but stays in the history.`) && change([{ op: 'archive', id }], 'Archived in the UI') }, 'Archive'),
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
        h('header', {}, h('h2', {}, 'Relations'), h('span', { class: 'n' }, data.outgoing.length + data.incoming.length)),
        data.outgoing.length + data.incoming.length
          ? h('table', { class: 'list' }, h('tbody', {}, relRows(data.outgoing, 'out'), relRows(data.incoming, 'in')))
          : h('div', { class: 'empty' }, 'Not linked to anything.'),
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
      h('p', { class: 'muted' }, 'A trigger that fires an action. One an agent proposes does nothing until you approve it in Review. Every firing is in Activity.'),
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
      h('p', { class: 'muted' }, focused ? 'What this is connected to. ' : 'What is connected to what. Entities with no drawn relation are left out. ', 'Drag to move, scroll to zoom. The Map screen lists the same things as a table.'),
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

// ---- Activity ------------------------------------------------------------

function describeEvent(ev) {
  const d = ev.detail ?? {};
  if (ev.origin === 'external') return `${d.ok === false ? 'failed' : 'ok'}${d.durationMs != null ? ` in ${d.durationMs} ms` : ''}`;
  const short = (v) => (v == null ? 'none' : String(typeof v === 'object' ? JSON.stringify(v) : v).replaceAll('\n', ' ').slice(0, 80));
  if (ev.action === 'entity.update') return Object.entries(d.changes ?? {}).map(([k, c]) => `${k}: ${short(c.from)} → ${short(c.to)}`).join('; ');
  if (ev.action === 'changeset.undo') return `undid ${d.undoes}${d.skipped?.length ? `, ${d.skipped.length} left alone` : ''}`;
  if (ev.action === 'relation.link' || ev.action === 'relation.unlink') return `${relations.get(d.type)?.title ?? d.type} ${d.to}`;
  if (ev.action === 'entity.create') return `${typeTitle(d.type)}, ${d.status ?? ''}`;
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
          h('td', { class: 'muted' }, describeEvent(ev), ev.detail?.approved_by && ` · approved by ${ev.detail.approved_by}`, !withTarget && ev.reason && ` · ${ev.reason}`),
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
          h('summary', {}, h('span', { class: 'muted nowrap' }, when(first.ts)), h('span', {}, work.actor, approver && h('span', { class: 'muted' }, `, approved by ${approver}`)), h('strong', { class: 'grow', style: 'flex-basis: 100%' }, g.events.find((e) => e.reason && e.reason !== 'Source of this change')?.reason ?? first.action), h('span', { class: 'chip' }, `${g.events.length} change${g.events.length === 1 ? '' : 's'}`),
            undone
              ? h('span', { class: 'pill closed' }, g.events.some((e) => e.action === 'changeset.undo') ? 'an undo' : 'undone')
              : h(
                  'button',
                  {
                    onclick: async (click) => {
                      click.preventDefault();
                      if (!confirm('Undo this change set? The opposite is applied as a new change; nothing is erased from the log.')) return;
                      try {
                        const r = await api('undo', { changeset: g.changeset });
                        if (r.skipped.length) alert(`Undone, except:\n- ${r.skipped.join('\n- ')}`);
                        run();
                      } catch (err) {
                        alert(err.message);
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
    h('div', { class: 'page-head' }, h('h1', {}, 'Activity'), h('p', { class: 'muted' }, 'Every change to the map, and every tool call imported from a connection. Newest first.')),
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
        [['', 'Everything'], ['lattice', 'Changes to the map'], ['external', 'External tool calls']].map(([v, label]) => h('option', { value: v, selected: v === activityState.origin }, label)),
      ),
    ),
    h('section', { class: 'card' }, list),
  );
  run().catch((err) => list.replaceChildren(h('div', { class: 'error' }, err.message)));
}

// ---- routing -------------------------------------------------------------

const ROUTES = { today, review, map, activity, automations, graph };

async function route() {
  const [, name = 'today', arg] = location.hash.split('/');
  for (const a of document.querySelectorAll('#nav a')) a.classList.toggle('active', a.dataset.route === (name === 'e' || name === 'new' ? 'map' : name));
  try {
    if (!schema) await loadSchema();
    if (name === 'e' && arg) await entity(arg);
    else if (name === 'graph') await graph(arg);
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
