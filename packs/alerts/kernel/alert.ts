// The owner hears when something breaks: a notification on the map it broke in and, for the server's own map (the
// default workspace), a mail to PELAGO_ALERT_TO as well, so it reaches them away from the page. Said once an hour at
// most for each thing (its key); the server's log has every one. A crash is mailed on the way down, before the
// process exits and is started again.
//
// On the alerts pack's context: the mail goes out through the walls (root.mail, to the operator's address alone, and
// nothing without one), the notification through the notifications pack (act.report.notify). Where a map asks, the
// context is of that map; a crash has none, and is handed a server duty's context (serverContext), which calls root
// services alone. Another internal pack alerts by this pack's name, act.report.alert.

import type { KernelContext } from '#pelago/kernel';

const EVERY_MS = 3_600_000;
const told = new Map<string, number>();

/** Whether the thing under this key was said within the hour; if not, it is now. */
function sayNow(key: string, now = Date.now()): boolean {
  if (now - (told.get(key) ?? 0) < EVERY_MS) return false;
  told.set(key, now);
  return true;
}

/** Forget what was said, for tests. */
export const resetAlerts = () => told.clear();

/** Mail the owner, if the server has an address for them. Never throws: a failure to tell is written to the log. */
export async function mailOwner(ctx: Pick<KernelContext, 'call'>, subject: string, text: string): Promise<boolean> {
  try {
    return (await ctx.call<{ subject: string; text: string }, { sent: boolean }>('root.mail', { subject: `Archipelago: ${subject}`, text })).sent;
  } catch (err) {
    console.error(`alert: mailing "${subject}" failed: ${(err as Error).message}`);
    return false;
  }
}

export interface Alert {
  /** What it is, for once an hour at most: the same key is said again only after an hour. */
  key: string;
  title: string;
  body: string;
  level?: 'warning' | 'urgent';
  /** Who says it, on the map: a pack, the scheduler. */
  from: string;
  about?: string;
}

/** Tell the owner of the context's map that something broke: on its map, and by mail when it is the server's own. */
export async function alertOwner(ctx: KernelContext, alert: Alert): Promise<void> {
  console.error(`alert: ${alert.title}`);
  if (!sayNow(`${ctx.workspace}/${alert.key}`)) return;
  const body = `${alert.body}\n\nSaid once an hour at most; the server's log has each one.`;
  const notice = { actor: { kind: 'agent', name: alert.from }, title: alert.title, body, level: alert.level ?? 'urgent', ...(alert.about !== undefined && { about: alert.about }) };
  await Promise.all([
    ctx.workspace === 'default' ? mailOwner(ctx, alert.title, body) : undefined,
    ctx.call('act.report.notify', notice).catch((err) => console.error(`alert: telling the map failed: ${(err as Error).message}`)),
  ]);
}

/** act.report.alert: an alert another internal pack raises, on the map its context is of. */
export const alertAct = (ctx: KernelContext, alert: Alert) => alertOwner(ctx, alert);

/**
 * On a crash, the owner is mailed what it was before the process exits (at most ten seconds later). The context is
 * asked for only then: a server duty's, which has no map and mails through the walls.
 */
export function alertOnCrash(ctx: () => Promise<Pick<KernelContext, 'call'>>, where: string): void {
  let crashing = false;
  const crash = (kind: string) => (err: unknown) => {
    console.error(`${kind}:`, err);
    if (crashing) return;
    crashing = true;
    const said = err instanceof Error ? err.stack ?? err.message : String(err);
    const out = setTimeout(() => process.exit(1), 10_000);
    const text = `${kind}, at ${new Date().toISOString()}:\n\n${said.slice(0, 4000)}\n\nIt exits now and is started again by whatever runs it.`;
    void ctx()
      .then((c) => mailOwner(c, `the server on ${where} crashed`, text), (e: Error) => console.error(`alert: mailing the crash failed: ${e.message}`))
      .finally(() => {
        clearTimeout(out);
        process.exit(1);
      });
  };
  process.on('uncaughtException', crash('uncaught exception'));
  process.on('unhandledRejection', crash('unhandled rejection'));
}

/** The crash mail the surface's server asks for at its start (surface.crash, packs/surface/kernel/above.ts): its server duty's context, made then. */
export const crashMailed = (ctx: Pick<KernelContext, 'call'>, where: string) => alertOnCrash(async () => ctx, where);
