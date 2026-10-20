// Members: the people who sign in to a workspace, each by an email address. An admin adds someone by their address;
// they are sent an invitation, and from then on sign in by asking for a link at that address (POST /connect/sign-in).
// The link works once, for half an hour; opened, the page trades its code (POST /connect/join) for a token that keeps
// that browser signed in for a month. Whether a member is an admin is kept here, on the member, so every sign-in gets
// it; removing a member ends their sign-ins at once. The table is read only through the whole database: no member's
// role is granted it.

import { createHash, randomBytes } from 'node:crypto';
import { z } from 'zod';
import { createToken } from './auth.ts';
import type { Q } from './db.ts';
import { normalEmail, sendMail } from './mail.ts';
import { wholeMap } from './outbox.ts';
import { actorId, type Actor, type Archipelago } from './pelago.ts';
import type { Tool } from './tools.ts';
import { keep, take } from './transient.ts';

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

let site = { origin: 'http://127.0.0.1:3100', nameOf: async (id: string) => id };
/** Where the links in the mail lead, and a workspace's name to put in it: the server says, when it starts. */
export function configureMembers(given: typeof site) {
  site = given;
}

export async function memberOf(db: Q, email: string): Promise<Member | undefined> {
  const { rows } = await db.query<Member>(`select email, person_id, admin, added_at from member where email = $1 and removed_at is null`, [email]);
  return rows[0];
}

const KEY = 'signin:';
const hash = (code: string) => createHash('sha256').update(code).digest('hex');

/** A one-time link that signs this member in. The code names its workspace, so the server knows where to trade it. */
async function linkFor(db: Q, workspace: string, email: string, ms: number, origin = site.origin): Promise<string> {
  const code = `inv_${workspace}_${randomBytes(20).toString('hex')}`;
  await keep(db, KEY + hash(code), { email }, ms);
  return `${origin}/#/join/${code}`;
}

/** Which workspace a code claims to be for. Says nothing about whether it is valid. */
export const workspaceOfCode = (code: string) => /^inv_([a-z0-9][a-z0-9-]{0,39})_[a-f0-9]{40}$/.exec(code)?.[1];

/** Trade a code for a month's token, once, if the address it was sent to is still a member. */
export async function redeem(db: Q, workspace: string, code: string): Promise<string | undefined> {
  const taken = await take<{ email: string }>(db, KEY + hash(code));
  const member = taken && (await memberOf(db, taken.value.email));
  if (!member) return undefined;
  return (await createToken(db, workspace, { kind: 'human', name: member.email, entity: member.person_id, admin: member.admin, expires_days: SIGNED_IN_DAYS })).token;
}

/**
 * Someone asks to sign in at an address: one mail, with a link for each workspace it is a member of. Nothing is
 * said back either way, so the page cannot be used to learn who is a member where.
 */
export async function requestSignIn(workspaces: { id: string; name: string; db: () => Promise<Q> }[], email: string, origin: string): Promise<void> {
  const links: string[] = [];
  for (const ws of workspaces) {
    const db = await ws.db();
    if (await memberOf(db, email)) links.push(`${ws.name}\n${await linkFor(db, ws.id, email, LINK_MINUTES * 60_000, origin)}`);
  }
  if (!links.length) return;
  await sendMail({
    to: email,
    subject: 'Sign in to Archipelago',
    text: `Open this link to sign in. It works once, for the next ${LINK_MINUTES} minutes, and keeps this browser signed in for ${SIGNED_IN_DAYS} days.\n\n${links.join('\n\n')}\n\nIf you did not ask to sign in, you can ignore this mail.\n`,
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
      const { rows } = await whole.db.query<{ id: string }>(`select id from entity where type = 'person' and archived_at is null and lower(props->>'email') = $1 order by created_at limit 1`, [email]);
      const person =
        rows[0]?.id ??
        (await l.apply(actorId(actor), { ops: [{ op: 'create', ref: 'p', type: 'person', title: input.name?.trim() || email, visibility: 'shared', props: { email } }], reason: 'Added to the workspace' })).created.p;
      await whole.db.query(
        `insert into member (email, person_id, admin, added_by) values ($1, $2, $3, $4)
         on conflict (email) do update set person_id = excluded.person_id, admin = excluded.admin, added_by = excluded.added_by, added_at = now(), removed_at = null`,
        [email, person, Boolean(input.admin), actor.name],
      );
      const name = await site.nameOf(l.workspace);
      const by = (actor.person && (await l.entity(actor.person))?.title) || actor.name;
      try {
        await sendMail({
          to: email,
          subject: `You are invited to ${name} on Archipelago`,
          text: `${by} has added you to ${name} on Archipelago.\n\nOpen this link to sign in. It works once, for ${INVITE_DAYS} days. After that, sign in at ${site.origin} with this email address.\n\n${await linkFor(whole.db, l.workspace, email, INVITE_DAYS * 86_400_000)}\n`,
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
