// Changes: what is held for the owner and what has happened, newest first.

import { api, ask, h, part, tell } from './base.js';
import { ago, changeRow, chip, eventLine, gist, link, loadSchema, refreshReviewCount, relations, statusesOf, who } from './words.js';

// ---- Review --------------------------------------------------------------

// What has changed, as one list, newest first: what is held for the owner
// above it, and in it what agents did since the owner last looked, marked.
// Looking is recorded; it permits nothing.
export const reviewState = { origin: '' };
export const ORIGINS = [['', 'Everything'], ['github', 'Pushes'], ['external', 'Tool calls']];

export async function review() {
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
export function attentionOf(notes, events) {
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
export const noticeLine = (n, read) => {
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

export function proposalCard(p, names) {
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

/** The whole record, or one strand of it, as lines into `list`. */
export async function drawTimeline(list, origin, notes = [], read, seen) {
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
export function activity() {
  reviewState.origin = '';
  location.hash = '#/review';
}
