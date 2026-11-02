// A chat's tab lives as its chat does (the design e_p6fr4uye): it opens as the chat begins, out of sight and marked,
// carries the chat's title, and goes as the chat ends. A tab and each pane in it is a chat's (`chat` on the tab, `by` on
// a pane) or the owner's: at a chat's end what was made for it closes and what the owner made stays (e_g629ejm6), so a
// chat's tab the owner split a pane in, or merged a tab of theirs into, stays as theirs. One in sight is struck and goes
// when the reader leaves it (e_qyazzz7f); one kept (⋯ Keep) is the owner's already (e_n7gpy3pt). Every page mirrors the
// open chats, on load, when it comes back into sight and when it hears one end (e_gm9ej6bv); a tab the owner closed
// while its chat runs stays closed until the chat next shows something (e_qvdrv6h3), and after a clear the chat's new
// session takes over its tab (e_2ppfesd4).

import { hooks } from './base.js';
import { heard, nameOf } from './pane-route.js';
import { drawStrip, openTab } from './tab-bar.js';
import { draw } from './panes.js';
import { dismissed, focusOf, freshTab, keep, landed, outTabs, poppedTab, tabs } from './tabs.js';

const isRun = (key) => /^e_[a-z0-9]{8}$/.test(key ?? '');
/** What a tab opened for a chat carries: whom it follows, whose it is, what it is called and its hue's word. */
export const chatTab = (run) => ({ follows: run, chat: run, by: run, named: nameOf(run), word: heard.get(run)?.name });
/** The panes of tab `t` made for chat `run`. */
const madeFor = (t, run) => t.groups.filter((g) => t.panes[g]?.by === run);

/** Take chat `run`'s panes out of tab `t`: a tab left with none goes, one left with the owner's is theirs. */
export function settle(t, run) {
  const going = madeFor(t, run);
  for (const g of going) (delete t.panes[g], landed.delete(`${t.id}:${g}`));
  t.groups = t.groups.filter((g) => !going.includes(g));
  t.sizes = t.groups.map(() => 1 / t.groups.length);
  if (!t.groups.includes(t.focus)) t.focus = t.groups[0];
  if (t.chat === run) delete t.chat;
  if (t.follows === run) t.follows = 'none';
  t.ended = (t.ended ?? []).filter((r) => r !== run);
  if (!t.ended.length) delete t.ended;
  if (!t.groups.length) tabs.list = tabs.list.filter((o) => o !== t);
}

/** How long a chat a clear ended keeps its tab, for the session that goes on in it to take over. */
const clearedFor = 15_000;
/** Sessions whose tabs were taken over, so their end closes nothing. */
const taken = new Set();

/**
 * Chat `run` has ended (`why`, as its client said): its panes and tabs go, the owner's stay. Where the reader is, it
 * waits for them to leave: the chat's tab in sight is struck, and its pane they are in stays. Found ended as the page
 * opens or comes back (`found`), it all goes at once. One a clear ended waits a moment: the chat goes on as a new
 * session, which takes it over.
 */
export function ended(run, why, found = false) {
  if (poppedTab || !isRun(run) || taken.has(run)) return;
  if (why === 'clear') return void setTimeout(() => ended(run), clearedFor);
  let redraw = false;
  const one = heard.get(run);
  if (one) one.ended = true;
  dismissed.delete(run);
  for (const t of [...tabs.list]) {
    for (const g of t.groups) if (t.panes[g]?.held === run) delete t.panes[g].held;
    if (t.chat !== run && t.follows !== run && !madeFor(t, run).length) continue;
    const inSight = t.id === tabs.front;
    if (inSight && !found && (t.chat === run || madeFor(t, run).includes(focusOf(t)))) t.ended = [...new Set([...(t.ended ?? []), run])];
    else (settle(t, run), (redraw ||= inSight));
  }
  // A page always keeps a tab of the owner's.
  if (!tabs.list.length) tabs.list = [freshTab('#/')];
  if (!tabs.list.some((t) => t.id === tabs.front)) tabs.front = tabs.list[0].id;
  keep();
  if (redraw) draw();
  drawStrip();
}

/** Chat `run` was heard from again (a resume, a show): a tab struck for it is its own again, and one closed comes back. */
export function revive(run) {
  dismissed.delete(run);
  for (const t of tabs.list) if (t.ended?.includes(run)) (t.ended = t.ended.filter((r) => r !== run)), t.ended.length || delete t.ended;
}

/** After a clear the chat goes on as session `now`: everything the page kept for session `before` is its now. */
export function takeOver(before, now) {
  if (!isRun(before) || !isRun(now)) return;
  const swap = (v) => (v === before ? now : v);
  for (const t of tabs.list) {
    t.follows = swap(t.follows);
    if (t.chat) t.chat = swap(t.chat);
    if (t.ended) t.ended = t.ended.filter((r) => r !== before);
    for (const g of t.groups) for (const k of ['held', 'by']) if (t.panes[g]?.[k]) t.panes[g][k] = swap(t.panes[g][k]);
  }
  for (const [key, l] of landed) if (l.session === before) landed.set(key, { ...l, session: now });
  taken.add(before);
  if (dismissed.delete(before)) dismissed.add(now);
  keep();
}

/** The chats this page keeps something of: a tab that is theirs or follows them, a pane made for or held for them. */
function keptFor() {
  const runs = new Set();
  for (const t of [...tabs.list, ...outTabs()]) {
    for (const run of [t.chat, t.follows]) if (isRun(run)) runs.add(run);
    for (const g of t.groups) for (const run of [t.panes[g]?.by, t.panes[g]?.held]) if (isRun(run)) runs.add(run);
  }
  return runs;
}

/** The chats open now (the `sessions` view): each has a tab, unless the owner closed it, and those gone have none. */
export function mirror(open) {
  if (poppedTab) return;
  const live = new Set(open.map((s) => s.id));
  for (const run of [...dismissed]) if (!live.has(run)) dismissed.delete(run);
  const kept = keptFor();
  for (const run of kept) if (!live.has(run)) ended(run, undefined, true);
  // Oldest first, so the newest chat is the last tab.
  for (const s of [...open].reverse()) if (!kept.has(s.id) && !dismissed.has(s.id)) openTab(`#/e/${s.working_on?.[0]?.id ?? s.id}`, chatTab(s.id), false);
  drawStrip();
}

hooks.sessionEnded = ended;
hooks.settleTab = (t, run) => (settle(t, run), keep(), drawStrip());
hooks.sessionsOpen = mirror;
