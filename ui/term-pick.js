// What a part of the query bar adds, or holds beyond what fits (ui/query-bar.js): one menu for each, the same shape
// everywhere, over the page (a popover, so the bar does not clip it). It has a field to type in when there is a choice
// to narrow or words to add, and below it the choices in groups (in use here, around, the rest); a click or Enter picks.
// It replaces the browser's own lists, which drew in their own look and could not say what a choice adds.

import { h } from './base.js';

const menu = h('div', { class: 'menu-items term-pick', popover: 'auto', role: 'dialog' });
document.body.append(menu);

/**
 * Open the menu under `anchor`. `groups` are [{ label, items: [{ label, title, pick }] }]; `typed` (optional) is
 * { placeholder, title, pick(words) } for words written in the field that match no choice, which it answers with
 * whether they were taken. `held` (optional) lists what the part holds, each { label, title, open, drop }, drawn first.
 */
export function pickTerm(anchor, { label, groups = [], typed, held }) {
  const field = (typed || groups.some((g) => g.items.length > 8)) && h('input', { type: 'search', class: 'term-pick-field', placeholder: typed?.placeholder ?? 'Find a choice', title: typed?.title ?? '', 'aria-label': label, autocomplete: 'off' });
  const list = h('div', { class: 'term-pick-list' });
  const close = () => menu.hidePopover();
  const take = (item) => (close(), item.pick());
  const drawList = () => {
    const q = field?.value.trim().toLowerCase() ?? '';
    const some = groups.map((g) => ({ ...g, items: g.items.filter((i) => !q || i.label.toLowerCase().includes(q)) })).filter((g) => g.items.length);
    list.replaceChildren(
      ...(held?.length ? [h('div', { class: 'term-pick-head' }, 'Here'), ...held.map((t) => h('div', { class: 'term-pick-held' },
        h('button', { type: 'button', class: 'term-pick-item', title: t.title, onclick: () => (close(), t.open()) }, t.label),
        h('button', { type: 'button', class: 'term-pick-x', title: 'Take it out', 'aria-label': `Take out ${t.label}`, onclick: () => (close(), t.drop()) }, '×')))] : []),
      ...some.flatMap((g) => [g.label && h('div', { class: 'term-pick-head' }, g.label), ...g.items.map((i) => h('button', { type: 'button', class: 'term-pick-item', title: i.title ?? i.label, onclick: () => take(i) }, i.label))]),
      q && typed && h('button', { type: 'button', class: 'term-pick-item term-pick-typed', title: typed.title, onclick: () => (typed.pick(field.value.trim()) ? close() : field.classList.add('wrong')) }, `Add “${field.value.trim()}”`),
    );
  };
  if (field) {
    field.addEventListener('input', (ev) => (ev.stopPropagation(), field.classList.remove('wrong'), drawList()));
    field.addEventListener('keydown', (ev) => {
      if (ev.key !== 'Enter') return;
      ev.preventDefault();
      const words = field.value.trim();
      const first = list.querySelector('.term-pick-item:not(.term-pick-typed)');
      // Written words go in as written when the field takes them (a type's name, #tag, a link and its end...); else the first choice.
      if (words && typed?.pick(words)) return close();
      if (first && (!typed || !words || first.textContent.toLowerCase() === words.toLowerCase())) return first.click();
      field.classList.add('wrong');
    });
  }
  menu.setAttribute('aria-label', label);
  menu.replaceChildren(...[field, list].filter(Boolean));
  drawList();
  menu.showPopover();
  const r = anchor.getBoundingClientRect();
  menu.style.left = `${Math.max(0, Math.min(r.left, innerWidth - menu.offsetWidth))}px`;
  menu.style.top = `${r.bottom}px`;
  field?.focus();
}
