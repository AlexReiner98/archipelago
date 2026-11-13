// What a page drawn from frozen marks has that no part may do (decision e_rhz4dvpk), around the marks the page was
// published with (./frozen-page.js): its site's head and foot and a way to start a map of one's own, which change with
// the site after the page is published, as marks of the host's own; and on the page itself, where a link leads, the
// read-only sheet of an item a picture shows, a way to copy code, and printing. Every text is set as text.

import { h } from './base.js';
import { checkMarks } from './part-check.js';
import { mountPart } from './part-render.js';

/**
 * How a page read with no session reads its notes: whole, as a document is (page.notes), every title a heading. Read
 * whole, a note asks its style only how long a title may be; the look a page keeps does not hold the style's numbers
 * yet, so it reads titles as the dialect does when it is told none (packs/walls/page/text.js, readText).
 */
export const readingStyle = { page: { notes: 'whole' }, numbers: { note_title_most: 90 } };

/** An address on this server as a text mark may hold it: whole, on the web. */
const whole = (href) => {
  if (typeof href !== 'string' || !href) return undefined;
  try {
    const url = new URL(href, location.origin);
    return /^https?:$/.test(url.protocol) ? url.href : undefined;
  } catch {
    return undefined;
  }
};
const link = (words, href, at = {}) => ['text', { ...at, ...(whole(href) && { href: whole(href) }) }, String(words ?? '')];

/** The site's head: its name, the way home, and its main pages. */
export const siteHead = (site) => [
  'box',
  { key: 'site-head', flow: 'row', gap: 6, align: 'between', wrap: true },
  link(site.name, site.home, { bold: true }),
  ['box', { flow: 'row', gap: 5, wrap: true }, ...(site.pages ?? []).map((p, i) => link(p.title, p.href, { key: `site:${i}`, tip: String(p.title).slice(0, 200) }))],
];

/** What a page ends with: its site's footer, a way to start a map of one's own, and, read with a sign-in, a way to print it. */
export function pageFoot(d, { start, print }) {
  const foot = [...(start ? [link(d.start, start, { look: 'muted' })] : []), ...(print ? [['button', { key: 'print', look: 'quiet', tip: 'Print this page, or save it as a PDF' }, 'Print or save as PDF']] : [])];
  return [...(d.site?.footer ? [['box', { key: 'site-foot', look: 'band', pad: 4 }, ['note', {}, String(d.site.footer)]]] : []), ...(foot.length ? [['box', { key: 'foot', flow: 'row', gap: 6 }, ...foot]] : [])];
}

/** Where a person with no account begins on this server (/connect/start), else its front page. */
export const startAddress = () => fetch('/connect/start').then((res) => (res.ok ? res.json() : null)).then((r) => r?.url ?? '/', () => '/');

/** The words of a page whose marks were not kept (published before pages kept them, or its part failed), as plain marks. */
export function plainMarks(d) {
  if (!Array.isArray(d?.parts)) return ['text', { look: 'muted' }, 'This page does not open anything.'];
  const part = (p, i) =>
    p.section
      ? ['box', { key: `s:${p.section.id}`, item: p.section.id, flow: 'column', gap: 3 }, ['text', { look: 'title', size: 6 }, String(p.section.title ?? '')], ...(d.lenses?.[p.section.id] || p.section.picture ? [['picture', { item: p.section.id }]] : []), ...(p.section.body ? [['note', {}, String(p.section.body)]] : [])]
      : ['note', { key: `text:${i}` }, String(p.text ?? '')];
  return ['box', { key: 'page', flow: 'column', gap: 8 }, ['text', { look: 'title', size: 8 }, String(d.title ?? '')], ...d.parts.filter((p) => !p.section || p.section.id !== d.share).map(part)];
}

/** A control that copies code beside it, saying so until the pointer or the focus leaves; where the browser refuses, the code is selected to copy by hand. */
function copyButton(code) {
  const again = (e) => (e.currentTarget.classList.remove('copied'), (e.currentTarget.title = 'Copy'));
  return h('button', {
    class: 'copy',
    type: 'button',
    title: 'Copy',
    'aria-label': 'Copy',
    onpointerleave: again,
    onblur: again,
    onclick: (e) => {
      const button = e.currentTarget;
      (navigator.clipboard?.writeText(code.textContent) ?? Promise.reject()).then(() => (button.classList.add('copied'), (button.title = 'Copied')), () => getSelection()?.selectAllChildren(code));
    },
  });
}

/** Give each piece of code in `root` a way to copy it, once. */
export function copyable(root) {
  for (const code of root.querySelectorAll('code')) {
    if (code.dataset.copy) continue;
    code.dataset.copy = '1';
    const block = code.parentElement?.tagName === 'PRE';
    const at = block ? code.parentElement : code;
    const wrap = h('span', { class: block ? 'code-block' : 'code-line' });
    at.replaceWith(wrap);
    wrap.append(at, copyButton(code));
  }
}

let sheet = null;
/** Close the item's sheet, if one is open. */
export function closeSheet() {
  sheet?.stop();
  sheet?.node.remove();
  sheet = null;
  document.body.removeAttribute('data-doc-sheet');
}
addEventListener('keydown', (e) => e.key === 'Escape' && sheet && closeSheet());

/** Open the sheet of an item a picture shows, from the marks the page keeps of it. */
export function openSheet(marks) {
  closeSheet();
  const node = h('aside', { class: 'doc-sheet', role: 'dialog', 'aria-label': 'An item of this view' });
  document.body.append(node);
  document.body.setAttribute('data-doc-sheet', 'open');
  const render = mountPart(node, { style: readingStyle, tell: (ev) => ev?.key === 'close' && closeSheet() });
  render.draw(checkMarks(marks));
  sheet = { node, stop: () => render.stop() };
  node.querySelector('button')?.focus();
}
