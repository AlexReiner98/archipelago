// Members: the people who sign in to a workspace, each by an email address. An admin adds someone by their address;
// they are sent an invitation, and from then on sign in by asking for a link at that address (POST /connect/sign-in).
// The link (or the code beside it, typed: POST /connect/code) works once, for half an hour; opened, the page trades
// its code (POST /connect/join) for a token that keeps
// that browser signed in for a month. Whether a member is an admin is kept here, on the member, so every sign-in gets
// it; removing a member ends their sign-ins at once. The table is read only through the whole database: no member's
// role is granted it.

import { createHash, randomBytes, randomInt } from 'node:crypto';
import { z } from 'zod';
import { createToken } from './auth.ts';
import { controlValue, setControlValue, takeControlValue } from './control.ts';
import { stillWritable } from './ended.ts';
import type { Q } from './db.ts';
import { normalEmail, sendMail } from './mail.ts';
import { wholeMap } from './outbox.ts';
import { actorId, type Actor, type Archipelago } from './pelago.ts';
import type { Tool } from './tools.ts';
import { keep, kept, take } from './transient.ts';

/** How long a sign-in lasts in a browser, how long a sign-in link works, and how long an invitation does. */
export const SIGNED_IN_DAYS = 30;
export const LINK_MINUTES = 30;
export const INVITE_DAYS = 7;

export interface Member {
  email: string;
  person_id: string;
  admin: boolean;
  added_at: string;
}

/** The most members a workspace may have, and what to say to the admin who would add one more (how to make room). */
export interface MemberLimit {
  members: number;
  note?: string;
  /** What the workspace is on, as the pack that set the limit names it ("Solo"), and where its admin manages that. */
  plan?: string;
  manage?: string;
}

let site = { origin: 'http://127.0.0.1:3100', nameOf: async (id: string) => id, limitOf: async (_id: string): Promise<MemberLimit | undefined> => undefined };
/** Where the links in the mail lead, a workspace's name to put in it, and its member limit: the server says, when it starts. */
export function configureMembers(given: Omit<typeof site, 'limitOf'> & Partial<Pick<typeof site, 'limitOf'>>) {
  site = { ...site, ...given };
}

/**
 * A workspace's member limit is the server's, not its map's: a server pack sets it on a workspace it made (a plan with
 * room for so many), in the control values of the default workspace's database, where no workspace admin can reach.
 */
const limitKey = (workspace: string) => `member_limit:${workspace}`;
/** A workspace's member limit, as the server says it. */
export const limitOf = (workspace: string) => site.limitOf(workspace);
export const memberLimit = (control: Q, workspace: string) => controlValue<MemberLimit>(control, limitKey(workspace));
export async function setMemberLimit(control: Q, workspace: string, limit: MemberLimit | null): Promise<void> {
  if (limit) await setControlValue(control, limitKey(workspace), limit);
  else await takeControlValue(control, limitKey(workspace));
}

/** Refuse one more member past the limit, saying how to make room. Those already in stay when a limit is lowered. */
async function roomForOneMore(db: Q, workspace: string, added = 0): Promise<void> {
  const limit = await site.limitOf(workspace);
  if (!limit) return;
  const { rows } = await db.query<{ n: number }>(`select count(*)::int as n from member where removed_at is null`);
  if (rows[0].n - added < limit.members) return;
  const name = await site.nameOf(workspace);
  if (added) rows[0].n -= added;
  throw new Error(`${name} has room for ${limit.members} member${limit.members === 1 ? '' : 's'}${rows[0].n > limit.members ? ` and has ${rows[0].n}` : ''}.${limit.note ? ` ${limit.note}` : ''}`);
}

export async function memberOf(db: Q, email: string): Promise<Member | undefined> {
  const { rows } = await db.query<Member>(`select email, person_id, admin, added_at from member where email = $1 and removed_at is null`, [email]);
  return rows[0];
}

/**
 * Add someone to a workspace by their address, with no mail: a server pack's act (src/server-acts.ts). The first member
 * of a workspace is its owner, the person its views are for.
 */
export async function admitMember(whole: Archipelago, email: string, admin: boolean): Promise<string> {
  const first = !(await whole.db.query(`select 1 from member where removed_at is null limit 1`)).rows.length;
  const { rows } = await whole.db.query<{ id: string }>(`select id from entity where type = 'person' and archived_at is null and lower(props->>'email') = $1 order by created_at limit 1`, [email]);
  const person = first
    ? (await whole.init({ kind: 'human', name: email }, { name: email, email })).me
    : (rows[0]?.id ?? (await whole.apply('system', { ops: [{ op: 'create', ref: 'p', type: 'person', title: email, visibility: 'shared', props: { email } }], reason: 'Added to the workspace' })).created.p);
  await whole.db.query(
    `insert into member (email, person_id, admin, added_by) values ($1, $2, $3, 'server pack')
     on conflict (email) do update set person_id = excluded.person_id, admin = excluded.admin, removed_at = null`,
    [email, person, admin || first],
  );
  return person;
}

/** On a workspace with a member limit a person signs in as a member: a human token for anyone else would be a seat unpaid for. */
export async function humanTokenAllowed(l: Archipelago, person: string | undefined): Promise<void> {
  if (!(await site.limitOf(l.workspace))) return;
  const { rows } = await (await wholeMap(l)).db.query(`select 1 from member where person_id = $1 and removed_at is null`, [person ?? '']);
  if (!rows.length) throw new Error('On this workspace a person signs in as a member: add them under Members first.');
}

const KEY = 'signin:';
const hash = (code: string) => createHash('sha256').update(code).digest('hex');

/** A one-time link that signs this member in. The code names its workspace, so the server knows where to trade it. */
export async function linkFor(db: Q, workspace: string, email: string, ms: number, origin = site.origin): Promise<string> {
  const code = `inv_${workspace}_${randomBytes(20).toString('hex')}`;
  await keep(db, KEY + hash(code), { email }, ms);
  return `${origin}/#/join/${code}`;
}

/** Which workspace a code claims to be for. Says nothing about whether it is valid. */
export const workspaceOfCode = (code: string) => /^inv_([a-z0-9][a-z0-9-]{0,39})_[a-f0-9]{40}$/.exec(code)?.[1];

/** Trade a code for a month's token, once, if the address it was sent to is still a member. */
export const redeem = (db: Q, workspace: string, code: string) => redeemWith(db, workspace, KEY + hash(code));

/** The member a link's code would sign in, without trading it: so they can be asked to agree to something first. */
export async function emailOfLink(db: Q, code: string): Promise<string | undefined> {
  const email = (await kept<{ email: string }>(db, KEY + hash(code)))?.email;
  return email && (await memberOf(db, email)) ? email : undefined;
}

// A code to type, beside each link: for a browser the mail's links do not open in, such as an agent's own. It is short
// enough to type, so it works only with the address it was sent to, and an address is allowed a few wrong ones.
const CODE = 'signin-code:';
const TRIES = 'signin-tries:';
/** The characters of a typed code: none that reads as another (0 and O, 1, I and L). */
const LETTERS = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';
export const CODE_TRIES = 5;
const typed = (code: string) => code.toUpperCase().replace(/[^0-9A-Z]/g, '');

/** A one-time code that signs this member in when typed with their address, shown as two groups of four. */
export async function codeFor(db: Q, email: string, ms: number): Promise<string> {
  const code = Array.from({ length: 8 }, () => LETTERS[randomInt(LETTERS.length)]).join('');
  await keep(db, CODE + hash(`${email}:${code}`), { email }, ms);
  return `${code.slice(0, 4)}-${code.slice(4)}`;
}

/**
 * Trade a typed code for a month's token in the workspace it was sent for, once. Wrong ones are counted per address in
 * the server's own database (control), and past CODE_TRIES nothing is traded for that address until the count runs out.
 */
export async function redeemTyped(workspaces: { id: string; db: () => Promise<Q> }[], control: Q, email: string, code: string): Promise<{ token: string } | 'gone' | 'tries'> {
  const tries = (await kept<number>(control, TRIES + email)) ?? 0;
  if (tries >= CODE_TRIES) return 'tries';
  for (const ws of workspaces) {
    const db = await ws.db();
    if (!(await memberOf(db, email))) continue;
    const token = await redeemWith(db, ws.id, CODE + hash(`${email}:${typed(code)}`));
    if (token) return { token };
  }
  await keep(control, TRIES + email, tries + 1, LINK_MINUTES * 60_000);
  return 'gone';
}

/** Whether a typed code would sign this address in somewhere, without trading it or counting a wrong one. */
export async function typedWorks(workspaces: { id: string; db: () => Promise<Q> }[], email: string, code: string): Promise<boolean> {
  for (const ws of workspaces) {
    const db = await ws.db();
    if ((await memberOf(db, email)) && (await kept(db, CODE + hash(`${email}:${typed(code)}`))) !== undefined) return true;
  }
  return false;
}

async function redeemWith(db: Q, workspace: string, key: string): Promise<string | undefined> {
  const taken = await take<{ email: string }>(db, key);
  const member = taken && (await memberOf(db, taken.value.email));
  if (!member) return undefined;
  return (await createToken(db, workspace, { kind: 'human', name: member.email, entity: member.person_id, admin: member.admin, expires_days: SIGNED_IN_DAYS })).token;
}

/**
 * Someone asks to sign in at an address: one mail, with a link and a code for each workspace it is a member of.
 * Nothing is said back either way, so the page cannot be used to learn who is a member where.
 */
export async function requestSignIn(workspaces: { id: string; name: string; db: () => Promise<Q> }[], email: string, origin: string): Promise<void> {
  const links: string[] = [];
  for (const ws of workspaces) {
    const db = await ws.db();
    if (!(await memberOf(db, email))) continue;
    const ms = LINK_MINUTES * 60_000;
    links.push(`${ws.name}:\n${await linkFor(db, ws.id, email, ms, origin)}\nOr type this code on the sign-in page: ${await codeFor(db, email, ms)}`);
  }
  if (!links.length) return;
  await sendMail({
    to: email,
    subject: 'Your Archipelago sign-in link',
    text: [
      'Hello,',
      `Here is the link you asked for to sign in to Archipelago. Open it, or type its code on the page where you asked. Either works once, for the next ${LINK_MINUTES} minutes, and keeps that browser signed in for ${SIGNED_IN_DAYS} days.`,
      links.join('\n\n'),
      'If you did not ask to sign in, you can ignore this email: nobody can sign in without the link or its code.',
      '- Archipelago',
    ].join('\n\n'),
  });
}

const needAdmin = (actor: Actor, what: string) => {
  if (!actor.admin) throw new Error(`Only a workspace admin can ${what}.`);
};

export const MEMBER_TOOLS: Record<string, Tool> = {
  member_add: {
    description: `Add a person to this workspace by their email address: they are sent an invitation (it works for ${INVITE_DAYS} days), and from then on sign in at that address. Their person entity is the one with that email, or a new shared one. Admins only.`,
    humanOnly: true,
    input: {
      email: z.string().min(3),
      name: z.string().optional().describe('Their name, for a new person entity; the address is used when it is left out.'),
      admin: z.boolean().optional().describe('May manage members, tokens and workspace settings.'),
    },
    run: async (l, actor, input) => {
      needAdmin(actor, 'add members');
      const email = normalEmail(input.email);
      if (!email) throw new Error(`"${input.email}" is not an email address.`);
      const whole = await wholeMap(l);
      if (await memberOf(whole.db, email)) throw new Error(`${email} is a member already.`);
      await stillWritable(l.workspace);
      await roomForOneMore(whole.db, l.workspace);
      const { rows } = await whole.db.query<{ id: string }>(`select id from entity where type = 'person' and archived_at is null and lower(props->>'email') = $1 order by created_at limit 1`, [email]);
      const person =
        rows[0]?.id ??
        (await l.apply(actorId(actor), { ops: [{ op: 'create', ref: 'p', type: 'person', title: input.name?.trim() || email, visibility: 'shared', props: { email } }], reason: 'Added to the workspace' })).created.p;
      await whole.db.query(
        `insert into member (email, person_id, admin, added_by) values ($1, $2, $3, $4)
         on conflict (email) do update set person_id = excluded.person_id, admin = excluded.admin, added_by = excluded.added_by, added_at = now(), removed_at = null`,
        [email, person, Boolean(input.admin), actor.name],
      );
      // Two added at once may both have found room: counted again, the one past the limit is taken out.
      await roomForOneMore(whole.db, l.workspace, 1).catch(async (err) => {
        await whole.db.query(`update member set removed_at = now() where email = $1`, [email]);
        throw err;
      });
      const name = await site.nameOf(l.workspace);
      const inviter = actor.person ? await l.entity(actor.person) : undefined;
      const by = inviter?.title || actor.name;
      // A reply reaches whoever sent the invitation, at the address they sign in with, else the one on their page.
      const { rows: theirs } = actor.person ? await whole.db.query<{ email: string }>(`select email from member where person_id = $1 and removed_at is null limit 1`, [actor.person]) : { rows: [] };
      const replyTo = theirs[0]?.email ?? normalEmail(inviter?.props?.email);
      try {
        await sendMail({
          to: email,
          ...(replyTo && { replyTo }),
          subject: `${by} invited you to ${name} on Archipelago`,
          text: [
            'Hello,',
            `${by} has invited you to ${name} on Archipelago, where its people and their AI agents keep track of their work together.`,
            `To accept, open this link. It signs you in on this device and works once, for ${INVITE_DAYS} days:`,
            await linkFor(whole.db, l.workspace, email, INVITE_DAYS * 86_400_000),
            `Afterwards, sign in at ${site.origin} with this email address, and you will be sent a link each time you need one.`,
            `You are getting this because ${by} added ${email} to ${name}. If you were not expecting it, you can ignore this email: nothing happens unless the link is opened.${replyTo ? ` Reply to it to reach ${by}.` : ''}`,
            '- Archipelago',
          ].join('\n\n'),
        });
        return { email, person, invited: true };
      } catch (err) {
        return { email, person, invited: false, error: (err as Error).message };
      }
    },
  },
  member_list: {
    description: 'The members of this workspace: each email address, the person it is, whether they are an admin, and when they last used a sign-in. Admins only.',
    humanOnly: true,
    input: {},
    run: async (l, actor) => {
      needAdmin(actor, 'list members');
      const { rows } = await (await wholeMap(l)).db.query<Member & { name: string | null; last_used: string | null }>(
        `select m.email, m.person_id, m.admin, m.added_at, e.title as name,
                (select max(t.last_used) from token t where t.entity_id = m.person_id and t.kind = 'human') as last_used
         from member m left join entity e on e.id = m.person_id where m.removed_at is null order by m.added_at`,
      );
      return rows;
    },
  },
  member_set: {
    description: 'Make a member an admin or not (their sign-ins change at once), or remove them (their sign-ins end at once). Admins only; nobody removes themselves.',
    humanOnly: true,
    input: { email: z.string(), admin: z.boolean().optional(), remove: z.boolean().optional() },
    run: async (l, actor, input) => {
      needAdmin(actor, 'change members');
      const whole = await wholeMap(l);
      const member = await memberOf(whole.db, normalEmail(input.email) ?? '');
      if (!member) throw new Error(`${input.email} is not a member.`);
      const live = `entity_id = $1 and kind = 'human' and revoked_at is null`;
      if (input.remove) {
        if (member.person_id === actor.person) throw new Error('You cannot remove yourself.');
        await whole.db.query(`update member set removed_at = now() where email = $1`, [member.email]);
        await whole.db.query(`update token set revoked_at = now() where ${live}`, [member.person_id]);
        return { removed: member.email };
      }
      if (input.admin === undefined) return member;
      if (!input.admin && member.person_id === actor.person) throw new Error('You cannot take away your own admin.');
      await whole.db.query(`update member set admin = $2 where email = $1`, [member.email, input.admin]);
      await whole.db.query(`update token set admin = $2 where ${live}`, [member.person_id, input.admin]);
      return { ...member, admin: input.admin };
    },
  },
};
