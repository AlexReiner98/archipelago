// Ways to read one document from outside: a link that lets someone with no login read it, and a share with another
// workspace on this server. Made, listed and revoked by the owner; a shared one read where it is shared.

import { z } from 'zod';
import { createShare, listShares } from './documents.ts';
import { publish, publishedState, unpublish } from './published.ts';
import type { Tool } from './tools.ts';
import { endShare, readAny, sharedFigure, shareWithWorkspace } from './workspace-share.ts';

export const SHARE_TOOLS: Record<string, Tool> = {
  document: {
    description:
      'A document read whole, as its reader meets it: its text, and in their places the items it brings in (a line of its note holding only an item’s id), each with its title, state and note. A document another workspace shares with this one (sys.shared_document) is read from that workspace once it is accepted. ' +
      'To write one, make an item of type work.document (or any type a screen reads whole) whose note is the text, and put an item’s id alone on a line where that item belongs; a lens’s id brings in its picture, drawn live in the app. Write each such item for the document’s reader, and make it part of the document (part_of), so the document holds its sections and what the document is part of shows the document, not each section; not_inside names the sections kept elsewhere. A section can be brought into other documents too. Only the owner can give someone a link to it.',
    input: { id: z.string() },
    run: async (l, _actor, input) => readAny(l, input.id),
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
    input: { id: z.string().describe('The document.'), workspace: z.string().describe('The id of the workspace to share it with.') },
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
    description: 'Publish a document as it stands: it becomes public, and what anyone reads at its address (/p/<workspace>/<id>) is this, frozen, until it is published again. Its lenses are kept as pictures a reader can explore.',
    humanOnly: true,
    input: { id: z.string().describe('The document.') },
    run: async (l, actor, input) => publish(l, actor, input.id),
  },
  unpublish: {
    description: 'Take a published document down: its address answers nothing, and it is shared with the workspace again.',
    humanOnly: true,
    input: { id: z.string().describe('The document.') },
    run: async (l, actor, input) => unpublish(l, actor, input.id),
  },
  published: {
    description: 'Whether a document is published, when and by whom, and whether its draft now says something other than what is published (changed): then only a human publishing it again changes what anyone reads.',
    input: { id: z.string().describe('The document.') },
    run: async (l, _actor, input) => publishedState(l, input.id),
  },
  share_figure: {
    description: 'The figure of one section of a document another workspace shares with this one, as base64 with its content type, or null.',
    input: { via: z.string().describe('The shared document here.'), id: z.string().describe('The section, as the document tool names it.') },
    run: async (l, _actor, input) => sharedFigure(l, input),
  },
};
