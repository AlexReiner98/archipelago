// The page every item lands on, in the sheet that opens from the side of the canvas. Its page is the sheet root's
// walled parts (decision e_bn76z5fu, task e_zhxd9bhb): sheet.page draws the title, head, note, fields, choices, source,
// links picked and history, and writes as the person; sheet.follow follows the reading. What stays the host's here is
// the frame (e_gyzm7rj3, e_dd7gdy8z): its menu with the kernel's acts (publish, share, launch, end a session, a pack's
// actions), the public mark, and what it places in the slots the page part opens: the changes held on it and a pack's
// action form under the title (sheet.bands), and the sections other packs' screens give it below the source and
// above history (sheet.sections, e_axz9au5f). The frame reads the item once and tells the parts (`page`), so a page
// drawn again in place is not mounted anew under the person's typing.

import { api, ask, drawSlots, h, hooks, may, part, state, tell } from './base.js';
import { drawIn, openHere } from './canvas.js';
import { viewsOn } from './views-kept.js';
import { readDocument, readingOf } from './item-reading.js';
import { publicMark, publicOf, shareMenu } from './item-share.js';
import { heldBand, heldOn } from './item-held.js';
import { actionForm, actionsFor, buttonsOn, countOn, drawnBy, readWhole, sectionsOn, toolOf } from './screens.js';
import { isA, menu, relations, titles, who } from './words.js';
import { pageType, readPageModel } from './page-schema.js';

/** The root relation a relation extends: what the page reads, whichever pack's flavour of it was used. */
const rootOf = (type) => relations.get(type)?.root ?? type;

/** The item whose page the parts are mounted for now, and the node they are in. */
let mounted = null;

/**
 * Put the host's own nodes in a slot the page part opens, once the part has drawn it and each time it draws it anew:
 * the slot is the part's place for them, and what fills it is the host's to say.
 */
function fillSlot(host, name, nodes) {
  const put = () => {
    const el = host.querySelector(`.pm-slot[data-slot="${name}"]`);
    if (!el || (el.childNodes.length === nodes.length && nodes.every((n) => n.parentNode === el))) return;
    el.replaceChildren(...nodes);
  };
  const watch = new MutationObserver(() => (host.isConnected ? put() : watch.disconnect()));
  watch.observe(host, { childList: true, subtree: true });
  put();
  return watch;
}

/** Fill the two slots the page part opens with what the host draws there, letting go of what it put there before. */
function fillSlots(m, above, sections) {
  for (const w of m.watching ?? []) w.disconnect();
  m.watching = [fillSlot(m.node, 'sheet.bands', above), fillSlot(m.node, 'sheet.sections', sections)];
}

/** What the page part is told of the page, as data: the item, its links, source, owner and history, its note's count. */
function told(data, past, owner, count, named) {
  const e = data.entity;
  const tie = (r) => ({ type: r.type, root: rootOf(r.type) });
  const names = {};
  for (const ev of past) if (ev.actor && !names[ev.actor]) names[ev.actor] = who(ev.actor).textContent;
  return {
    name: 'page',
    item: Object.fromEntries(['id', 'type', 'title', 'body', 'status', 'is_open', 'visibility', 'private_to', 'owner', 'confidence', 'archived_at', 'created_at', 'updated_at', 'props'].filter((k) => e[k] !== undefined).map((k) => [k, e[k]])),
    views: {
      item: { outgoing: data.outgoing.map(tie), incoming: data.incoming.map(tie), titles: named, ...(owner && { owner: { id: owner.id, title: owner.title } }), ...(data.source && { source: { id: data.source.id, title: data.source.title, uri: data.source.uri } }) },
      history: { events: past.map(({ seq, ts, actor, action, target_id, target_title, reason, changeset, detail }) => ({ seq, ts, actor, action, target_id, target_title, reason, changeset, detail: { ...(detail?.undone_by && { undone_by: detail.undone_by }), ...(detail?.forgot && { forgot: true }) } })), names },
    },
    ...(count && { count }),
  };
}

export async function entity(id, here) {
  const page = part('item');
  const again = () => entity(id, here);
  const inPlace = page.dataset.item === id && page.childElementCount > 0;
  if (!inPlace) page.replaceChildren(h('div', { class: 'empty' }, 'Loading…'));
  page.dataset.item = id;
  let data, past;
  const heldHere = heldOn(id);
  try {
    [data, past] = await Promise.all([api('get', { id }), api('events', { target: id, limit: 40 })]);
  } catch (err) {
    return page.replaceChildren(h('div', { class: 'error' }, err.message));
  }
  const e = data.entity;
  // On an island that runs a version of its pack, the page is drawn by that version: its screens, views and fields.
  const version = await readPageModel(e);
  const type = pageType(e.type);
  const writes = may('write');
  const change = async (ops, reason) => {
    try {
      await api('change', { ops, reason });
      again();
    } catch (err) {
      tell('That change was not made', err.message);
    }
  };
  const run = isA(e.type, 'run');
  const session = run && e.is_open && !e.archived_at;
  const [owner, { doc }, plan, shared] = await Promise.all([
    e.owner ? api('get', { id: e.owner }).then((r) => r.entity, () => null) : null,
    readWhole(e.type) ? readDocument(id) : { doc: null },
    !e.archived_at && data.incoming.some((r) => rootOf(r.type) === 'part_of' && readWhole(r.entity_type)) ? api('publish_plan', { within: id }).catch(() => null) : null,
    publicOf(id),
  ]);
  const shown = doc && type?.public ? await api('published', { id }).catch(() => null) : null;
  const bands = await Promise.all((await heldHere).map((p) => heldBand(p, again)));
  for (const r of [...data.outgoing, ...data.incoming, ...(data.mentioned_in ?? [])]) titles.set(r.id, r.title);
  // The items its fields name, said by their names: its neighbours' are here already, the rest are asked for.
  const ids = [...new Set(Object.values(e.props).flatMap((v) => (Array.isArray(v) ? v : [v])).filter((v) => typeof v === 'string' && /^e_[a-z0-9]{8}$/.test(v)))].slice(0, 40);
  await Promise.all(ids.filter((n) => !titles.has(n)).map((n) => api('get', { id: n }).then((r) => titles.set(n, r.entity.title), () => null)));
  const named = Object.fromEntries(ids.filter((n) => titles.has(n)).map((n) => [n, titles.get(n)]));
  const publishable = writes && !e.archived_at && type?.public;
  const workish = writes && !e.archived_at && Boolean(type?.capabilities?.plannable) && Boolean(type?.fields.tokens_estimated);
  const endSession = async () => {
    if (!(await ask({ title: `End "${e.title}"?`, message: 'Anything it holds is released.', action: 'End session', danger: true }))) return;
    try {
      await api(state.schema.acts.ends, { run: id, outcome: 'cancelled', summary: 'Ended from the UI' });
    } catch (err) {
      await tell('The session was not ended', err.message);
    }
    again();
  };
  // A pack's action on this kind of item opens its form under the title.
  const acting = h('div');
  const act = (tool) => {
    const form = actionForm(tool, id, again);
    acting.replaceChildren(form);
    form.scrollIntoView({ block: 'nearest' });
  };
  const copyBrief = async () => navigator.clipboard.writeText((await api('view', { name: 'brief', params: { task: id } })).text);
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
  // What its type's screens give it to do, and the views packs ship of an item of its type: the first in sight, the rest in the menu.
  const buttons = e.archived_at ? [] : [...buttonsOn(data).filter((b) => writes || !b.action), ...viewsOn(e.type, id).map((v) => ({ label: v.title, tip: `Draw its ${v.title.toLowerCase()} on the canvas`, at: v.at }))];
  const press = (b) => (b.at ? openHere(b.at) : b.draw ? drawIn(drawnBy(b.draw, id)) : act(toolOf(b.action)));
  const rarely = h('span', { class: 'item-menu-parts' });
  void drawSlots(rarely, { slot: 'item.menu', item: e, redraw: again }).catch((err) => console.warn(err.message));

  // The frame's row: its version, its public mark, what packs offer beside the menu, and the frame's menu (e_dd7gdy8z).
  const frame = h(
    'div',
    { class: 'sheet-marks' },
    h('span', { class: 'grow' }),
    version && h('span', { class: 'muted small gist version-mark', title: `Its island runs ${version.title}, a version of the ${version.of} pack: this page is drawn by it` }, version.title),
    publicMark(data.public_views, again, writes && !e.archived_at),
    rarely,
    writes && session && h('button', { class: 'quiet-button', title: 'Close it and release what it holds', onclick: endSession }, 'End session'),
    buttons[0] && h('button', { class: 'quiet-button item-button', title: buttons[0].tip, onclick: () => press(buttons[0]) }, buttons[0].label),
    menu('⋯', [
      ...buttons.slice(1).map((b) => [b.label, () => press(b)]),
      ...(e.archived_at || !writes ? [] : actionsFor(e.type).filter((tool) => !buttons.some((b) => b.action === tool.action)).map((tool) => [tool.title ?? tool.tool, () => act(tool)])),
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
      publishable && doc && ['Preview as published', () => window.open(`/preview/${id}`, '_blank')],
      writes && shown && [
        shown.published ? 'Publish again' : 'Publish',
        async () =>
          (await ask({ title: `Publish "${e.title}"?`, message: 'Anyone will be able to read it at its own address, with no login, and search engines to list it: its text, the sections it holds that are shared with the workspace and its views, as they are now. What you change afterwards stays a draft until you publish again.', action: 'Publish', danger: !shown.published })) &&
          api('publish', { id }).then(again, (err) => tell('It was not published', err.message)),
      ],
      writes && shown?.published && ['Unpublish', async () => (await ask({ title: `Unpublish "${e.title}"?`, message: 'Its address will answer nothing; it stays shared with the workspace.', action: 'Unpublish', danger: true })) && api('unpublish', { id }).then(again, (err) => tell('It was not unpublished', err.message))],
      publishable && !shown && e.visibility !== 'public' && [
        'Make public',
        async () =>
          (await ask({ title: `Make "${e.title}" public?`, message: doc ? 'Anyone will be able to read it at its own address, with no login, and search engines to list it: its text and the sections it holds that are shared with the workspace. History stays private.' : 'Anyone will be able to see its name and state, with no login. A proof question brings its tests and their results. Notes and history stay private.', action: 'Make public', danger: true })) &&
          change([{ op: 'update', id, visibility: 'public' }], 'Made public in the UI'),
      ],
      publishable && !shown && e.visibility === 'public' && ['Stop being public', () => change([{ op: 'update', id, visibility: 'private' }], 'No longer public, set in the UI')],
      e.visibility === 'public' && type?.public && (Boolean(type?.capabilities?.plannable) || shown?.published) && ['Open its public page', () => window.open(`/p/${e.workspace}/${id}`, '_blank', 'noopener')],
      ...shareMenu(e, shared, again, writes),
      ['Copy id', () => navigator.clipboard.writeText(e.id)],
    ]),
  );
  // A document reads in its note's place as it will publish (the publish pack's reading), above the page's note.
  const reading = doc && readingOf(e, doc, (await api('view', { name: 'style', params: { of: id } }).catch(() => null))?.style ?? state.style, again);
  const said = told(data, past, owner, countOn(data), named);
  const sections = sectionsOn(data);
  const above = [...bands, acting, reading && h('section', { class: 'page-section note' }, reading)].filter(Boolean);

  // Mounted once for an item, told again when it is drawn again: the person's typing is not taken from under them.
  if (inPlace && mounted?.id === id && mounted.node.isConnected) {
    mounted.frame.replaceWith(frame);
    mounted.frame = frame;
    fillSlots(mounted, above, sections);
    hooks.tellSlot?.('sheet', (mounted.said = said));
    return;
  }
  for (const w of mounted?.watching ?? []) w.disconnect();
  const node = h('div', { class: 'sheet-parts' });
  page.replaceChildren(frame, node);
  mounted = { id, node, frame, said };
  hooks.tellSlot?.('sheet', said);
  fillSlots(mounted, above, sections);
  const drawn = await drawSlots(node, { slot: 'sheet', item: e, redraw: again });
  if (!drawn) return void node.replaceChildren(h('div', { class: 'error' }, 'No part draws the sheet: the sheet pack is off.'));
  // Told again once mounted: the slot keeps only its last event, and the reading may have been told since.
  if (mounted?.node === node) hooks.tellSlot?.('sheet', mounted.said ?? said);
}
