// A page drawn from frozen marks (decision e_rhz4dvpk): a document published or given as a link (/p/<workspace>/<id>,
// a site's own domain), its preview (/preview/<id>), a document read with one's own sign-in (/read/<id>), and a
// product's public page. The server ran the page's part (publish.doc, publish.public) and sends its marks with the page's
// data (packs/publish/kernel/page-marks.ts); this draws them as the host draws any part's (./part-render.js), checked
// first, with no session and none of the part's code. What only the page can do is the host's (./frozen-chrome.js):
// its theme and page_css, its site's head and foot, pictures, where a link leads, sheets, copy and print.

import { SignInNeeded, authHeaders, call, h } from './base.js';
import { drawFrozen } from './doc-lens.js';
import { carried } from './doc-ref.js';
import { closeSheet, copyable, openSheet, pageFoot, plainMarks, readingStyle, siteHead, startAddress } from './frozen-chrome.js';
import { warmLayouts } from './layout.js';
import { checkedCss } from './marks.js';
import { checkMarks } from './part-check.js';
import { mountPart } from './part-render.js';
import { applyTheme } from './theme.js';
import { startTips } from './tip.js';

startTips();

const main = document.getElementById('main');
const here = location.pathname.replace(/\/+$/, '');
/** A product's page (ui/public.html) or a document's. */
const product = main.dataset.page === 'public';
// Opened from the app (/read/<id>), the page is read with the reader's own sign-in; made public, as anyone; a preview
// (/preview/<id>) is drawn as the published page would be, read with the reader's sign-in.
const own = /^\/read\/(e_[a-z0-9]{8})$/.exec(here)?.[1];
const preview = /^\/preview\/e_[a-z0-9]{8}$/.test(here);
const published = here.startsWith('/p/');
const post = (at, input) =>
  call(at, input, authHeaders()).catch((err) => {
    throw err instanceof SignInNeeded ? new Error('Sign in to Archipelago in this browser first, then open this again.') : err;
  });
const api = (tool, input) => post(`/api/${tool}`, input);

/** Say, for an agent's look (`?look`, packs/look_draw), that the page has drawn: two frames on, so it has been painted. */
const sayLook = (state, why) => {
  const root = document.documentElement;
  if (!new URLSearchParams(location.search).has('look') || root.dataset.lookSaid) return;
  root.dataset.lookSaid = '1';
  requestAnimationFrame(() => requestAnimationFrame(() => (why && (root.dataset.lookWhy = String(why).slice(0, 300)), (root.dataset.look = state))));
};

// How the workspace's style says a published page looks (page_css): read after the page's own rules, only in it.
const pageSheet = new CSSStyleSheet();
document.adoptedStyleSheets = [...document.adoptedStyleSheets, pageSheet];
const pageCss = (css) => {
  try {
    return css ? [':where(body) {', checkedCss(css, true), '}'].join('\n') : '';
  } catch (err) {
    console.warn(err.message);
    return '';
  }
};

// A link followed takes what the page's data says it carries (data.carry), set as it is followed.
let carryOn;
const carry = (e) => {
  const link = e.target.closest?.('a[href]');
  if (!(link instanceof HTMLAnchorElement)) return;
  const to = carried(link.href, location.href, carryOn);
  if (to !== link.href) link.href = to;
};
addEventListener('click', carry, true);
addEventListener('auxclick', carry, true);

/** The page drawn now, and what it was drawn from. */
let d = null;
let render = null;
let start = null;
let head = null;

/** Where a page another one names is read: beside this one, at its address word on its site, or one's own read. */
const pageOf = (id) => {
  const paths = d?.paths ?? {};
  if (own) return `/read/${id}`;
  if (d?.site?.host && paths[id]) return paths[id] === 'home' ? '/' : `/${paths[id]}`;
  return here.replace(/[^/]+$/, id);
};

/** An item named on the page, followed: its section on the page, another published page, or its sheet. */
function follow(id) {
  const at = main.querySelector(`[data-item="${id}"]`);
  if (at) return void at.scrollIntoView({ behavior: 'smooth', block: 'start' });
  if (d?.links?.[id]) return void (location.href = pageOf(id));
  const sheet = d?.marks?.sheets?.[id];
  if (sheet && (published || d?.site)) openSheet(sheet);
}

main.addEventListener('click', (ev) => {
  // A note names an item as the app does (#/e/<id>): here it leads where a page can take it.
  const a = ev.target.closest?.('a[href]');
  const id = a && main.contains(a) && /^#\/e\/(e_[a-z0-9]{8})$/.exec(a.hash)?.[1];
  if (!id) return;
  ev.preventDefault();
  follow(id);
});

/** A picture the marks name, drawn out of the page's data: a view as publishing froze it, else a figure. */
function picture(id, el) {
  if (product) return void el.append(h('img', { src: `${here}/picture/${id}`, alt: '', loading: 'lazy' }));
  const lens = d?.lenses?.[id];
  const s = d?.parts?.find((p) => p.section?.id === id)?.section;
  if (lens) {
    const at = h('div', { class: 'doc-lens', 'data-lens': id });
    el.append(at);
    return void drawFrozen(at, lens, d.types, { onItem: published || d.site ? follow : null });
  }
  if (!s?.picture) return;
  const img = h('img', { alt: s.title ?? '', 'data-figure': id });
  el.append(img);
  if (own || preview) api('picture', { result: id }).then((p) => (p ? (img.src = `data:${p.content_type};base64,${p.data}`) : img.remove()), () => img.remove());
  else img.src = `${here}/picture/${id}`;
}

/** What the person did on the marks: the page's own gestures. */
function told(ev) {
  if (ev?.key === 'print' && ev.name === 'press') print();
  if (product && ev?.key === 'build' && ev.name === 'picked') void load(String(ev.value ?? ''));
}

async function draw(data) {
  d = data;
  closeSheet();
  if (d.carry) carryOn = d.carry;
  applyTheme(d);
  pageSheet.replaceSync(pageCss(d.page_css));
  document.title = d.marks?.title ?? (product ? `${d.title}: how we know` : d.title);
  // The page's body wears the name of the head its style gives it (page.head), so its stylesheet can dress it.
  if (head) document.body.classList.remove(head);
  head = /^[a-z]+$/.test(d.head ?? '') ? d.head : null;
  if (head) document.body.classList.add(head);
  if (d.marks_error) console.warn(`This page's marks were not kept: ${d.marks_error}`);
  const body = d.marks?.marks ?? (product ? ['text', { look: 'muted' }, 'This page cannot be drawn here.'] : plainMarks(d));
  // One read with no login, not on its site's own domain, ends with a quiet way to start a map of one's own.
  const startsOwn = !product && !own && !preview && !d.site?.host && typeof d.start === 'string' && Boolean(d.start);
  const page = ['box', { flow: 'column', gap: 8 }, ...(d.site ? [siteHead(d.site)] : []), body, ...(product ? [] : pageFoot(d, { start: startsOwn && start, print: !published && !d.site }))];
  // Drawn the first time out of sight until its pictures are in (part-render draws each a moment after its marks), so
  // a reader never sees the words without their pictures; drawn again, it changes in place.
  const first = !render;
  if (first) render = mountPart(main.appendChild(h('div', { class: 'part-body' })), { style: readingStyle, tell: told, picture });
  const holder = main.querySelector('.part-body');
  if (first) holder.style.visibility = 'hidden';
  render.draw(checkMarks(page));
  await Promise.resolve();
  copyable(main);
  main.querySelector(':scope > p')?.remove();
  holder.style.visibility = '';
}

/** The page's data with its marks, read where this page is. */
function read(build) {
  const given = !build && document.getElementById('page-data');
  if (given) return Promise.resolve(JSON.parse(given.textContent));
  warmLayouts();
  if (preview) return post(`${here}/data`, {});
  // One's own read: the item read whole as the schema marks that read (whole), as a page, with its marks.
  if (own) return api('schema', { reads: true }).then((s) => api(s?.reads?.find((r) => r.whole)?.name, { id: own, drawn: true, page: true }));
  return fetch(`${here}/data${build ? `?build=${encodeURIComponent(build)}` : ''}`).then(async (res) => {
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(product ? 'There is nothing public at this address.' : (body.error ?? 'This page does not open anything.'));
    return body;
  });
}

async function load(build) {
  try {
    const [data, address] = await Promise.all([read(build), product || own || preview ? null : startAddress()]);
    start = address;
    await draw(data);
    sayLook('drawn');
  } catch (err) {
    render = null;
    main.replaceChildren(h('p', { class: 'error' }, err.message));
    sayLook('error', err.message);
  }
}

void load();

// Opened with ?live, a published page is drawn anew each time its document is published again (packs/publish/kernel/published-live.ts).
// It reads again once its stream is open too: a publish between the first read and the stream is not missed.
if (published && !product && new URLSearchParams(location.search).has('live')) {
  const fresh = () => fetch(`${here}/data`).then((res) => res.json()).then(draw, () => null);
  const live = new EventSource(`${here}/live`);
  live.addEventListener('open', fresh);
  live.addEventListener('published', fresh);
}
