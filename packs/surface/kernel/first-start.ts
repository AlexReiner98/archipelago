// The first start with tokens on: there is nobody to ask yet, so the server makes what everything else is made from.
// The operator secret is given once: to a person at a terminal it is printed; otherwise it would stay in a log that
// others read and keep (a container's, a host's), so it is written to a file only the server's own user can read, and
// the log says where (the sweep of 29 Oct 2026). The default workspace's owner is named by their address
// (PELAGO_OWNER_EMAIL), made its first admin and mailed a sign-in code: a person signs in by email, never by pasting a
// token, and a server is not set up without mail (the owner, 8 Nov 2026).

import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { hasHumanToken } from '../../../src/auth.ts';
import { env } from '../../../src/env.ts';
import '../../../src/member-mail.ts'; // the owner's sign-in code goes out as mail
import { adminEmails, admitMember, ownerEmail, requestSignIn } from '../../../src/members.ts';
import type { Workspace, Workspaces } from '../../../src/workspaces.ts';

/** Where the operator secret of a first start is written when nobody is at a terminal. */
export const FIRST_START_FILE = 'first-start-secrets.txt';

/** Make what a first start needs, and give it once: the secret printed at a terminal, else in a file in `dir`. */
export async function firstStart(workspaces: Workspaces, main: Workspace, dir: string, terminal = Boolean(process.stdout.isTTY)): Promise<string | undefined> {
  // A workspace with an admin, or one already signed in to the old way, has its owner.
  if (!(await adminEmails(main.pelago)).length && !(await hasHumanToken(main.pelago.db))) {
    if (!env('OWNER_EMAIL')) throw new Error('First start: set PELAGO_OWNER_EMAIL to the owner’s address (and PELAGO_MAIL_FROM, so the server sends mail). They are mailed a code to sign in.');
    const email = ownerEmail(env('OWNER_EMAIL'));
    await admitMember(main.pelago, email, true);
    await requestSignIn([{ id: main.id, name: main.name, db: async () => main.pelago.db }], email);
    console.log(`\nFirst start: ${email} is the default workspace's owner, and was mailed a code to sign in.`);
  }
  const operator = await workspaces.ensureOperator();
  if (!operator) return undefined;
  const said = `Operator secret (creates workspaces; shown once):\n  ${operator}`;
  if (terminal) {
    console.log(`\n${said}`);
    return undefined;
  }
  const file = join(dir, FIRST_START_FILE);
  writeFileSync(file, `${said}\n\nRead this once, keep what it holds somewhere safe, and delete this file.\n`, { mode: 0o600 });
  console.log(`\nFirst start: the operator secret is in ${file}, readable only by this server's user. Read it once, then delete it.`);
  return file;
}
