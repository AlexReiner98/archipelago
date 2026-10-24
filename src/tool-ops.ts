// The shapes the tools share: an op of a change, the source of a fact, who may see an item. One schema, so every
// tool that takes ops (change, and the human's decide) is checked the same way.

import { z } from 'zod';

export const props = z.record(z.string(), z.unknown());
export const visibility = z.enum(['private', 'shared', 'public']).describe('private: only its author. shared: everyone in the workspace. public: anyone, with no login, on the product’s public page, or a document at its own address (/p/<workspace>/<id>) with the sections it holds; only a project, feature, release, proof question, test, test result or document can be, and only a human makes it so (from an agent it waits as a proposal).');
const confidence = z.number().min(0).max(1);
export const BRANCH = z.string().optional().describe('The git branch you work on (git branch --show-current).');
const field = z.object({
  type: z.enum(['string', 'number', 'boolean', 'date', 'datetime', 'url', 'enum', 'json']),
  values: z.array(z.string()).optional(),
  description: z.string().optional(),
  default: z.unknown().optional(),
  shown: z.boolean().optional().describe('Sent with the item in a lens answer, so a style can draw by it.'),
});

export const source = z.object({
  uri: z.string().describe('A stable address: file path, URL, message id or commit.'),
  title: z.string().optional(),
  kind: z.enum(['file', 'email', 'web', 'conversation', 'commit', 'other']).optional(),
  excerpt: z.string().optional().describe('The passage the facts were drawn from.'),
});
const opSource = source.optional().describe('Where this one fact came from, when it differs from the source of the whole change.');

/** The longest name an agent may give a thing. A name is read in a row, a box and a tooltip; a sentence does not fit any of them. */
export const TITLE_MAX = 60;
const NAME = `A name, not a sentence: ${TITLE_MAX} characters at most. What else there is to say goes in the note.`;

export const op = z.discriminatedUnion('op', [
  z.object({
    op: z.literal('create'),
    ref: z.string().optional().describe('A name for this new item that later ops in the same change can use in place of an id.'),
    type: z.string(),
    title: z.string().describe(NAME),
    body: z.string().optional(),
    status: z.string().optional(),
    owner: z.string().optional().describe('Id or ref of a person or agent.'),
    visibility: visibility.optional(),
    confidence: confidence.optional(),
    props: props.optional().describe('Only the fields the type declares. See query schema.'),
    source: opSource,
  }),
  z.object({
    op: z.literal('update'),
    id: z.string(),
    title: z.string().optional().describe(NAME),
    body: z.string().optional().describe('The whole note, replacing what is there. To change part of a note, use append or replace instead.'),
    append: z.string().optional().describe('Added to the end of the note after a blank line; the rest is left as it is. For an outcome, a new sighting, a further finding.'),
    replace: z
      .object({ find: z.string().min(1).describe('An exact passage of the note as it is now. It must be there exactly once.'), with: z.string().describe('What goes in its place; empty to remove it.') })
      .optional()
      .describe('Replace one passage of the note; the rest is left as it is.'),
    status: z.string().optional(),
    owner: z.string().nullable().optional(),
    visibility: visibility.optional(),
    confidence: confidence.optional(),
    props: props.optional().describe('Merged into existing props. Set a field to null to clear it.'),
  }),
  z.object({
    op: z.literal('link'),
    type: z.string().describe('A link type, e.g. depends_on.'),
    from: z.string().describe('Id or ref.'),
    to: z.string().describe('Id or ref.'),
    props: props.optional(),
    confidence: confidence.optional(),
    source: opSource,
  }),
  z.object({ op: z.literal('unlink'), relation: z.string().describe('The link\'s id, from query get.') }),
  z.object({ op: z.literal('archive'), id: z.string() }),
  z.object({ op: z.literal('restore'), id: z.string().describe('An archived item to bring back.') }),
  z.object({ op: z.literal('merge'), keep: z.string(), drop: z.string().describe('Its links move to keep, then it is archived.') }),
  z.object({
    op: z.literal('define_type'),
    type: z.object({
      id: z.string().describe('Must look like "local.my_type".'),
      title: z.string(),
      description: z.string(),
      extends: z.string().optional().describe('Needed: one of the seven kinds of the work (actor, aim, work, question, record, occurrence, place) or a type of one; it inherits fields, statuses and the kind.'),
      statuses: z.object({ open: z.array(z.string()).min(1), closed: z.array(z.string()) }).optional(),
      fields: z.record(z.string(), field).optional(),
      deliverable: z.boolean().optional().describe('true when it is made for a reader or a customer, like a document or a release: what it is part of names it under its title.'),
    }),
  }),
]);
