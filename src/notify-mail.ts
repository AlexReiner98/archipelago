// A notification mailed to the person it is for. The kernel tells the packs that hear notification.made that one was
// made (src/notify.ts), and a pack that hears it may answer with one mail about it: its subject and text are the
// pack's, and nothing else is. Where it goes is the kernel's to say: the person the notification is for (the one it is
// private to, else the workspace's owner), at the address they sign in with, which the sign-in proved is theirs. So a
// pack can mail no one but that person, about nothing but that notification, once; whether it does (the person turned
// mail on, it is not their quiet hours) is the pack's to decide.

import { normalEmail, sendMail } from './mail.ts';
import { itemLink } from './members.ts';
import { wholeMap } from './outbox.ts';
import type { Archipelago } from './pelago.ts';

/** The event the kernel tells packs when a notification is made. */
export const NOTIFICATION_MADE = 'notification.made';

/** A mail a pack asks for, in answer to hearing a notification made. */
export interface NotificationMail {
  notification: string;
  subject: string;
  text: string;
}

/** The most of a subject and of a text the kernel sends. */
const SUBJECT_MOST = 200;
const TEXT_MOST = 20_000;

/** The event a pack heard, when it was the kernel's telling of a notification made; else undefined. */
const heardOf = (input: unknown): { target: string } | undefined => {
  const e = (input as { event?: { action?: unknown; pack?: unknown; target?: unknown } } | null)?.event;
  return e?.action === NOTIFICATION_MADE && e.pack === 'kernel' && typeof e.target === 'string' ? { target: e.target } : undefined;
};

/** The workspace's owner, as a person: the one its views are for (the setting me), else its first admin member. Of the whole map. */
export async function ownerOf(whole: Archipelago): Promise<string | undefined> {
  const me = await whole.setting<string>('me');
  if (me) return me;
  const { rows } = await whole.db.query<{ person_id: string }>(`select person_id from member where admin and removed_at is null order by added_at limit 1`);
  return rows[0]?.person_id;
}

/** The person a notification is for: the one it is private to, else the workspace's owner. */
export async function personFor(whole: Archipelago, notification: string): Promise<string | undefined> {
  const { rows } = await whole.db.query<{ private_to: string | null }>(`select private_to from entity where id = $1`, [notification]);
  if (!rows.length) return undefined;
  return rows[0].private_to || (await ownerOf(whole));
}

/** What a notification is about (its about link), if it is about something still on the map. */
export async function subjectOf(whole: Archipelago, notification: string): Promise<string | undefined> {
  const { rows } = await whole.db.query<{ to_id: string }>(
    `select r.to_id from relation r join entity e on e.id = r.to_id where r.from_id = $1 and r.type = any($2::text[]) and r.valid_to is null and e.archived_at is null order by r.id limit 1`,
    [notification, whole.registry.relationFamily('about')],
  );
  return rows[0]?.to_id;
}

/** The address a notification's person signs in with, if they are a member who does. */
export async function addressFor(l: Archipelago, notification: string): Promise<string | undefined> {
  const whole = await wholeMap(l);
  const person = await personFor(whole, notification);
  if (!person) return undefined;
  const { rows } = await whole.db.query<{ email: string }>(`select email from member where person_id = $1 and removed_at is null order by added_at limit 1`, [person]);
  return normalEmail(rows[0]?.email);
}

/**
 * Send what a pack asked to mail, having heard `input`: refused whole unless it heard a notification made and asks for
 * one mail about that notification. Answers whether it was sent; a person with no address to send to is sent nothing.
 */
export async function mailHeard(l: Archipelago, pack: string, input: unknown, asked: NotificationMail[]): Promise<{ sent: boolean; why?: string }> {
  const heard = heardOf(input);
  if (!heard) throw new Error(`The ${pack} pack asks to mail: a pack mails only on hearing a notification made (${NOTIFICATION_MADE}).`);
  if (asked.length !== 1 || asked[0].notification !== heard.target) throw new Error(`The ${pack} pack mails once, about the notification it heard (${heard.target}).`);
  const subject = String(asked[0].subject ?? '').replace(/\s+/g, ' ').trim().slice(0, SUBJECT_MOST);
  const text = String(asked[0].text ?? '').slice(0, TEXT_MOST);
  if (!subject) throw new Error(`The ${pack} pack's mail has no subject.`);
  const to = await addressFor(l, heard.target);
  if (!to) return { sent: false, why: 'the person it is for signs in with no address' };
  // The link is to what the notification is about, where there is something to do, else to the notification.
  const link = itemLink(l.workspace).replace('{id}', (await subjectOf(await wholeMap(l), heard.target)) ?? heard.target);
  await sendMail({ to, subject, text: `${text.replace(/\n+$/, '')}\n\n${link}\n` });
  console.log(`${pack}: mailed notification ${heard.target}`);
  return { sent: true };
}
