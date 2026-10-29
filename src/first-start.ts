// The first start with tokens on: there is nobody to ask for a token yet, so the server makes the two everything else
// is made from, the operator secret and the default workspace's owner token, and gives them once. To a person at a
// terminal they are printed; otherwise they would stay in a log that others read and keep (a container's, a host's),
// so they are written to a file only the server's own user can read, and the log says where (the sweep of 29 Oct 2026).

import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createToken, hasHumanToken } from './auth.ts';
import type { Workspace, Workspaces } from './workspaces.ts';

/** Where the secrets of a first start are written when nobody is at a terminal. */
export const FIRST_START_FILE = 'first-start-secrets.txt';

/** Make what a first start needs, and give it once: printed at a terminal, else in a file in `dir`. */
export async function firstStart(workspaces: Workspaces, main: Workspace, dir: string, terminal = Boolean(process.stdout.isTTY)): Promise<string | undefined> {
  const said: string[] = [];
  const operator = await workspaces.ensureOperator();
  if (operator) said.push(`Operator secret (creates workspaces; shown once):\n  ${operator}`);
  if (!(await hasHumanToken(main.pelago.db))) {
    const owner = await createToken(main.pelago.db, main.id, { kind: 'human', name: 'owner', admin: true });
    said.push(`Your token for the default workspace (shown once):\n  ${owner.token}\nPaste it into the web UI, and set PELAGO_TOKEN for the CLI.`);
  }
  if (!said.length) return undefined;
  if (terminal) {
    console.log(`\n${said.join('\n\n')}`);
    return undefined;
  }
  const file = join(dir, FIRST_START_FILE);
  writeFileSync(file, `${said.join('\n\n')}\n\nRead this once, keep what it holds somewhere safe, and delete this file.\n`, { mode: 0o600 });
  console.log(`\nFirst start: the operator secret and the owner's token are in ${file}, readable only by this server's user. Read it once, then delete it.`);
  return file;
}
