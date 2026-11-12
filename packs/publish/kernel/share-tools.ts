// Ways to read from outside the map: a public view anyone may open (src/public-view.ts), made, listed and taken down by
// a person, and publishing a document. Links with a secret went with public views (the owner, 11 Nov 2026).

import { z } from 'zod';
import { readDocument } from '../../../src/documents.ts';
import { share, unshare } from '../../../src/public-view.ts';
import { shareAsk, sharedViews, sharePlan } from './public-view-freeze.ts';
import { publish, publishAll, unpublish } from '../../../src/published.ts';
import { publishAsk, publishedState, publishPlan } from './published-freeze.ts';
import { picturesOf } from './published-pictures.ts';
import type { Tool } from '../../../src/tools.ts';

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
      'A document read whole, as its reader meets it (any other item is read the same way, by its note): its text, and in their places the items it brings in (a line of its note holding only an item’s id), each with its title, state and note. ' +
      'To write one, make an item of type document (or any type a screen reads whole) whose note is the text, and put an item’s id alone on a line where that item belongs; a lens’s id brings in its view, drawn live in the app. Write each such item for the document’s reader, and make it part of the document (part_of), so the document holds its sections and what the document is part of shows the document, not each section; not_inside names the sections kept elsewhere. A section can be brought into other documents too. Only the owner can give someone a link to it.',
    input: {
      id: z.string(),
      drawn: z.boolean().optional().describe('true for the drawing of each view it brings in as well, as publishing would keep it (lenses): for a page that draws a draft.'),
    },
    run: async (l, _actor, input) => {
      const doc = await readDocument(l, input.id);
      if (!input.drawn) return doc;
      const sections = doc.parts.flatMap((p) => ('section' in p ? [p.section] : []));
      return { ...doc, ...(await picturesOf(l, sections, false)) };
    },
  },
  share_create: {
    description: 'Make a view, a document or any item public as it stands now, frozen, at /p/<workspace>/<id> for anyone and for search engines (and at its path on its site, when it has one). What is private is left out; share_plan says what goes out first. Sharing it again replaces what is public. Only a person shares: an agent asks with the ask verb, action share_ask.',
    humanOnly: true,
    input: { id: z.string().describe('The view, document or item.') },
    run: async (l, actor, input) => share(l, actor, input.id),
  },
  share_plan: {
    description: 'What making a view, document or item public would take out with it (goes), what it leaves out because it is private, and whether it is public already: asked before it is shared, since it is frozen when shared.',
    input: { id: z.string().describe('The view, document or item.') },
    run: (l, _actor, input) => sharePlan(l, input.id),
  },
  share_list: {
    description: 'Every public view of this workspace, newest first, or with id the one of that item: what it is of, its address, who shared it and when.',
    input: { id: z.string().optional().describe('Only the public view of this item.') },
    run: async (l, _actor, input) => sharedViews(l, input.id),
  },
  share_revoke: {
    description: 'Take a public view down, at once: its address answers nothing, and the item itself is left as it is.',
    humanOnly: true,
    input: { id: z.string().describe('The item whose public view to take down.') },
    run: async (l, actor, input) => unshare(l, actor, input.id),
  },
  share_ask: {
    description: 'Ask the person to make a view, document or item public: they are notified about it, and share it from its page. Sharing is theirs; this never shares.',
    input: { id: z.string().describe('The view, document or item.'), reason: z.string().optional().describe('Why, in a sentence.') },
    run: async (l, actor, input) => shareAsk(l, actor, input.id, input.reason),
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
};
