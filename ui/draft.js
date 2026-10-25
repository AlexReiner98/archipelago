// A draft in the sheet: an item's title and note written in place, kept on the page until the person saves it. Only
// what they save reaches the map, as one change on their authority through `change`: the log keeps facts, not
// keystrokes (the owner, 25 Oct 2026). A new item is a draft until it has a title and is saved; closed unsaved,
// nothing is written. Saving asks first when someone changed the item since the sheet opened, so no one's words are
// overwritten unseen. What applies is the rules' to say, never the page's.

import { api, ask, h, state, tell } from './base.js';
import { renderBody } from './body.js';

/** Whether the sheet holds words not yet saved: the router asks before they are left behind. */
export const unsaved = () => Boolean(document.querySelector('#sheet [data-draft="unsaved"]'));

/** Ask before leaving words unsaved; true when there are none, or the person lets them go. */
export const mayLeave = async () => !unsaved() || Boolean(await ask({ title: 'Leave without saving?', message: 'What you wrote here is not on the map yet.', action: 'Leave', danger: true }));

/**
 * The title, the note and the bar that saves them. `base` is the item as the sheet opened it ({ id, type, title, body,
 * updated_at }), or a new item's type and any title it starts with. `note`: false where the note is not written here
 * (a document, read whole). `saved(id)` is told when the change is made.
 */
export function draftOf({ base, style, editable = true, note = true, saved }) {
  const isNew = !base.id;
  const title = h('h1', { class: 'draft-title', contenteditable: editable ? 'plaintext-only' : 'false', 'data-placeholder': 'Title', spellcheck: 'true' }, base.title ?? '');
  const area = h('textarea', { class: 'draft-body', placeholder: 'What is it, and how does it relate to other items?', rows: 4, hidden: !isNew && Boolean(base.body) });
  area.value = base.body ?? '';
  // The note as it reads, folded (renderBody), until it is clicked to be written.
  const read = !isNew && base.body && h('div', { class: 'draft-read', title: editable ? 'Click to write' : '' }, renderBody(base.body, { style }));
  const said = h('span', { class: 'draft-said' });
  const save = h('button', { class: 'primary', type: 'button' }, isNew ? 'Create' : 'Save');
  const discard = h('button', { class: 'quiet-button', type: 'button' }, 'Discard');
  const bar = h('div', { class: 'draft-bar', hidden: true }, said, h('span', { class: 'grow' }), discard, save);
  const box = h('div', { class: 'draft' }, bar);
  const now = () => ({ title: title.textContent.replace(/\s+/g, ' ').trim(), body: area.value });
  const changed = () => now().title !== (base.title ?? '').trim() || now().body !== (base.body ?? '');
  const grow = () => ((area.style.height = 'auto'), (area.style.height = `${area.scrollHeight}px`));
  const update = () => {
    const open = isNew || changed();
    bar.hidden = !open;
    box.dataset.draft = changed() ? 'unsaved' : '';
    save.disabled = !now().title || !changed();
    said.textContent = !now().title ? 'A title first' : changed() ? 'Not saved' : '';
  };
  const write = () => {
    if (read) read.hidden = true;
    area.hidden = false;
    grow();
    area.focus();
  };
  if (read && editable) read.addEventListener('click', (ev) => !ev.target.closest('a, summary, button') && write());
  title.addEventListener('input', update);
  title.addEventListener('keydown', (ev) => ev.key === 'Enter' && (ev.preventDefault(), note ? write() : title.blur()));
  area.addEventListener('input', () => (grow(), update()));
  discard.addEventListener('click', () => {
    title.textContent = base.title ?? '';
    area.value = base.body ?? '';
    if (read) (read.hidden = false), (area.hidden = true);
    update();
    if (isNew) history.back();
  });
  save.addEventListener('click', async () => {
    const next = now();
    if (!next.title || !changed()) return;
    save.disabled = true;
    said.textContent = 'Saving…';
    try {
      if (isNew) {
        const made = await api('change', { ops: [{ op: 'create', ref: 'new', type: base.type, title: next.title, ...(next.body.trim() && { body: next.body }) }], reason: 'Started on the canvas' });
        box.dataset.draft = '';
        return saved(made.created?.new);
      }
      // Someone else's words since the sheet opened are not written over unseen.
      const live = (await api('get', { id: base.id })).entity;
      const moved = live.updated_at !== base.updated_at && (live.title !== base.title || (live.body ?? '') !== (base.body ?? ''));
      if (moved && !(await ask({ title: 'Changed since you opened it', message: 'Someone changed its title or note while you were writing. Save yours over theirs?', action: 'Save mine', danger: true }))) return update();
      const ops = [{ op: 'update', id: base.id, ...(next.title !== (base.title ?? '').trim() && { title: next.title }), ...(next.body !== (base.body ?? '') && { body: next.body }) }];
      const done = await api('change', { ops, reason: 'Written in the sheet' });
      // Held for someone's word by a rule: it is on the map as a proposal, not yet applied.
      if (done.status && done.status !== 'applied') await tell('Saved as a proposal', 'A rule holds this change for a person to approve before it applies.');
      box.dataset.draft = '';
      state.selfDrawn = done.status === 'applied';
      saved(base.id);
    } catch (err) {
      update();
      tell('It was not saved', err.message);
    }
  });
  update();
  // A new item opens with its title ready to be typed.
  if (isNew) requestAnimationFrame(() => title.focus());
  return { title, note: note ? [read, area].filter(Boolean) : [], bar: box };
}

/** A new item as a draft in the sheet: its type (a task unless chosen), a title to type and a note. Saved, it is a loose
 * item on the map, tied to nothing: how it relates is said in its note, and an agent proposes the links. */
export function newItem(host, { type, title = '', style, types, choices }) {
  const draw = (chosen) => {
    const draft = draftOf({ base: { type: chosen, title }, style, saved: (id) => id && (location.hash = `#/e/${id}`) });
    host.replaceChildren(
      h(
        'div',
        { class: 'page-head' },
        draft.title,
        h('div', { class: 'sheet-marks' }, h('select', { class: 'mark-type', title: 'What kind of item it is', onchange: (ev) => ((title = draft.title.textContent), draw(ev.target.value)) }, choices.map((t) => h('option', { value: t.id, selected: t.id === chosen }, t.label))), h('span', { class: 'muted' }, 'new, tied to nothing yet')),
      ),
      h('section', { class: 'note' }, draft.note),
      draft.bar,
    );
  };
  draw(types.has(type) ? type : choices[0]?.id);
}
