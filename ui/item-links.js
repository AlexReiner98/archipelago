// Linking an item to another: done rarely, so the form opens from its menu.

import { api, h, state } from './base.js';
import { chip, fits, kept, pill, typeTitle } from './words.js';

/**
 * The form that links an item to another, hidden until `open` is called. `change` sends ops and draws the page again;
 * `redraw` draws it again as it was. Its links are not listed here: the canvas draws them, and a link is not removed by
 * hand (the owner, 9 Nov 2026).
 */
export function linkAdder(e, change, redraw) {
  const id = e.id;
  // Every way this item can be linked, read from its side: "depends on" and "blocks" are one relation in its two directions.
  const phrases = state.schema.relations
    .filter((r) => !kept(r.id))
    .flatMap((r) => [fits(r.from, e.type) && { rel: r.id, out: true, label: r.title, others: r.to }, fits(r.to, e.type) && r.inverse !== r.title && { rel: r.id, out: false, label: r.inverse, others: r.from }])
    .filter(Boolean);
  const adder = h('div', { class: 'add-relation', hidden: true });
  const editor = h('section', { class: 'card', hidden: true, style: 'margin-bottom: var(--space-8)' }, adder);
  const open = () => {
    state.dirty = true; // a live update must not close this
    editor.hidden = false;
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
                    h('button', { onclick: () => change([{ op: 'link', type: p.rel, from: p.out ? id : x.id, to: p.out ? x.id : id }], 'Link added in the UI') }, 'Link'),
                  ),
                ),
              )
            : h('div', { class: 'empty' }, any ? 'Nothing matches.' : `Nothing matches among: ${p.others.map(typeTitle).join(', ')}.`),
        );
      } catch (err) {
        if (mine === turn) found.replaceChildren(h('div', { class: 'error' }, err.message));
      }
    };
    adder.replaceChildren(h('div', { class: 'toolbar' }, h('span', { class: 'muted' }, 'This'), pick, q, h('button', { onclick: redraw }, 'Cancel')), found);
    adder.hidden = false;
    q.focus();
    editor.scrollIntoView({ block: 'nearest' });
  };
  return { editor, open, any: phrases.length > 0 };
}
