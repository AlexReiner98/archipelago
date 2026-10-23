// Held for you: the changes that wait for the owner's word before they apply, on Home above everything else, since
// an agent waits on each one. A row says who asked and why, with Apply and Decline in reach; Look opens the whole
// change, where each part can be left out or corrected before it is applied (docs/ui-strategy.md).

import { api, ask, h, tell } from './base.js';
import { ago, chip, gist, link, loadSchema, relations, statusesOf, typeTitle, who } from './words.js';

/** What a held change does, in a few words: the one thing it does, when it does one; else why it was asked for. */
function said(p, names) {
  if (p.ops.length !== 1) return gist(p.reason);
  const [o] = p.ops;
  const name = (id) => names.get(id)?.title ?? 'an item';
  if (o.op === 'create') return `New ${typeTitle(o.type).toLowerCase()}: ${o.title}`;
  if (o.op === 'update') return o.visibility === 'public' ? `Make "${name(o.id)}" public` : o.status ? `Set "${name(o.id)}" to ${o.status}` : `Change "${name(o.id)}"`;
  if (o.op === 'archive') return `Archive "${name(o.id)}"`;
  if (o.op === 'link') return `Link "${name(o.from)}" ${relations.get(o.type)?.title ?? o.type} "${name(o.to)}"`;
  if (o.op === 'define_type') return `New type: ${o.type.title}`;
  return gist(p.reason);
}

/** The table on Home: one row per held change, the oldest first. Left out when nothing is held. */
export async function heldPiece(host, title) {
  const [pending, known] = await Promise.all([api('proposals').catch(() => []), api('search', { limit: 200, include_archived: true }).catch(() => [])]);
  if (!host.isConnected) return;
  if (!pending.length) return host.remove();
  const names = new Map(known.map((e) => [e.id, e]));
  const again = () => heldPiece(host, title);
  const row = (p) => {
    const whole = h('div', { hidden: true });
    const decide = async (yes) => {
      const note = yes ? undefined : await ask({ title: 'Decline this change?', message: p.reason, input: { placeholder: 'Why not? (optional, kept in the log for whoever made it)' }, action: 'Decline', danger: true });
      if (!yes && note === null) return;
      try {
        await api('decide', { proposal: p.id, approve: yes, note: note || undefined });
        if (yes && p.ops.some((o) => o.op === 'define_type')) await loadSchema();
      } catch (err) {
        return tell('That was not done', err.message);
      }
      again();
    };
    const look = () => {
      whole.hidden = !whole.hidden;
      if (!whole.hidden && !whole.childElementCount) whole.append(proposalCard(p, names, again));
    };
    const n = p.ops.length;
    return [
      h(
        'li',
        { class: 'row-top', style: 'flex-wrap: nowrap' },
        h('span', { class: 'pill warn', style: 'flex: none', title: p.held_by?.say ?? 'Waits for you' }, 'Approve'),
        h('span', { class: 'grow', title: p.reason, style: 'min-width: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis' }, said(p, names)),
        h('span', { class: 'muted small', style: 'flex: none' }, who(p.actor)),
        h('span', { class: 'muted small nowrap', style: 'flex: none' }, `${n} change${n === 1 ? '' : 's'}`),
        h('button', { style: 'flex: none', title: 'See each part of it, and leave out or correct any before applying', onclick: look }, 'Look'),
        h('button', { class: 'primary', style: 'flex: none', onclick: () => decide(true) }, 'Apply'),
        h('button', { class: 'danger', style: 'flex: none', onclick: () => decide(false) }, 'Decline'),
      ),
      whole,
    ];
  };
  // Every held change at once, oldest first: one that cannot be applied any more is said, and the rest go on.
  const all = async (yes) => {
    const n = pending.length;
    const note = await ask(
      yes
        ? { title: `Apply all ${n} changes?`, message: 'Each is applied as if you had pressed its Apply, oldest first.', action: 'Apply all' }
        : { title: `Decline all ${n} changes?`, message: 'Each is declined, with the same note for whoever made it.', input: { placeholder: 'Why not? (optional, kept in the log for whoever made them)' }, action: 'Decline all', danger: true },
    );
    if (note === null) return;
    const failed = [];
    for (const p of pending) {
      try {
        await api('decide', { proposal: p.id, approve: yes, note: (!yes && typeof note === 'string' && note) || undefined });
      } catch (err) {
        failed.push(`${said(p, names)}: ${err.message}`);
      }
    }
    if (yes && pending.some((p) => p.ops.some((o) => o.op === 'define_type'))) await loadSchema();
    if (failed.length) await tell(`${failed.length} of ${n} were not done`, failed.join('\n'));
    again();
  };
  host.replaceChildren(
    h(
      'section',
      { class: 'card wide needs held', style: 'margin-bottom: var(--space-8)' },
      h(
        'header',
        {},
        h('h2', { title: 'Changes that wait for your word before they apply' }, title),
        h('span', { class: 'n' }, pending.length),
        pending.length > 1 && h('span', { class: 'grow' }),
        pending.length > 1 && h('button', { class: 'quiet-button', title: 'Apply every change held here, oldest first', onclick: () => all(true) }, 'Apply all'),
        pending.length > 1 && h('button', { class: 'quiet-button danger', title: 'Decline every change held here', onclick: () => all(false) }, 'Decline all'),
      ),
      h('ul', { class: 'rows' }, pending.map(row)),
    ),
  );
}

function proposalCard(p, names, done) {
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
        section('Links', (o) => o.op === 'link' || o.op === 'unlink'),
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
      done();
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
