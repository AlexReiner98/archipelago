// A new workspace's id, made from the name it is given: by a server pack that sells one (src/server-acts.ts) and by
// the sign-up page (src/signup.ts), from one list of ids nobody may take.

import { validWorkspaceId } from './auth.ts';
import type { Workspaces } from './workspaces.ts';

/** Ids no new workspace takes: the server's own names, and the paths it serves under (/x/ is a server pack's). */
export const RESERVED = ['default', 'www', 'app', 'api', 'admin', 'mail', 'staging', 'archipelago', 'x'];

/** A workspace id from a name: its words, lowercase and joined by hyphens, with a number added if it is taken. */
export async function freeId(at: Pick<Workspaces, 'has'>, name: string): Promise<string> {
  const base = name.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 30).replace(/-+$/, '') || 'workspace';
  for (let n = 1; n < 1000; n++) {
    const id = n === 1 ? base : `${base}-${n}`;
    if (validWorkspaceId(id) && !RESERVED.includes(id) && !(await at.has(id))) return id;
  }
  throw new Error('No free workspace id for that name.');
}
