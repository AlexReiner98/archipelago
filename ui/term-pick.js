// What a part of the query bar adds, or holds beyond what fits (ui/query-bar.js): one menu for each, the same shape
// everywhere, over the page (a popover, so the bar does not clip it). It never guesses what is meant (decision
// e_45sgrfqd): a choice is picked, or leads to the next list (a kind, then the things of that kind, with ‹ to go back);
// a field only narrows the list, finds items by name (`search`), or, where the kind is words or a date, is what is
// written (`typed`), refused when it is not what that kind takes. The choices come in groups (in use here, around,
// the rest); a click or Enter picks. It replaces the browser's own lists, which drew in their own look and could not
// say what a choice adds.

import { h } from './base.js';

const menu = h('div', { class: 'menu-items term-pick', popover: 'auto', role: 'dialog' });
document.body.append(menu);

/**
 * Open the menu under `anchor`. A step is { label, groups, typed, search, held }: `groups` are
 * [{ label, items: [{ label, note, title, pick } or { label, title, next: () => step }] }] (note: what it is, drawn apart); `typed` (optional) is
 * { placeholder, title, pick(written) } for a kind that takes what is written, answering whether it was taken;
 * `search` (optional) is { placeholder, find(q) } answering with items as groups' items are, found by name; `held`
 * (optional) lists what the part holds, each { label, title, open, drop }, drawn first.
 */
export function pickTerm(anchor, first) {
  const steps = [];
  const open = (step) => {
    steps.push(step);
    draw(step);
  };
  const close = () => menu.hidePopover();
  const draw = (step) => {
    const { label, groups = [], typed, search, held } = step;
    const wants = typed || search || groups.some((g) => g.items.length > 8);
    const field = wants ? h('input', { type: 'search', class: 'term-pick-field', placeholder: typed?.placeholder ?? search?.placeholder ?? 'Find a choice', title: typed?.title ?? '', 'aria-label': label, autocomplete: 'off' }) : null;
    const list = h('div', { class: 'term-pick-list' });
    const back = steps.length > 1 && h('button', { type: 'button', class: 'term-pick-back', title: 'Back', onclick: () => (steps.pop(), draw(steps.at(-1))) }, `‹ ${label}`);
    const take = (item) => (item.next ? open(item.next()) : (close(), item.pick()));
    // A choice: its name, and what it is (an item's type) apart, so a long name never hides it.
    const button = (i) => h('button', { type: 'button', class: `term-pick-item${i.next ? ' term-pick-on' : ''}${i.note ? ' term-pick-noted' : ''}`, title: i.title ?? i.label, onclick: () => take(i) },
      i.note ? [h('span', { class: 'term-pick-name' }, i.label), h('span', { class: 'term-pick-note' }, i.note)] : i.label);
    let found = [];
    const drawList = () => {
      const q = field?.value.trim() ?? '';
      const some = groups.map((g) => ({ ...g, items: search ? g.items : g.items.filter((i) => !q || i.label.toLowerCase().includes(q.toLowerCase())) })).filter((g) => g.items.length);
      list.replaceChildren(...[
        ...(held?.length ? [groups.length > 0 && h('div', { class: 'term-pick-head' }, 'Here'), ...held.map((t) => h('div', { class: 'term-pick-held' },
          h('button', { type: 'button', class: 'term-pick-item', title: t.title, onclick: () => (close(), t.open()) }, t.label),
          h('button', { type: 'button', class: 'term-pick-x', title: 'Take it out', 'aria-label': `Take out ${t.label}`, onclick: () => (close(), t.drop()) }, '×')))] : []),
        ...some.flatMap((g) => [g.label && h('div', { class: 'term-pick-head' }, g.label), ...g.items.map(button)]),
        ...found.map(button),
        q && typed ? h('button', { type: 'button', class: 'term-pick-item term-pick-typed', title: typed.title, onclick: () => (typed.pick(q) ? close() : field.classList.add('wrong')) }, `Add “${q}”`) : null,
      ].filter(Boolean));
    };
    // Items found by name, asked as the field changes; an answer to an older question is dropped.
    let asked = 0;
    const find = async () => {
      const q = field.value.trim();
      const n = ++asked;
      const items = q ? await search.find(q).catch(() => []) : [];
      if (n === asked) (found = items), drawList();
    };
    if (field) {
      field.addEventListener('input', (ev) => (ev.stopPropagation(), field.classList.remove('wrong'), search ? find() : drawList()));
      field.addEventListener('keydown', (ev) => {
        if (ev.key === 'Backspace' && !field.value && steps.length > 1) return (ev.preventDefault(), steps.pop(), draw(steps.at(-1)));
        if (ev.key !== 'Enter') return;
        ev.preventDefault();
        const written = field.value.trim();
        // What is written is taken only where the kind takes writing; else Enter picks the first choice shown.
        if (written && typed) return typed.pick(written) ? close() : field.classList.add('wrong');
        const top = list.querySelector('.term-pick-item:not(.term-pick-typed)');
        if (top && !held?.length) return top.click();
        field.classList.add('wrong');
      });
    }
    menu.setAttribute('aria-label', label);
    // Items found by name want room for their names beside their types.
    menu.classList.toggle('finding', Boolean(search));
    menu.replaceChildren(...[back, field, list].filter(Boolean));
    drawList();
    field?.focus();
  };
  open(first);
  menu.showPopover();
  const r = anchor.getBoundingClientRect();
  menu.style.left = `${Math.max(0, Math.min(r.left, innerWidth - menu.offsetWidth))}px`;
  menu.style.top = `${r.bottom}px`;
  menu.querySelector('input')?.focus();
}
