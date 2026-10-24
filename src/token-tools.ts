// Making, listing and revoking tokens. A token acts for a person; an agent's can be scoped: within an item (it writes
// only what is part of it, what lives in it or is about it) and may report (send only what a system measured),
// propose (every change waits for a person) or change (as any agent, under the workspace's setting).

import { z } from 'zod';
import { createToken, listTokens, revokeToken } from './auth.ts';
import { humanTokenAllowed } from './members.ts';
import type { Actor } from './pelago.ts';
import type { Tool } from './tools.ts';

const needAdmin = (actor: Actor, what: string) => {
  if (!actor.admin) throw new Error(`Only a workspace admin can ${what}.`);
};

export const TOKEN_TOOLS: Record<string, Tool> = {
  token_create: {
    description:
      'Make a token. Anyone can make an agent token that acts for themselves: it sees what they see and proposes to them. Only an admin can make a token for someone else or for a human. The secret is shown once. ' +
      'An agent’s token can be scoped. within: the items it writes within (each with all that is part of it, lives in it or is about it); it still reads the map as its person does. ' +
      'may: report (it can only send what a system measured, with report, action health), propose (every change it sends waits for a person) or change (the default: as any agent, under the workspace’s setting). Give it an expiry (expires_days) unless there is a reason not to.',
    humanOnly: true,
    input: {
      kind: z.enum(['human', 'agent']),
      name: z.string().min(1).describe('Who or what will use it, e.g. "claude-code". Recorded against everything done with it.'),
      entity: z.string().optional().describe('Id of the person this token is, or acts for. Defaults to you.'),
      admin: z.boolean().optional(),
      expires_days: z.number().int().positive().optional(),
      within: z.array(z.string()).optional().describe('Ids of the items an agent’s token writes within. Left out: everything.'),
      may: z.enum(['report', 'propose', 'change']).optional().describe('What an agent’s token may do. Left out: change.'),
    },
    run: async (l, actor, input) => {
      const entity = input.entity ?? actor.person;
      if (input.kind === 'human' || input.admin || entity !== actor.person) needAdmin(actor, 'make a token for anyone but an agent acting for yourself');
      if ((input.within?.length || (input.may && input.may !== 'change')) && input.kind !== 'agent') throw new Error('Only an agent’s token can be scoped.');
      for (const id of input.within ?? []) if (!(await l.entity(id))) throw new Error(`"${id}" is no item in this map, so a token cannot be within it.`);
      if (input.kind === 'human') await humanTokenAllowed(l, entity);
      return createToken(l.db, l.workspace, { ...input, entity });
    },
  },
  token_list: {
    description: 'List tokens: an admin sees the whole workspace’s, anyone else their own. Secrets are never shown. Each says what it is within, by name, and what it may do.',
    humanOnly: true,
    input: { within: z.string().optional().describe('Only the tokens within this item.'), q: z.string().optional().describe('Only the tokens whose name holds this, in any case.') },
    run: async (l, actor, input) => {
      const q = input.q?.trim().toLowerCase();
      const tokens = (await listTokens(l.db, actor.admin ? undefined : (actor.person ?? ''))).filter((t) => (!input.within || t.within?.includes(input.within)) && (!q || t.name.toLowerCase().includes(q)));
      return Promise.all(tokens.map(async (t) => ({ ...t, within_titles: t.within && (await Promise.all(t.within.map(async (id) => (await l.entity(id))?.title ?? id))) })));
    },
  },
  token_revoke: {
    description: 'Revoke a token at once. An admin can revoke any; anyone else only their own.',
    humanOnly: true,
    input: { id: z.string() },
    run: async (l, actor, input) => revokeToken(l.db, input.id, actor.admin ? undefined : (actor.person ?? '')),
  },
};
