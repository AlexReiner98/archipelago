// Signing in, before anyone is known: a link asked for at an address and the code it carries traded once for a token,
// a code typed with its address, an address and its password, and a person keeping a password for their address.
// Identity's (the owner, 12 Nov 2026, e_wuqn82rf: root work out of the connect pack); the surface's open routes
// (packs/surface/kernel/connect-routes.ts) answer the request with what this says. Only the workspaces an address is a
// member of are opened: an unknown address opens none (./control-index.ts).
//
// What it asks above itself is handed in: the documents an address owes (the surface's signin gates) and an address in
// its one form (the mail pack's), so identity imports nothing above it.

import type { Q } from '../../database/kernel/db.ts';
import type { Actor } from '../../write/kernel/pelago.ts';
import { workspacesOf } from './control-index.ts';
import { emailOfLink, LINK_MINUTES, memberOf, redeem, redeemTyped, requestSignIn, signedIn, triesSpent, typedWorks, workspaceOfCode } from './members.ts';
import { clearPassword, passwordProblem, passwordSet, passwordTriesSpent, passwordWorks, setPassword, TRIES_MINUTES } from './passwords.ts';
import type { Workspace, Workspaces } from './workspaces.ts';

/** What a route open to anyone is handed by the server: its names, whether it signs in with tokens, the request's parts. */
export interface OpenRoutes {
  hosts: string[];
  named: string[];
  tokens: boolean;
  /** The workspace a request that names none is for. */
  fallback: string;
  workspaces: Pick<Workspaces, 'has' | 'get' | 'hold' | 'list' | 'create' | 'control'>;
  /** True, and the request answered, when its address has asked too often. */
  tooOften: () => boolean;
  body: () => Promise<unknown>;
  /** The body as it came, for what is signed over its bytes. Read it or body, not both. */
  raw: () => Promise<Buffer>;
  /** Where the request comes from, for what is counted by address (a pack's stream). */
  from?: string;
  /** Who is signed in, as any request with a token says; refused if nobody is. */
  person: () => Promise<{ ws: Workspace; actor: () => Actor; look?: true }>;
}

/** What signing in is handed beside the request: what it may not ask above itself. */
export interface SignInAt extends OpenRoutes {
  /** Keep a workspace open until the request is answered. */
  hold(workspace: string): void;
  /** The documents this address has not agreed to at their current version: recorded if the request agrees to them. */
  owes(email: string, agree: unknown): Promise<unknown[]>;
  /** An address in its one form, or undefined for what is no address. */
  email(given: unknown): string | undefined;
}

/** An answer: its status and its body, sent as JSON kept private. */
export interface Answered { status: number; body: unknown }

/** The paths signing in answers, each a POST. */
export const SIGN_IN_PATHS = ['/connect/sign-in', '/connect/join', '/connect/code', '/connect/password', '/connect/password/set'];

/** One sign-in mail a minute to an address, whoever asks: the form cannot be used to flood someone's inbox. */
const lately = new Map<string, number>();
function askedLately(email: string): boolean {
  const now = Date.now();
  for (const [e, at] of lately) if (now - at > 60_000) lately.delete(e);
  if (lately.has(email)) return true;
  lately.set(email, now);
  return false;
}

const answer = (status: number, body: unknown): Answered => ({ status, body });

/** A person signed in keeps a password for their address, or takes it away; an agent or a look pass never does. */
async function keepPassword(at: SignInAt): Promise<Answered> {
  const { ws, actor, look } = await at.person();
  const who = actor();
  if (look || who.kind !== 'human' || !who.person) return answer(403, { error: 'Only the person signed in keeps a password, not an agent.' });
  const { rows } = await ws.pelago.db.query<{ email: string }>(`select email from member where person_id = $1 and removed_at is null limit 1`, [who.person]);
  const email = rows[0]?.email;
  if (!email) return answer(403, { error: 'A password is kept for a member’s address, and this sign-in has none.' });
  const control = await at.workspaces.control();
  const body = ((await at.body()) ?? {}) as { password?: unknown };
  if (body.password === undefined) return answer(200, { email, set: (await passwordSet(control, email)) ?? null });
  if (body.password === null) return (await clearPassword(control, email), answer(200, { email, set: null }));
  const problem = passwordProblem(body.password);
  if (problem) return answer(400, { error: problem });
  await setPassword(control, email, body.password as string);
  return answer(200, { email, set: await passwordSet(control, email) });
}

/** A sign-in path's answer (SIGN_IN_PATHS), once the route has checked this server signs people in and the request is not too often. */
export async function signIn(path: string, at: SignInAt): Promise<Answered> {
  if (path === '/connect/password/set') return keepPassword(at);
  const body = ((await at.body()) ?? {}) as { email?: unknown; code?: unknown; agree?: unknown; ref?: unknown; password?: unknown; workspace?: unknown };
  const all = async () => (await at.workspaces.list()).map((w) => ({ ...w, db: async () => (await at.workspaces.get(w.id)).pelago.db }));
  const theirs = async (email: string) => {
    const ids = new Set(await workspacesOf(await at.workspaces.control(), email, all));
    return (await at.workspaces.list()).filter((w) => ids.has(w.id)).map((w) => ({ ...w, db: async () => (await at.workspaces.get(w.id)).pelago.db }));
  };
  // Before a code is traded, the documents this person has not agreed to at their current version: recorded if the
  // request agrees to them, else answered so the page can ask. The code is not spent while anything is owed.
  const owes = (email: string) => at.owes(email, body.agree);
  if (path === '/connect/sign-in') {
    const email = at.email(body.email);
    if (!email) return answer(400, { error: 'That is not an email address.' });
    // Answered at once and the same either way: whether the address is a member anywhere is not told. An address in
    // no workspace is sent nothing; the page offers where to begin to everyone who asks.
    if (!askedLately(email)) void requestSignIn(await theirs(email), email).catch((err) => console.error(`sign-in mail to ${email} failed:`, (err as Error).message));
    return answer(200, { sent_to: email });
  }
  // An address and its password. Its workspace is the one named, or the only one; for several, the answer lists them.
  if (path === '/connect/password') {
    const email = at.email(body.email);
    if (!email) return answer(400, { error: 'That is not an email address.' });
    const control = await at.workspaces.control();
    const wait = `Too many wrong passwords for this address. Wait ${TRIES_MINUTES} minutes, or ask for an email instead.`;
    if (await passwordTriesSpent(control, email)) return answer(429, { error: wait });
    if (!(await passwordWorks(control, email, body.password))) return (await passwordTriesSpent(control, email)) ? answer(429, { error: wait }) : answer(401, { error: 'That email and password do not match.' });
    const mine: { id: string; name: string; db: () => Promise<Q> }[] = [];
    for (const w of await theirs(email)) if (await memberOf(await w.db(), email)) mine.push(w);
    if (!mine.length) return answer(403, { error: 'This address is a member of no workspace here.' });
    const ws = mine.length === 1 ? mine[0] : mine.find((w) => w.id === body.workspace);
    if (!ws) return answer(200, { workspaces: mine.map(({ id, name }) => ({ id, name })) });
    const owed = await owes(email);
    if (owed.length) return answer(200, { agree: owed });
    const db = await ws.db();
    return answer(200, { token: await signedIn(db, ws.id, (await memberOf(db, email))!) });
  }
  // A code from the mail, typed with the address it was sent to.
  if (path === '/connect/code') {
    const email = at.email(body.email);
    if (!email) return answer(400, { error: 'That is not an email address.' });
    // Asked only once the code is known to work, so the answer says nothing of an address the asker cannot sign in as.
    // The tries are counted before the code is looked at, so past them nothing says whether a code would work.
    const control = (await at.workspaces.get(at.fallback)).pelago.db;
    const spent = `Too many wrong codes for this address. Wait ${LINK_MINUTES} minutes, then ask for a new email.`;
    if (await triesSpent(control, email)) return answer(429, { error: spent });
    const mine = await theirs(email);
    if (await typedWorks(mine, email, String(body.code ?? ''))) {
      const owed = await owes(email);
      if (owed.length) return answer(200, { agree: owed });
    }
    const traded = await redeemTyped(mine, control, email, String(body.code ?? ''));
    if (traded === 'tries') return answer(429, { error: spent });
    return traded === 'gone' ? answer(410, { error: 'That code was not accepted: it may be mistyped, used or run out.' }) : answer(200, traded);
  }
  // A link opened (/connect/join): the code it carries, traded once.
  const code = String(body.code ?? '');
  const workspace = workspaceOfCode(code);
  const gone = answer(410, { error: 'This sign-in link has been used or has run out. Ask for a new one.' });
  if (!workspace || !(await at.workspaces.has(workspace))) return gone;
  at.hold(workspace);
  const db = (await at.workspaces.get(workspace)).pelago.db;
  const email = await emailOfLink(db, code);
  if (!email) return gone;
  const owed = await owes(email);
  if (owed.length) return answer(200, { agree: owed });
  const token = await redeem(db, workspace, code);
  return token ? answer(200, { token }) : gone;
}
