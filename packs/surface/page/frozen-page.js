// A page drawn from frozen marks (decision e_rhz4dvpk): a document published or given as a link (/p/<workspace>/<id>,
// a site's own domain), its preview (/preview/<id>), a document read with one's own sign-in (/read/<id>), and a
// product's public page. The server ran the page's part (publish.doc, publish.public) and sends its marks with the page's
// data (packs/publish/kernel/page-marks.ts); this draws them, checked first, with no session and none of the part's
// code: a document's in the page's own elements, which its page_css is written against (./frozen-doc.js), a product's
// as the host draws any part's (./part-render.js). What only the page can do is the host's: its theme and page_css,
// its site's head and foot, pictures, where a link leads, sheets, copy and print (./frozen-chrome.js).

import { SignInNeeded, authHeaders, call, h, hooks } from './base.js';
import { drawFrozen } from './doc-lens.js';
import { carried } from './doc-ref.js';
import { closeSheet, openSheet, plainMarks, readingStyle, startAddress } from './frozen-chrome.js';
import { blocks, pageParts, siteHead, waysOf } from './frozen-doc.js';
import { warmLayouts } from './layout.js';
import { checkedCss } from './marks.js';
import { checkMarks } from './part-check.js';
import { mountPart } from './part-render.js';
import { applyTheme } from './theme.js';
import { startTips } from './tip.js';

// The runtime that draws parts, asked for by name by the kit (packs/kit/page/base.js): look mode mounts its part here too.
hooks.partsRuntime = () => import('./part-host.js');

startTips();

const main = document.getElementById('main');
const here = location.pathname.replace(/\/+$/, '');
/** A product's page (packs/surface/page/public.html) or a document's. */
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
let start = null;
let head = null;

/** An item named on the page, followed: another published page it names, or its sheet when a picture froze it. */
function follow(id) {
  if (d?.links?.[id]) return void (location.href = waysOf(d, { own, here }).pageOf(id));
  const sheet = d?.marks?.sheets?.[id];
  if (sheet && (published || d?.site)) openSheet(sheet);
}

/** A section's picture: a view as publishing froze it, drawn once it is in place, else its figure. */
function pictureOf(id) {
  if (d?.lenses?.[id]) return h('div', { class: 'doc-lens', 'data-lens': id });
  const s = d?.parts?.find((p) => p.section?.id === id)?.section;
  return s?.picture ? h('figure', {}, h('img', { src: own || preview ? '' : `${here}/picture/${id}`, alt: s.title ?? '', 'data-figure': id })) : null;
}

/** A document's page, in its own elements (./frozen-doc.js), with what is around it as it is served. */
function drawDoc() {
  const ways = waysOf(d, { own, here });
  const root = checkMarks(d.marks?.marks ?? plainMarks(d));
  // One read with no login, not on its site's own domain, ends with a quiet way to start a map of one's own; one read with a sign-in may be printed.
  const startsOwn = !own && !preview && !d.site?.host && typeof d.start === 'string' && Boolean(d.start);
  const printable = !published && !d.site;
  main.replaceChildren(
    ...[
      d.site && siteHead(d.site),
      pageParts(root, d, ways, pictureOf),
      d.site?.footer && h('footer', { class: 'site-foot' }, blocks(d.site.footer, ways, 3)),
      (printable || startsOwn) && h('footer', { class: 'muted' }, printable && h('button', { class: 'print', onclick: () => print() }, 'Print or save as PDF'), startsOwn && h('a', { class: 'start-own', href: start ?? '/' }, d.start)),
    ].flat(Infinity).filter(Boolean),
  );
  // Its pictures, with the words: a drawing's first frame is kept with the picture, and the drawing takes it over once started.
  for (const el of main.querySelectorAll('[data-lens]')) drawFrozen(el, d.lenses[el.dataset.lens], d.types, { onItem: published || d.site ? follow : null });
  if (own || preview) for (const img of main.querySelectorAll('img[data-figure]')) api('picture', { result: img.dataset.figure }).then((p) => (p ? (img.src = `data:${p.content_type};base64,${p.data}`) : img.remove()), () => img.remove());
}

/** A product's page, drawn as the host draws any part's; picking another build reads that build's page. */
let render = null;
function drawProduct() {
  if (!render) render = mountPart(main.appendChild(h('div', { class: 'part-body' })), {
    style: readingStyle,
    tell: (ev) => ev?.key === 'build' && ev.name === 'picked' && void load(String(ev.value ?? '')),
    picture: (id, el) => el.append(h('img', { src: `${here}/picture/${id}`, alt: '', loading: 'lazy' })),
  });
  render.draw(checkMarks(d.marks?.marks ?? ['text', { look: 'muted' }, 'This page cannot be drawn here.']));
  main.querySelector(':scope > p')?.remove();
}

function draw(data) {
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
  if (product) drawProduct();
  else drawDoc();
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
    draw(data);
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
