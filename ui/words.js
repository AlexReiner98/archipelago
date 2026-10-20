// The lookups every screen shares (types, relations, titles) and the ways of saying things briefly: a row, a mark, a word.

import { applyTheme } from './theme.js';
import { api, h, state } from './base.js';

// ---- shared lookups ------------------------------------------------------

export const types = new Map();
export const relations = new Map();

export async function loadSchema() {
  // The schema, and the workspace's style: what a page that is not a picture is drawn by, until it asks for its own.
  [state.schema, state.style] = await Promise.all([api('schema'), api('view', { name: 'style', params: {} }).then((r) => r.style)]);
  applyTheme(state.style);
  types.clear();
  relations.clear();
  for (const t of state.schema.types) types.set(t.id, t);
  for (const r of state.schema.relations) relations.set(r.id, r);
}

export const typeTitle = (id) => types.get(id)?.title ?? id;
/** A type as a choice in a list: its title, and its pack's name only where another type has the same title. */
export const typeChoice = (t) => `${t.title}${(state.schema?.types ?? []).some((o) => o.id !== t.id && !o.dormant && o.title === t.title) ? ` (${t.pack})` : ''}`;
/** What a new item is when nothing says which: the first type of work that can be estimated (a task, where the work pack is on). */
export const workType = () => (state.schema?.types ?? []).find((t) => !t.dormant && t.kind === 'work' && t.flavour_of === 'work' && t.fields?.tokens_estimated)?.id ?? 'work';
export const statusesOf = (typeId) => {
  const s = types.get(typeId)?.statuses;
  return s ? [...s.open, ...s.closed] : [];
};
export const isClosed = (typeId, status) => types.get(typeId)?.statuses.closed.includes(status) ?? false;
export const isA = (typeId, ancestor) => {
  for (let t = typeId; t; t = types.get(t)?.flavour_of) if (t === ancestor) return true;
  return false;
};
/** Whether a type may sit at one end of a relation, given that end's allowed types. */
export const fits = (allowed, typeId) => allowed.some((a) => a === '*' || isA(typeId, a));
// Relations the system keeps itself (what a session works on, who holds a resource) are not edited by hand.
export const kept = (relId) => relId.startsWith('sys.') || relId === 'holds';

export const when = (ts) => new Date(ts).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
export const daysAgo = (ts) => {
  const days = Math.floor((Date.now() - new Date(ts).getTime()) / 86_400_000);
  return days === 0 ? 'today' : days === 1 ? 'yesterday' : `${days} days ago`;
};
// ---- Saying things briefly -------------------------------------------------
// The screens show what agents write, and agents write paragraphs. These keep
// a row to one line: a short name, a few words, a mark. The whole of it is
// always one click or one hover away.

/** How long ago, in a word: "now", "5 min", "3 h", "yesterday", "12 Oct". The exact time is the tooltip. */
export const ago = (ts) => {
  const then = new Date(ts);
  const mins = Math.floor((Date.now() - then.getTime()) / 60_000);
  const text =
    mins < 1 ? 'now' : mins < 60 ? `${mins} min` : mins < 24 * 60 ? `${Math.floor(mins / 60)} h` : mins < 48 * 60 ? 'yesterday' : then.toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
  return h('span', { class: 'ago', title: when(ts) }, text);
};

/** An actor as a person would name it; what the log holds ("agent:claude-code/claude-code:pelago") is the tooltip. */
export function who(actor) {
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
export const gist = (text) => (text ?? '').split(/(?<=[.:;])\s|\n/)[0].replace(/[.:;]$/, '');

/** On whose authority, as a mark. The sentence is the tooltip. */
export function authorityMark(a) {
  if (!a) return h('span', { class: 'mark mark-none', title: 'Authority not recorded' }, '?');
  const yours = a.of === 'human';
  return h('span', { class: `mark ${yours ? 'mark-human' : 'mark-agent'}`, title: authorityText(a) }, yours ? 'your word' : 'its call');
}

/** What an event did, in a word. */
export const VERBS = {
  'entity.create': 'created', 'entity.update': 'changed', 'entity.archive': 'archived', 'entity.restore': 'restored', 'entity.merge': 'merged',
  'relation.link': 'linked', 'relation.unlink': 'unlinked', 'type.define': 'new type',
  'proposal.create': 'held', 'proposal.approve': 'applied', 'proposal.reject': 'declined', 'proposal.supersede': 'overtaken',
  'changeset.undo': 'undid', 'changes.seen': 'marked seen', 'questions.confirmed': 'owner answered', 'repo.push': 'push', 'recheck.done': 're-checked',
  'automation.fire': 'automation', 'run.stale': 'went quiet', 'connection.check': 'connection', 'resource.claim': 'took', 'resource.release': 'gave back',
};
export const verb = (ev) => (ev.action === 'entity.update' && !Object.keys(ev.detail?.changes ?? {}).length ? 'confirmed' : (VERBS[ev.action] ?? ev.action));

/**
 * One change set as one line: who, the point of it, what it did, on whose
 * word, when. Opened, it gives the whole reason and each thing it touched.
 */
/** An event that belongs to no change set (a push heard, a session gone quiet), as the same kind of line. */
export function eventLine(ev) {
  const about = describeEvent(ev);
  return h(
    'div',
    { class: 'change line' },
    who(ev.actor),
    h('span', { class: 'gist', title: ev.reason ?? '' }, h('span', { class: 'muted' }, `${verb(ev)} `), ev.target_id ? h('a', { href: `#/e/${ev.target_id}` }, ev.target_title ?? ev.target_id) : gist(ev.reason) || about),
    ago(ev.ts),
  );
}

export function changeRow(g, { undone, onUndo, attention, onRead, here, fresh }) {
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

export const chip = (typeId) => h('span', { class: 'chip', title: typeId }, typeTitle(typeId));
export const pill = (typeId, status) => h('span', { class: `pill${isClosed(typeId, status) ? ' closed' : ''}` }, status);
/** Titles of the items the pages have shown, so a line that only holds an id can still say a name. */
export const titles = new Map();
export const named = (id) => titles.get(id) ?? id;
/** Text an agent wrote, with each item id in it as a link by the item's name: an id is something to follow, never something to read. */
export const idsAsLinks = (text) => {
  const out = [];
  let from = 0;
  // An item's id is a way to it; a source written [its name](its address) is its name, opening the address.
  for (const m of text.matchAll(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)|\be_[a-z0-9]{8}\b/g)) {
    out.push(text.slice(from, m.index), m[1] ? h('a', { href: m[2], target: '_blank', rel: 'noopener noreferrer', title: m[2] }, m[1]) : h('a', { href: `#/e/${m[0]}`, title: 'Open it' }, titles.get(m[0]) ?? 'this item'));
    from = m.index + m[0].length;
  }
  return [...out, text.slice(from)];
};
export const link = (e) => (e ? (titles.set(e.id, e.title), h('a', { href: `#/e/${e.id}` }, e.title)) : h('span', { class: 'muted' }, '(missing)'));

/** The usual one-line rendering of an entity. */
export function entityRow(e, sub) {
  return h(
    'li',
    {},
    h('div', { class: 'row-top' }, chip(e.type), h('span', { class: 'grow' }, link(e)), e.due && h('span', { class: 'pill warn' }, `due ${e.due}`), pill(e.type, e.status)),
    sub && h('div', { class: 'row-sub' }, sub),
  );
}

export function card(title, { wide } = {}) {
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

export const WHY = { depends_on: 'depends on', waits_on: 'waits on', resource_unavailable: 'needs (unavailable)', resource_held: 'needs (held by another)' };

/** A small menu for what is done rarely: the page keeps one or two actions in sight. */
export function menu(label, items) {
  const box = h('details', { class: 'menu' }, h('summary', {}, label), h('div', { class: 'menu-items' }, items.filter(Boolean).map(([text, onclick, cls]) => h('button', { class: cls ?? '', onclick: (ev) => ((box.open = false), onclick(ev)) }, text))));
  return box;
}
document.addEventListener('click', (ev) => {
  for (const open of document.querySelectorAll('details.menu[open]')) if (!open.contains(ev.target)) open.open = false;
});

/** When an open item was last changed or confirmed, as a mark that turns as it ages. */
export function ageChip(e) {
  const days = Math.floor((Date.now() - new Date(e.updated_at).getTime()) / 86_400_000);
  return h('span', { class: `mark ${days >= 14 ? 'mark-old' : 'mark-human'}`, title: `Last changed or confirmed ${when(e.updated_at)}` }, days === 0 ? 'true today' : days === 1 ? 'true yesterday' : `${days} days unconfirmed`);
}

/** Where a run was, as a person says it. */
export const RAN = { 'github-actions': 'Sync agent', server: 'Reader', 'claude-code': 'Session' };
/** Which of each item's sections are unfolded, kept while the page is open. */
export const unfolded = new Map();
/** A sentence of explanation, kept behind a small mark: there to be asked for, not to be read past. */
export const hint = (text) => h('span', { class: 'hint', title: text, tabindex: 0 }, '?');

/** A stored field name as a person would label it: "recheck_days" is "Recheck days". */
export const label = (key) => key.charAt(0).toUpperCase() + key.slice(1).replaceAll('_', ' ');
// On whose authority a change was made, as the log has it.
export function authorityText(a) {
  if (!a) return '';
  if (a.of === 'agent') return `on the agent's own judgment${a.basis ? `: ${a.basis}` : ''}`;
  return a.stated_by ? `on a human's word, as ${a.stated_by} reports it: ${a.basis}` : `on the authority of ${a.who}`;
}

export function describeEvent(ev) {
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

/** A count of tokens as a person says it: 1.2M, 340k. */
export const tokensText = (t) => (t >= 1e6 ? `${+(t / 1e6).toFixed(1)}M` : t >= 1000 ? `${Math.round(t / 1000)}k` : `${Math.round(t)}`);
