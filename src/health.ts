// Health reported from outside: a monitor (Uptime Kuma, by its webhook notification) says a part of a running system
// went down or came back, and the item that stands for it follows. Which items can be watched, and by which field and
// statuses, is the type's `watch` capability. The status moves through the one write path, as a change set whose
// reason is what the monitor said: a measurement, not anyone's judgment, so it is applied, not held.

import { z } from 'zod';
import type { Watch } from './capabilities.ts';
import { actorId, type Actor, type Archipelago, type Entity } from './pelago.ts';
import type { Tool } from './tools.ts';

/** What a monitor said about one check: up, down, or nothing to act on (pending, maintenance, a test). */
export interface Reading {
  up?: boolean;
  /** The addresses the check is of, as an item's field would hold them. */
  addresses: string[];
  /** The monitor's own name for it, matched to a title when no address is. */
  name?: string;
  said: string;
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

/** The status a watched item moves to on a reading, or undefined to leave it. */
export function nextStatus(watch: Watch, status: string, up: boolean | undefined): string | undefined {
  if (up === true && status === watch.down) return watch.up;
  if (up === false && [watch.up, ...(watch.also ?? [])].includes(status)) return watch.down;
  return undefined;
}

/** Apply a reading to the items it is about: those whose watched address it names, else whose title is its name. */
export async function reportHealth(l: Archipelago, actor: Actor, reading: Reading, by: string) {
  const types = l.registry.having('watch');
  if (!types.length) return { matched: [], changed: [] };
  const { rows } = await l.db.query<Entity>(`select * from entity where type = any($1::text[]) and archived_at is null and is_open`, [types]);
  const watchOf = (e: Entity) => l.registry.type(e.type)!.capabilities.watch!;
  const at = (e: Entity) => (typeof e.props[watchOf(e).field] === 'string' ? sameAddress(e.props[watchOf(e).field] as string) : undefined);
  let matched = rows.filter((e) => reading.addresses.includes(at(e) ?? '\0'));
  if (!matched.length && reading.name) matched = rows.filter((e) => e.title.trim().toLowerCase() === reading.name!.toLowerCase());
  const moves = matched.flatMap((e) => {
    const to = nextStatus(watchOf(e), e.status, reading.up);
    return to ? [{ e, to }] : [];
  });
  if (moves.length) {
    const what = reading.up ? 'answers again' : 'does not answer';
    const reason = `${by}: ${reading.name ?? at(moves[0].e) ?? moves[0].e.title} ${what}${reading.said ? ` (${reading.said.slice(0, 200)})` : ''}`;
    await l.apply(actorId(actor), { ops: moves.map(({ e, to }) => ({ op: 'update' as const, id: e.id, status: to })), reason }, { authority: { of: 'agent', who: actorId(actor), basis: `Reported by ${by}` } });
  }
  return {
    matched: matched.map((e) => ({ id: e.id, title: e.title, status: moves.find((m) => m.e.id === e.id)?.to ?? e.status })),
    changed: moves.map(({ e, to }) => ({ id: e.id, title: e.title, from: e.status, to })),
  };
}

const loose = z.looseObject({}).nullable().optional();

export const HEALTH_TOOLS: Record<string, Tool> = {
  health_report: {
    description:
      'A monitor reports a check: Uptime Kuma’s webhook notification posts its body here as it is (POST /agent/health_report, the token in an Authorization: Bearer header). ' +
      'The item whose watched address (a component’s url) is the monitor’s address, else whose title is the monitor’s name, goes down when the check fails and up when it answers again; ' +
      'the change set’s reason is what the monitor said. An item still being built (planned, wiring) is left alone.',
    input: {
      heartbeat: loose.describe('Kuma’s heartbeat: status 0 down, 1 up, 2 pending, 3 maintenance; msg what it saw.'),
      monitor: loose.describe('Kuma’s monitor: name, url, hostname, port, type, docker_container.'),
      msg: z.string().optional(),
    },
    run: async (l, actor, input) => {
      const reading = readKuma(input as { heartbeat?: Loose; monitor?: Loose; msg?: string });
      // Kuma's "Test" button sends no heartbeat: say it was heard, and change nothing.
      if (!input.heartbeat) return { heard: true, note: 'No heartbeat: nothing to report.' };
      return { heard: true, up: reading.up ?? null, ...(await reportHealth(l, actor, reading, actor.name)) };
    },
  },
};
