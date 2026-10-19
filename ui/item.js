// The page every item lands on, drawn from what every item has and what its kind and type say of it: where it
// sits, its facts, a picture of what it is tied to, what holds it up, its note and its history. What a pack adds
// for a kind or type comes as screens (ui/screens.js), one column under the note; the page names no pack's type.

import { api, ask, h, part, tell } from './base.js';
import { renderBody } from './body.js';
import { automationDoes, entityForm } from './forms.js';
import { documentMenu, documentNote, figureOf, readDocument } from './item-doc.js';
import { relationEditor } from './item-links.js';
import { lensView, storyPart } from './lens.js';
import { actionForm, actionsFor, drawScreens, fold, keepsFigure, readWhole } from './screens.js';
import { RAN, ageChip, ago, changeRow, chip, eventLine, gist, idsAsLinks, isA, isClosed, link, menu, pill, relations, statusesOf, titles, tokensText, typeTitle, types, when } from './words.js';

/** The root relation a relation extends: what the page reads, whichever pack's flavour of it was used. */
const rootOf = (type) => relations.get(type)?.root ?? type;
/** The ties that hold work up: what depends on it, waits on it or needs it. */
const HOLDING = ['depends_on', 'waits_on', 'needs'];
/** A session's own record (where it ran, its ids, when it was heard from, what it used): said as marks, not as fields. */
const RUN_OWN = ['story', 'session_id', 'cwd', 'last_seen', 'tokens_used', 'surface'];
/** A field that holds an item's id. */
const ID = /^e_[a-z0-9]{8}$/;

export async function entity(id, here) {
  const page = part('item');
  const again = () => entity(id, here);
  // Drawn again in place (after a change, a step further out), the page keeps its height and its scroll.
  if (page.dataset.item !== id) page.replaceChildren(h('div', { class: 'empty' }, 'Loading…'));
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
  const altitude = type?.altitude;
  const change = async (ops, reason) => {
    try {
      await api('change', { ops, reason });
      again();
    } catch (err) {
      tell('That change was not made', err.message);
    }
  };
  const owner = e.owner ? await api('get', { id: e.owner }).then((r) => r.entity, () => null) : null;
  // The kernel's own records: a session and an automation.
  const run = isA(e.type, 'sys.run');
  const session = run && e.is_open && !e.archived_at;
  const automation = isA(e.type, 'sys.automation');
  // A session that told the story of its work is that story first.
  const story = run && e.props.story?.length ? await api('view', { name: 'story', params: { run: id } }).catch(() => null) : null;
  // An item a screen reads whole is met as its reader meets it: its text with the items it brings in, in their places.
  const { doc, links } = readWhole(e.type) ? await readDocument(id) : { doc: null, links: [] };

  const live = !e.archived_at && e.is_open && !e.type.startsWith('sys.');
  // What names it, less what the trail already leads to; and what it makes for a reader, named under its title.
  const made = (r) => rootOf(r.type) === 'part_of' && types.get(r.entity_type)?.deliverable;
  const mentions = (data.mentioned_in ?? []).filter((m) => !data.trail?.some((t) => t.id === m.id) && !data.incoming.some((r) => r.id === m.id && made(r)));
  const delivers = data.incoming.filter((r) => made(r) && !isClosed(r.entity_type, r.status));
  // What can be shown to anyone is what its pack says can be; public work (a product) has a page of its own.
  const publishable = !e.archived_at && type?.public;
  // Work an agent can take on: what can be estimated.
  const workish = !e.archived_at && type?.kind === 'work' && Boolean(type.fields.tokens_estimated);
  const ties = relationEditor(e, data, change, again);
  // What happened to it, as the same lines Changes shows.
  const sets = [];
  for (const ev of past) {
    const last = sets.at(-1);
    if (ev.changeset && last?.changeset === ev.changeset) last.events.push(ev);
    else sets.push({ changeset: ev.changeset, events: [ev] });
  }
  const lines = sets.flatMap((g) => (g.changeset ? changeRow(g, { here: id }) : g.events.map(eventLine)));
  const holding = data.incoming.filter((r) => HOLDING.includes(rootOf(r.type)));
  const heldBy = data.outgoing.filter((r) => HOLDING.includes(rootOf(r.type)));
  const tieRows = (rows) => h('ul', { class: 'rows' }, rows.map((r) => h('li', { class: 'row-top tie-row' }, chip(r.entity_type), h('span', { class: 'grow', title: r.title }, link(r)), rootOf(r.type) !== 'depends_on' && h('span', { class: 'muted small' }, relations.get(r.type)?.title ?? r.type), pill(r.entity_type, r.status))));
  const endSession = async () => {
    if (!(await ask({ title: `End "${e.title}"?`, message: 'Anything it holds is released.', action: 'End session', danger: true }))) return;
    try {
      await api('session_end', { run: id, outcome: 'cancelled', summary: 'Ended from the UI' });
    } catch (err) {
      await tell('The session was not ended', err.message);
    }
    again();
  };
  // A short value is a fact to glance at; a long one (a decision's outcome, its rationale) is text to read.
  const fields = Object.entries(e.props).filter(([k, v]) => v !== null && v !== '' && k !== 'story' && !(run && RUN_OWN.includes(k)));
  const runFacts = run && [
    e.props.surface && h('span', { class: 'fact', title: e.props.cwd ?? '' }, e.props.surface === 'claude-code' ? 'Claude Code' : (RAN[e.props.surface] ?? e.props.surface)),
    e.props.last_seen && h('span', { class: 'fact' }, h('span', { class: 'muted' }, 'heard from '), ago(e.props.last_seen)),
    e.props.tokens_used > 0 && h('span', { class: 'fact', title: `${e.props.tokens_used} tokens, input and output, not counting cached re-reads` }, h('span', { class: 'muted' }, 'used '), tokensText(e.props.tokens_used)),
  ];
  const short = fields.filter(([, v]) => String(v).length <= 32);
  // A field that holds an item's id says that item's name, as a way to it.
  await Promise.all(short.filter(([, v]) => ID.test(String(v)) && !titles.has(String(v))).map(([, v]) => api('get', { id: String(v) }).then((r) => titles.set(r.entity.id, r.entity.title), () => null)));
  const value = (v) => (ID.test(String(v)) ? idsAsLinks(String(v)) : String(v));
  const long = fields.filter(([, v]) => String(v).length > 32);
  const edit = () => {
    const form = entityForm(e.type, e, {
      submitLabel: 'Save',
      onCancel: again,
      onSubmit: async (next) => {
        const props = { ...next.props };
        for (const key of Object.keys(e.props)) if (!(key in props) && !type?.fields[key]?.system) props[key] = null;
        await api('change', { ops: [{ op: 'update', id, title: next.title, body: next.body, status: next.status, visibility: next.visibility || undefined, props }], reason: 'Edited in the UI' });
        again();
      },
    });
    page.querySelector('.note').replaceWith(form);
    form.scrollIntoView({ block: 'nearest' });
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

  const note = doc
    ? documentNote(doc, id, here)
    : h(
        'section',
        { class: 'card wide note' },
        keepsFigure(e.type) && figureOf(e, 'figure'),
        long.length > 0 && h('dl', { class: 'fields' }, long.map(([k, v]) => [h('dt', {}, k.replaceAll('_', ' ')), h('dd', {}, String(v).length > 140 ? h('details', { class: 'long' }, h('summary', { title: String(v) }, gist(String(v))), String(v)) : String(v))])),
        e.body ? renderBody(e.body) : !long.length && h('div', { class: 'empty' }, 'No notes.'),
      );
  const screens = drawScreens({ e, data, id, redraw: again });

  page.replaceChildren(
    h(
      'div',
      { class: 'page-head' },
      h('div', { class: 'row-top' }, chip(e.type), altitude && h('span', { class: 'pill', title: `How high this sits: workspace, project, stream, step` }, altitude), e.archived_at && h('span', { class: 'pill closed' }, 'archived'), e.confidence < 1 && h('span', { class: 'pill warn' }, `confidence ${e.confidence}`), e.private_to && h('span', { class: 'pill closed', title: 'Other members of the workspace cannot see this' }, 'private to you'), e.visibility === 'public' && h('span', { class: 'pill ok', title: 'Anyone can see its name and state, with no login' }, 'public'), links.length > 0 && h('span', { class: 'pill warn', title: `Readable with no login by whoever holds the link (${links.length})` }, 'shared by link')),
      // Where it sits, from Home down, each step a way back up, so a person always knows how high they are; a stream or a
      // step in nothing says so, as work to file (docs/ui-strategy.md).
      h(
        'nav',
        { class: 'trail', title: 'Where this sits' },
        h('a', { class: 'trail-step', href: '#/' }, 'Home'),
        (data.trail ?? []).map((t) => [h('span', { class: 'trail-sep' }, '›'), h('a', { class: 'trail-step', href: `#/e/${t.id}`, title: `${typeTitle(t.type)}: ${t.title}` }, t.title)]),
        !data.trail?.length && (altitude === 'stream' || altitude === 'step') && [h('span', { class: 'trail-sep' }, '›'), h('span', { class: 'muted', title: 'Part of no project yet' }, 'not filed')],
      ),
      h('h1', { style: 'margin-top: 6px' }, e.title),
      // The pictures it is drawn in, each a way straight back to it with this item marked, and the documents that show it.
      data.shown_in?.length > 0 &&
        h(
          'div',
          { class: 'delivers shown-in', title: 'The pictures this is drawn in' },
          h('span', { class: 'muted small' }, 'Shown in'),
          data.shown_in.map((v) => [
            h('a', { class: 'trail-view', href: `#/graph?from=${v.of.id}&lens=${v.id}&here=${id}`, title: `Open "${v.title}" of ${v.of.title}, with this marked in it` }, v.title),
            v.documents.map((d) => h('a', { class: 'deliverable', href: `#/e/${d.id}?here=${id}`, title: `"${v.title}" is drawn in this document; it opens with this marked` }, chip(d.type), h('span', { class: 'gist' }, d.title))),
          ]),
        ),
      // What names it in its text: a link written as an id has its way back here.
      mentions.length > 0 && h('div', { class: 'delivers mentions', title: 'What names this in its text or fields' }, h('span', { class: 'muted small' }, 'Mentioned in'), mentions.map((m) => h('span', { class: 'deliverable' }, chip(m.type), h('span', { class: 'gist', title: m.title }, link(m))))),
      // What it makes for a reader or a customer, named where it is looked for: under the title of what it is part of.
      delivers.length > 0 &&
        h(
          'div',
          { class: 'delivers', title: 'What this delivers: documents, files and releases that are part of it' },
          h('span', { class: 'muted small' }, 'Delivers'),
          delivers.map((r) => h('span', { class: 'deliverable' }, chip(r.entity_type), h('span', { class: 'gist', title: r.title }, link(r)), pill(r.entity_type, r.status))),
        ),
    ),
    h(
      'div',
      { class: 'toolbar facts' },
      h('select', { title: 'Status', onchange: (ev) => change([{ op: 'update', id, status: ev.target.value }], `Status set to ${ev.target.value} in the UI`) }, statusesOf(e.type).map((st) => h('option', { value: st, selected: st === e.status }, st))),
      live && ageChip(e),
      session && h('button', { title: 'Close it and release what it holds', onclick: endSession }, 'End session'),
      automation && h('span', { class: 'fact' }, automationDoes(e.props)),
      automation && e.props.last_fired && h('span', { class: `fact${String(e.props.last_result).startsWith('failed') ? ' error' : ''}`, title: String(e.props.last_result) }, `last fired ${when(e.props.last_fired)}`),
      h('span', { class: 'fact' }, owner ? link(owner) : h('span', { class: 'muted' }, 'no owner')),
      runFacts,
      short.map(([k, v]) => h('span', { class: 'fact' }, h('span', { class: 'muted' }, `${k.replaceAll('_', ' ')} `), value(v))),
      h('span', { class: 'grow' }),
      !e.archived_at && h('button', { onclick: edit }, 'Edit'),
      menu('More', [
        !e.archived_at && ties.any && ['Edit relations', ties.open],
        live && ['Still true as written', () => change([{ op: 'update', id }], 'Checked in the UI: still true as written')],
        // What packs offer to do with this kind of item.
        ...(e.archived_at ? [] : actionsFor(e.type).map((tool) => [tool.title ?? tool.tool, () => act(tool)])),
        // Only an address on the web: what an agent wrote there is opened by the owner's click.
        /^https?:[/][/]/i.test(e.props.link ?? '') && ['Open where it ran', () => window.open(e.props.link, '_blank', 'noopener')],
        // A repository, known by its address on GitHub: an agent on the server can re-check its oldest items against its code.
        type?.fields.remote && !e.archived_at && e.props.remote && ['Re-check its oldest items now', () => api('github_app', { recheck: id }).then(() => tell('The re-check has started', 'An agent on the server is checking this repository’s oldest open items against its code. Its run shows here, under Tokens used, in a few minutes.'), (err) => tell('The re-check did not start', err.message))],
        data.source && [`Source: ${data.source.title.replace(/\b[a-z]_[a-z0-9]{8}\b/g, (found) => titles.get(found) ?? 'a session')}`, () => (location.hash = `#/e/${data.source.id}`)],
        workish && ['Copy session brief', copyBrief],
        workish && ['Launch a session: investigate only', () => launch('plan')],
        workish && ['Launch a session: may edit files', () => launch('acceptEdits')],
        publishable &&
          e.visibility !== 'public' && [
            'Make public',
            async () =>
              (await ask({ title: `Make "${e.title}" public?`, message: 'Anyone will be able to see its name and state, with no login. A proof question brings its tests and their results. Notes and history stay private.', action: 'Make public', danger: true })) &&
              change([{ op: 'update', id, visibility: 'public' }], 'Made public in the UI'),
          ],
        publishable && e.visibility === 'public' && ['Stop being public', () => change([{ op: 'update', id, visibility: 'private' }], 'No longer public, set in the UI')],
        e.visibility === 'public' && type?.public && type.kind === 'work' && ['Open its public page', () => window.open(`/p/${e.workspace}/${id}`, '_blank', 'noopener')],
        ...(doc ? documentMenu(e, links, page, again) : []),
        ['Copy id', () => navigator.clipboard.writeText(e.id)],
        !e.archived_at && ['Archive', async () => (await ask({ title: `Archive "${e.title}"?`, message: 'It leaves every view but stays in the history.', action: 'Archive', danger: true })) && change([{ op: 'archive', id }], 'Archived in the UI'), 'danger'],
      ]),
    ),
    ties.editor,
    acting,
    // Where it sits and what it holds, as a picture: the lens and the style kept for it, or the ones every item opens on. It takes no room when there is nothing to draw.
    ...(story ? [storyPart(story)].flat() : [h('section', { class: 'card lens-card', style: 'margin-bottom: 14px' }, lensView({ lens: { from: id }, quiet: true }))]),
    // What it holds up and what holds it, said outright: a picture places them, these say which way the tie runs.
    (holding.length + heldBy.length > 0 || '') &&
      h('div', { class: 'grid', style: 'margin-bottom: 14px' }, holding.length > 0 && fold(id, 'holding', 'Waiting on this', holding.length, true, tieRows(holding)), heldBy.length > 0 && fold(id, 'held', 'This waits on', heldBy.length, true, tieRows(heldBy))),
    // What it is comes before what its screens draw of it: said under a chart, it reads as a caption to it.
    // A session that tells its story keeps its log of notes behind a fold: the story is what it says.
    h('div', { class: 'grid', style: 'margin-bottom: 14px' }, story ? fold(id, 'log', 'Log', 0, false, note) : note),
    screens.column,
    h('div', { class: 'grid' }, fold(id, 'history', 'History', lines.length, false, lines)),
  );
  screens.after();
}
