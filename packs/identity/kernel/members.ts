// Members: the people who sign in to a workspace, each by an email address. An admin adds someone by their address;
// they are sent an invitation, and from then on sign in by asking for a link at that address (POST /connect/sign-in).
// The link (or the code beside it, typed: POST /connect/code) works once, for half an hour; opened, the page trades
// its code (POST /connect/join) for a token that keeps
// that browser signed in for a month; a member who set a password may sign in with it instead (src/passwords.ts).
// Whether a member is an admin is kept here, on the member, so every sign-in gets
// it; removing a member ends their sign-ins at once. The table is read only through the whole database: no member's
// role is granted it.

import { randomInt } from 'node:crypto';
import { sha256Hex, workspaceSecret } from '../../../src/hashes.ts';
import { z } from 'zod';
import { needAdmin } from '../../../src/actor-checks.ts';
import { createToken } from './auth.ts';
import type { Q } from '../../../src/db.ts';
import { normalEmail } from '../../../src/email-address.ts';
import { configureStanding, limitOf, stillWritable, type Limits, type Standing } from '../../../src/standing.ts';
import { indexMember } from './control-index.ts';
import { bypassingRls } from '../../../src/outbox.ts';
import { actorId, type Actor, type Archipelago } from '../../../src/pelago.ts';
import type { Tool } from '../../../src/tools.ts';
import { keep, kept, take } from '../../../src/transient.ts';

/** How long a sign-in lasts in a browser, how long a sign-in link works, and how long an invitation does. */
export const SIGNED_IN_DAYS = 30;
export const LINK_MINUTES = 30;
export const INVITE_DAYS = 7;

export interface Member {
  email: string;
  person_id: string;
  admin: boolean;
  added_at: string;
  /** One who only reads: they see what any member sees, and the database refuses their writes (src/db.ts scoped). Never an admin. */
  read_only: boolean;
}

/** A workspace's limits (src/standing.ts), members among them: the name it had when members were all a plan limited. */
export type MemberLimit = Limits;

let site = { origin: 'http://127.0.0.1:3100', nameOf: async (id: string) => id, rename: async (_id: string, _name: string): Promise<void> => {} };
/** Where the links in the mail lead, a workspace's name to put in it, how to change it, and its standing: the server says, when it starts. */
export function configureMembers(given: Partial<typeof site> & { standingOf?: (id: string) => Promise<Standing | undefined> }) {
  const { standingOf: read, ...rest } = given;
  site = { ...site, ...rest };
  configureStanding({ ...(read && { read }), ...(rest.nameOf && { nameOf: rest.nameOf }) });
}
/** Where an item of a workspace is read by a person, `{id}` for the item: an agent names an item to its owner as a link to it, not by its id. */
export const itemLink = (workspace: string) => `${site.origin}/i/${workspace}/{id}`;
/** Give a workspace another name, where the server keeps them. */
export const renameWorkspace = (workspace: string, name: string) => site.rename(workspace, name);
/** Which workspaces each address belongs to is kept beside the workspaces too, so a sign-in opens only those (src/control-index.ts). */
const noted = indexMember;

/**
 * What members tells the people it is about: an invitation issued, or the sign-in codes asked for. Members only raises
 * it; the mail side (src/member-mail.ts) says how it reads and sends it, and whether it sends at all.
 */
export type MemberNotice =
  | { kind: 'invite_issued'; to: string; replyTo?: string; by: string; workspace: string; signIn: string }
  | { kind: 'sign_in_code'; to: string; codes: string[]; minutes: number; days: number };
export interface MemberNotices {
  /** Whether a notice reaches anyone: a workspace is made only where its owner can be sent a code. */
  sends: () => boolean;
  /** Tell it. Throws when it did not go. */
  send: (notice: MemberNotice) => Promise<void>;
}
let notices: MemberNotices = { sends: () => false, send: async (n) => void console.log(`member notice not sent (no mail side loaded): ${n.kind}`) };
/** Who tells members' notices: the mail side, when it is loaded. */
export function onMemberNotice(given: MemberNotices) {
  notices = given;
}

// A workspace's limits are the server's, not its map's: the server pack that made it says them (src/standing.ts).
export { limitOf };

/** Refuse one more member past the limit, saying how to make room. Those already in stay when a limit is lowered. */
async function roomForOneMore(db: Q, workspace: string, added = 0): Promise<void> {
  const limit = await limitOf(workspace);
  if (!limit?.members) return;
  const { rows } = await db.query<{ n: number }>(`select count(*)::int as n from member where removed_at is null`);
  if (rows[0].n - added < limit.members) return;
  const name = await site.nameOf(workspace);
  if (added) rows[0].n -= added;
  throw new Error(`${name} has room for ${limit.members} member${limit.members === 1 ? '' : 's'}${rows[0].n > limit.members ? ` and has ${rows[0].n}` : ''}.${limit.note ? ` ${limit.note}` : ''}`);
}

export async function memberOf(db: Q, email: string): Promise<Member | undefined> {
  const { rows } = await db.query<Member>(`select email, person_id, admin, added_at, read_only from member where email = $1 and removed_at is null`, [email]);
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
  await noted(email, whole.workspace, true);
  return person;
}

/**
 * A new workspace's owner, by their address: every workspace is made with one, on a server that sends mail, so
 * someone can always sign in to it by email (the owner, 8 Nov 2026). Every way a workspace is made asks here first.
 */
export function ownerEmail(given: unknown): string {
  if (!notices.sends()) throw new Error('This server sends no mail (set PELAGO_MAIL_FROM): a workspace is made only where its owner can sign in by email.');
  const email = normalEmail(given);
  if (!email) throw new Error("A workspace is made with its owner's email address (email), so they can sign in to it.");
  return email;
}

/** The addresses of a workspace's admins: whoever can sign in to it by email and manage it (the operator's list). */
export async function adminEmails(whole: Archipelago): Promise<string[]> {
  const { rows } = await whole.db.query<{ email: string }>(`select email from member where admin and removed_at is null order by added_at`);
  return rows.map((r) => r.email);
}

/** On a workspace with a member limit a person signs in as a member: a human token for anyone else would be a seat unpaid for. */
export async function humanTokenAllowed(l: Archipelago, person: string | undefined): Promise<void> {
  if (!(await limitOf(l.workspace))) return;
  const { rows } = await (await bypassingRls(l)).db.query(`select 1 from member where person_id = $1 and removed_at is null`, [person ?? '']);
  if (!rows.length) throw new Error('On this workspace a person signs in as a member: add them under Members first.');
}

const KEY = 'signin:';
const hash = sha256Hex;

/**
 * How an invitation says to come in: sign in at this server with the address, which is mailed a code. Never a sign-in
 * link in a mail: from a young domain one reads to spam filters as phishing (the owner, 10 Nov 2026).
 */
export const signInBy = (email: string) => `go to ${new URL(site.origin).host} and sign in with this email address (${email}). You will be sent a code to type there.`;

/** A one-time link that signs this member in, handed over in a browser, never mailed. The code names its workspace, so the server knows where to trade it. */
export async function linkFor(db: Q, workspace: string, email: string, ms: number, origin = site.origin): Promise<string> {
  const code = workspaceSecret('inv', workspace);
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
/** Whether this address has used up its wrong codes for now. */
export const triesSpent = async (control: Q, email: string) => ((await kept<number>(control, TRIES + email)) ?? 0) >= CODE_TRIES;

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
  return member && signedIn(db, workspace, member);
}

/** A member's sign-in in a browser: a month's token, an admin's if they are one. */
export const signedIn = async (db: Q, workspace: string, member: Member) =>
  (await createToken(db, workspace, { kind: 'human', name: member.email, entity: member.person_id, admin: member.admin, expires_days: SIGNED_IN_DAYS })).token;

/**
 * Someone asks to sign in at an address: one mail, with a code for each workspace it is a member of, and to an address
 * in none, nothing. Nothing is said back either way, so the page cannot be used to learn who is a member where.
 */
export async function requestSignIn(workspaces: { id: string; name: string; db: () => Promise<Q> }[], email: string): Promise<void> {
  const links: string[] = [];
  for (const ws of workspaces) {
    const db = await ws.db();
    if (!(await memberOf(db, email))) continue;
    const ms = LINK_MINUTES * 60_000;
    // A code, never a link: a mail from a young domain that carries a sign-in link reads to spam filters as phishing.
    links.push(`${ws.name}: ${await codeFor(db, email, ms)}`);
  }
  // An address in no workspace is sent nothing: anyone can type one, and mail its owner never asked for is marked as
  // spam, which costs every mail after it. The page offers Start a workspace after asking, the same for everyone.
  if (!links.length) return;
  await notices.send({ kind: 'sign_in_code', to: email, codes: links, minutes: LINK_MINUTES, days: SIGNED_IN_DAYS });
}


export const MEMBER_TOOLS: Record<string, Tool> = {
  member_add: {
    description: `Add a person to this workspace by their email address: they are sent an invitation (it works for ${INVITE_DAYS} days), and from then on sign in at that address. Their person entity is the one with that email, or a new shared one. Admins only.`,
    humanOnly: true,
    input: {
      email: z.string().min(3),
      name: z.string().optional().describe('Their name, for a new person entity; the address is used when it is left out.'),
      admin: z.boolean().optional().describe('May manage members, tokens and workspace settings.'),
      read_only: z.boolean().optional().describe('Only reads: sees what any member sees and changes nothing. Never an admin.'),
    },
    run: async (l, actor, input) => {
      needAdmin(actor, 'add members');
      if (input.admin && input.read_only) throw new Error('A member who only reads cannot be an admin.');
      const email = normalEmail(input.email);
      if (!email) throw new Error(`"${input.email}" is not an email address.`);
      const whole = await bypassingRls(l);
      if (await memberOf(whole.db, email)) throw new Error(`${email} is a member already.`);
      await stillWritable(l.workspace);
      await roomForOneMore(whole.db, l.workspace);
      const { rows } = await whole.db.query<{ id: string }>(`select id from entity where type = 'person' and archived_at is null and lower(props->>'email') = $1 order by created_at limit 1`, [email]);
      const person =
        rows[0]?.id ??
        (await l.apply(actorId(actor), { ops: [{ op: 'create', ref: 'p', type: 'person', title: input.name?.trim() || email, visibility: 'shared', props: { email } }], reason: 'Added to the workspace' })).created.p;
      await whole.db.query(
        `insert into member (email, person_id, admin, added_by, read_only) values ($1, $2, $3, $4, $5)
         on conflict (email) do update set person_id = excluded.person_id, admin = excluded.admin, added_by = excluded.added_by, added_at = now(), removed_at = null, read_only = excluded.read_only`,
        [email, person, Boolean(input.admin), actor.name, Boolean(input.read_only)],
      );
      await noted(email, l.workspace, true);
      // Two added at once may both have found room: counted again, the one past the limit is taken out.
      await roomForOneMore(whole.db, l.workspace, 1).catch(async (err) => {
        await whole.db.query(`update member set removed_at = now() where email = $1`, [email]);
        await noted(email, l.workspace, false);
        throw err;
      });
      const name = await site.nameOf(l.workspace);
      const inviter = actor.person ? await l.entity(actor.person) : undefined;
      const by = inviter?.title || actor.name;
      // A reply reaches whoever sent the invitation, at the address they sign in with, else the one on their page.
      const { rows: theirs } = actor.person ? await whole.db.query<{ email: string }>(`select email from member where person_id = $1 and removed_at is null limit 1`, [actor.person]) : { rows: [] };
      const replyTo = theirs[0]?.email ?? normalEmail(inviter?.props?.email);
      try {
        // No sign-in link (see requestSignIn): they ask for a code at the sign-in page, which is mailed to them.
        await notices.send({ kind: 'invite_issued', to: email, ...(replyTo && { replyTo }), by, workspace: name, signIn: signInBy(email) });
        return { email, person, invited: true };
      } catch (err) {
        return { email, person, invited: false, error: (err as Error).message };
      }
    },
  },
  member_list: {
    description: 'The members of this workspace: each email address, the person it is, whether they are an admin or only read, and when they last used a sign-in. Admins only.',
    humanOnly: true,
    input: {},
    run: async (l, actor) => {
      needAdmin(actor, 'list members');
      const { rows } = await (await bypassingRls(l)).db.query<Member & { name: string | null; last_used: string | null }>(
        `select m.email, m.person_id, m.admin, m.read_only, m.added_at, e.title as name,
                (select max(t.last_used) from token t where t.entity_id = m.person_id and t.kind = 'human') as last_used
         from member m left join entity e on e.id = m.person_id where m.removed_at is null order by m.added_at`,
      );
      return rows;
    },
  },
  member_set: {
    description: 'Make a member an admin or not, or one who only reads or not (their sign-ins change at once), or remove them (their sign-ins end at once). An admin never only reads. Admins only; nobody removes themselves.',
    humanOnly: true,
    input: { email: z.string(), admin: z.boolean().optional(), read_only: z.boolean().optional(), remove: z.boolean().optional() },
    run: async (l, actor, input) => {
      needAdmin(actor, 'change members');
      const whole = await bypassingRls(l);
      const member = await memberOf(whole.db, normalEmail(input.email) ?? '');
      if (!member) throw new Error(`${input.email} is not a member.`);
      const live = `entity_id = $1 and kind = 'human' and revoked_at is null`;
      if (input.remove) {
        if (member.person_id === actor.person) throw new Error('You cannot remove yourself.');
        await whole.db.query(`update member set removed_at = now() where email = $1`, [member.email]);
        // Every token tied to them ends, their agents' too: an agent acts as its person, who is no longer here.
        await whole.db.query(`update token set revoked_at = now() where entity_id = $1 and revoked_at is null`, [member.person_id]);
        await noted(member.email, l.workspace, false);
        return { removed: member.email };
      }
      if (input.admin === undefined && input.read_only === undefined) return member;
      if (input.admin && input.read_only) throw new Error('A member who only reads cannot be an admin.');
      // Each takes the other away: an admin who is made to only read is an admin no more, and the other way round.
      const admin = input.admin ?? (input.read_only ? false : member.admin);
      const readOnly = input.read_only ?? (input.admin ? false : member.read_only);
      if ((!admin || readOnly) && member.person_id === actor.person) throw new Error('You cannot take away your own admin.');
      // Their tokens' admin follows at once; whether they only read is read from here with each request (src/auth.ts).
      await whole.db.query(`update member set admin = $2, read_only = $3 where email = $1`, [member.email, admin, readOnly]);
      await whole.db.query(`update token set admin = $2 where ${live}`, [member.person_id, admin]);
      return { ...member, admin, read_only: readOnly };
    },
  },
};
