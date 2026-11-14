// A guest map: a workspace made by one click, with no account, for a visitor's own agent to draw on within seconds
// (the owner, 13 Nov 2026, e_4bsagguk). It is kept for a week unless it is saved, and holds a few hundred items. Its
// guest is its owner, with all an owner may do there (e_hz2ggfg8), except what would have this server act outward
// for an anonymous person, which waits for sign-in (e_68gs8b7p; packs/surface/kernel/guest-gate.ts). What it may do is
// its standing (./standing.ts), said here instead of by a server pack; once it has ended it is read-only, and the
// server's leader deletes it a day later (packs/identity/kernel/workspaces.ts).
//
// The record is kept beside the workspaces, in the server's own database (control values, ./control.ts).

import { randomBytes } from 'node:crypto';
import type { Q } from '../../database/kernel/db.ts';
import { controlValue, setControlValue } from './control.ts';
import { standingChanged, type Limits, type Standing } from './standing.ts';

/** How long a guest map is kept unless saved, and how long it is then kept read-only before it is deleted. */
export const GUEST_DAYS = 7, GUEST_GRACE_DAYS = 1;
/** The most items a guest map holds. */
export const GUEST_ITEMS = 300;
const DAY = 86_400_000;
/** What a guest's agent is called when it acts as the map's owner. */
export const GUEST_OWNER = 'as the guest map’s owner';

export interface Guest {
  made: string;
  expires_at: string;
  /** When signing in kept it: it is then a workspace like any other. */
  saved?: string;
  /** A visitor's click took it (one made ahead and never taken has none): `made` is then that click. */
  clicked?: true;
  /** When its first item was written through its tools: what the 30 seconds are counted to (e_neesnubg). */
  first_item?: string;
}

const KEY = 'guest:';
export const guestKey = (workspace: string) => `${KEY}${workspace}`;
/** A new guest map's id: never one a person would choose. */
export const newGuestId = () => `guest-${randomBytes(6).toString('hex')}`;
export const isGuestId = (id: string) => /^guest-[a-f0-9]{12}$/.test(id);

export const guestOf = (control: Q, workspace: string) => controlValue<Guest>(control, guestKey(workspace));

/** Note a new workspace as a guest map, from now: made ahead, or taken by a visitor's click. */
export async function markGuest(control: Q, workspace: string, now = new Date(), clicked = false): Promise<Guest> {
  const guest: Guest = { made: now.toISOString(), expires_at: new Date(now.getTime() + GUEST_DAYS * DAY).toISOString(), ...(clicked && { clicked: true as const }) };
  await setControlValue(control, guestKey(workspace), guest);
  standingChanged(workspace); // read as none while it opened
  return guest;
}

/** Keep a guest map: signing in saves it, and its limits and its end go. */
export async function keepGuest(control: Q, workspace: string, now = new Date()): Promise<void> {
  const guest = await guestOf(control, workspace);
  if (guest && !guest.saved) await setControlValue(control, guestKey(workspace), { ...guest, saved: now.toISOString() });
  standingChanged(workspace);
}

const LIMITS: Limits = { items: GUEST_ITEMS, members: 1, storage: 20_000_000, requests: 240, sessions: 3, looks: 30, note: 'A guest map is small: sign in to keep it and lift its limits.' };

/** What a guest map may do: its limits, and once its days are up, its end. None once saved, or for any other workspace. */
export function guestStanding(guest: Guest | undefined, now = new Date()): Standing | undefined {
  if (!guest || guest.saved) return undefined;
  const ends = Date.parse(guest.expires_at);
  if (now.getTime() < ends) return { limits: LIMITS, guest: true };
  return { limits: LIMITS, guest: true, ended: { since: guest.expires_at, delete_at: new Date(ends + GUEST_GRACE_DAYS * DAY).toISOString(), note: `A guest map is kept for ${GUEST_DAYS} days unless someone signs in to save it.` } };
}

/** Note a guest map's first item, once: the change that wrote it was made through its tools (packs/surface/kernel/guest-gate.ts). */
export async function noteFirstItem(control: Q, workspace: string, now = new Date()): Promise<void> {
  const guest = await guestOf(control, workspace);
  if (guest?.clicked && !guest.first_item) await setControlValue(control, guestKey(workspace), { ...guest, first_item: now.toISOString() });
}

/**
 * The number to watch (e_neesnubg), counts only: how many guest maps a click took, how many of them reached a first
 * item, and the seconds from the click to it (the median and the slowest tenth). No map and no person is named.
 */
export async function guestCounts(control: Q): Promise<{ made: number; first_item: number; seconds: { median: number; p90: number } | null }> {
  const { rows } = await control.query<{ value: Guest }>(`select value from control_value where key like 'guest:%'`);
  const clicked = rows.map((r) => r.value).filter((g) => g.clicked);
  const took = clicked.filter((g) => g.first_item).map((g) => (Date.parse(g.first_item!) - Date.parse(g.made)) / 1000).sort((a, b) => a - b);
  const at = (share: number) => Math.round(took[Math.min(took.length - 1, Math.floor(share * took.length))] * 10) / 10;
  return { made: clicked.length, first_item: took.length, seconds: took.length ? { median: at(0.5), p90: at(0.9) } : null };
}

/** The guest maps whose day to be deleted has come. */
export async function guestsDue(control: Q, now = new Date()): Promise<string[]> {
  const { rows } = await control.query<{ key: string; value: Guest }>(`select key, value from control_value where key like 'guest:%'`);
  return rows.filter((r) => Date.parse(guestStanding(r.value, now)?.ended?.delete_at ?? '') <= now.getTime()).map((r) => r.key.slice(KEY.length));
}
