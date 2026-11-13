// The panes pack's one part, panes.panes (task e_d5ewsvgf, decision e_bn76z5fu): the strip of tabs (slot `tabs`) and
// the panes of the tab in sight (mounted again with the piece `slot: 'panes'`), decided from one model (./model.js)
// and drawn by the runtime with the pane marks (packs/walls/page/part-pane.js). Both mounts share this module, so one
// model; a change redraws each. The model is kept in the person's browser by workspace (tools.keep), never on the map.
//
// The page's address is the runtime's (docs/packs.md, "The page's address is the runtime's"): the strip's mount is
// handed `page` as it moves and told each step back or forth, and answers by writing the address the pane in focus
// stands at (tools.go). It is told each show (`land`), and each chat that ended or rested, and reads the open sessions
// live; ./life.js does to the tabs what each means. Only the strip's mount hears these: the panes' mount draws.

import * as M from './model.js';
import { strip } from './strip.js';
import { ended, land, leaving, mirror, rested, sides } from './life.js';

const KEEP = 'tabs';
let n = 0;
const newId = (prefix) => `${prefix}${Date.now().toString(36)}${(++n).toString(36)}`;

/** The one model, shared by every mount of this part in this worker. */
let m = null;
const mounts = new Set();
/** The mount that hears the page: the strip's. */
let driver = null;
/** Shows that wait for the reader to leave where they would land, by session: tried again on the next move. */
const waiting = new Map();

/** The page open over a tab, kept with it: an item's, a screen, the workspace. */
const sheetOf = (hash) => /^#\/(e\/e_[a-z0-9]{8}|s\/[^?]*|workspace|you|new[^?]*)/.exec(hash ?? '')?.[1];

/** The model kept, or a fresh one on the address the page opened on. */
function modelOf(input) {
  const kept = input?.kept?.[KEEP];
  const list = Array.isArray(kept?.list) ? kept.list.filter(M.sound) : [];
  if (list.length) return sides({ ...M.model(list, kept.front), heard: kept.heard ?? {}, landed: kept.landed ?? {}, dismissed: kept.dismissed ?? [] });
  const hash = input?.page?.hash ?? '#/';
  const fresh = M.model([M.freshTab(newId, M.atOf(hash) ?? 'v')]);
  M.frontOf(fresh).sheet = sheetOf(hash);
  return sides(fresh);
}

/** The sessions as the strip names and marks them: what each is called, the word its hue is made from, whether it ended. */
const sessionsOf = () => Object.fromEntries(Object.entries(m.heard ?? {}).map(([k, s]) => [k, { name: s.called, word: s.name, ended: s.ended }]));

/** The panes of the tab in sight, as marks: each its canvas at its address, its strip its name, its mark and its two buttons. */
function panesMarks(t) {
  const focus = M.focusOf(t);
  const pane = (id) => {
    const p = t.panes[id];
    const share = t.sizes[t.groups.indexOf(id)];
    const who = p.slot ?? (p.held ? m.heard?.[p.held]?.called ?? '' : '');
    return ['pane', { key: `pane:${id}`, at: p.at, share, drag: 'pane', selected: id === focus, ...(p.ring && Date.now() - p.ring < 2000 && { ring: true }), tip: String(p.said ? `${who}: ${p.said}` : 'Drag its name to dock it elsewhere').slice(0, 200) },
      ['text', {}, String(p.name ?? 'Canvas').slice(0, 120)],
      ...(who ? [['text', { look: 'mark' }, String(who).slice(0, 40)]] : []),
      ['button', { key: `totab:${id}`, look: 'quiet', tip: 'Move this pane to a new tab' }, '⧉'],
      ...(t.groups.length > 1 ? [['button', { key: `close:${id}`, look: 'quiet', tip: 'Close this pane' }, '×']] : []),
    ];
  };
  return ['panes', { key: 'panes', dir: t.dir ?? 'row' }, ...t.groups.map(pane)];
}

const marksFor = (slot) => (slot === 'panes' ? panesMarks(M.frontOf(m)) : strip(m, { sessions: sessionsOf() }));

/** Keep the model, publish what the host reads of it, and redraw every mount: the strip and the panes read the same tabs. */
function changed() {
  const t = M.frontOf(m);
  driver?.tools.keep({ list: m.list, front: m.front, heard: m.heard, landed: m.landed, dismissed: m.dismissed }, KEEP);
  driver?.tools.state?.('front', m.front);
  driver?.tools.state?.('lands_in', M.landsIn(m, t).join(' ') || null);
  driver?.tools.state?.('front_chat', t.chat ?? null);
  driver?.tools.state?.('front_follows', t.follows ?? null);
  for (const mount of mounts) mount.tools.marks(marksFor(mount.slot));
}

/** The address the tab in sight stands at, written over the entry or as a step (`push`). */
function say(push = false) {
  const hash = M.tabHref(M.frontOf(m));
  driver?.tools.go?.({ hash, push });
}

/** Bring tab `id` into sight: the one left goes if its chat ended, and the address becomes the new one's. */
function show(id) {
  const left = M.frontOf(m);
  if (!M.toFront(m, id)) return false;
  if (left?.ended) leaving(m, left);
  say(false);
  return true;
}

/** What a press, a drop or a pane's word does to the model: false when nothing, true when it changed, 'step' when the address takes a step. */
export function act(event) {
  const { key = '', name, value } = event ?? {};
  const [what, a, b] = String(key).split(':');
  const t = M.frontOf(m);
  if (name === 'press' || name === 'close') {
    if (what === 'new') return Boolean(M.openTab(m, newId, M.BLANK)) && (say(false), true);
    if (what === 'front') return show(a);
    if ((what === 'tab' && name === 'close') || (what === 'close' && a?.startsWith('t'))) return M.closeTab(m, a) && (say(false), true);
    if (what === 'close') return M.closePane(t, a) && (say(false), true);
    if (what === 'totab') return Boolean(M.paneToTab(m, newId, a)) && (say(false), true);
    if (what === 'follow') return (Object.assign(M.tabOf(m, a) ?? {}, { follows: b }), true);
    if (what === 'keep') return (M.keepTab(M.tabOf(m, a)), true);
    if (what === 'merge') return (M.joinTab(m, M.tabOf(m, a), M.tabOf(m, b)), say(false), true);
    if (what === 'split') return Boolean(M.openPane(t, newId, M.BLANK, 'right', M.focusOf(t), { anew: true })) && (say(false), true);
    return false;
  }
  if (name === 'share' && what === 'panes') return Number.isInteger(value?.index) && value.index + 1 < t.sizes.length && (M.share(t, value.index, Number(value.at)), true);
  if (name === 'focus' && what === 'pane') return t.focus !== a && t.groups.includes(a) && ((t.focus = a), say(false), true);
  if (name === 'named' && what === 'pane') return Boolean(t.panes[a]) && t.panes[a].name !== value && ((t.panes[a].name = String(value ?? '').slice(0, 120)), true);
  if ((name === 'open' || name === 'go') && what === 'pane') {
    const at = M.asPane(String(value?.at ?? value ?? ''));
    if (!M.drawable(at) || !M.goPane(t, a, at)) return false;
    if (a === M.focusOf(t)) say(true);
    return true;
  }
  if (name === 'opened' && what === 'pane') return t.focus !== a && t.groups.includes(a) && ((t.focus = a), true);
  if (name === 'drop') {
    const [onto, target] = String(value?.onto ?? '').split(':');
    if (what === 'pane' && value?.zone === 'tabs') return (onto === 'tab' ? (M.joinTab(m, t, M.tabOf(m, target), [a]), true) : Boolean(M.paneToTab(m, newId, a))) && (say(false), true);
    if (what === 'pane' && onto === 'pane') return M.dropPane(t, a, target, value.zone);
    if (what === 'tab' && value?.zone === 'tabs' && onto === 'tab' && target !== a) return (M.joinTab(m, M.tabOf(m, a), M.tabOf(m, target)), say(false), true);
    if (what === 'tab' && value?.zone === 'out' && m.list.length > 1) return popOut(a);
  }
  return false;
}

/** Pop tab `id` out into a window of its own; this page draws it no more. */
function popOut(id) {
  const t = M.tabOf(m, id);
  if (!t || !driver?.tools.window) return false;
  driver.tools.window(id, M.tabHref(t));
  m.out = [...(m.out ?? []).filter((o) => o.id !== id), t];
  m.list = m.list.filter((o) => o !== t);
  if (m.front === id) (m.front = m.list[0].id), say(false);
  return true;
}

/** The page moved to `hash` (a link followed, a page opened over the canvas): the tab in sight keeps the page, its pane in focus the lens. */
function moved(hash) {
  const t = M.frontOf(m);
  const sheet = sheetOf(hash);
  let changes = t.sheet !== sheet;
  t.sheet = sheet;
  const at = M.atOf(hash);
  if (at) changes = M.goPane(t, M.focusOf(t), at, true) || changes;
  return changes;
}

/** A step back or forth: the pane in focus takes it, and the address follows; nothing left that way, the address stays the pane's. */
function stepped(by) {
  const t = M.frontOf(m);
  const went = M.travel(t, M.focusOf(t), by);
  say(false);
  return went;
}

/** Land a show, or keep it to try again; then try those that wait. */
function landed(step) {
  const did = land(m, step, newId);
  if (did.later) return (waiting.set(step.run ?? step.actor, step), true);
  waiting.delete(step.run ?? step.actor);
  if (did.go) driver?.tools.go?.({ hash: did.go, push: false });
  return true;
}
function retry() {
  for (const step of [...waiting.values()]) {
    const did = land(m, step, newId);
    if (did.later) continue;
    waiting.delete(step.run ?? step.actor);
    if (did.go) driver?.tools.go?.({ hash: did.go, push: false });
  }
}

/** Read the sessions open now and mirror them: those gone keep no tab, nor those quiet or waiting. */
async function readOpen() {
  const got = await driver?.tools.read?.('sessions', {});
  if (!got?.open) return;
  mirror(m, newId, got.open);
  changed();
}

/** What the strip's mount hears of the page and the sessions: true when the tabs changed. */
function heard(event) {
  if (event?.name === 'split') return act({ key: 'split', name: 'press' });
  if (event?.name === 'step') return stepped(event.step === -1 ? -1 : 1);
  if (event?.name === 'land' && event.step) return (landed(event.step), void readOpen(), true);
  if (event?.name === 'ended') return (ended(m, newId, event.run, false), true);
  if (event?.name === 'rested') return (rested(m, newId, event.run), true);
  return false;
}

export default function panes(input, tools) {
  m ??= modelOf(input);
  const mount = { slot: (input?.slot ?? input?.piece?.slot) === 'panes' ? 'panes' : 'tabs', tools, hash: input?.page?.hash };
  mounts.add(mount);
  // The strip's mount hears the page: the address it opened on goes to the pane in focus, as the page's own panes took it.
  if (mount.slot === 'tabs') {
    driver = mount;
    if (input?.page?.hash) moved(input.page.hash);
    queueMicrotask(changed);
    void readOpen();
  }
  return {
    marks: marksFor(mount.slot),
    update(next) {
      const hash = next?.page?.hash;
      if (mount === driver && hash && hash !== mount.hash) {
        mount.hash = hash;
        if (moved(hash)) changed();
      }
      if (mount === driver && waiting.size) (retry(), changed());
      return marksFor(mount.slot);
    },
    on(event) {
      const did = (mount === driver && heard(event)) || act(event);
      if (!did) return undefined;
      if (waiting.size) retry();
      changed();
      return marksFor(mount.slot);
    },
    end() {
      mounts.delete(mount);
      if (driver === mount) driver = null;
    },
  };
}

/** For tests: start again with this model. */
export const reset = (list = [], front = null) => ((m = list.length ? sides(M.model(list, front)) : null), mounts.clear(), (driver = null), waiting.clear());
