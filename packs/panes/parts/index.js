// The panes pack's one part, panes.panes (task e_d5ewsvgf, decision e_bn76z5fu): the strip of tabs (slot `tabs`) and
// the canvas of the tab in sight (mounted again with the piece `slot: 'panes'`; a tab is one canvas, Alex, 17 Nov
// 2026), decided from one model (./model.js)
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

/** The model kept (each tab cut to its one canvas), or a fresh one on the address the page opened on. */
function modelOf(input) {
  const kept = input?.kept?.[KEEP];
  const list = Array.isArray(kept?.list) ? kept.list.filter(M.sound).map(M.alone) : [];
  if (list.length) return sides({ ...M.model(list, kept.front), heard: kept.heard ?? {}, landed: kept.landed ?? {}, dismissed: kept.dismissed ?? [] });
  const hash = input?.page?.hash ?? '#/';
  const fresh = M.model([M.freshTab(newId, M.atOf(hash) ?? 'v')]);
  M.frontOf(fresh).sheet = sheetOf(hash);
  return sides(fresh);
}

/** The sessions as the strip names and marks them: what each is called, the word its hue is made from, whether it ended. */
const sessionsOf = () => Object.fromEntries(Object.entries(m.heard ?? {}).map(([k, s]) => [k, { name: s.called, word: s.name, ended: s.ended, state: s.state, for: s.for }]));

/** A web page framed in a pane is named by its host. */
function hostOf(at) {
  try {
    const url = M.webOf(at);
    return url ? new URL(url).host : undefined;
  } catch {
    return undefined;
  }
}

/** The tab in sight's canvas, as a mark: drawn at its address, named by what it draws (a web page by its host). */
function paneMark(t) {
  const id = M.focusOf(t);
  return ['panes', { key: 'panes', dir: 'row' }, ['pane', { key: `pane:${id}`, at: t.panes[id].at, share: 1, selected: true }, ['text', {}, String(hostOf(t.panes[id].at) ?? t.panes[id].name ?? 'Canvas').slice(0, 120)]]];
}

const marksFor = (slot) => (slot === 'panes' ? paneMark(M.frontOf(m)) : strip(m, { sessions: sessionsOf() }));

/** Keep the model, publish what the host reads of it, and redraw every mount: the strip and the panes read the same tabs. */
function changed() {
  const t = M.frontOf(m);
  driver?.tools.keep({ list: m.list, front: m.front, heard: m.heard, landed: m.landed, dismissed: m.dismissed }, KEEP);
  driver?.tools.state?.('front', m.front);
  driver?.tools.state?.('lands_in', M.landsIn(m, t).join(' ') || null);
  driver?.tools.state?.('front_chat', t.chat ?? null);
  driver?.tools.state?.('front_follows', t.follows ?? null);
  driver?.tools.state?.('pane_at', M.hrefOf(t.panes[M.focusOf(t)]?.at));
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
  const [what, a] = String(key).split(':');
  const t = M.frontOf(m);
  if (name === 'press' || name === 'close') {
    if (what === 'new') return Boolean(M.openTab(m, newId, M.BLANK)) && (say(false), true);
    if (what === 'front') return show(a);
    if ((what === 'tab' && name === 'close') || what === 'close') return M.closeTab(m, a) && (say(false), true);
    return false;
  }
  const pane = M.focusOf(t);
  if (what !== 'pane' || a !== pane) return false;
  // What it draws: an item opened that it already draws keeps it there (moved).
  if (name === 'drawn') return void (t.panes[a].ids = (Array.isArray(value) ? value : []).slice(0, 500)), false;
  if (name === 'named') return t.panes[a].name !== value && ((t.panes[a].name = String(value ?? '').slice(0, 120)), true);
  if (name === 'open' || name === 'go') {
    const at = M.paneAt(String(value?.at ?? value ?? ''));
    return M.drawable(at) && M.goPane(t, a, at) && (say(true), true);
  }
  return false;
}

/** The page moved to `hash` (a link followed, a page opened over the canvas): the tab in sight keeps the page, its pane in focus the lens. */
function moved(hash) {
  const t = M.frontOf(m);
  const sheet = sheetOf(hash);
  let changes = t.sheet !== sheet;
  t.sheet = sheet;
  const at = M.atOf(hash);
  if (at) return M.goPane(t, M.focusOf(t), at, true) || changes;
  // An item's page with no lens: the pane in focus keeps what it draws when that holds the item, else draws the
  // item's own canvas, as an item's page opened by its address always did.
  const item = /^#\/e\/(e_[a-z0-9]{8})$/.exec(hash ?? '')?.[1];
  const pane = t.panes[M.focusOf(t)];
  if (item && !pane?.ids?.includes(item)) changes = M.goPane(t, M.focusOf(t), M.paneAt(`e/${item}`), true) || changes;
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
  if (event?.name === 'sessions') return (void readOpen(), false);
  if (event?.name === 'busy') return void (m.busy = { ...m.busy, [String(event.pane)]: Date.now() }), waiting.size > 0;
  if (event?.name === 'step') return stepped(event.step === -1 ? -1 : 1);
  if (event?.name === 'land' && event.step) return landed(event.step);
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
    // The open sessions are read once the page has drawn its first view (the host says so: `sessions`), never before.
    queueMicrotask(changed);
    // Told before it was mounted, it is handed the last word as `told`.
    if (input?.told?.name === 'sessions') void readOpen();
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
