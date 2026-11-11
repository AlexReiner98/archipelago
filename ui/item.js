// The page every item lands on, in the sheet that opens from the side of the canvas: a bare page of what the item
// holds, a section for each (ui/item-sections.js), under its title. What it is tied to is not on it: the canvas
// behind draws that, with this item lit. Rare actions are in one menu; the page names no pack's type.

import { api, ask, h, may, part, state, tell } from './base.js';
import { drawIn, goQuery, openHere, queryNow } from './canvas.js';
import { viewsOn } from './canvases.js';
import { draftOf } from './draft.js';
import { documentMenu, figureOf, publicMark, publicOf, readDocument, shareMenu } from './item-doc.js';
import { heldBand, heldOn } from './item-held.js';
import { readingOf } from './item-read.js';
import { choicesOf } from './fields.js';
import { choicesSection, fieldsSection, headSection, historySection, section, sourceSection } from './item-sections.js';
import { linkAdder } from './item-links.js';
import { startLink } from './link-pick.js';
import { added } from './query-bar.js';
import { drawing as redraw, settleWhenFilled } from './settle.js';
import { actionForm, actionsFor, buttonsOn, countOn, drawnBy, keepsFigure, readWhole, sectionsOn, toolOf } from './screens.js';
import { idsIn, isA, label, menu, relations, titles } from './words.js';
import { pageType, readPageModel } from './page-schema.js';

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
  // What does not wait on the item is asked with it: each read can take a second or more on a busy server, so the
  // page asks them side by side, not one after another. How its page looks, and what is held on it:
  const lookOf = api('view', { name: 'style', params: { of: id } }), heldHere = heldOn(id);
  lookOf.catch(() => null);
  try {
    [data, past] = await Promise.all([api('get', { id }), api('events', { target: id, limit: 40 })]);
  } catch (err) {
    return page.replaceChildren(h('div', { class: 'error' }, err.message));
  }
  const e = data.entity;
  // On an island that runs a version of its pack, the page is drawn by that version: its screens, views and fields.
  const version = await readPageModel(e);
  const type = pageType(e.type);
  // Whether this session may change the map: every control that writes is drawn only then (ui/base.js may).
  const writes = may('write');
  const change = async (ops, reason) => {
    try {
      await api('change', { ops, reason });
      again();
    } catch (err) {
      tell('That change was not made', err.message);
    }
  };
  // The kernel's own record of a session at work.
  const run = isA(e.type, 'run');
  const session = run && e.is_open && !e.archived_at;
  // Its owner; an item a screen reads whole, its text with the items it brings in, in their places (it can be printed
  // and shared); and what it holds that can be published (a site's project publishes all of it with one click).
  const [owner, { doc }, plan, shared] = await Promise.all([
    e.owner ? api('get', { id: e.owner }).then((r) => r.entity, () => null) : null,
    readWhole(e.type) ? readDocument(id) : { doc: null },
    !e.archived_at && data.incoming.some((r) => rootOf(r.type) === 'part_of' && readWhole(r.entity_type)) ? api('publish_plan', { within: id }).catch(() => null) : null,
    // Its public view, when a person shared it (src/public-view.ts).
    publicOf(id),
  ]);
  // A document is read in public as it was last published: whether it is, and whether its draft says something else now.
  const shown = doc && type?.public ? await api('published', { id }).catch(() => null) : null;
  // How its page looks is its style: the house style's, its kind's (a document reads through), its own.
  const looks = (await lookOf).style;

  // What waits for the person's word on it: each held change that touches it, as a band under its title.
  const bands = await Promise.all((await heldHere).map((p) => heldBand(p, again)));

  const live = writes && !e.archived_at && e.is_open && !e.type.startsWith('sys.');
  // What can be shown to anyone is what its pack says can be; public work (a product) has a page of its own.
  const publishable = writes && !e.archived_at && type?.public;
  // Work an agent can take on: what can be estimated.
  const workish = writes && !e.archived_at && Boolean(type?.capabilities?.plannable) && Boolean(type?.fields.tokens_estimated);
  const ties = linkAdder(e, change, again);
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

  // What it relates to, drawn one click from its page (decision e_jedng69e): the item found, and a walk of one step
  // along the links it has, in place of the canvas's lens or added to it.
  // What holds others walks part_of down only, so a step more goes deeper into it and never up to what holds it.
  const holds = data.incoming.some((r) => rootOf(r.type) === 'part_of');
  const along = [...new Set([...data.outgoing, ...data.incoming].map((r) => r.type).filter((t) => !t.startsWith('sys.')).map((t) => (holds && rootOf(t) === 'part_of' ? `${t}<` : t)))];
  const walkFrom = (add) => {
    const now = queryNow();
    if (!add || !now) return goQuery({ filter: { find: [`id ${id}`] }, walk: { over: along, steps: 1 } });
    const over = now.walk?.over === 'all' ? 'all' : [...new Set([...(now.walk?.over ?? []), ...along])];
    goQuery({ ...added(now, { find: `id ${id}` }), walk: { over, steps: Math.max(1, now.walk?.steps ?? 0) } });
  };
  const walkSaid = along.map((t) => t.replace(/[<>]$/, '')).map((t) => relations.get(t)?.title ?? t).join(', ');
  // What its type's screens give it to do: the first in sight, beside Walk from it, any more in the menu.
  // And the views packs ship of an item of its type (ui/canvases.js), each drawn on the canvas up.
  const buttons = e.archived_at ? [] : [...buttonsOn(data).filter((b) => writes || !b.action), ...viewsOn(e.type, id).map((v) => ({ label: v.title, tip: `Draw its ${v.title.toLowerCase()} on the canvas`, at: v.at }))];
  const press = (b) => (b.at ? openHere(b.at) : b.draw ? drawIn(drawnBy(b.draw, id)) : act(toolOf(b.action)));

  redraw.inPlace = inPlace;
  // Its title and note, written in place and saved as one change (ui/draft.js).
  // A document reads in its note's place as it will publish (ui/item-read.js).
  const reading = doc && readingOf(doc, looks);
  // Read beside its draft (the pages), a document opens as words to write: it reads on the left already.
  const writing = Boolean(doc && document.querySelector('.lens-view.beside-sheet'));
  const draft = draftOf({ base: e, style: looks, editable: writes && !e.archived_at, reading, writing, saved: again, count: countOn(data) });
  // The sheet can open before the canvas under it has drawn: told when it has.
  if (doc && !writing) document.getElementById('sheet').addEventListener('beside', () => draft.open(), { once: true });
  const note = section('note', 'Note', 0, keepsFigure(e.type) && figureOf(e, 'figure'), h('div', { class: 'note' }, draft.note));
  // A field picked is changed at once; words written in a field wait with the note for its Save. A pick made while
  // words wait leaves the page as it stands, so they are not lost: it is drawn again when they are saved.
  const fieldEdit = writes && !e.archived_at && {
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
  const history = historySection(id, past, writes && !e.archived_at && again);
  const kids = [
    h(
      'div',
      { class: 'page-head' },
      draft.title,
      h(
        'div',
        { class: 'sheet-marks' },
        h('span', { class: 'grow' }),
        version && h('span', { class: 'muted small gist version-mark', title: `Its island runs ${version.title}, a version of the ${version.of} pack: this page is drawn by it` }, version.title),
        // The public views that show it, and a share again when one is behind it (ui/item-doc.js).
        publicMark(data.public_views, again, writes && !e.archived_at),
        writes && session && h('button', { class: 'quiet-button', title: 'Close it and release what it holds', onclick: endSession }, 'End session'),
        buttons[0] && h('button', { class: 'quiet-button item-button', title: buttons[0].tip, onclick: () => press(buttons[0]) }, buttons[0].label),
        writes && !e.archived_at && ties.any && h('button', { class: 'quiet-button link-start', title: 'Link it to another: click that one on the canvas (Esc lets it go)', onclick: () => startLink(e, (made) => made && again()) }, 'Link'),
        !e.archived_at && along.length > 0 && h('button', { class: 'quiet-button walk-from', title: `Draw it and what it links to, along ${walkSaid}, in place of the canvas's lens`, onclick: () => walkFrom(false) }, 'Walk from it'),
      menu('⋯', [
        ...buttons.slice(1).map((b) => [b.label, () => press(b)]),
        writes && !e.archived_at && ties.any && ['Link to one by name…', ties.open],
        !e.archived_at && along.length > 0 && ['Walk from it, added to the lens', () => walkFrom(true)],
        live && ['Still true as written', () => change([{ op: 'update', id }], 'Checked in the UI: still true as written')],
        // What packs offer to do with this kind of item.
        ...(e.archived_at || !writes ? [] : actionsFor(e.type).filter((tool) => !buttons.some((b) => b.action === tool.action)).map((tool) => [tool.title ?? tool.tool, () => act(tool)])),
        // Only an address on the web: what an agent wrote there is opened by the owner's click.
        /^https?:[/][/]/i.test(e.props.link ?? '') && ['Open where it ran', () => window.open(e.props.link, '_blank', 'noopener')],
        workish && ['Copy session brief', copyBrief],
        workish && ['Launch a session: investigate only', () => launch('plan')],
        workish && ['Launch a session: may edit files', () => launch('acceptEdits')],
        writes && plan?.documents.length > 0 && [
          plan.to_publish ? `Publish all (${plan.to_publish} to publish)` : 'Publish all again',
          async () =>
            (await ask({ title: `Publish everything in "${e.title}"?`, message: `Its ${plan.documents.length} documents, as they are now, for anyone to read at their own addresses, each linking to the others. What you change afterwards stays a draft until you publish again.`, action: 'Publish all', danger: plan.documents.some((d) => !d.published) })) &&
            api('publish_all', { within: id }).then((r) => (r.refused && tell('Some were not published', r.refused.map((x) => `${x.title}: ${x.error}`).join(' ')), again()), (err) => tell('Nothing was published', err.message)),
        ],
        // The page a reader would be given if it were published now, drawn by the published page itself.
        publishable && doc && ['Preview as published', () => window.open(`/preview/${id}`, '_blank')],
        writes && shown && [
          shown.published ? 'Publish again' : 'Publish',
          async () =>
            (await ask({ title: `Publish "${e.title}"?`, message: 'Anyone will be able to read it at its own address, with no login, and search engines to list it: its text, the sections it holds that are shared with the workspace and its views, as they are now. What you change afterwards stays a draft until you publish again.', action: 'Publish', danger: !shown.published })) &&
            api('publish', { id }).then(again, (err) => tell('It was not published', err.message)),
        ],
        writes && shown?.published && ['Unpublish', async () => (await ask({ title: `Unpublish "${e.title}"?`, message: 'Its address will answer nothing; it stays shared with the workspace.', action: 'Unpublish', danger: true })) && api('unpublish', { id }).then(again, (err) => tell('It was not unpublished', err.message))],
        publishable &&
          !shown &&
          e.visibility !== 'public' && [
            'Make public',
            async () =>
              (await ask({ title: `Make "${e.title}" public?`, message: doc ? 'Anyone will be able to read it at its own address, with no login, and search engines to list it: its text and the sections it holds that are shared with the workspace. History stays private.' : 'Anyone will be able to see its name and state, with no login. A proof question brings its tests and their results. Notes and history stay private.', action: 'Make public', danger: true })) &&
              change([{ op: 'update', id, visibility: 'public' }], 'Made public in the UI'),
          ],
        publishable && !shown && e.visibility === 'public' && ['Stop being public', () => change([{ op: 'update', id, visibility: 'private' }], 'No longer public, set in the UI')],
        e.visibility === 'public' && type?.public && (Boolean(type?.capabilities?.plannable) || shown?.published) && ['Open its public page', () => window.open(`/p/${e.workspace}/${id}`, '_blank', 'noopener')],
        ...(doc ? documentMenu(e, shared, again, writes) : shareMenu(e, shared, again, writes)),
        ['Copy id', () => navigator.clipboard.writeText(e.id)],
        writes && !e.archived_at && ['Archive', async () => (await ask({ title: `Archive "${e.title}"?`, message: 'It leaves every view but stays in the history.', action: 'Archive', danger: true })) && change([{ op: 'archive', id }], 'Archived in the UI'), 'danger'],
      ]),
      ),
    ),
    ...bands,
    writes && ties.editor,
    acting,
    headSection(e, owner, writes && ((st) => change([{ op: 'update', id, status: st }], `Status set to ${st} in the UI`)), writes && ((v) => change([{ op: 'update', id, visibility: v }], `Visibility set to ${v} in the UI`))),
    note,
    // What its kind's screens add to the page: a run's turns, for one.
    ...sectionsOn(data),
    choicesSection(e, writes && pick, fieldEdit),
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
