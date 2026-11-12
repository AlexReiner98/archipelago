// What a running system reports to the map: a monitor (Uptime Kuma, by its webhook notification) says a part went
// down or came back, a deploy says a part is live at a commit and another stopped on purpose. The items that stand
// for those parts follow. Which items can be reported on, and by which field and statuses, is the type's `watch`
// capability; a part is found by its watched address (or, for a monitor, its name), never by an item id, so a system
// needs to know nothing of the map. A reading is a measurement, not anyone's judgment: it goes through the one write
// path as a change set whose reason is what was reported, applied at once, and only to what the token is within.
// This pack reads the map and says the change (act.report.reading); the surface applies it as the reporter, a reading
// (packs/surface/kernel/report-tool.ts, the report verb's health action).

import type { KernelContext } from '#pelago/kernel';

/** A type's watch capability, as the registry holds it (packs/loader/kernel/capabilities.ts). */
export interface Watch { field: string; up: string; down: string; also?: string[]; idle?: string; commit?: string }
/** An item as the reads API answers it. */
type Item = { id: string; type: string; title: string; status: string; is_open?: boolean; props: Record<string, unknown> };
/** An update the reading makes: a status, and a commit where the type keeps one. */
export type ReadingOp = { op: 'update'; id: string; status?: string; props?: Record<string, unknown> };

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

/** The open items of the types that are watched, as the asker may read them: every page of each. */
async function watched(ctx: KernelContext, types: string[]): Promise<Item[]> {
  const seen = new Map<string, Item>();
  for (const type of types) {
    for (let after: string | undefined, first = true; first || after; first = false) {
      const { rows, next } = (await ctx.reads({ items: { type }, page: { ...(after && { after }) } })) as { rows: Item[]; next?: string };
      for (const e of rows) if (e.is_open !== false) seen.set(e.id, e);
      after = next;
    }
  }
  return [...seen.values()];
}

/**
 * What a reading changes of the items it is about, read as the map that asks: the ops and the reason the change is
 * applied with (by the surface, as the actor that reported it), and what was matched and changed.
 */
export async function readingPlan(ctx: KernelContext, reading: Reading, by: string) {
  const types = ctx.registry.having('watch');
  if (!types.length) return { ops: [] as ReadingOp[], reason: '', matched: [], changed: [] };
  const rows = await watched(ctx, types);
  type Entity = Item;
  const watchOf = (e: Entity) => ctx.registry.type(e.type)!.capabilities.watch as Watch;
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
  const ops = moves.flatMap(({ e, to, commit }): ReadingOp[] => (to || commit ? [{ op: 'update', id: e.id, ...(to && { status: to }), ...(commit && { props: { [watchOf(e).commit!]: commit } }) }] : []));
  const changed = moves.filter((m) => m.to || m.commit);
  return {
    ops,
    reason: ops.length ? `${by}: ${said(reading, moves[0].e.title)}` : '',
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

/** A report as the health action is given it: Kuma's webhook body as it is, or a deploy's reading. */
export type Given = { heartbeat?: Loose; monitor?: Loose; msg?: string; live?: Reading['live']; idle?: string[]; said?: string };

/** The service act.report.reading: what a report says and what it changes, for the surface to apply as the reporter. */
export async function health(ctx: KernelContext, { given, by }: { given: Given; by: string }) {
  // Kuma's "Test" button sends no heartbeat: say it was heard, and change nothing.
  if (!given.heartbeat && !given.live && !given.idle?.length) return { heard: true, note: 'Nothing measured: nothing to report.' };
  const reading: Reading = given.heartbeat ? readKuma(given) : { addresses: [], said: given.said?.trim() ?? '', live: given.live, idle: given.idle };
  return { heard: true, ...(given.heartbeat && { up: reading.up ?? null }), ...(await readingPlan(ctx, reading, by)) };
}
