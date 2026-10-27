// Ways to read one document from outside: a link that lets someone with no login read it, and a share with another
// workspace on this server. Made, listed and revoked by the owner; a shared one read where it is shared.

import { z } from 'zod';
import { createShare, listShares } from './documents.ts';
import { picturesOf, publish, publishAll, publishAsk, publishedState, publishPlan, unpublish } from './published.ts';
import type { Tool } from './tools.ts';
import { endShare, readAny, sharedFigure, sharedPictures, shareWithWorkspace } from './workspace-share.ts';

const authority = z
  .object({
    of: z.enum(['human', 'agent']).describe('"human" when a person told you to publish it; "agent" when it is your own judgment.'),
    basis: z.string().optional().describe('For "human": what they said and where (required). For "agent": what it rests on.'),
  })
  .optional()
  .describe('On whose authority an agent publishes, kept on the event it logs. Left out, it is recorded as your own judgment.');

export const SHARE_TOOLS: Record<string, Tool> = {
  document: {
    description:
      'A document read whole, as its reader meets it: its text, and in their places the items it brings in (a line of its note holding only an item’s id), each with its title, state and note. A document another workspace shares with this one (sys.shared_document) is read from that workspace once it is accepted. ' +
      'To write one, make an item of type work.document (or any type a screen reads whole) whose note is the text, and put an item’s id alone on a line where that item belongs; a lens’s id brings in its view, drawn live in the app. Write each such item for the document’s reader, and make it part of the document (part_of), so the document holds its sections and what the document is part of shows the document, not each section; not_inside names the sections kept elsewhere. A section can be brought into other documents too. Only the owner can give someone a link to it.',
    input: {
      id: z.string(),
      drawn: z.boolean().optional().describe('true for the drawing of each view it brings in as well, as publishing would keep it (lenses): for a page that draws a draft. Through a share, only one that may be published here.'),
    },
    run: async (l, _actor, input) => {
      const doc = await readAny(l, input.id);
      if (!input.drawn) return doc;
      const sections = doc.parts.flatMap((p) => ('section' in p ? [p.section] : []));
      return { ...doc, ...('from' in doc ? await sharedPictures(l, input.id, sections) : await picturesOf(l, sections, false)) };
    },
  },
  share_create: {
    description: 'Make a link that lets someone with no login read one document and the items it brings in. The link is shown once.',
    humanOnly: true,
    input: { id: z.string().describe('The document.') },
    run: async (l, actor, input) => createShare(l, actor, input.id),
  },
  share_workspace: {
    description: 'Share one document with another workspace on this server, for those there to read and nobody else. It arrives there as an offer to accept, if that workspace accepts shares from this one. An admin’s.',
    humanOnly: true,
    input: {
      id: z.string().describe('The document.'),
      workspace: z.string().describe('The id of the workspace to share it with.'),
      publish: z.boolean().optional().describe('true to let that workspace publish it too, as this map gives it, until the share is revoked: revoking takes it down there.'),
    },
    run: async (l, actor, input) => shareWithWorkspace(l, actor, input),
  },
  share_list: {
    description: 'The links and workspace shares made to a document, standing ones first. Secrets are never shown.',
    humanOnly: true,
    input: { id: z.string().describe('The document.') },
    run: async (l, _actor, input) => listShares(l, input.id),
  },
  share_revoke: {
    description: 'Stop a link to a document, or its share with a workspace, from working, at once.',
    humanOnly: true,
    input: { id: z.string().describe('The link or share, from share_list.') },
    run: async (l, actor, input) => endShare(l, actor, input.id),
  },
  publish: {
    description: 'Publish a document as it stands: it becomes public, and what anyone reads at its address (/p/<workspace>/<id>) is this, frozen, until it is published again. Its lenses are kept as views a reader can explore. An agent may publish only where the owner allows it (agent_publish); elsewhere ask with the ask verb, action publish_ask.',
    input: { id: z.string().describe('The document.'), authority },
    run: async (l, actor, input) => publish(l, actor, input.id, input.authority),
  },
  unpublish: {
    description: 'Take a published document down: its address answers nothing, and it is shared with the workspace again.',
    humanOnly: true,
    input: { id: z.string().describe('The document.') },
    run: async (l, actor, input) => unpublish(l, actor, input.id),
  },
  publish_all: {
    description: 'Publish every open document an item holds (part_of, at any depth), then publish them again so each links to the others at their addresses. One whose path is taken is named, and the rest go ahead. An agent may only where the owner allows it, as with publish.',
    input: { within: z.string().describe('The item that holds the documents, such as a site’s project.'), authority },
    run: async (l, actor, input) => publishAll(l, actor, input.within, input.authority),
  },
  publish_plan: {
    description: 'Which documents an item holds and whether each is published as it stands: those not yet published or changed since are counted in to_publish.',
    input: { within: z.string().describe('The item that holds the documents.') },
    run: async (l, _actor, input) => publishPlan(l, input.within),
  },
  publish_ask: {
    description: 'Ask the person to publish an item’s documents: they are notified about the item, with what changed, and publish all of it with one click on its page. Publishing is theirs; this never publishes.',
    input: { within: z.string().describe('The item that holds the documents.'), reason: z.string().optional().describe('Why now, in a sentence.') },
    run: async (l, actor, input) => publishAsk(l, actor, input.within, input.reason),
  },
  published: {
    description: 'Whether a document is published, when and by whom, and whether its draft now says something other than what is published (changed): then only a human publishing it again changes what anyone reads.',
    input: { id: z.string().describe('The document.') },
    run: async (l, _actor, input) => publishedState(l, input.id),
  },
  share_figure: {
    description: 'The figure of one section of a document another workspace shares with this one, as base64 with its content type, or null.',
    input: { via: z.string().describe('The shared document here.'), id: z.string().describe('The section, as query document names it.') },
    run: async (l, _actor, input) => sharedFigure(l, input),
  },
};
