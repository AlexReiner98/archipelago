// What a running system reports to the map: a monitor (Uptime Kuma, by its webhook notification) says a part went
// down or came back, a deploy says a part is live at a commit and another stopped on purpose. The items that stand
// for those parts follow. Which items can be reported on, and by which field and statuses, is the type's `watch`
// capability; a part is found by its watched address (or, for a monitor, its name), never by an item id, so a system
// needs to know nothing of the map. A reading is a measurement, not anyone's judgment: it goes through the one write
// path as a change set whose reason is what was reported, applied at once, and only to what the token is within.

import { z } from 'zod';
import type { Watch } from './capabilities.ts';
import type { Actor, Archipelago, Entity, Op } from './pelago.ts';
import type { Tool } from './tools.ts';

/** What was reported about some parts: each by its addresses, and what it is now. */
export interface Reading {
  /** A monitor's check: up, down, or nothing to act on (pending, maintenance). */
  up?: boolean;
  /** The addresses the check is of, as an item's field would hold them. */
  addresses: string[];
  /** The monitor's own name for it, matched to a title when no address is. */
  name?: string;
  said: string;
  /** A deploy's word: the part at this address is live at this commit. */
  live?: { at: string; commit: string };
  /** A deploy's word: the parts at these addresses were stopped on purpose. */
  idle?: string[];
}

type Loose = Record<string, unknown> | null | undefined;

/** An address as compared: no trailing slash, scheme and host in lower case. */
export function sameAddress(a: string): string {
  const s = a.trim().replace(/\/+$/, '');
  const m = /^([a-z][a-z0-9+.-]*:\/\/[^/?#]*)(.*)$/i.exec(s);
  return m ? m[1].toLowerCase() + m[2] : s;
}

/** Uptime Kuma's webhook body read as a reading. Its heartbeat status is 0 down, 1 up, 2 pending, 3 maintenance. */
export function readKuma(input: { heartbeat?: Loose; monitor?: Loose; msg?: string }): Reading {
  const beat = input.heartbeat ?? {};
  const mon = input.monitor ?? {};
  const status = beat.status;
  const text = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : undefined);
  const addresses: string[] = [];
  const url = text(mon.url);
  // Kuma leaves "https://" in url on monitors that are not of an address.
  if (url && url !== 'https://' && url !== 'http://') addresses.push(url);
  const host = text(mon.hostname);
  if (host && mon.port) addresses.push(`tcp://${host}:${mon.port}`);
  if (host && mon.type === 'ping') addresses.push(`ping://${host}`);
  const container = text(mon.docker_container);
  if (container) addresses.push(`docker://${container}`);
  return {
    up: status === 1 ? true : status === 0 ? false : undefined,
    addresses: addresses.map(sameAddress),
    name: text(mon.name),
    said: text(beat.msg) ?? text(input.msg) ?? '',
  };
}

/** The status a watched item moves to on a monitor's check, or undefined to leave it. */
export function nextStatus(watch: Watch, status: string, up: boolean | undefined): string | undefined {
  if (up === true && status === watch.down) return watch.up;
  if (up === false && [watch.up, ...(watch.also ?? [])].includes(status)) return watch.down;
  return undefined;
}

/** Apply a reading to the items it is about, through the write path, as the actor that reported it. */
export async function applyReading(l: Archipelago, actor: Actor, reading: Reading, by: string) {
  const types = l.registry.having('watch');
  if (!types.length) return { matched: [], changed: [] };
  const { rows } = await l.db.query<Entity>(`select * from entity where type = any($1::text[]) and archived_at is null and is_open`, [types]);
  const watchOf = (e: Entity) => l.registry.type(e.type)!.capabilities.watch!;
  const at = (e: Entity) => (typeof e.props[watchOf(e).field] === 'string' ? sameAddress(e.props[watchOf(e).field] as string) : undefined);
  const named = (addresses: string[]) => rows.filter((e) => addresses.map(sameAddress).includes(at(e) ?? '\0'));
  const moves: { e: Entity; to?: string; commit?: string }[] = [];
  // A monitor's check: by address, else by the monitor's name.
  let checked = named(reading.addresses);
  if (!checked.length && reading.name) checked = rows.filter((e) => e.title.trim().toLowerCase() === reading.name!.toLowerCase());
  for (const e of checked) moves.push({ e, to: nextStatus(watchOf(e), e.status, reading.up) });
  // A deploy's word: what is live is up and runs that commit; what was stopped rests where monitors leave it alone.
  const live = reading.live ? named([reading.live.at]) : [];
  for (const e of live) moves.push({ e, to: e.status === watchOf(e).up ? undefined : watchOf(e).up, commit: watchOf(e).commit && e.props[watchOf(e).commit!] !== reading.live!.commit ? reading.live!.commit : undefined });
  const idle = named(reading.idle ?? []);
  for (const e of idle) moves.push({ e, to: watchOf(e).idle && e.status !== watchOf(e).idle ? watchOf(e).idle : undefined });
  const ops = moves.flatMap(({ e, to, commit }): Op[] => (to || commit ? [{ op: 'update', id: e.id, ...(to && { status: to }), ...(commit && { props: { [watchOf(e).commit!]: commit } }) }] : []));
  if (ops.length) await l.change(actor, { ops, reason: `${by}: ${said(reading, moves[0].e.title)}`, authority: { of: 'agent', basis: `Reported by ${by}` } }, true);
  const changed = moves.filter((m) => m.to || m.commit);
  return {
    matched: [...checked, ...live, ...idle].map((e) => ({ id: e.id, title: e.title, status: changed.find((m) => m.e.id === e.id)?.to ?? e.status })),
    changed: changed.map(({ e, to, commit }) => ({ id: e.id, title: e.title, from: e.status, to: to ?? e.status, ...(commit && { commit }) })),
  };
}

/** The reason a reading is logged with: what was reported, in a line. */
function said(reading: Reading, first: string): string {
  const words = reading.said ? ` (${reading.said.slice(0, 200)})` : '';
  if (reading.live) return `${reading.live.at} is live at ${reading.live.commit.slice(0, 7)}${reading.idle?.length ? `, ${reading.idle.join(', ')} stopped` : ''}${words}`;
  if (reading.idle?.length) return `${reading.idle.join(', ')} stopped${words}`;
  return `${reading.name ?? first} ${reading.up ? 'answers again' : 'does not answer'}${words}`;
}

const loose = z.looseObject({}).nullable().optional();

/** The report tool's input: Kuma's webhook body as it is, or a deploy's reading. */
const REPORT_INPUT = {
  heartbeat: loose.describe('A monitor’s check, as Uptime Kuma’s webhook sends it: status 0 down, 1 up, 2 pending, 3 maintenance; msg what it saw.'),
  monitor: loose.describe('Kuma’s monitor: name, url, hostname, port, type, docker_container.'),
  msg: z.string().optional(),
  live: z.object({ at: z.string().min(1), commit: z.string().regex(/^[0-9a-f]{7,40}$/) }).optional().describe('A deploy: the part watched at this address is live at this commit.'),
  idle: z.array(z.string().min(1)).optional().describe('A deploy: the parts watched at these addresses were stopped on purpose.'),
  said: z.string().optional().describe('What the system said about it, in a line.'),
};

export const REPORT_TOOLS: Record<string, Tool> = {
  report: {
    description:
      'A running system reports what it measured, and the parts of the map that stand for it follow, at once: the token may be one that can only report. ' +
      'Uptime Kuma’s webhook notification posts its body here as it is (POST /agent/report, the token in an Authorization: Bearer header): the item whose watched address (a component’s url) is the monitor’s address, else whose title is its name, goes down when the check fails and up when it answers again; one still being built (planned, wiring) is left alone. ' +
      'A deploy sends live (the address of the part now live, and its commit) and idle (the addresses of the parts it stopped). Parts are found by their address, never by an id; the change set’s reason is what was reported.',
    report: true,
    input: REPORT_INPUT,
    run: async (l, actor, input) => {
      const given = input as { heartbeat?: Loose; monitor?: Loose; msg?: string; live?: Reading['live']; idle?: string[]; said?: string };
      // Kuma's "Test" button sends no heartbeat: say it was heard, and change nothing.
      if (!given.heartbeat && !given.live && !given.idle?.length) return { heard: true, note: 'Nothing measured: nothing to report.' };
      const reading: Reading = given.heartbeat ? readKuma(given) : { addresses: [], said: given.said?.trim() ?? '', live: given.live, idle: given.idle };
      return { heard: true, ...(given.heartbeat && { up: reading.up ?? null }), ...(await applyReading(l, actor, reading, actor.name)) };
    },
  },
};

/** Names a tool had before it was folded into another: Kuma's webhook still posts to health_report until it is moved. */
export const FORMER_NAMES: Record<string, string> = { health_report: 'report' };
