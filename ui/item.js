// The page every item lands on.

import { api, ask, h, main, part, state, tell } from './base.js';
import { renderBody } from './body.js';
import { automationDoes, entityForm } from './forms.js';
import { gate } from './gate.js';
import { tokensText } from './graph.js';
import { lensView, storyPart } from './lens.js';
import { proofPart } from './proof.js';
import { roadmap } from './roadmap.js';
import { RAN, ageChip, ago, changeRow, chip, eventLine, fits, gist, idsAsLinks, isA, isClosed, kept, link, menu, pill, relations, statusesOf, titles, typeTitle, types, unfolded, when } from './words.js';
import { secretBox } from './workspace-cards.js';

export async function entity(id, here) {
  const main = part('item');
  // Drawn again in place (after a change, a step further out), the page keeps its height and its scroll.
  if (main.dataset.item !== id) main.replaceChildren(h('div', { class: 'empty' }, 'Loading…'));
  main.dataset.item = id;
  let data;
  let past;
  try {
    [data, past] = await Promise.all([api('get', { id }), api('events', { target: id, limit: 40 })]);
  } catch (err) {
    return main.replaceChildren(h('div', { class: 'error' }, err.message));
  }
  const e = data.entity;
  const change = async (ops, reason) => {
    try {
      await api('change', { ops, reason });
      entity(id);
    } catch (err) {
      tell('That change was not made', err.message);
    }
  };
  const owner = e.owner ? await api('get', { id: e.owner }).then((r) => r.entity, () => null) : null;
  // A repository says what the agents working in it have used: the sync agent in GitHub Actions, and sessions on a machine.
  const used = isA(e.type, 'software.repo') ? await api('view', { name: 'agent_usage', params: { repo: id } }).catch(() => null) : null;
  // A session that told the story of its work is that story first.
  const story = isA(e.type, 'sys.run') && e.props.story?.length ? await api('view', { name: 'story', params: { run: id } }).catch(() => null) : null;
  // A document is read as its reader meets it: its text with the items it brings in, in their places.
  const doc = isA(e.type, 'document') ? await api('document', { id }).catch(() => null) : null;
  const links = doc ? (await api('share_list', { id }).catch(() => [])).filter((s) => !s.revoked_at) : [];
  // A note or file may keep a figure (a document shows it with the section); its own page shows it too.
  const figure = ['note', 'file'].some((t) => isA(e.type, t)) ? await api('picture', { result: id }).catch(() => null) : null;
  const relRows = (rows, direction) =>
    rows.map((r) => {
      const phrase = relations.get(r.type)?.[direction === 'out' ? 'title' : 'inverse'] ?? r.type;
      return h(
        'tr',
        {},
        h('td', { class: 'nowrap muted' }, phrase),
        h('td', {}, chip(r.entity_type), ' ', link(r)),
        h('td', {}, pill(r.entity_type, r.status)),
        h(
          'td',
          { class: 'act' },
          !e.archived_at &&
            !kept(r.type) &&
            h(
              'button',
              {
                class: 'danger',
                onclick: async () =>
                  (await ask({ title: 'Remove this relation?', message: `${e.title} ${phrase} ${r.title}`, action: 'Remove', danger: true })) && change([{ op: 'unlink', relation: r.relation }], 'Relation removed in the UI'),
              },
              'Remove',
            ),
        ),
      );
    });

  // Every way this entity can be linked, read from its side: "depends on" and
  // "blocks" are one relation in its two directions.
  const phrases = state.schema.relations
    .filter((r) => !kept(r.id))
    .flatMap((r) => [fits(r.from, e.type) && { rel: r.id, out: true, label: r.title, others: r.to }, fits(r.to, e.type) && r.inverse !== r.title && { rel: r.id, out: false, label: r.inverse, others: r.from }])
    .filter(Boolean);
  const adder = h('div', { class: 'add-relation', hidden: true });
  const openAdder = () => {
    state.dirty = true; // a live update must not close this
    const pick = h('select', { onchange: () => find() }, phrases.map((p, i) => h('option', { value: i }, p.label)));
    const q = h('input', { type: 'search', placeholder: 'Search for what to link to', oninput: () => find() });
    const found = h('div');
    let turn = 0;
    const find = async () => {
      const mine = ++turn;
      const p = phrases[pick.value];
      const text = q.value.trim();
      if (!text) return found.replaceChildren();
      const any = p.others.includes('*');
      try {
        const hits = (await Promise.all((any ? [undefined] : p.others).map((type) => api('search', { q: text, type, limit: 8 })))).flat();
        if (mine !== turn) return;
        // Sources, sessions and the like are offered only to relations that name them.
        const rows = hits.filter((x) => x.id !== id && (!any || !x.type.startsWith('sys.')));
        found.replaceChildren(
          rows.length
            ? h(
                'ul',
                { class: 'rows' },
                rows.map((x) =>
                  h(
                    'li',
                    { class: 'row-top' },
                    chip(x.type),
                    h('span', { class: 'grow' }, x.title),
                    pill(x.type, x.status),
                    h('button', { onclick: () => change([{ op: 'link', type: p.rel, from: p.out ? id : x.id, to: p.out ? x.id : id }], 'Relation added in the UI') }, 'Link'),
                  ),
                ),
              )
            : h('div', { class: 'empty' }, any ? 'Nothing matches.' : `Nothing matches among: ${p.others.map(typeTitle).join(', ')}.`),
        );
      } catch (err) {
        if (mine === turn) found.replaceChildren(h('div', { class: 'error' }, err.message));
      }
    };
    adder.replaceChildren(h('div', { class: 'toolbar' }, h('span', { class: 'muted' }, 'This'), pick, q, h('button', { onclick: () => entity(id) }, 'Cancel')), found);
    adder.hidden = false;
    q.focus();
  };

  const live = !e.archived_at && e.is_open && !e.type.startsWith('sys.');
  // What names it, less what the trail already leads to.
  const mentions = (data.mentioned_in ?? []).filter((m) => !data.trail?.some((t) => t.id === m.id) && !data.incoming.some((r) => r.id === m.id && r.type === 'part_of' && types.get(r.entity_type)?.deliverable));
  const delivers = data.incoming.filter((r) => r.type === 'part_of' && types.get(r.entity_type)?.deliverable && !isClosed(r.entity_type, r.status));
  // A project is its roadmap first: what needs the owner in it and its features, then what every item has.
  const project = isA(e.type, 'project');
  const gated = isA(e.type, 'event') && !e.archived_at;
  // What can be shown to anyone: a product, what it has built, and how we know it is correct.
  const publishable = !e.archived_at && ['project', 'software.feature', 'software.release', 'software.proof', 'software.test', 'software.test_result'].some((t) => isA(e.type, t));
  const proven = !e.archived_at && ['project', 'software.feature', 'software.proof'].some((t) => isA(e.type, t));
  const relCount = data.outgoing.length + data.incoming.length;
  // Changing relations is done rarely: the list to remove from and the form to add with open together, from the menu.
  const editor = h('section', { class: 'card', hidden: true, style: 'margin-bottom: 14px' }, h('table', { class: 'list' }, h('tbody', {}, relRows(data.outgoing, 'out'), relRows(data.incoming, 'in'))), adder);
  // What happened to it, as the same lines Changes shows.
  const sets = [];
  for (const ev of past) {
    const last = sets.at(-1);
    if (ev.changeset && last?.changeset === ev.changeset) last.events.push(ev);
    else sets.push({ changeset: ev.changeset, events: [ev] });
  }
  const lines = sets.flatMap((g) => (g.changeset ? changeRow(g, { here: id }) : g.events.map(eventLine)));
  // A section that is not the point of the page is one line until it is asked for.
  const fold = (key, title, n, open, content) =>
    h(
      'details',
      { class: 'card wide fold', open: unfolded.get(`${id}:${key}`) ?? open, ontoggle: (ev) => unfolded.set(`${id}:${key}`, ev.target.open) },
      h('summary', {}, h('h2', {}, title), n ? h('span', { class: 'n' }, n) : ''),
      content,
    );
  // The ties that hold work up: what depends on it, waits on it or needs it; and what it depends on, waits on or needs.
  const HOLDING = ['depends_on', 'waits_on', 'needs'];
  const holding = data.incoming.filter((r) => HOLDING.includes(r.type));
  const heldBy = data.outgoing.filter((r) => HOLDING.includes(r.type));
  const tieRows = (rows) => h('ul', { class: 'rows' }, rows.map((r) => h('li', { class: 'row-top tie-row' }, chip(r.entity_type), h('span', { class: 'grow', title: r.title }, link(r)), r.type !== 'depends_on' && h('span', { class: 'muted small' }, relations.get(r.type)?.title ?? r.type), pill(r.entity_type, r.status))));
  const session = isA(e.type, 'sys.run') && e.is_open && !e.archived_at;
  const automation = isA(e.type, 'sys.automation');
  const endSession = async () => {
    if (!(await ask({ title: `End "${e.title}"?`, message: 'Anything it holds is released.', action: 'End session', danger: true }))) return;
    try {
      await api('session_end', { run: id, outcome: 'cancelled', summary: 'Ended from the UI' });
    } catch (err) {
      await tell('The session was not ended', err.message);
    }
    entity(id);
  };
  const workish = !e.archived_at && ['task', 'issue', 'software.feature'].some((t) => types.get(e.type)?.flavour_of === t || e.type === t);
  // A short value is a fact to glance at; a long one (a decision's outcome, its rationale) is text to read.
  // A session's own record (where it ran, its ids, when it was heard from, what it used) is said as marks, not as fields.
  const run = isA(e.type, 'sys.run');
  const RUN_OWN = ['story', 'session_id', 'cwd', 'last_seen', 'tokens_used', 'surface'];
  const fields = Object.entries(e.props).filter(([k, v]) => v !== null && v !== '' && k !== 'story' && !(run && RUN_OWN.includes(k)));
  const runFacts = run && [
    e.props.surface && h('span', { class: 'fact', title: e.props.cwd ?? '' }, e.props.surface === 'claude-code' ? 'Claude Code' : (RAN[e.props.surface] ?? e.props.surface)),
    e.props.last_seen && h('span', { class: 'fact' }, h('span', { class: 'muted' }, 'heard from '), ago(e.props.last_seen)),
    e.props.tokens_used > 0 && h('span', { class: 'fact', title: `${e.props.tokens_used} tokens, input and output, not counting cached re-reads` }, h('span', { class: 'muted' }, 'used '), tokensText(e.props.tokens_used)),
  ];
  const short = fields.filter(([, v]) => String(v).length <= 32);
  // A field that holds an item's id says that item's name, as a way to it.
  const ID = /^e_[a-z0-9]{8}$/;
  await Promise.all(short.filter(([, v]) => ID.test(String(v)) && !titles.has(String(v))).map(([, v]) => api('get', { id: String(v) }).then((r) => titles.set(r.entity.id, r.entity.title), () => null)));
  const value = (v) => (ID.test(String(v)) ? idsAsLinks(String(v)) : String(v));
  const long = fields.filter(([, v]) => String(v).length > 32);
  const edit = () => {
    const form = entityForm(e.type, e, {
      submitLabel: 'Save',
      onCancel: () => entity(id),
      onSubmit: async (next) => {
        const props = { ...next.props };
        for (const key of Object.keys(e.props)) if (!(key in props) && !types.get(e.type)?.fields[key]?.system) props[key] = null;
        await api('change', { ops: [{ op: 'update', id, title: next.title, body: next.body, status: next.status, visibility: next.visibility || undefined, props }], reason: 'Edited in the UI' });
        entity(id);
      },
    });
    main.querySelector('.note').replaceWith(form);
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

  // A lens brought into a document is its picture, drawn live with the style kept for it, and then its note.
  const lensPart = (s) =>
    h(
      'section',
      { class: 'doc-lens' },
      h('div', { class: 'doc-lens-head' }, chip(s.type), h('a', { class: 'grow', href: `#/e/${s.id}`, title: s.title }, s.title)),
      h('div', { class: 'lens-card' }, lensView({ lens: { lens: s.id }, key: `doc:${id}:${s.id}`, bare: true, style: here ? { here } : {} })),
      s.body && renderBody(s.body),
    );
  const docPart = (p) =>
    p.section && isA(p.section.type, 'lens')
      ? lensPart(p.section)
      : p.section
      ? h(
          'details',
          { class: 'doc-section', open: unfolded.get(`${id}:${p.section.id}`) ?? Boolean(p.section.picture), ontoggle: (ev) => unfolded.set(`${id}:${p.section.id}`, ev.target.open) },
          h('summary', {}, chip(p.section.type), h('span', { class: 'grow', title: p.section.title }, h('a', { href: `#/e/${p.section.id}` }, p.section.title)), pill(p.section.type, p.section.status)),
          p.section.picture && figureOf(p.section),
          p.section.body ? renderBody(p.section.body) : h('div', { class: 'empty' }, 'No notes.'),
        )
      : p.missing
        ? h('div', { class: 'error' }, `${p.missing}: not found, archived or not yours to see`)
        : renderBody(p.text.replace(/^#{1,3}\s+/gm, '')); // a heading for the reader is a section title here
  // A section's figure is fetched with the page's token, so it is drawn from what the picture tool gives.
  const figureOf = (s) => {
    const img = h('img', { class: 'doc-figure', alt: s.title });
    api('picture', { result: s.id }).then((p) => p && (img.src = `data:${p.content_type};base64,${p.data}`), () => null);
    return img;
  };
  const shareLink = async () => {
    if (!(await ask({ title: `Make a link to "${e.title}"?`, message: 'Anyone with the link can read it and every item it brings in, with no login, until the link is revoked.', action: 'Make link' }))) return;
    try {
      const made = await api('share_create', { id });
      main.querySelector('.note').prepend(secretBox('Link to read this document. Send it to its reader.', `${location.origin}${made.path}`));
    } catch (err) {
      tell('No link was made', err.message);
    }
  };
  const stopSharing = async () => {
    if (!(await ask({ title: `Stop the ${links.length === 1 ? 'link' : `${links.length} links`} to "${e.title}"?`, message: 'They stop working at once.', action: 'Stop sharing', danger: true }))) return;
    for (const s of links) await api('share_revoke', { id: s.id }).catch(() => null);
    entity(id);
  };
  const note = doc
    ? h('section', { class: 'card wide note doc' }, doc.parts.length ? doc.parts.map(docPart) : h('div', { class: 'empty' }, 'Nothing written yet.'))
    : h(
    'section',
    { class: 'card wide note' },
    figure && h('img', { class: 'figure', src: `data:${figure.content_type};base64,${figure.data}`, alt: e.title }),
    long.length > 0 && h('dl', { class: 'fields' }, long.map(([k, v]) => [h('dt', {}, k.replaceAll('_', ' ')), h('dd', {}, String(v).length > 140 ? h('details', { class: 'long' }, h('summary', { title: String(v) }, gist(String(v))), String(v)) : String(v))])),
    e.body ? renderBody(e.body) : !long.length && h('div', { class: 'empty' }, 'No notes.'),
  );

  main.replaceChildren(
    h(
      'div',
      { class: 'page-head' },
      h('div', { class: 'row-top' }, chip(e.type), e.archived_at && h('span', { class: 'pill closed' }, 'archived'), e.confidence < 1 && h('span', { class: 'pill warn' }, `confidence ${e.confidence}`), e.private_to && h('span', { class: 'pill closed', title: 'Other members of the workspace cannot see this' }, 'private to you'), e.visibility === 'public' && h('span', { class: 'pill ok', title: 'Anyone can see its name and state, with no login' }, 'public'), links.length > 0 && h('span', { class: 'pill warn', title: `Readable with no login by whoever holds the link (${links.length})` }, 'shared by link')),
      h('h1', { style: 'margin-top: 6px' }, e.title),
      // Where it sits, outermost first, each step a way back up; the views kept about a step open with this item marked in them.
      data.trail?.length > 0 &&
        h(
          'nav',
          { class: 'trail', title: 'Where this sits' },
          data.trail.map((t, i) => [
            i > 0 && h('span', { class: 'trail-sep' }, '\u203A'),
            h('a', { class: 'trail-step', href: `#/e/${t.id}`, title: `${typeTitle(t.type)}: ${t.title}` }, t.title),
          ]),
        ),
      // The pictures it is drawn in, each a way straight back to it with this item marked, and the documents that show it.
      data.shown_in?.length > 0 &&
        h(
          'div',
          { class: 'delivers shown-in', title: 'The pictures this is drawn in' },
          h('span', { class: 'muted small' }, 'Shown in'),
          data.shown_in.map((v) => [
            h('a', { class: 'trail-view', href: `#/graph?from=${v.of.id}&lens=${v.id}&here=${id}`, title: `Open "${v.title}" of ${v.of.title}, with this marked in it` }, v.title),
            v.documents.map((d) => h('a', { class: 'deliverable', href: `#/e/${d.id}?here=${id}`, title: `"${v.title}" is drawn in this document; it opens with this marked` }, chip('document'), h('span', { class: 'gist' }, d.title))),
          ]),
        ),
      // What names it in its text: a link written as an id has its way back here.
      mentions.length > 0 &&
        h(
          'div',
          { class: 'delivers mentions', title: 'What names this in its text or fields' },
          h('span', { class: 'muted small' }, 'Mentioned in'),
          mentions.map((m) => h('span', { class: 'deliverable' }, chip(m.type), h('span', { class: 'gist', title: m.title }, link(m)))),
        ),
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
      h(
        'select',
        { title: 'Status', onchange: (ev) => change([{ op: 'update', id, status: ev.target.value }], `Status set to ${ev.target.value} in the UI`) },
        statusesOf(e.type).map((st) => h('option', { value: st, selected: st === e.status }, st)),
      ),
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
        !e.archived_at && phrases.length > 0 && ['Edit relations', () => ((editor.hidden = false), openAdder(), editor.scrollIntoView({ block: 'nearest' }))],
        live && ['Still true as written', () => change([{ op: 'update', id }], 'Checked in the UI: still true as written')],
        // Only an address on the web: what an agent wrote there is opened by the owner's click.
        /^https?:[/][/]/i.test(e.props.link ?? '') &&['Open where it ran', () => window.open(e.props.link, '_blank', 'noopener')],
        isA(e.type, 'software.repo') && !e.archived_at && e.props.remote && ['Re-check its oldest items now', () => api('github_app', { recheck: id }).then(() => tell('The re-check has started', 'An agent on the server is checking this repository\u2019s oldest open items against its code. Its run shows here, under Tokens used, in a few minutes.'), (err) => tell('The re-check did not start', err.message))],
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
        e.visibility === 'public' && (project || isA(e.type, 'software.feature')) && ['Open its public page', () => window.open(`/p/${e.workspace}/${id}`, '_blank', 'noopener')],
        doc && ['Print or save as PDF', () => window.open(`/read/${id}`, '_blank')],
        doc && !e.archived_at && ['Make a link to read it', shareLink],
        links.length > 0 && ['Stop sharing', stopSharing, 'danger'],
        ['Copy id', () => navigator.clipboard.writeText(e.id)],
        !e.archived_at && ['Archive', async () => (await ask({ title: `Archive "${e.title}"?`, message: 'It leaves every view but stays in the history.', action: 'Archive', danger: true })) && change([{ op: 'archive', id }], 'Archived in the UI'), 'danger'],
      ]),
    ),
    editor,
    // Where it sits and what it holds, as a picture: the lens and the style kept for it, or the ones every item opens on. It takes no room when there is nothing to draw.
    ...(story ? [storyPart(story)].flat() : [h('section', { class: 'card lens-card', style: 'margin-bottom: 14px' }, lensView({ lens: { from: id }, quiet: true }))]),
    // What it holds up and what holds it, said outright: a picture places them, these say which way the tie runs.
    (holding.length + heldBy.length > 0 || '') &&
      h('div', { class: 'grid', style: 'margin-bottom: 14px' }, holding.length > 0 && fold('holding', 'Waiting on this', holding.length, true, tieRows(holding)), heldBy.length > 0 && fold('held', 'This waits on', heldBy.length, true, tieRows(heldBy))),
    // What a project is comes before its chart: said under the chart, it reads as a caption to it.
    project ? h('div', { class: 'grid', style: 'margin-bottom: 14px' }, note) : '',
    project ? h('div', { id: 'roadmap', 'data-root': id }) : '',
    // An event is a gate first: what it waits for, and what is still to be put on one side of it or the other.
    gated ? h('div', { id: 'gate', 'data-root': id }) : '',
    // How we know it is correct, where questions have been asked of this.
    proven ? h('div', { id: 'proof', 'data-root': id }) : '',
    h(
      'div',
      { class: 'grid' },
      // A session that tells its story keeps its log of notes behind a fold: the story is what it says.
      !project && (story ? fold('log', 'Log', 0, false, note) : note),
      used?.runs.length > 0 &&
        fold('usage', 'Tokens used here', `${tokensText(Object.values(used.month).reduce((sum, u) => sum + u.tokens, 0))} in 30 days`, false, [
          h(
            'div',
            { class: 'toolbar fold-bar usage-sums', title: 'The last 30 days, by where the agents ran' },
            Object.entries(used.month).map(([where, u]) =>
              h('span', { class: 'fact' }, h('span', { class: 'muted' }, `${RAN[where] ?? where} `), h('strong', {}, tokensText(u.tokens)), h('span', { class: 'muted' }, ` in ${u.runs} run${u.runs === 1 ? '' : 's'}${u.cost_usd > 0 ? ` · $${u.cost_usd.toFixed(2)}` : ''}`)),
            ),
          ),
          used.runs.map((run) =>
            h(
              'div',
              { class: 'change line' },
              h('span', { class: 'chip' }, RAN[run.surface] ?? run.surface),
              h('span', { class: 'gist', title: run.title }, h('a', { href: `#/e/${run.id}` }, run.title)),
              run.status === 'failed' && h('span', { class: 'pill bad' }, 'failed'),
              h('span', { class: 'muted small' }, `${tokensText(run.tokens)}${run.cost_usd ? ` · $${run.cost_usd.toFixed(2)}` : ''}`),
              ago(run.at),
            ),
          ),
        ]),
      fold('history', 'History', lines.length, false, lines),
    ),
  );
  if (project) roadmap(id).catch((err) => document.getElementById('roadmap')?.replaceChildren(h('div', { class: 'error' }, err.message)));
  if (gated) gate(id).catch((err) => document.getElementById('gate')?.replaceChildren(h('div', { class: 'error' }, err.message)));
  if (proven) proofPart(id, project).catch((err) => document.getElementById('proof')?.replaceChildren(h('div', { class: 'error' }, err.message)));
}
