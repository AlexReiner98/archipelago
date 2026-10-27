// The page every item lands on, in the sheet that opens from the side of the canvas: a bare page of what the item
// holds, a section for each (ui/item-sections.js), under its title. What it is tied to is not on it: the canvas
// behind draws that, with this item lit. Rare actions are in one menu; the page names no pack's type.

import { api, ask, h, part, state, tell } from './base.js';
import { draftOf } from './draft.js';
import { documentMenu, figureOf, readDocument } from './item-doc.js';
import { readingOf } from './item-read.js';
import { choicesOf } from './fields.js';
import { choicesSection, fieldsSection, headSection, historySection, section, sourceSection } from './item-sections.js';
import { relationEditor } from './item-links.js';
import { drawing as redraw, settleWhenFilled } from './settle.js';
import { actionForm, actionsFor, keepsFigure, readWhole } from './screens.js';
import { idsIn, isA, label, menu, relations, titles, types } from './words.js';

/** The root relation a relation extends: what the page reads, whichever pack's flavour of it was used. */
const rootOf = (type) => relations.get(type)?.root ?? type;

export async function entity(id, here) {
  const page = part('item');
  const again = () => entity(id, here);
  // Drawn again in place (after a change, a step further out, the map changing under it), only what differs is swapped.
  const inPlace = page.dataset.item === id && page.childElementCount > 0;
  if (!inPlace) page.replaceChildren(h('div', { class: 'empty' }, 'Loading…'));
  page.dataset.item = id;
  let data;
  let past;
  try {
    [data, past] = await Promise.all([api('get', { id }), api('events', { target: id, limit: 40 })]);
  } catch (err) {
    return page.replaceChildren(h('div', { class: 'error' }, err.message));
  }
  const e = data.entity;
  const type = types.get(e.type);
  const change = async (ops, reason) => {
    try {
      await api('change', { ops, reason });
      again();
    } catch (err) {
      tell('That change was not made', err.message);
    }
  };
  const owner = e.owner ? await api('get', { id: e.owner }).then((r) => r.entity, () => null) : null;
  // The kernel's own record of a session at work.
  const run = isA(e.type, 'sys.run');
  const session = run && e.is_open && !e.archived_at;
  // An item a screen reads whole can be printed and shared: its text with the items it brings in, in their places.
  const { doc, links } = readWhole(e.type) ? await readDocument(id) : { doc: null, links: [] };
  // A document is read in public as it was last published: whether it is, and whether its draft says something else now.
  // One shared from another workspace too, which publishes only where that workspace allows it (src/published-share.ts).
  const shown = doc && type?.public ? await api('published', { id }).catch(() => null) : null;
  // What it holds that can be published: a site's project publishes all of it with one click.
  const plan = !e.archived_at && data.incoming.some((r) => rootOf(r.type) === 'part_of' && readWhole(r.entity_type)) ? await api('publish_plan', { within: id }).catch(() => null) : null;
  // How its page looks is its style: the house style's, its kind's (a document reads through), its own.
  const looks = (await api('view', { name: 'style', params: { of: id } })).style;

  const live = !e.archived_at && e.is_open && !e.type.startsWith('sys.');
  // What can be shown to anyone is what its pack says can be; public work (a product) has a page of its own.
  const publishable = !e.archived_at && type?.public;
  // Work an agent can take on: what can be estimated.
  const workish = !e.archived_at && e.kind === 'work' && Boolean(type?.fields.tokens_estimated);
  const ties = relationEditor(e, data, change, again);
  const endSession = async () => {
    if (!(await ask({ title: `End "${e.title}"?`, message: 'Anything it holds is released.', action: 'End session', danger: true }))) return;
    try {
      await api('session_end', { run: id, outcome: 'cancelled', summary: 'Ended from the UI' });
    } catch (err) {
      await tell('The session was not ended', err.message);
    }
    again();
  };
  // Ids in its fields and its note are said by the names of what they name: its neighbours' are already here.
  for (const r of [...data.outgoing, ...data.incoming, ...(data.mentioned_in ?? [])]) titles.set(r.id, r.title);
  const noted = idsIn([e.body ?? '', ...Object.values(e.props).map((v) => (typeof v === 'string' ? v : ''))].join(' ')).filter((n) => !titles.has(n));
  await Promise.all(noted.map((n) => api('get', { id: n }).then((r) => titles.set(r.entity.id, r.entity.title), () => null)));
  // Settling a question by picking one of its choices: what was chosen, and why if it is said, and its first closed
  // status, as one change on the person's word. Whether it applies or waits is the rules' to say.
  const pick = async (choice) => {
    const c = choicesOf(e, type);
    const why = await ask({ title: `Settle "${e.title}"?`, message: choice, input: c.why ? { placeholder: 'Why? (optional)' } : undefined, action: 'Settle it' });
    if (why === null || why === false) return;
    // The day it was settled on, where its type keeps one (settles.on): the reader's own day.
    const now = new Date();
    const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
    const props = { ...(c.chosen && { [c.chosen]: choice }), ...(c.why && typeof why === 'string' && why.trim() && { [c.why]: why.trim() }), ...(c.on && { [c.on]: today }) };
    change([{ op: 'update', id, status: type.statuses.closed[0], props }], `Settled in the UI: ${choice}`);
  };
  // A pack's action on this kind of item opens its form under the page's head.
  const acting = h('div');
  const act = (tool) => {
    const form = actionForm(tool, id, again);
    acting.replaceChildren(form);
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

  redraw.inPlace = inPlace;
  // Its title and note, written in place and saved as one change (ui/draft.js).
  // A document reads in its note's place as it will publish (ui/item-read.js); one shared from another workspace is
  // read there, not written here.
  const reading = doc && readingOf(doc, looks);
  const draft = draftOf({ base: e, style: looks, editable: !e.archived_at, reading, saved: again });
  const note = section('note', 'Note', 0, keepsFigure(e.type) && figureOf(e, 'figure'), h('div', { class: 'note' }, doc?.from ? reading : draft.note));
  // A field picked is changed at once; words written in a field wait with the note for its Save. A pick made while
  // words wait leaves the page as it stands, so they are not lost: it is drawn again when they are saved.
  const fieldEdit = !e.archived_at && {
    pick: async (name, value) => {
      const words = draft.unsaved();
      try {
        const made = await api('change', { ops: [{ op: 'update', id, props: { [name]: value } }], reason: `${label(name)} set in the UI` });
        if (made.status && made.status !== 'applied') await tell('Saved as a proposal', 'A rule holds this change for a person to approve before it applies.');
        state.selfDrawn = made.status === 'applied';
      } catch (err) {
        await tell('That change was not made', err.message);
      }
      if (!words) again();
    },
    keep: draft.field,
    save: draft.save,
  };
  const history = historySection(id, past);
  const kids = [
    h(
      'div',
      { class: 'page-head' },
      draft.title,
      h(
        'div',
        { class: 'sheet-marks' },
        h('span', { class: 'grow' }),
        session && h('button', { class: 'quiet-button', title: 'Close it and release what it holds', onclick: endSession }, 'End session'),
      menu('⋯', [
        !e.archived_at && ties.any && ['Edit links', ties.open],
        live && ['Still true as written', () => change([{ op: 'update', id }], 'Checked in the UI: still true as written')],
        // What packs offer to do with this kind of item.
        ...(e.archived_at ? [] : actionsFor(e.type).map((tool) => [tool.title ?? tool.tool, () => act(tool)])),
        // Only an address on the web: what an agent wrote there is opened by the owner's click.
        /^https?:[/][/]/i.test(e.props.link ?? '') && ['Open where it ran', () => window.open(e.props.link, '_blank', 'noopener')],
        workish && ['Copy session brief', copyBrief],
        workish && ['Launch a session: investigate only', () => launch('plan')],
        workish && ['Launch a session: may edit files', () => launch('acceptEdits')],
        plan?.documents.length > 0 && [
          plan.to_publish ? `Publish all (${plan.to_publish} to publish)` : 'Publish all again',
          async () =>
            (await ask({ title: `Publish everything in "${e.title}"?`, message: `Its ${plan.documents.length} documents, as they are now, for anyone to read at their own addresses, each linking to the others. What you change afterwards stays a draft until you publish again.`, action: 'Publish all', danger: plan.documents.some((d) => !d.published) })) &&
            api('publish_all', { within: id }).then((r) => (r.refused && tell('Some were not published', r.refused.map((x) => `${x.title}: ${x.error}`).join(' ')), again()), (err) => tell('Nothing was published', err.message)),
        ],
        // The page a reader would be given if it were published now, drawn by the published page itself.
        publishable && doc && ['Preview as published', () => window.open(`/preview/${id}`, '_blank')],
        shown && [
          shown.published ? 'Publish again' : 'Publish',
          async () =>
            (await ask({ title: `Publish "${e.title}"?`, message: 'Anyone will be able to read it at its own address, with no login, and search engines to list it: its text, the sections it holds that are shared with the workspace and its views, as they are now. What you change afterwards stays a draft until you publish again.', action: 'Publish', danger: !shown.published })) &&
            api('publish', { id }).then(again, (err) => tell('It was not published', err.message)),
        ],
        shown?.published && ['Unpublish', async () => (await ask({ title: `Unpublish "${e.title}"?`, message: 'Its address will answer nothing; it stays shared with the workspace.', action: 'Unpublish', danger: true })) && api('unpublish', { id }).then(again, (err) => tell('It was not unpublished', err.message))],
        publishable &&
          !shown &&
          e.visibility !== 'public' && [
            'Make public',
            async () =>
              (await ask({ title: `Make "${e.title}" public?`, message: doc ? 'Anyone will be able to read it at its own address, with no login, and search engines to list it: its text and the sections it holds that are shared with the workspace. History stays private.' : 'Anyone will be able to see its name and state, with no login. A proof question brings its tests and their results. Notes and history stay private.', action: 'Make public', danger: true })) &&
              change([{ op: 'update', id, visibility: 'public' }], 'Made public in the UI'),
          ],
        publishable && !shown && e.visibility === 'public' && ['Stop being public', () => change([{ op: 'update', id, visibility: 'private' }], 'No longer public, set in the UI')],
        e.visibility === 'public' && type?.public && (e.kind === 'work' || shown?.published) && ['Open its public page', () => window.open(`/p/${e.workspace}/${id}`, '_blank', 'noopener')],
        ...(doc ? documentMenu(e, links, page, again, doc) : []),
        ['Copy id', () => navigator.clipboard.writeText(e.id)],
        !e.archived_at && ['Archive', async () => (await ask({ title: `Archive "${e.title}"?`, message: 'It leaves every view but stays in the history.', action: 'Archive', danger: true })) && change([{ op: 'archive', id }], 'Archived in the UI'), 'danger'],
      ]),
      ),
    ),
    ties.editor,
    acting,
    headSection(e, owner, (st) => change([{ op: 'update', id, status: st }], `Status set to ${st} in the UI`), (v) => change([{ op: 'update', id, visibility: v }], `Visibility set to ${v} in the UI`)),
    note,
    choicesSection(e, pick, fieldEdit),
    fieldsSection(e, looks, fieldEdit),
    sourceSection(data.source),
    // One Save for the note and every field written in place, kept in sight at the foot of the page.
    draft.bar,
    history,
  ].filter(Boolean);
  redraw.inPlace = false;
  if (inPlace) return settleWhenFilled(page, kids, async () => {});
  page.replaceChildren(...kids);
}
