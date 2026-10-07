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

async function api(tool, input = {}) {
  const res = await fetch(`/api/${tool}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(input) });
  const body = await res.json();
  if (!res.ok) throw new Error(body.error);
  return body.result;
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
  const badge = document.getElementById('review-count');
  try {
    const pending = await api('proposals');
    badge.textContent = pending.length;
    badge.hidden = pending.length === 0;
  } catch {
    badge.hidden = true;
  }
}

// ---- Today ---------------------------------------------------------------

function today() {
  const needs = card('Needs you now');
  const blocked = card('Blocked, and what has to move first');
  const waiting = card('Waiting on others');
  const risk = card('At risk');
  const mine = card('You are holding up');
  const resources = card('Resources and connections');
  main.replaceChildren(
    h('div', { class: 'page-head' }, h('h1', {}, 'Today'), h('p', { class: 'muted' }, 'Derived from the map each time you open this page.')),
    h('div', { class: 'grid' }, needs.el, blocked.el, mine.el, waiting.el, risk.el, resources.el),
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
          : op.op === 'archive'
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
      if (!mapState.type) rows = rows.filter((e) => e.type !== 'sys.source');
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
    h('div', { class: 'page-head' }, h('h1', {}, 'Map'), h('p', { class: 'muted' }, 'Everything in the map. A type includes its flavours.')),
    h(
      'div',
      { class: 'toolbar', style: 'margin-bottom: 12px' },
      h('input', { type: 'search', placeholder: 'Search titles and text', value: mapState.q, oninput: set('q'), style: 'flex: 1; min-width: 200px' }),
      h('select', { onchange: set('type') }, h('option', { value: '' }, 'All types'), schema.types.map((t) => h('option', { value: t.id, selected: t.id === mapState.type }, `${t.title}${t.pack === 'core' ? '' : ` (${t.pack})`}`))),
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
      h('div', { class: 'row-top' }, chip(e.type), e.archived_at && h('span', { class: 'pill closed' }, 'archived'), e.confidence < 1 && h('span', { class: 'pill warn' }, `confidence ${e.confidence}`)),
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

// ---- Activity ------------------------------------------------------------

function describeEvent(ev) {
  const d = ev.detail ?? {};
  if (ev.origin === 'external') return `${d.ok === false ? 'failed' : 'ok'}${d.durationMs != null ? ` in ${d.durationMs} ms` : ''}`;
  if (ev.action === 'entity.update') return Object.entries(d.changes ?? {}).map(([k, c]) => `${k}: ${c.from ?? 'none'} → ${c.to ?? 'none'}`).join('; ');
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
        if (g.events.length === 1) return eventTable(g.events);
        // The newest event in an approved changeset is the approval itself;
        // the line should name who made the change, then who approved it.
        const work = g.events.find((e) => !e.action.startsWith('proposal.')) ?? first;
        const approver = work.detail?.approved_by;
        return h(
          'details',
          { class: 'group' },
          h('summary', {}, h('span', { class: 'muted nowrap' }, when(first.ts)), h('span', {}, work.actor, approver && h('span', { class: 'muted' }, `, approved by ${approver}`)), h('strong', { class: 'grow', style: 'flex-basis: 100%' }, g.events.find((e) => e.reason && e.reason !== 'Source of this change')?.reason ?? first.action), h('span', { class: 'chip' }, `${g.events.length} changes`)),
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

const ROUTES = { today, review, map, activity };

async function route() {
  const [, name = 'today', arg] = location.hash.split('/');
  for (const a of document.querySelectorAll('#nav a')) a.classList.toggle('active', a.dataset.route === (name === 'e' ? 'map' : name));
  try {
    if (!schema) await loadSchema();
    if (name === 'e' && arg) await entity(arg);
    else await (ROUTES[name] ?? today)();
  } catch (err) {
    main.replaceChildren(h('div', { class: 'error' }, err.message));
  }
  refreshReviewCount();
}

window.addEventListener('hashchange', route);
route();
