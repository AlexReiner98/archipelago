// Saved canvases (task e_uq77ps44): a flat lens and a style kept on the map as an item of core's `lens` type, so a
// person opens it anywhere and it draws the same. Its id travels in the address beside the lens (`canvas=`, ui/query.js),
// so what is moved on it goes to its own places (the places stream, under its id, apart from the map's) and the bar
// names it. This is the host's side of them (task e_pe3fjd75, from ui/canvases.js): the views kept read once a page,
// what a view draws and where it opens, the view button naming the one up, and the band's frame. What the view button
// opens and a screen's list of views are the lenses pack's parts (packs/lenses/parts/), drawn at the map's version: they
// name a view, and this opens it and draws its thumbnail (hooks.openView, hooks.viewThumb). Saving and deleting the view
// up, and making an island, are parts that fill the band (`bar`: the menu pack's menu.band, the islands pack's
// islands.new). One a document brings in is a part of that page, in neither list unless it is up.

import { api, drawSlots, firstDrawn, h, hooks, idsOf, may, state, tell, wordsOf, withIds } from './base.js';
import { drawPart } from './part-host.js';
import { placeBy } from './menu-place.js';
import { addressOf, flatView, stepsOf } from './query.js';
import { filterSaid, fitBar } from './query-bar.js';
import { sharePublicly } from './item-doc.js';
import { thumbOf } from './thumbs.js';
import { pageIsA, pageSchema, versionCanvases } from './page-schema.js';
import { isA, typeChoice, types, workType } from './words.js';

const TYPE = 'lens';
/**
 * The saved canvases, the kept first, then by name: so a switch keeps its order as they change. The packs' canvases
 * (presets, decision e_x8bghuce) are among them, each until the owner keeps a version of it (props.preset), which
 * stands in its place; a preset kept is not on the map, so it has no id of its own to open by (`preset` says so).
 */
let known = null;
export function savedCanvases(fresh = false) {
  if (fresh || !known)
    known = firstDrawn.then(() => Promise.all([api('search', { type: TYPE, open: true, limit: 200 }).catch(() => []), api('view', { name: 'saved_views', params: { limit: 200 } }).catch(() => null)])).then(([rows, views]) => {
      const said = new Map((views?.pictures ?? []).map((p) => [p.lens, p]));
      // A working view about what has closed is retired with it (packs/lenses/kernel/saved-views.ts).
      const ended = new Set(views?.ended ?? []);
      const marked = rows.filter((r) => !ended.has(r.id)).map((r) => ({ ...r, note: said.get(r.id)?.note ?? null, cannot: said.get(r.id)?.cannot ?? null, inDocument: Boolean(said.get(r.id)?.document) }));
      const kept = new Set(rows.map((r) => r.props?.preset).filter(Boolean));
      // A pack's view of one item (`on` its types) is offered on that item's page alone (viewsOn).
      const offered = (state.schema?.canvases ?? []).filter((p) => !kept.has(p.id) && !p.on?.length).map((p) => ({ id: p.id, title: p.title, preset: true, props: { ...p.props, preset: p.id } }));
      return [...marked, ...offered].sort((a, b) => Number(a.status === 'working') - Number(b.status === 'working') || a.title.localeCompare(b.title, undefined, { numeric: true }));
    });
  return known;
}

/** What a saved canvas draws: its filter, its walk and its limit; and its style, with its own id. */
export function viewParts(item) {
  const p = item.props ?? {};
  const filter = p.filter ?? {};
  const lens = { ...(p.view && { view: p.view }), filter, walk: p.walk ?? { over: [], steps: 0 }, ...(p.limit && { limit: p.limit }), ...(p.time && { time: p.time }), ...(p.sessions === false && { sessions: false }) };
  return { lens, style: { ...(p.style ?? {}), ...(!item.preset && { canvas: item.id }) } };
}

/** Where a saved canvas opens: the address names it, and its lens is read from the map when it is opened; a pack's, by its lens. */
export const canvasAt = (c) => (c.preset ? `#/v?${addressOf(viewParts(c).lens, viewParts(c).style)}` : `#/v?canvas=${c.id}`);
/** The saved canvas up: the one the address names, else a pack's whose lens is the one up (its style changed, it is marked so). */
const upOf = (all, lens, style) => (style.canvas ? all.find((c) => c.id === style.canvas) : all.find((c) => c.preset && addressOf(viewParts(c).lens) === addressOf(lens)));

/** A view a pack ships, opened by its address: its own settings (a list's columns), which the address does not carry. */
export const presetSettings = (lens) => {
  const at = addressOf(lens);
  // A view of one item is its address with that item where it says {here}.
  const fits = (p) => new RegExp(`^${addressOf(viewParts({ ...p, preset: true, props: p.props }).lens).replace(/[.*+?^$()|[\]\\]/g, '\\$&').replaceAll(encodeURIComponent('{here}'), 'e_[a-z0-9]+')}$`).test(at);
  const preset = [...(state.schema?.canvases ?? []), ...versionCanvases()].find(fits);
  // `shipped` names the view its pack ships, which its drawing sends its actions as (packs/walls/page/layout-asks.js drawingActs).
  return preset ? { ...settingsOf({ props: preset.props }), shipped: preset.id } : {};
};

/**
 * The views packs ship of an item of this type (a preset `on` it): each its title and the address it opens at, the
 * item where its query says {here}. Its page offers them, so a project's roadmap is a view, not a screen.
 */
export const viewsOn = (typeId, id) =>
  (pageSchema()?.canvases ?? [])
    .filter((p) => p.on?.some((t) => pageIsA(typeId, t)))
    .map((p) => {
      const props = JSON.parse(JSON.stringify(p.props).replaceAll('{here}', id));
      const { lens, style } = viewParts({ preset: true, props });
      return { id: p.id, title: p.title, at: `#/v?${addressOf(lens, style)}` };
    });

/**
 * A saved canvas drawn where something brings it in (a document's section, a screen's piece): its lens and style read
 * from the map, drawn with the style of what it is about.
 */
export function keptView(id, { key = `kept:${id}`, style = {} } = {}) {
  const host = h('div', { class: 'lens-wrap' }, h('div', { class: 'empty' }, 'Loading…'));
  host.ready = api('get', { id })
    .then((got) => {
      const kept = viewParts(got.entity);
      const of = got.outgoing.find((o) => o.type === 'about')?.id;
      // Its steps are played by a drawing that knows them, with what they name drawn too.
      const { steps, told } = stepsOf(got.entity);
      if (told.length) kept.lens.filter = withIds(kept.lens.filter, told);
      // It starts from what it is about, where it draws that or what is in it (in it, within it, or the end of a link term); else from the one item it names.
      const ids = idsOf(kept.lens.filter);
      const ends = [...(kept.lens.filter.find ?? []), ...(kept.lens.filter.only ?? [])].filter((t) => !/^(id|text|type|kind) /.test(t)).map((t) => t.split(/\s+/).slice(1).join(' '));
      const from = ids.includes(of) || ends.includes(of) ? of : ids.length === 1 ? ids[0] : true;
      const view = flatView({ lens: kept.lens, style: { ...kept.style, ...style }, of, key, nest: from, ...(steps && { extra: { steps } }) });
      Object.defineProperty(host, 'answer', { get: () => view.answer, configurable: true });
      host.mark = (here) => view.mark(here);
      host.replaceChildren(view);
      return view.ready;
    })
    .catch((err) => host.replaceChildren(h('div', { class: 'error' }, err.message)));
  return host;
}
// What a drawing's `view` mark draws (ui/view-frame.js), handed over so the marks need not import the canvases.
hooks.keptView = keptView;

/** The style a canvas keeps: how it is drawn, not which canvas it is. */
const keptStyle = (style) => Object.fromEntries(['shape', 'lit', 'style'].filter((k) => style?.[k]).map((k) => [k, style[k]]));
/** Whether what is up differs from what the canvas keeps. */
const edited = (item, lens, style) => {
  const kept = viewParts(item);
  return addressOf(kept.lens, keptStyle(kept.style)) !== addressOf(lens, keptStyle(style));
};

/**
 * Share the view that is up (decision e_nwdn7ce6): as a public view anyone opens, frozen as it is now, with what goes
 * out said first (ui/item-doc.js). A share shows a view kept on the map: one not kept is saved first, in the band.
 */
async function shareView(current) {
  if (!current || current.preset) return tell('Not shared', 'Save this view first: a share shows a view kept on the map.');
  try {
    await sharePublicly(current.id, current.title);
  } catch (err) {
    tell('Not shared', err.message);
  }
}

/** A mark drawn in the colour of what holds it, at the size of its text, from its strokes. */
function drawnMark(...strokes) {
  const NS = 'http://www.w3.org/2000/svg';
  const el = (tag, attrs) => Object.entries(attrs).reduce((e, [k, v]) => (e.setAttribute(k, v), e), document.createElementNS(NS, tag));
  const svg = el('svg', { viewBox: '0 0 16 16', class: 'q-mark', 'aria-hidden': 'true' });
  svg.append(...strokes.map((d) => el('path', { d })));
  return svg;
}
const dot = (x, y, r = 2) => `M${x - r} ${y}a${r} ${r} 0 1 0 ${2 * r} 0a${r} ${r} 0 1 0 ${-2 * r} 0`;
/** The canvas picker's mark: three items and the links between them. */
const canvasMark = () => drawnMark(dot(4, 12), dot(12, 4), dot(12, 12), 'M5.5 10.5l5-5', 'M6 12h4');

/** The layout's menu: what is done rarely to how the view up is drawn, over everything, as a tab's menu is. */
const layoutList = h('div', { class: 'menu-items tab-menu', popover: 'auto', role: 'menu', 'aria-label': 'This view’s layout' });
document.body.append(layoutList);
function layoutMenu(rows) {
  const button = h('button', { type: 'button', class: 'q-save q-band-menu', title: 'Layout, and sharing this view', 'aria-label': 'Layout, and sharing this view', 'aria-haspopup': 'menu' }, '⋯');
  const item = (text, title, act, danger) => h('button', { type: 'button', role: 'menuitem', ...(danger && { class: 'danger' }), title, onclick: () => (layoutList.hidePopover(), act()) }, text);
  button.addEventListener('click', () => {
    if (layoutList.matches(':popover-open')) return layoutList.hidePopover();
    layoutList.replaceChildren(...rows.filter(Boolean).map((m) => m.element ?? item(m.text, m.title, m.act, m.danger)));
    layoutList.showPopover();
    placeBy(layoutList, button, { end: true });
  });
  return button;
}

/** A part's menu opened in the band hangs over the page, placed by what opened it: the band clips what hangs below it. */
function floatMenus(parts) {
  parts.addEventListener('click', (ev) => {
    const box = ev.target.closest?.('summary')?.parentElement;
    const list = box?.matches('details') ? box.querySelector(':scope > .menu-items') : null;
    if (!list || box.open) return;
    // Placed once it is open (the click opens it after this), fixed where it is in sight.
    requestAnimationFrame(() => box.open && ((list.style.position = 'fixed'), placeBy(list, box.querySelector(':scope > summary') ?? box, { end: true })));
  });
  return parts;
}

/** What the islands pack's part may offer for a new island, as its piece: the island packs and the types a first item may be (none where this session only reads). */
function islandPiece() {
  if (!may('write')) return {};
  const all = state.schema?.packs ?? [];
  const island = all.filter((p) => p.kind === 'island');
  const packs = (island.length ? island : all.filter((p) => p.id === 'core')).slice(0, 50);
  const usable = [...types.values()].filter((t) => !t.system && !t.dormant && !t.retired && !t.id.startsWith('sys.') && !isA(t.id, 'system') && !isA(t.id, 'actor'));
  const offered = [...usable.filter((t) => t.pack !== 'core' && packs.some((p) => p.id === t.pack)), ...usable.filter((t) => t.pack === 'core').sort((a, b) => Number(b.id === workType()) - Number(a.id === workType()))].slice(0, 50);
  return { packs: packs.map((p) => p.id), names: packs.map((p) => p.title), types: offered.map((t) => `${t.pack} ${t.id}`), type_names: offered.map((t) => typeChoice(t)) };
}
/** Whether the map holds its packs to the island rules (workspace_info islands), read once a page. */
let islandsOn;
const islandsHere = () => (islandsOn ??= api('workspace_info').then((info) => info?.islands === true, () => false));

/** The saved canvas the canvas draws now, if one is: Home marks it. */
let up = null;
/** The views the bar has read the list again for, not finding them in it. */
const reread = new Set();

/**
 * The canvas up, in the bar: back and forward, the button naming the view up (opening every view), the parts that
 * fill the band (Save, a new island), the pane's own buttons and the layout's menu. `open` goes to an address (a
 * pane's own, ui/panes.js).
 */
export function canvasSwitch(lens, style, isHome, open = (href) => (location.hash = href)) {
  up = style.canvas ?? null;
  const part = h('span', { class: 'q-part q-canvas', title: 'The view up: switch to another, or save this one' });
  // A view the address names that the list lacks was kept since it was read (an agent's, another tab's): read it again.
  // Once for each: one retired is never in it.
  const listed = savedCanvases().then((all) => (style.canvas && !all.some((c) => c.id === style.canvas) && !reread.has(style.canvas) ? (reread.add(style.canvas), savedCanvases(true)) : all));
  listed.then(async (all) => {
    const current = upOf(all, lens, style);
    const changed = current && edited(current, lens, style);
    // Not saved, it is named as its tab and its pane are: by what its filter finds.
    const label = current ? current.title : isHome ? 'Home' : filterSaid(lens.filter, () => {}) || 'View';
    const pick = viewPicker({ current, label, changed, isHome, open, title: current ? (changed ? `${current.title}: changed since it was saved` : current.title) : 'Not saved: Save keeps it' });
    const own = hooks.paneButtons?.() ?? [];
    const travel = own.filter((b) => b.classList.contains('q-travel'));
    // Each picker marked before it, its tooltip saying what it is.
    const named = (mark, title) => h('span', { class: 'q-label q-pick-label', title, 'aria-hidden': 'true' }, mark);
    // The parts that fill the band, side by side: what the person keeps of the view up, and an island made.
    const parts = floatMenus(h('span', { class: 'q-parts' }));
    // The layout up and its switch are the styles pack's part (slot bar.layouts): drawn once the view is, so its reads wait.
    const layout = h('div', { class: 'q-look-row' });
    void firstDrawn.then(() => drawPart(layout, { slot: 'bar.layouts', piece: {} }));
    const rows = [{ element: layout }, may('write') && current && !current.preset && { text: 'Share it', title: 'Public for anyone, frozen as it is now', act: () => shareView(current) }];
    part.replaceChildren(...travel, named(canvasMark(), 'View: the saved view up'), pick, parts, ...own.filter((b) => !travel.includes(b)), layoutMenu(rows));
    fitBar();
    const piece = { ...(current && !current.preset && { current: current.id }), home: Boolean(isHome), ...((await islandsHere()) ? islandPiece() : {}) };
    await drawSlots(parts, { slot: 'bar', piece }).catch((err) => parts.append(h('span', { class: 'error', title: String(err?.message ?? err) }, 'The band’s parts did not draw')));
    fitBar();
  });
  return part;
}

// ---- What a part names: a view to open, a thumbnail, the view up ----------------------------------------------

/** Where a view a part names opens: home, one kept or one a pack ships, by its id. */
async function viewAt(id) {
  if (id === 'home') return '#/';
  const c = (await savedCanvases()).find((v) => v.id === id);
  return c ? canvasAt(c) : /^e_/.test(id) ? `#/v?canvas=${id}` : null;
}
hooks.openView = (id) => viewAt(id).then((href) => href && (location.hash = href));
/** A view's thumbnail where a part names it: drawn once the list says what the view draws. */
hooks.viewThumb = (id) => {
  const box = h('span', { class: 'thumb-at' });
  if (id !== 'home') savedCanvases().then((all) => ((c) => c && box.replaceChildren(thumbOf({ id: c.id, ...viewParts(c) })))(all.find((v) => v.id === id)));
  return box;
};
hooks.viewUp = () => up;

// ---- The view switcher: the bar's button, and the panel the lenses pack's part fills ----------------------------

const panel = h('div', { class: 'tab-menu view-panel', popover: 'auto', role: 'dialog', 'aria-label': 'Views' });
document.body.append(panel);

/** The button naming the view up, opening the panel over the page with the part that fills it (`bar.views`). */
function viewPicker({ current, label, title, changed, isHome, open }) {
  const button = h('button', { type: 'button', class: 'q-pick q-view-pick', title, 'aria-haspopup': 'dialog', 'data-title': current?.title ?? (isHome ? 'Home' : '') },
    // The name is cut short where the bar is short of room; the whole of it is the tooltip.
    h('span', { class: 'q-pick-text' }, `${label}${changed ? ' •' : ''}`), h('span', { 'aria-hidden': 'true' }, '▾'));
  button.addEventListener('click', () => {
    if (panel.matches(':popover-open')) return panel.hidePopover();
    const body = h('div', { class: 'view-list' });
    panel.replaceChildren(body);
    panel.showPopover();
    placeBy(panel, button);
    // Placed again as the part draws into it; the field to find a view by takes the keys once it is drawn.
    let focused = false;
    const drawing = new MutationObserver(() => {
      if (!panel.matches(':popover-open')) return drawing.disconnect();
      placeBy(panel, button);
      const field = body.querySelector('.pm-input');
      if (field && !focused) (focused = true), field.focus();
    });
    drawing.observe(body, { childList: true, subtree: true });
    const openView = (id) => viewAt(id).then((href) => href && (panel.hidePopover(), open(href)));
    drawPart(body, { slot: 'bar.views', piece: { current: current?.id, home: Boolean(isHome) }, openView })
      .then((drawn) => drawn || body.replaceChildren(h('div', { class: 'empty muted small' }, 'No pack draws the views.')))
      .catch((err) => body.replaceChildren(h('div', { class: 'error' }, err.message)));
  });
  return button;
}
