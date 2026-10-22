// The reader's way to the repositories it reads, until it is a pack itself (step 3 of "GitHub, the push reader and
// the launcher as packs"): the GitHub App is a server pack now (packs/github_app), and the reader asks GitHub through
// the host that pack declares, as the installation a workspace connected, with the token the kernel trades for it.
// It is also told of each push the App hands to a workspace, and reads it there; and its tool says what it runs on
// and starts a re-check by hand.

import { z } from 'zod';
import { connection, hasModel, NO_MODEL } from './model-account.ts';
import { wholeMap } from './outbox.ts';
import { readable, readPush, recheck } from './reader.ts';
import type { Reach } from './reader-push.ts';
import type { Delivered } from './server-connect.ts';
import type { ServerPacks } from './server-host.ts';
import type { Tool } from './tools.ts';

/** The server pack that is the GitHub App, and the host it asks GitHub's API through. */
const APP = 'github_app';
const API = 'api';

export interface AppReach extends Reach {
  /** The installation a workspace connected, if it has. */
  installationOf(workspace: string): Promise<{ id: string; account: string } | undefined>;
}

export function appReach(packs: ServerPacks): AppReach {
  const ask = async (installation: string, path: string) => {
    const made = await packs.request(APP, { host: API, path, as: installation });
    const answer = (made.body ?? {}) as { message?: string };
    if (made.status >= 300) throw new Error(`GitHub answered ${made.status}${answer.message ? `: ${answer.message}` : ''} to GET ${path}`);
    return answer;
  };
  return {
    installationOf: async (workspace) => {
      const c = await packs.connectionOf(APP, workspace);
      return c && { id: c.id, account: c.account };
    },
    asInstallation: ask,
    repositories: async (installation) => {
      const names: string[] = [];
      for (let page = 1; page <= 10; page++) {
        const answer = (await ask(installation, `/installation/repositories?per_page=100&page=${page}`)) as { repositories?: { full_name: string }[] };
        names.push(...(answer.repositories ?? []).map((r) => r.full_name));
        if ((answer.repositories ?? []).length < 100) break;
      }
      return names;
    },
  };
}

/**
 * A push the App handed to a workspace, once its GitHub pack recorded it: a push of commits to a branch is read
 * against the map, by the agent on this server. GitHub is not kept waiting for that: it is answered now, and the
 * run says what it did when it is over.
 */
export function readOnPush(reach: AppReach): Delivered {
  return async ({ l, pack, connection: c, event, payload, answer, hold }) => {
    if (pack !== APP || event !== 'repo.push') return;
    const p = (payload ?? {}) as { after?: string; before?: string; repository?: { full_name?: string; default_branch?: string } };
    const taken = answer as { recorded?: boolean; repo?: { id: string; title: string }; branch?: string; deleted?: boolean; commits?: number };
    const reading = Boolean(taken.recorded && taken.repo && taken.branch && !taken.deleted && taken.commits && p.after && p.repository?.full_name) && (await hasModel(l));
    if (reading) {
      const release = hold();
      void readPush(l, reach, { installation: c.id, name: p.repository!.full_name!, entity: taken.repo! }, { branch: taken.branch!, default_branch: p.repository!.default_branch ?? taken.branch!, before: p.before ?? '0', after: p.after! })
        .then((r) => console.log(`reader: ${p.repository!.full_name} ${p.after!.slice(0, 7)}: ${r.ran ? `${r.ok ? 'done' : 'failed'}, ${r.tokens} tokens` : r.reason}`))
        .catch((err) => console.error(`reader: ${(err as Error).message}`))
        .finally(release);
    }
    return { reading };
  };
}

/** The App as the reader reaches it, set by the server. */
let reach: AppReach | undefined;
export function configureReader(r: AppReach | undefined): void {
  reach = r;
}

export const READER_TOOLS: Record<string, Tool> = {
  reader: {
    description:
      'The agent on this server that reads each push to a repository connected through the GitHub App: what it runs on (the workspace’s model account, see model_account, or the server’s model); without one, pushes are recorded but not read. ' +
      'recheck: a repository’s id, to have it re-check that repository’s oldest open items against the code now, without waiting for one to be due. It runs on the workspace’s key, and its run shows on the repository’s page when it is over. Admins only for that.',
    humanOnly: true,
    input: { recheck: z.string().optional().describe('A repository’s id.') },
    run: async (l, actor, input) => {
      const whole = await wholeMap(l);
      const status = async () => {
        const on = await connection(whole);
        return on ? { model: on.model, from: on.from } : { model: null, from: null };
      };
      if (!input.recheck) return status();
      if (!actor.admin) throw new Error('Only a workspace admin can start a re-check.');
      const mine = reach && (await reach.installationOf(l.workspace));
      if (!reach || !mine) throw new Error('This workspace has not connected GitHub, so there is nothing for the agent to read the repository through.');
      if (!(await connection(whole))) throw new Error(NO_MODEL);
      const repo = (await readable(whole, reach, mine.id)).find((r) => r.entity.id === input.recheck);
      if (!repo) throw new Error('That is not a repository the GitHub App was given. Choose it on GitHub first (Workspace, Connections).');
      const about = (await reach.asInstallation(mine.id, `/repos/${repo.name}`)) as { default_branch?: string };
      // Not waited for: it takes minutes, and says what it did as a run when it is over.
      void recheck(whole, reach, repo, about.default_branch ?? 'main', true).catch((err) => console.error(`reader: re-check of ${repo.name} failed: ${(err as Error).message}`));
      return { ...(await status()), started: true };
    },
  },
};
