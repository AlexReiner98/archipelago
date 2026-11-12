// The owner hears when something breaks: a notification on the map it broke in and, for the server's own map (the
// default workspace), a mail to PELAGO_ALERT_TO as well, so it reaches them away from the page. Said once an hour at
// most for each thing (its key); the server's log has every one. A crash is mailed on the way down, before the
// process exits and is started again.
//
// Settings, from the environment:
//   PELAGO_ALERT_TO   who is mailed. Without it (or without PELAGO_MAIL_FROM, src/mail.ts), only the map is told.

import { env } from '../../../src/env.ts';
import { normalEmail, sendMail } from '../../../src/mail.ts';
import { notify } from '../../../src/notify.ts';
import type { Archipelago } from '../../../src/pelago.ts';

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

/** Where alerts are mailed, when the server has an address for them. */
export const alertTo = () => normalEmail(env('ALERT_TO'));

/** Mail the owner, if the server has an address for them. Never throws: a failure to tell is written to the log. */
export async function mailOwner(subject: string, text: string): Promise<boolean> {
  const to = alertTo();
  if (!to) return false;
  try {
    await sendMail({ to, subject: `Archipelago: ${subject}`, text });
    return true;
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

/** Tell the owner of `l` that something broke: on its map, and by mail when it is the server's own. */
export async function alertOwner(l: Archipelago, alert: Alert): Promise<void> {
  console.error(`alert: ${alert.title}`);
  if (!sayNow(`${l.workspace}/${alert.key}`)) return;
  const body = `${alert.body}\n\nSaid once an hour at most; the server's log has each one.`;
  await Promise.all([
    l.workspace === 'default' ? mailOwner(alert.title, body) : undefined,
    notify(l, { kind: 'agent', name: alert.from }, { title: alert.title, body, level: alert.level ?? 'urgent', about: alert.about }).catch((err) => console.error(`alert: telling the map failed: ${(err as Error).message}`)),
  ]);
}

/** On a crash, the owner is mailed what it was before the process exits (at most ten seconds later). */
export function alertOnCrash(where: string): void {
  let crashing = false;
  const crash = (kind: string) => (err: unknown) => {
    console.error(`${kind}:`, err);
    if (crashing) return;
    crashing = true;
    const said = err instanceof Error ? err.stack ?? err.message : String(err);
    const out = setTimeout(() => process.exit(1), 10_000);
    void mailOwner(`the server on ${where} crashed`, `${kind}, at ${new Date().toISOString()}:\n\n${said.slice(0, 4000)}\n\nIt exits now and is started again by whatever runs it.`).finally(() => {
      clearTimeout(out);
      process.exit(1);
    });
  };
  process.on('uncaughtException', crash('uncaught exception'));
  process.on('unhandledRejection', crash('unhandled rejection'));
}
