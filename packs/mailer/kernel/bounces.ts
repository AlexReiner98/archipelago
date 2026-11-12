// Addresses that bounced: mail to them failed for good, so none is sent to them for a while. Mailing a dead address
// again and again is a mark of a spammer to the receiving servers, and it costs the mail everyone else is sent.
//
// The relay that sends our mail is where a failure comes back to, as a delivery status notification (RFC 3464) to
// the sender's address. It hands each one to this server (POST /connect/bounce, with PELAGO_BOUNCE_SECRET as its
// bearer), which reads the addresses that failed for good (Action: failed, a 5.x.x status) and keeps them in the
// server's transient store (root.transient, packs/surface) for BOUNCED_DAYS: the default workspace's. A delay, or a failure that may pass, is not kept.

import { timingSafeEqual } from 'node:crypto';
import type { KernelContext } from '#pelago/kernel';
import { normalEmail } from './mail.ts';
import { keep, kept } from './store.ts';

/** A setting from the environment, PELAGO_ and the name (as src/env.ts reads one). */
const env = (name: string): string | undefined => process.env[`PELAGO_${name}`];

export const BOUNCED_DAYS = 90;
const KEY = 'bounced:';

/**
 * The addresses a delivery status notification says failed for good. Each recipient's fields stand in a block of
 * their own, apart from the next by an empty line; Final-Recipient names it, Action and Status say what became of it.
 */
export function failedFor(dsn: string): string[] {
  const blocks = dsn.replace(/\r\n/g, '\n').split(/\n\s*\n/);
  const out = new Set<string>();
  for (const block of blocks) {
    const field = (name: string) => new RegExp(`^${name}:\\s*(.+)$`, 'im').exec(block)?.[1]?.trim();
    const recipient = field('Final-Recipient') ?? field('Original-Recipient');
    if (!recipient || !/^failed$/i.test(field('Action') ?? '') || !/^5\.\d{1,3}\.\d{1,3}/.test(field('Status') ?? '')) continue;
    const email = normalEmail(recipient.replace(/^rfc822\s*;\s*/i, '').replace(/^<|>$/g, ''));
    if (email) out.add(email);
  }
  return [...out];
}

/** Keep each address as bounced, for BOUNCED_DAYS from now, in the store of the map the context is of. */
export async function noteBounced(ctx: KernelContext, emails: string[]): Promise<void> {
  for (const email of emails) await keep(ctx, KEY + email, { at: new Date().toISOString() }, BOUNCED_DAYS * 86_400_000);
}

/** Whether mail to this address bounced lately, so is not sent. */
export const hasBounced = async (ctx: KernelContext, email: string) => (await kept(ctx, KEY + email)) !== undefined;

/** Whether a request carries the relay's secret: none is taken where the server has none set. */
export function fromRelay(authorization: string | undefined): boolean {
  const secret = env('BOUNCE_SECRET');
  const given = /^Bearer\s+(.+)$/i.exec(authorization ?? '')?.[1] ?? '';
  if (!secret || given.length !== secret.length) return false;
  return timingSafeEqual(Buffer.from(given), Buffer.from(secret));
}
