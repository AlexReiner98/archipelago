// What the owner is looking at: the address of the pane in focus on their page (the view it draws, and the item whose
// page is open over it), sent with the page's beat (tail) and kept in the transient table (src/transient.ts) under
// their screen, so an agent on any server is told it without being told in chat. Kept when it moves, and again once
// in a while so its age stays true; the newest page to look wins. Operational state, no fact: gone after a day.

import type { Q } from './db.ts';
import type { Archipelago } from './pelago.ts';
import { type Whose, whose } from './presence.ts';
import { keep, kept } from './transient.ts';

/** Where the owner's page stands: its address without "#/", and when a page last said so. */
export interface Seen {
  at: string;
  page: string;
  /** When the address was last said, in ms. */
  said: number;
  /** The chat whose tab is in sight (src/sessions.ts), and whether it is that chat's own tab or one of the owner's following it. */
  tab?: { chat: string; own: boolean };
}

/** What the owner is looking at, said to an agent. */
export interface Seeing {
  /** The view the canvas draws: a kept view's name, or its query as terms. */
  view?: string;
  /** The kept view (a lens item), when it is one. */
  lens?: string;
  /** The item whose page is open over the canvas. */
  item?: { id: string; title: string; type: string };
  /** A screen that is not a canvas (home, workspace...). */
  screen?: string;
  /** Seconds since the page last said where it stands. */
  ago: number;
  /** The chat whose tab is in sight, by its title, and whether it is the asking session's. */
  tab?: { chat: string; title?: string; own: boolean; yours: boolean };
}

/** How long it is kept after it was last said. */
const KEPT_MS = 24 * 3600_000;
/** How often it is kept again while nothing moves, so its age stays true. */
const AGAIN_MS = 60_000;
/** Older than this, the owner is taken to have left the page: an agent is not told it as now. */
export const NOW_MS = 10 * 60_000;

const key = (w: Whose) => `seeing:${whose(w)}`;
// What this process last kept, per screen: the beat every two seconds writes only when the address moved.
const last = new Map<string, Seen>();

/** A page said where it stands. */
export async function seen(db: Q, w: Whose, page: string, at: string, tab?: Seen['tab']): Promise<void> {
  const k = key(w);
  const was = last.get(k);
  if (was && was.at === at && was.page === page && was.tab?.chat === tab?.chat && Date.now() - was.said < AGAIN_MS) return;
  const now = { at, page, said: Date.now(), ...(tab && { tab }) };
  last.set(k, now);
  await keep(db, k, now, KEPT_MS);
}

/** Where the owner's page last stood, on any server. */
export const seenNow = (db: Q, w: Whose) => kept<Seen>(db, key(w));

const ID = /e_[a-z0-9]{8}/g;

/** The address read as the agent sees the map: the view by its name or its terms, the item by its title. */
export async function seeing(l: Archipelago, s: Seen, run?: string): Promise<Seeing> {
  const [where, query = ''] = s.at.split('?');
  const [name = '', arg] = where.split('/');
  const p = new URLSearchParams(query);
  const ago = Math.max(0, Math.round((Date.now() - s.said) / 1000));
  // Whose tab it is: the asking chat's own, another chat's, or one of the owner's following a chat.
  const chat = s.tab ? await l.entity(s.tab.chat) : undefined;
  const tab = s.tab && { chat: s.tab.chat, ...(chat && { title: chat.title }), own: s.tab.own, yours: Boolean(run) && s.tab.chat === run };
  if (name !== '' && name !== 'v' && name !== 'e') return { screen: where, ago, ...(tab && { tab }) };
  // Every id named, read once each: the item, a kept view, the ids in the terms.
  const ids = [...new Set([...(name === 'e' && arg ? [arg] : []), ...query.match(ID) ?? []])].slice(0, 12);
  const items = new Map((await Promise.all(ids.map((id) => l.entity(id)))).flatMap((e) => (e ? [[e.id, e] as const] : [])));
  const titled = (term: string) => term.replace(ID, (id) => (items.get(id) ? `"${items.get(id)!.title}"` : id));
  const lens = p.get('canvas') ?? undefined;
  const terms = [
    ...p.getAll('find').filter(Boolean).map(titled),
    ...p.getAll('from').filter(Boolean).map((id) => `from ${titled(id)}`),
    ...p.getAll('only').filter(Boolean).map((t) => `only ${titled(t)}`),
    ...p.getAll('not').filter(Boolean).map((t) => `not ${titled(t)}`),
    ...(p.get('over') ? [`walk ${p.get('over')} ${p.get('steps') ?? 1}`] : []),
    ...(p.get('shape') ? [`as ${p.get('shape')}`] : []),
  ];
  const item = name === 'e' && arg ? items.get(arg) : undefined;
  // An item's page with no query of its own draws that item and what it is tied to.
  const bare = item ? `from "${item.title}"` : 'the canvas as it opens';
  const view = lens ? (items.get(lens)?.title ?? lens) : p.get('view') ? `view ${p.get('view')}` : terms.length ? terms.join(', ') : bare;
  return { view, ...(lens && { lens }), ...(item && { item: { id: item.id, title: item.title, type: item.type } }), ago, ...(tab && { tab }) };
}

/**
 * One line for an agent (`run`, the session asking): what the owner is looking at, or nothing when no page of theirs
 * said so lately. On another chat's own tab, only whose tab it is: what that tab draws is that chat's, not this one's.
 */
export async function seeingLine(l: Archipelago, db: Q, run?: string): Promise<string | undefined> {
  const s = await seenNow(db, l);
  if (!s || Date.now() - s.said > NOW_MS) return undefined;
  const v = await seeing(l, s, run);
  if (v.tab?.own && !v.tab.yours) return `The owner's page shows another chat's tab ("${v.tab.title ?? v.tab.chat}"), not yours.`;
  const whose = v.tab?.yours ? (v.tab.own ? ' On your tab, the' : ' On a tab of theirs following you, the') : ' The';
  const open = v.item && `${v.item.type} "${v.item.title}" (${v.item.id}) open`;
  // An item's page over its own canvas is said once.
  const where = v.screen ? `the ${v.screen} screen` : v.item && v.view === `from "${v.item.title}"` ? open : `the view ${v.view}${v.lens ? ` (${v.lens})` : ''}${open ? `, with ${open}` : ''}`;
  return `${whose} owner's page shows ${where}. "This", "here" or "it" may mean that (query seeing has it).`.trimStart();
}
