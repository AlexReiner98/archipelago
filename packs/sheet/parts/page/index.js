// An item's one page, as the sheet root's walled part (decision e_bn76z5fu; task e_zhxd9bhb): its title, a head of
// what it is and where it stands, its note, its fields, the choices it settles by, where its facts came from, the
// sections other packs give it, and its history. The frame, field editing, link picking and settling stay the host's
// (e_gyzm7rj3): this root pack is the host, protected from the refiner, and every write is a change on the person's word.
//
// It is handed the item whole, the island's words with each type's fields, and its named reads (`item`: its links and
// source; `history`: its events). It answers with marks; what is written waits for one Save, kept by the host.
// Other packs' sections are a slot under the source, above history (e_axz9au5f); the page carries two menus, the
// frame's, which the runtime draws with the kernel's acts, and this part's own (e_dd7gdy8z).

import { label, typeOf } from './words.js';
import { fieldEvent, fieldsMarks } from './fields.js';
import { choicesMarks, choicesOf, headEvent, headMarks, historyMarks, section, settleOps, sourceMarks } from './sections.js';
import { blank, barMarks, draftEvent, noteMarks, saveOps, titleMarks, unsaved } from './draft.js';
import { linkEvent, linkMarks } from './links.js';

/** The link types it walks from, read from this end: what it holds walks part_of down only. */
export function along(view) {
  const out = view?.outgoing ?? [], into = view?.incoming ?? [];
  const holds = into.some((r) => (r.root ?? r.type) === 'part_of');
  return [...new Set([...out, ...into].filter((r) => typeof r?.type === 'string' && !r.type.startsWith('sys.')).map((r) => (holds && (r.root ?? r.type) === 'part_of' ? `${r.type}<` : r.type)))];
}

/** What the head says, which the schema hands as fields too (the starters' columns): not shown again among the fields. */
const HEAD = ['status', 'owner', 'confidence', 'visibility', 'source'];

/**
 * What the host's frame tells the part of the page it stands on ({ name: 'page', item, views, count }): the item as
 * the frame read it, its links, source and owner, and its history, read once by the frame beside its own menu. Told
 * again each time the page is drawn again, so the part is not mounted anew under the person's typing.
 */
export const pageTold = (now, told) => (told?.name === 'page' && told.item?.id ? { ...now, item: told.item, views: { ...(now?.views ?? {}), ...(told.views ?? {}) }, piece: { ...(now?.piece ?? {}), ...(told.count && { count: told.count }), folds: told.folds ?? [] } } : now);

/** The page's state as one value: what is open, what is written, what is asked, what was said. */
const fresh = (kept) => ({ draft: { ...blank(), ...(kept?.draft && typeof kept.draft === 'object' ? kept.draft : {}), fields: { ...(kept?.draft?.fields ?? {}) } }, open: new Set(), emptyOpen: false, writing: false, finding: false, picked: null, asking: undefined, why: '', saving: false, said: undefined });

/** The whole page as marks. */
export function pageMarks(input, s) {
  const item = input?.item;
  if (!item?.id) return ['text', { look: 'muted' }, 'Nothing to show'];
  const type = typeOf(input.words, item.type);
  const writes = (input.may ?? ['write']).includes('write') && !item.archived_at;
  const view = input.views?.item ?? {};
  const c = choicesOf(item, type);
  const walk = along(view);
  const count = input.piece?.count ?? input.views?.item?.count;
  // A part its own style folds (page.head, fields, source, history: folded) is one quiet row, opened with a click.
  const folds = input.piece?.folds ?? [];
  const fold = (part, title, tip, marks) => (folds.includes(part) && !s.open.has(`part:${part}`) ? ['button', { key: `unfold:${part}`, look: 'quiet', tip }, `▸ ${title}`] : marks());
  const head = ['box', { flow: 'row', gap: 2, align: 'between' },
    titleMarks(item, s.draft, { writes }),
    ['box', { flow: 'row', gap: 1 },
      ...(writes ? [['button', { key: 'link-start', look: 'quiet', pick: 'link', tip: 'Link it to another: click that one on the canvas (Esc lets it go)' }, 'Link']] : []),
      ...(walk.length ? [['button', { key: 'walk', look: 'quiet', tip: `Draw it and what it links to, along ${walk.map((t) => t.replace(/<$/, '')).map(label).join(', ')}`.slice(0, 200) }, 'Walk from it']] : []),
      ['menu', { key: 'part-menu', label: '⋯', look: 'quiet', tip: 'More' },
        ...(writes ? [['button', { key: 'link-by-name' }, 'Link to one by name…']] : []),
        ...(walk.length ? [['button', { key: 'walk-add' }, 'Walk from it, added to the lens']] : []),
        ...(writes && item.is_open !== false ? [['button', { key: 'still-true' }, 'Still true as written']] : []),
        ...(writes ? [['button', { key: 'archive', tone: 'bad' }, 'Archive']] : [])]]];
  return ['box', { flow: 'column', gap: 3 },
    head,
    linkMarks({ finding: s.finding, picked: s.picked }),
    s.said && ['text', { tone: 'bad', tip: s.said.slice(0, 200) }, s.said],
    s.archiving && ['box', { look: 'sunk', flow: 'row', gap: 2, pad: 2 }, ['text', {}, `Archive "${item.title}"? It leaves every view but stays in the history.`], ['button', { key: 'archive-yes', look: 'main', tone: 'bad' }, 'Archive'], ['button', { key: 'archive-no', look: 'quiet' }, 'Cancel']],
    ['slot', { key: 'slot-bands', name: 'sheet.bands' }],
    fold('head', 'Head', 'Type, status, owner, who may see it, when made', () => headMarks({ ...item, owner_title: view.owner?.title }, type, { writes })),
    section('note', 'Note', 0, noteMarks(item, s.draft, { writes, writing: s.writing, count })),
    c && choicesMarks(item, c, { writes, asking: s.asking }),
    fold('fields', 'Fields', 'Its fields', () => section('fields', 'Fields', 0, fieldsMarks(item, type.fields, { writes, open: s.open, kept: s.draft.fields, emptyOpen: s.emptyOpen, skip: [...HEAD, ...(c ? [c.field] : [])], titles: view.titles ?? {} }) ?? ['text', { look: 'muted' }, 'None'])),
    fold('source', 'Source', 'Where its facts came from', () => sourceMarks(view.source)),
    ['slot', { key: 'slot-sections', name: 'sheet.sections' }],
    barMarks(s.draft, item, { saving: s.saving, said: s.saveSaid }),
    fold('history', 'History', 'What was done to it, and by whom', () => historyMarks(input.views?.history?.events ?? input.views?.history ?? [], { writes, names: input.views?.history?.names })),
  ].filter(Boolean);
}

/** Today, as the reader's day. */
const today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

export default function page(input, tools) {
  // What the frame told last of the page: a refresh of the input by the runtime keeps it.
  let told = input?.told?.name === 'page' ? input.told : null;
  let now = pageTold(input, told);
  let s = fresh(input?.kept);
  const draw = () => pageMarks(now, s);
  const item = () => now?.item ?? {};
  const type = () => typeOf(now?.words, item().type);
  // What is written is kept by the host until it is saved, and the page says it holds words unsaved.
  const keep = () => {
    const open = unsaved(s.draft, item());
    tools.keep?.(open ? s.draft : null, 'draft');
    tools.state?.('draft', open ? 'unsaved' : null);
  };
  const change = async (made) => {
    s.said = undefined;
    const r = await tools.change(made.ops, made.reason);
    if (r?.error) s.said = `That change was not made: ${r.error}`;
    else if (r?.status && r.status !== 'applied') s.said = `Held for a person's word: ${r.held ?? 'a rule holds it'}`;
    return r;
  };
  // Words written: kept, and drawn again only when the page goes from saved to unsaved or back (the bar comes or goes), so
  // the box being written in is not redrawn under each keystroke.
  const written = (write, event) => {
    const was = unsaved(s.draft, item());
    write();
    keep();
    return event.name !== 'edit' || was !== unsaved(s.draft, item()) ? draw() : undefined;
  };
  async function on(event) {
    if (event?.name === 'page') {
      told = event;
      const next = pageTold(now, event);
      if (next.item?.id !== now?.item?.id) s = fresh(undefined);
      now = next;
      return draw();
    }
    const it = item();
    if (!it.id || !event?.key) return undefined;
    const k = event.key;
    // A part folded by its style, opened.
    const unfold = /^unfold:(head|fields|source|history)$/.exec(k);
    if (unfold && event.name === 'press') return (s.open.add(`part:${unfold[1]}`), draw());
    // The draft: title, note, Save and Discard.
    const d = draftEvent(event, it, s.draft);
    if (d) {
      if (d.draft) return written(() => (s.draft = d.draft), event);
      if (d.writing) return ((s.writing = true), draw());
      if (d.discard) return ((s = { ...s, draft: blank(), open: new Set(), writing: false, saveSaid: undefined }), keep(), draw());
      if (d.ops) return (await change(d), draw());
      if (d.save) {
        const made = saveOps(s.draft, it);
        if (!made || s.saving) return draw();
        if (made.ops[0].title === '') return ((s.saveSaid = 'It needs a name'), draw());
        s.saving = true;
        tools.marks?.(draw());
        const r = await change(made);
        s.saving = false;
        if (!r?.error) ((s.draft = blank()), (s.open = new Set()), (s.writing = false), (s.saveSaid = undefined), keep());
        else s.saveSaid = s.said;
        return draw();
      }
    }
    // A field: a pick is a change at once, words wait with the note.
    const f = fieldEvent(event, it, type().fields, s.draft.fields);
    if (f) {
      if (f.empty) return ((s.emptyOpen = !s.emptyOpen), draw());
      if (f.open || f.fold) {
        const name = f.open ?? f.fold;
        s.open.has(name) ? s.open.delete(name) : s.open.add(name);
        return draw();
      }
      if (f.keep) return written(() => (s.draft = { ...s.draft, fields: { ...s.draft.fields, [f.keep[0]]: f.keep[1] } }), event);
      if (f.bad) return undefined;
      if (f.save) return on({ key: 'draft:save', name: 'press' });
      if (f.pick) return (s.open.delete(f.pick[0]), await change({ ops: [{ op: 'update', id: it.id, props: { [f.pick[0]]: f.pick[1] } }], reason: `${label(f.pick[0])} set in the UI` }), draw());
    }
    // The head: its status and who may see it.
    const h = headEvent(event, it);
    if (h) return (await change(h), draw());
    // Linking.
    const l = linkEvent(event, it, s.picked);
    if (l) {
      if ('finding' in l) s.finding = l.finding;
      if ('choose' in l) s.picked = l.choose;
      if (l.said) s.said = l.said;
      if (l.ops) await change(l);
      return draw();
    }
    // Settling by a choice: asked first, then one change.
    const c = choicesOf(it, type());
    const m = /^choice:(\d+)$/.exec(k);
    if (c && m && event.name === 'press') return ((s.asking = Number(m[1])), (s.why = ''), draw());
    if (k === 'choice-why' && event.name === 'edit') return void (s.why = String(event.value ?? ''));
    if (k === 'choice-cancel') return ((s.asking = undefined), draw());
    if (c && (k === 'choice-settle' || (k === 'choice-why' && event.name === 'submit')) && s.asking !== undefined) {
      const made = settleOps(it, type(), c, c.list[s.asking], s.why, today());
      s.asking = undefined;
      return (await change(made), draw());
    }
    // Walking from it: a query of it and one step along its links, in place of the lens or added to it.
    if ((k === 'walk' || k === 'walk-add') && event.name === 'press') {
      const over = along(now.views?.item);
      const query = now.address?.query;
      if (k === 'walk' || !query) return void tools.go?.({ query: { filter: { find: [`id ${it.id}`] }, walk: { over, steps: 1 } } });
      const was = query.walk?.over === 'all' ? 'all' : [...new Set([...(query.walk?.over ?? []), ...over])];
      return void tools.go?.({ query: { ...query, filter: { ...(query.filter ?? {}), find: [...(query.filter?.find ?? []), `id ${it.id}`] }, walk: { over: was, steps: Math.max(1, query.walk?.steps ?? 0) } } });
    }
    if (k === 'still-true' && event.name === 'press') return (await change({ ops: [{ op: 'update', id: it.id }], reason: 'Checked in the UI: still true as written' }), draw());
    if (k === 'archive' && event.name === 'press') return ((s.archiving = true), draw());
    if (k === 'archive-no') return ((s.archiving = false), draw());
    if (k === 'archive-yes' && event.name === 'press') return ((s.archiving = false), await change({ ops: [{ op: 'archive', id: it.id }], reason: 'Archived in the UI' }), draw());
    const u = /^undo:(c_[a-z0-9]+)$/.exec(k);
    if (u && event.name === 'press') {
      const r = await tools.undo?.(u[1]);
      if (r?.error) s.said = `That was not undone: ${r.error}`;
      return draw();
    }
    return undefined;
  }
  return {
    marks: draw(),
    update(next) {
      if (next?.told?.name === 'page') told = next.told;
      const was = now?.item?.id;
      now = pageTold(next, told?.item?.id === next?.item?.id ? told : null);
      // Another item: what was written of the last one stays kept by the host, under its own id.
      if (now?.item?.id !== was) s = fresh(next?.kept);
      return draw();
    },
    on,
  };
}

