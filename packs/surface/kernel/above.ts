// What the server asks of the packs above the surface (docs/kernel-packs.md, "Slots": surface.serve): the surface's
// server never imports a service pack's code. A pack names a function of its modules under `kernel.hooks`, by the
// point it fills, and the server asks for that point here:
//
// - on a map (`onMap`): a filling handed the pack's context of that map, as it asks (a person's view under row-level
//   security when it is one), then what the server gives it: an icon, a page's look, a preview, a public product's
//   page. A map whose packs fill it once is answered; none, or two, is refused by name.
// - for the server (`onServer`): a filling handed a server duty's context (serverContext, no map), from the internal
//   packs in the server's own folder, as loader's server slots are: what the server holds for the whole process (the
//   counts kept in memory, the streams a page listens on, the crash mail, the backups). It answers what the server
//   uses, values and functions; with the server's workspaces when it is a duty that walks them.
//
// Every point is filled by one pack: a name filled twice is refused, naming both.

import { readdirSync } from 'node:fs';
import type { ServerResponse } from 'node:http';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { hostAt, serverContext } from '../../loader/kernel/kernel-context.ts';
import { isInternal, type Manifest } from '../../loader/kernel/manifest.ts';
import { OWN_PACKS } from '../../loader/kernel/pack-folders.ts';
import { ownManifest, type RootCall } from '../../loader/kernel/root-calls.ts';
import { workingRules } from '../../loader/kernel/working-rules.ts';
import type { Archipelago } from '../../write/kernel/pelago.ts';

/** The server's workspaces, as a duty that walks them is handed them. */
export type Walked = NonNullable<RootCall['workspaces']>;

/** The one filling of a point on a map, handed that pack's context of the map; refused when none or two fill it. */
export async function onMap<T = unknown>(l: Archipelago, point: string, ...args: unknown[]): Promise<T> {
  const found = await hostAt(l).fillings(l, point);
  if (found.length > 1) throw new Error(`${point} is filled by ${found.map((f) => `the ${f.pack} pack`).join(' and ')}: one name, one owner`);
  if (!found.length) throw new Error(`Nothing here fills ${point}: the pack that does it is not running.`);
  return (await found[0].run(...args)) as T;
}

/** A duty with no workspaces to walk: a crash, a pack's counts, a page's stream. */
const none = async (): Promise<never> => { throw new Error('this server duty walks no workspace'); };
const NO_WORKSPACES: Walked = { get: none, isOpen: () => false, hold: () => () => undefined, closeIfUnused: none, list: async () => [] } as never;

type Filling = (ctx: ReturnType<typeof serverContext>, ...args: unknown[]) => unknown;
const loaded = new Map<string, Promise<{ pack: string; f: Filling }>>();

/** The internal service packs of the server's own folder, as their manifests say. */
const ownPacks = (home: string) => readdirSync(home).sort().flatMap((id) => {
  const m = ownManifest(id, join(home, '..')) as Manifest | undefined;
  return m && isInternal(m) && m.kernel?.trust === 'service' ? [m] : [];
});

/** The one filling of a server point, from the packs of the server's own folder: loaded once. */
function serverFilling(point: string, home = OWN_PACKS): Promise<{ pack: string; f: Filling }> {
  if (!loaded.has(point)) loaded.set(point, (async () => {
    const by = ownPacks(home).filter((m) => m.kernel?.hooks?.[point] !== undefined);
    if (by.length > 1) throw new Error(`${point} is filled by ${by.map((m) => `the ${m.id} pack`).join(' and ')}: one name, one owner`);
    const pack = by[0];
    if (!pack) throw new Error(`Nothing on this server fills ${point}: the pack that does it is not here.`);
    const ref = [pack.kernel!.hooks![point]].flat()[0];
    const [file, name] = ref.split('#');
    if (!file || file.includes('..')) throw new Error(`The ${pack.id} pack fills ${point} with ${ref}, outside its modules`);
    const f = ((await import(pathToFileURL(resolve(home, pack.id, pack.kernel?.modules ?? 'kernel/', file)).href)) as Record<string, unknown>)[name];
    if (typeof f !== 'function') throw new Error(`The ${pack.id} pack fills ${point} with ${ref}, which is no function of its modules`);
    return { pack: pack.id, f: f as Filling };
  })());
  return loaded.get(point)!;
}

/** The one filling of a server point, handed a server duty's context: of the server's workspaces when given, else of none. */
export async function onServer<T = unknown>(point: string, workspaces?: Walked, ...args: unknown[]): Promise<T> {
  const { pack, f } = await serverFilling(point);
  return (await f(serverContext(pack, workspaces ?? NO_WORKSPACES), ...args)) as T;
}

/** What the server holds of what was published (surface.published): streams, a reader's page data, a pack's counts, the sites. */
export interface Published {
  listenForPack(res: ServerResponse, pack: string, workspace: string, id: string, headers: Record<string, string>, from?: string): void;
  closePackListeners(pack: string): void;
  pageData(doc: { title: string; parts: unknown[] } & Record<string, unknown>, here: string): unknown;
  layoutCode(doc: { title: string; parts: unknown[] } & Record<string, unknown>, hash: string): unknown;
  counts: {
    addCount(workspace: string, stream: string, key: string, day?: string, n?: number): void;
    heldCounts(workspace: string, stream: string): { key: string; day: string; n: number }[];
    keepCounts(open: (workspace: string) => Promise<never>, everyMs?: number): () => Promise<void>;
    KEY: RegExp;
  };
  readSites(text: string | undefined): Record<string, string>;
}
export const published = () => onServer<Published>('surface.published');

/** What the server holds of mail (surface.mail): an address as it reads one, the mail a pack sends, the relay's bounces. */
export interface Mailing {
  email(given: unknown): string | undefined;
  sendMail(mail: { to: string; subject: string; text: string; unsubscribe?: string }): Promise<void>;
  setBounced(check: ((email: string) => Promise<boolean>) | undefined): void;
  bounces: { fromRelay(authorization: string | undefined): boolean; failedFor(dsn: string): string[]; days: number };
}
export const mailing = () => onServer<Mailing>('surface.mail');

/**
 * What the open routes answer with that is above the surface (./connect-routes.ts): the mailer pack's, the styles
 * pack's and the connect pack's, each asked of the pack that fills it, on the map it is about.
 */
export async function openRoutes() {
  const [mail, connect] = await Promise.all([mailing(), onServer<{ installed(path: string, origin: string, rules: () => string): { type: string; text: string } | undefined }>('surface.connect')]);
  type Answer = { status: number; body: unknown };
  return {
    email: mail.email,
    pageStyle: (l: Archipelago) => onMap<{ style: { theme?: unknown; lengths?: unknown } }>(l, 'surface.page_style', {}, false),
    bounces: { ...mail.bounces, noteBounced: (l: Archipelago, emails: string[]) => onMap(l, 'surface.note_bounced', emails) },
    connect: {
      installed: (path: string, origin: string) => connect.installed(path, origin, workingRules),
      asked: (l: Archipelago, body: unknown, origin: string, workspace: string) => onMap<Answer>(l, 'surface.token_asked', body, origin, workspace),
      polled: (l: Archipelago, workspace: string, id: string, secret: string) => onMap<Answer>(l, 'surface.token_polled', workspace, id, secret),
    },
  };
}

/** The backups the server runs while it leads, as the backup pack fills them (surface.backup). */
export type Backups = { duty(plan: unknown): () => void; all(dir: string, keep: number, upload?: unknown): Promise<unknown> };
/** A server duty a pack runs, started once its pack is loaded, and stopped by what this answers. */
export function dutyOf(start: () => Promise<() => void>): () => void {
  let stop: (() => void) | undefined, stopped = false;
  void start().then((s) => (stopped ? s() : (stop = s)), (err: Error) => console.error(`a server duty did not start: ${err.message}`));
  return () => { stopped = true; stop?.(); };
}

