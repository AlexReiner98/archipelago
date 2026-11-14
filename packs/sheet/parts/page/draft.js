// An item's title and note written in place, with every field written in words, kept until one Save (task e_pswmdxea;
// from the host's draft.js). Only what is saved reaches the map, as one change on the person's word: the log keeps
// facts, not keystrokes (the owner, 25 Oct 2026). Until then the words are kept in this browser by the host
// (tools.keep), so a reload or a closed tab does not lose them, and the page says it holds words unsaved (page state
// `draft`), so the person is asked before leaving them.

import { counted } from './note-count.js';

/** The draft as kept: what is written of the title, the note and each field, beside what each held when it began. */
export const blank = () => ({ title: undefined, body: undefined, fields: {} });

/** Whether the draft holds anything that differs from the item as it is. */
export function unsaved(draft, item) {
  if (draft.title !== undefined && draft.title !== (item.title ?? '')) return true;
  if (draft.body !== undefined && draft.body !== (item.body ?? '')) return true;
  return Object.entries(draft.fields).some(([k, v]) => JSON.stringify(v ?? null) !== JSON.stringify(item.props?.[k] ?? null));
}

/** The one change Save makes: the title, the note and the fields written, as one update; null when nothing differs. */
export function saveOps(draft, item) {
  if (!unsaved(draft, item)) return null;
  const op = { op: 'update', id: item.id };
  if (draft.title !== undefined && draft.title !== item.title) op.title = draft.title.trim();
  if (draft.body !== undefined && draft.body !== (item.body ?? '')) op.body = draft.body;
  const props = Object.fromEntries(Object.entries(draft.fields).filter(([k, v]) => JSON.stringify(v ?? null) !== JSON.stringify(item.props?.[k] ?? null)));
  if (Object.keys(props).length) op.props = props;
  return { ops: [op], reason: 'Written in the sheet' };
}

/** The count under the note while it is written, as its screen's count piece says, or how long it is. */
export function countMarks(body, piece, props = {}) {
  const c = counted(body ?? '', piece, props);
  if (!c) return ['text', { look: 'muted', tip: `No ${piece?.section ? `## ${piece.section}` : 'note'} to count` }, '–'];
  const l = c.limit;
  const tone = c.state === 'over' ? 'bad' : c.state === 'near' ? 'warn' : c.state === 'best' ? 'ok' : undefined;
  const said = !l ? c.n.toLocaleString() : `${c.n.toLocaleString()} / ${l.max.toLocaleString()}${c.posts > 1 ? ` ×${c.posts}` : ''}`;
  return ['text', { look: 'muted', size: 2, ...(tone && { tone }), tip: `${c.posts > 1 ? `The longest of ${c.posts} posts` : 'Characters'}${l ? `, at most ${l.max.toLocaleString()}` : ''}` }, said];
}

/** The title, as it reads or written in place. */
export function titleMarks(item, draft, { writes = false } = {}) {
  if (!writes || item.archived_at) return ['text', { look: 'title', size: 5, tip: item.title }, item.title ?? ''];
  return ['input', { key: 'draft:title', kind: 'text', look: 'title', value: draft.title ?? item.title ?? '', grow: true, tip: 'Its name, a few words' }];
}

/** The note: as it reads (ticks go back), or open as words to write, with its count under it. */
export function noteMarks(item, draft, { writes = false, writing = false, count } = {}) {
  const body = draft.body ?? item.body ?? '';
  if (!writes || item.archived_at) return body.trim() ? ['note', {}, body] : ['text', { look: 'muted' }, 'No note'];
  if (!writing && draft.body === undefined) {
    return ['box', { flow: 'column', gap: 1 },
      body.trim() ? ['note', { key: 'draft:tick', tick: true }, body] : ['text', { look: 'muted' }, 'No note'],
      ['button', { key: 'draft:write', look: 'quiet', tip: 'Write in its note' }, '✎']];
  }
  return ['box', { flow: 'column', gap: 1 },
    ['input', { key: 'draft:body', kind: 'text', lines: 12, value: body, grow: true, focus: draft.body === undefined, hint: 'Lead with the point; give each further part a ## title' }],
    countMarks(body, count, item.props)];
}

/** The bar that saves it, in sight at the page's foot while anything is unsaved. */
export function barMarks(draft, item, { saving = false, said } = {}) {
  if (!unsaved(draft, item)) return said ? ['text', { look: 'muted', tone: 'bad' }, said] : null;
  return ['box', { key: 'draft-bar', look: 'band', flow: 'row', gap: 2, align: 'end' },
    ...(said ? [['text', { tone: 'bad', tip: said.slice(0, 200) }, said]] : []),
    ['button', { key: 'draft:discard', look: 'quiet', tip: 'Let what is written go' }, 'Discard'],
    ['button', { key: 'draft:save', look: 'main', tip: saving ? 'Saving' : 'Save it, as one change' }, saving ? 'Saving…' : 'Save']];
}

/** A line of the note ticked or unticked, by its number among the lines. */
export function ticked(body, line, done) {
  const lines = String(body ?? '').split('\n');
  const l = lines[line];
  if (l === undefined || !/^\s*[-*] \[[ xX]\]/.test(l)) return null;
  lines[line] = l.replace(/\[[ xX]\]/, done ? '[x]' : '[ ]');
  return lines.join('\n');
}

/**
 * What a gesture on the draft comes to: `{ draft }` the draft changed, `{ save: true }`, `{ discard: true }`,
 * `{ writing: true }`, `{ ops, reason }` a tick made at once, or null when it is not the draft's.
 */
export function draftEvent(event, item, draft) {
  const k = event?.key;
  if (k === 'draft:title' && event.name === 'edit') return { draft: { ...draft, title: String(event.value ?? '') } };
  if (k === 'draft:title' && event.name === 'submit') return { save: true };
  if (k === 'draft:body' && event.name === 'edit') return { draft: { ...draft, body: String(event.value ?? '') } };
  if (k === 'draft:write' && event.name === 'press') return { writing: true };
  if (k === 'draft:save' && event.name === 'press') return { save: true };
  if (k === 'draft:discard' && event.name === 'press') return { discard: true };
  if (k === 'draft:tick' && event.name === 'tick') {
    const body = ticked(item.body, Number(event.value?.line), Boolean(event.value?.done));
    return body === null ? null : { ops: [{ op: 'update', id: item.id, body }], reason: 'Ticked in the UI' };
  }
  return null;
}
