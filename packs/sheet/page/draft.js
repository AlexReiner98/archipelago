// A draft in the sheet: an item's title and note written in place, kept on the page until the person saves it. Only
// what they save reaches the map, as one change on their authority through `change`: the log keeps facts, not
// keystrokes (the owner, 25 Oct 2026). A new item is a draft until it has a title and is saved; closed unsaved,
// nothing is written. Saving asks first when someone changed the item since the sheet opened, so no one's words are
// overwritten unseen. What applies is the rules' to say, never the page's. A note whose words live on another map is
// written there, by that map's `call`. Until then a copy of the words is kept in this browser alone (`kept`), so a
// reload or a closed tab does not lose them: put back when the sheet opens again, still unsaved.

import { api, ask, h, hooks, may, state, tell } from './base.js';
import { renderBody } from './body.js';
import { followLoose, refreshCanvas } from './canvas.js';
import { countMark } from './note-count.js';
import { ticked } from './text.js';

/** Where the cursor was in the words saved last: the page is drawn again, and it stays there. */
let left = null;

/** The copy of a draft this browser keeps until it is saved or discarded: by item id, or a new item's type. Storage
 * can be blocked or full: then nothing is kept, and the words last as long as the page. */
const keyOf = (base) => `pelago-draft:${base.id ?? `new:${base.type}`}`;
export const kept = {
  get(base) {
    try {
      return JSON.parse(localStorage.getItem(keyOf(base)) ?? 'null');
    } catch {
      return null;
    }
  },
  put(base, copy) {
    try {
      localStorage.setItem(keyOf(base), JSON.stringify(copy));
    } catch {
      // Not kept: the words are still on the page.
    }
  },
  drop(base) {
    try {
      localStorage.removeItem(keyOf(base));
    } catch {
      // Nothing could be kept, so nothing is left.
    }
  },
};

/** Whether the sheet holds words not yet saved: the router asks before they are left behind. */
export const unsaved = () => Boolean(document.querySelector('#sheet [data-draft="unsaved"]'));

/** Ask before leaving words unsaved; true when there are none, or the person lets them go. */
export const mayLeave = async () => !unsaved() || Boolean(await ask({ title: 'Leave without saving?', message: 'What you wrote here is not on the map yet.', action: 'Leave', danger: true }));
/** Asked for by name by a root before the sheet (the page's Refresh, packs/surface/page/live.js). */
hooks.mayLeave = mayLeave;

/**
 * The title, the note and the bar that saves them. `base` is the item as the sheet opened it ({ id, type, title, body,
 * updated_at }), or a new item's type and any title it starts with. `note`: false where the note is not written here
 * (a document, read whole). `reading`: what the note reads as, where it is not the note itself (a document, with the
 * sections it brings in). `writing`: the note opens as words to write, not as it reads (read beside it already, the
 * pages). `call`: the map it is written on, this one unless said. `saved(id)` is told when the change is made. `count`:
 * the count piece its screens declare, which says how its note is counted while it is written (packs/sheet/page/note-count.js).
 */
export function draftOf({ base, style, editable = true, note = true, reading, writing = false, call = api, saved, count }) {
  const isNew = !base.id;
  const here = call === api;
  // Words kept from before a reload or a redraw. Written against an older version of the item, they are saved against
  // that one, so Save asks before writing over what changed since.
  const copy = editable && kept.get(base);
  let from = copy?.was && copy.was.updated_at !== base.updated_at ? { ...base, ...copy.was } : base;
  let restored = Boolean(copy) && (copy.title !== (from.title ?? '') || copy.body !== (from.body ?? ''));
  if (copy && !restored) kept.drop(base);
  const title = h('h1', { class: 'draft-title', contenteditable: editable ? 'plaintext-only' : 'false', 'data-placeholder': 'Title', spellcheck: 'true' }, restored ? copy.title : (base.title ?? ''));
  const area = h('textarea', { class: 'draft-body', placeholder: 'What is it, and how does it relate to other items?', rows: 4, hidden: !isNew && !writing && !restored && Boolean(base.body) });
  area.value = restored ? copy.body : (base.body ?? '');
  // A checklist item ticked as the note reads is a change to that one line of it, on the person's word.
  const tick = async (line, done) => {
    const t = ticked(base.body, line, done);
    if (!t) return;
    const once = base.body.split(t.was).length === 2;
    const whole = () => base.body.split('\n').map((l, i) => (i === line ? t.now : l)).join('\n');
    try {
      const made = await call('change', { ops: [{ op: 'update', id: base.id, ...(once ? { replace: { find: t.was, with: t.now } } : { body: whole() }) }], reason: done ? 'Ticked in the note' : 'Unticked in the note' });
      if (made.status && made.status !== 'applied') await tell('Saved as a proposal', 'A rule holds this change for a person to approve before it applies.');
      state.selfDrawn = here && made.status === 'applied';
      saved(base.id);
    } catch (err) {
      tell('It was not ticked', err.message);
    }
  };
  // The note as it reads, folded (renderBody), until it is clicked to be written.
  const read = !isNew && !writing && base.body && h('div', { class: 'draft-read', hidden: restored, title: editable ? 'Click to write' : '' }, reading ?? renderBody(base.body, { style, tick: editable ? tick : undefined }));
  const said = h('span', { class: 'draft-said' });
  const save = h('button', { class: 'primary', type: 'button' }, isNew ? 'Create' : 'Save');
  const discard = h('button', { class: 'quiet-button', type: 'button' }, 'Discard');
  // How long the note is, in sight at the foot of the sheet while it is written.
  const length = (note && editable && countMark(count, base.props ?? {})) || null;
  const bar = h('div', { class: 'draft-bar', hidden: true }, said, h('span', { class: 'grow' }), length?.node, discard, save);
  const box = h('div', { class: 'draft' }, bar);
  // The line being written is scrolled into sight above the bar, not behind it: the sheet keeps the bar's height clear.
  // Kept once the bar is on the sheet, so taken off with the page it clears what it set.
  let sheet = null;
  const clear = () => {
    sheet = bar.closest('#sheet') ?? sheet;
    if (sheet) sheet.style.scrollPaddingBottom = bar.offsetHeight ? `${bar.offsetHeight + parseFloat(getComputedStyle(bar).marginBottom)}px` : '';
  };
  new ResizeObserver(clear).observe(bar);
  // Fields written in place wait here for the same Save (packs/sheet/page/field-edit.js): a name, what it held, what it holds now.
  const fields = new Map();
  const same = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
  const props = () => Object.fromEntries([...fields].filter(([, f]) => !same(f.now, f.was)).map(([k, f]) => [k, f.now ?? null]));
  const bad = () => [...fields.values()].find((f) => f.bad)?.bad;
  const now = () => ({ title: title.textContent.replace(/\s+/g, ' ').trim(), body: area.value });
  const worded = () => now().title !== (from.title ?? '').trim() || now().body !== (from.body ?? '');
  const changed = () => worded() || Object.keys(props()).length > 0;
  // The words are as tall as they are. Measuring them collapses the box for a moment, which would scroll the sheet
  // away from the line being written: the sheet is put back where it was, as a word processor keeps the page still.
  const grow = () => {
    const sheet = area.closest('#sheet');
    const top = sheet?.scrollTop;
    area.style.height = 'auto';
    area.style.height = `${area.scrollHeight}px`;
    if (sheet) sheet.scrollTop = top;
  };
  const update = () => {
    const open = isNew || changed();
    bar.hidden = !open && !(length && !area.hidden && (area.value.trim() || document.activeElement === area));
    discard.hidden = save.hidden = !open;
    length?.update(area.value);
    box.dataset.draft = changed() ? 'unsaved' : '';
    save.disabled = !now().title || !changed() || Boolean(bad());
    said.textContent = !now().title ? 'A title first' : bad() ?? (changed() ? (restored ? 'Restored · not saved' : 'Not saved') : '');
    // Before the browser scrolls to the line being written, not a frame after.
    clear();
  };
  // Each word written is kept in this browser, beside the version of the item it was written against.
  const keep = () => {
    restored = false;
    if (!worded()) return kept.drop(base);
    const words = now();
    kept.put(base, { title: title.textContent, body: words.body, was: { title: from.title ?? '', body: from.body ?? '', updated_at: from.updated_at } });
  };
  const write = () => {
    if (read) read.hidden = true;
    area.hidden = false;
    grow();
    update();
    area.focus();
  };
  if (read && editable) read.addEventListener('click', (ev) => !ev.target.closest('a, summary, button, input, .doc-lens, .pm-picture') && write());
  title.addEventListener('input', () => (keep(), update()));
  title.addEventListener('keydown', (ev) => ev.key === 'Enter' && (ev.preventDefault(), note ? write() : title.blur()));
  area.addEventListener('input', () => (grow(), keep(), update()));
  area.addEventListener('focus', update);
  discard.addEventListener('click', () => {
    kept.drop(base);
    from = base;
    restored = false;
    title.textContent = base.title ?? '';
    area.value = base.body ?? '';
    if (read) (read.hidden = false), (area.hidden = true);
    const written = fields.size > 0;
    fields.clear();
    update();
    if (isNew) history.back();
    // Fields written in place are drawn again as they read.
    else if (written) saved(base.id);
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
        kept.drop(base);
        followLoose(made.created?.new);
        refreshCanvas();
        return saved(made.created?.new);
      }
      // Someone else's words since the sheet opened are not written over unseen.
      const live = (await call('get', { id: base.id })).entity;
      const fresh = props();
      const moved = live.updated_at !== from.updated_at && (live.title !== from.title || (live.body ?? '') !== (from.body ?? '') || Object.keys(fresh).some((k) => !same(live.props[k], fields.get(k).was)));
      if (moved && !(await ask({ title: 'Changed since you opened it', message: 'Someone changed what you are writing while you were. Save yours over theirs?', action: 'Save mine', danger: true }))) return update();
      const ops = [{ op: 'update', id: base.id, ...(next.title !== (from.title ?? '').trim() && { title: next.title }), ...(next.body !== (from.body ?? '') && { body: next.body }), ...(Object.keys(fresh).length && { props: fresh }) }];
      left = { id: base.id, from: area.selectionStart, to: area.selectionEnd };
      const done = await call('change', { ops, reason: 'Written in the sheet' });
      // Held for someone's word by a rule: it is on the map as a proposal, not yet applied.
      if (done.status && done.status !== 'applied') await tell('Saved as a proposal', 'A rule holds this change for a person to approve before it applies.');
      box.dataset.draft = '';
      kept.drop(base);
      fields.clear();
      state.selfDrawn = here && done.status === 'applied';
      saved(base.id);
    } catch (err) {
      left = null;
      update();
      tell('It was not saved', err.message);
    }
  });
  update();
  // Words put back are as tall as they are.
  if (restored) requestAnimationFrame(grow);
  // A new item opens with its title ready to be typed.
  if (isNew) requestAnimationFrame(() => title.focus());
  // Words to write are as tall as they are, and saving leaves the cursor where it was.
  if (writing) requestAnimationFrame(() => {
    grow();
    if (left?.id === base.id) area.setSelectionRange(left.from, left.to), area.focus({ preventScroll: true });
    left = null;
  });
  /** A field written in place: `keep(value, bad)` holds what it says now for Save; `bad` says why it cannot be saved yet. */
  const field = (name, was) => (value, why) => {
    fields.set(name, { was, now: value === undefined ? fields.get(name)?.now : value, bad: why });
    update();
  };
  /** Open the note as words to write, the cursor left where it is. */
  const open = () => {
    if (read) read.hidden = true;
    area.hidden = false;
    grow();
    update();
  };
  // Not to be written, the note is only read: no box to type in.
  return { title, note: note ? (editable ? [read, area] : [read]).filter(Boolean) : [], bar: box, field, open, save: () => save.click(), unsaved: () => changed() };
}

/** A new item's kept words follow it to the type chosen for it. */
function moveKept(was, to) {
  const copy = kept.get({ type: was });
  if (!copy) return;
  kept.drop({ type: was });
  kept.put({ type: to }, copy);
}

/** A new item as a draft in the sheet: its type (a task unless chosen), a title to type and a note. Saved, it is a loose
 * item on the map, tied to nothing: how it relates is said in its note, and an agent proposes the links. */
export function newItem(host, { type, title = '', style, types, choices }) {
  // A session that may not write makes nothing: the sheet holds no draft.
  if (!may('write')) return host.replaceChildren(h('div', { class: 'empty' }, 'Read only'));
  const draw = (chosen) => {
    const draft = draftOf({ base: { type: chosen, title }, style, saved: (id) => id && (location.hash = `#/e/${id}`) });
    host.replaceChildren(
      h(
        'div',
        { class: 'page-head' },
        draft.title,
        h('div', { class: 'sheet-marks' }, h('select', { class: 'mark-type', title: 'What kind of item it is', onchange: (ev) => ((title = draft.title.textContent), moveKept(chosen, ev.target.value), draw(ev.target.value)) }, choices.map((t) => h('option', { value: t.id, selected: t.id === chosen }, t.label))), h('span', { class: 'muted' }, 'new, tied to nothing yet')),
      ),
      h('section', { class: 'note' }, draft.note),
      draft.bar,
    );
  };
  draw(types.has(type) ? type : choices[0]?.id);
}
