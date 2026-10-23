// A workspace's settings: read and changed by a human admin, never by an agent. What agents may do unreviewed here
// (apply their changes, download backups, publish documents) is the owner's to give and take back.

import { z } from 'zod';
import { endedOf } from './ended.ts';
import { limitOf } from './members.ts';
import { acceptedSenders } from './outbox.ts';
import { actorId, type Archipelago } from './pelago.ts';
import { liftsOn } from './rules.ts';
import type { Tool } from './tools.ts';

const settings = async (l: Archipelago) => {
  const { agent_backups, agent_publish, agent_code } = await liftsOn(l.db);
  return { id: l.workspace, default_visibility: await l.defaultVisibility(), agent_changes: await l.agentChanges(), accepts_from: await acceptedSenders(l), agent_backups, agent_publish, agent_code };
};

export const WORKSPACE_TOOLS: Record<string, Tool> = {
  workspace_info: {
    description: 'This workspace’s settings: its id, its owner (null until one is set with init), the default visibility of new things, whether agents’ changes are applied as they are made or held for a human, whether agents may download backups or publish documents, and which workspaces it accepts notifications from.',
    humanOnly: true,
    input: {},
    run: async (l) => {
      const { rows } = await l.db.query<{ id: string; title: string }>(`select e.id, e.title from setting s join entity e on to_jsonb(e.id) = s.value where s.key = 'me'`);
      return { ...(await settings(l)), owner: rows[0] ?? null, member_limit: (await limitOf(l.workspace)) ?? null, ended: (await endedOf(l.workspace)) ?? null };
    },
  },
  workspace_set: {
    description: 'Change workspace settings. default_visibility: whether new things are private to their author (the default) or shared unless they say otherwise. agent_changes: "apply" to have what agents change take effect as they make it, each change logged and undoable, or "hold" to have it wait for a human. With "apply" an agent can also settle a decision or a hypothesis: it must say what was chosen and why, and the human is notified. accepts_from: which other workspaces may send this one notifications. Admins only.',
    humanOnly: true,
    input: {
      default_visibility: z.enum(['private', 'shared']).optional(),
      agent_changes: z.enum(['apply', 'hold']).optional(),
      accepts_from: z.array(z.string()).optional().describe('Ids of the workspaces allowed to send this one notifications. Replaces the list.'),
      agent_backups: z.boolean().optional().describe('Whether agents may download the whole workspace as a backup file (backup_download), private items included.'),
      agent_publish: z.boolean().optional().describe('Whether agents may publish documents here (publish, publish_all), each publish logged with its authority. Taking one down stays a human’s.'),
      agent_code: z.boolean().optional().describe('Whether agents’ changes to the code a drawing or a style runs (modules, code) take effect as they make them, instead of waiting for a human. That code runs only in the sandbox; each change is logged and undoable.'),
    },
    run: async (l, actor, input) => {
      if (!actor.admin) throw new Error('Only a workspace admin can change workspace settings.');
      for (const [key, value] of Object.entries(input)) {
        await l.db.query(`insert into setting (key, value) values ($1, $2::jsonb) on conflict (key) do update set value = excluded.value`, [key, JSON.stringify(value)]);
        await l.log(l.db, { actor: actorId(actor), action: 'workspace.set', reason: `${key} set to ${JSON.stringify(value)}` });
      }
      return settings(l);
    },
  },
};
