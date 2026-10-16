// Links that let someone with no login read one document: made, listed and revoked by the owner.

import { z } from 'zod';
import { createShare, listShares, revokeShare } from './documents.ts';
import type { Tool } from './tools.ts';

export const SHARE_TOOLS: Record<string, Tool> = {
  share_create: {
    description: 'Make a link that lets someone with no login read one document and the items it brings in. The link is shown once.',
    humanOnly: true,
    input: { id: z.string().describe('The document.') },
    run: async (l, actor, input) => createShare(l, actor, input.id),
  },
  share_list: {
    description: 'The links made to a document, standing ones first. Secrets are never shown.',
    humanOnly: true,
    input: { id: z.string().describe('The document.') },
    run: async (l, _actor, input) => listShares(l, input.id),
  },
  share_revoke: {
    description: 'Stop a link to a document from working, at once.',
    humanOnly: true,
    input: { id: z.string().describe('The link, from share_list.') },
    run: async (l, actor, input) => revokeShare(l, actor, input.id),
  },
};
