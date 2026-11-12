// Ways to read from outside the map: a public view anyone may open (./public-view.ts), made, listed and taken down by
// a person, and publishing a document. Links with a secret went with public views (the owner, 11 Nov 2026).
//
// On the publish pack's context, as the rest of it: each tool's input is a JSON shape the surface builds its schema
// from (packs/surface/kernel/tool-input.ts), its run is handed the pack's context of the map it is called on (the
// adapter at src/share-tools.ts), and an agent's ask (share_ask, publish_ask) is a notification made as that agent, by
// the notifications pack's name (act.report.notify).

import type { KernelContext } from '#pelago/kernel';
import { readDocument } from './document-read.ts';
import { itemOf, type Actor, type Said } from './map.ts';
import { share, unshare } from './public-view.ts';
import { sharedViews, sharePlan } from './public-view-freeze.ts';
import { publish, publishAll, unpublish } from './published.ts';
import { publishedState, publishPlan } from './published-freeze.ts';
import { picturesOf } from './published-pictures.ts';

const ID = /^e_[a-z0-9]{8}$/;

/** A notification for the person, made as the agent that asks. */
const ask = (ctx: KernelContext, actor: Actor, title: string, body: string, about: string) => ctx.call('act.report.notify', { actor: { kind: actor.kind, name: actor.name }, title, body, about });

/** An agent asks the person to make a view or an item public: a notification about it, which they share from its page. */
export async function shareAsk(ctx: KernelContext, actor: Actor, id: string, reason?: string) {
  const item = ID.test(id) ? await itemOf(ctx, id) : null;
  if (!item) throw new Error(`"${id}" is not an item of this workspace you can read.`);
  if (item.archived_at) throw new Error(`"${item.title}" is archived.`);
  await ask(ctx, actor, `Make "${item.title}" public`.slice(0, 200), reason ?? '', id);
  return { asked: true, note: 'The person is notified; making it public is theirs.' };
}

/** An agent asks for an item's documents to be published: a notification about it for the person, who publishes with one click. */
export async function publishAsk(ctx: KernelContext, actor: Actor, within: string, reason?: string) {
  const plan = await publishPlan(ctx, within);
  if (!plan.to_publish) return { asked: false, note: `Everything in "${plan.within.title}" is published as it stands.` };
  const n = plan.to_publish;
  const title = `${n} document${n === 1 ? '' : 's'} in "${plan.within.title}" to publish`.slice(0, 200);
  await ask(ctx, actor, title, [reason, plan.documents.filter((d) => d.changed).map((d) => `- ${d.title}`).join('\n')].filter(Boolean).join('\n\n'), within);
  return { asked: true, to_publish: n, note: 'The person is notified; publishing is theirs, with one click on the item’s page.' };
}

/** A tool as this pack declares it: its input a JSON shape, what each field is for in `says`, run on the pack's context. */
export interface ShareTool {
  description: string;
  humanOnly?: boolean;
  /** A read: an agent reaches it through query, by its own name. */
  query?: boolean;
  /** It reads an item whole, as its reader meets it: the read the page draws such an item by. */
  whole?: boolean;
  input: Record<string, unknown>;
  says?: Record<string, string>;
  run(ctx: KernelContext, actor: Actor, input: any): Promise<unknown>;
}

/** On whose authority an agent publishes: the shape, and what it and each of its fields is for. */
const AUTHORITY = { 'authority?': { of: ['human', 'agent'], 'basis?': 'string' } };
const AUTHORITY_SAYS = {
  authority: 'On whose authority an agent publishes, kept on the event it logs. Left out, it is recorded as your own judgment.',
  'authority.of': '"human" when a person told you to publish it; "agent" when it is your own judgment.',
  'authority.basis': 'For "human": what they said and where (required). For "agent": what it rests on.',
};
const ITEM = 'The view, document or item.';
const DOCUMENT = 'The document.';
const WITHIN = 'The item that holds the documents.';

export const SHARE_TOOLS: Record<string, ShareTool> = {
  document: {
    query: true,
    whole: true,
    description:
      'A document read whole, as its reader meets it (any other item is read the same way, by its note): its text, and in their places the items it brings in (a line of its note holding only an item’s id), each with its title, state and note. ' +
      'To write one, make an item of type document (or any type a screen reads whole) whose note is the text, and put an item’s id alone on a line where that item belongs; a lens’s id brings in its view, drawn live in the app. Write each such item for the document’s reader, and make it part of the document (part_of), so the document holds its sections and what the document is part of shows the document, not each section; not_inside names the sections kept elsewhere. A section can be brought into other documents too. Only the owner can give someone a link to it.',
    input: { id: 'string', 'drawn?': 'boolean' },
    says: { drawn: 'true for the drawing of each view it brings in as well, as publishing would keep it (lenses): for a page that draws a draft.' },
    run: async (ctx, _actor, input: { id: string; drawn?: boolean }) => {
      const doc = await readDocument(ctx, input.id);
      if (!input.drawn) return doc;
      const sections = doc.parts.flatMap((p) => ('section' in p ? [p.section] : []));
      return { ...doc, ...(await picturesOf(ctx, sections, false)) };
    },
  },
  share_create: {
    description: 'Make a view, a document or any item public as it stands now, frozen, at /p/<workspace>/<id> for anyone and for search engines (and at its path on its site, when it has one). What is private is left out; share_plan says what goes out first. Sharing it again replaces what is public. Only a person shares: an agent asks with the ask verb, action share_ask.',
    humanOnly: true,
    input: { id: 'string' },
    says: { id: ITEM },
    run: async (ctx, actor, input: { id: string }) => share(ctx, actor, input.id),
  },
  share_plan: {
    description: 'What making a view, document or item public would take out with it (goes), what it leaves out because it is private, and whether it is public already: asked before it is shared, since it is frozen when shared.',
    input: { id: 'string' },
    says: { id: ITEM },
    run: (ctx, _actor, input: { id: string }) => sharePlan(ctx, input.id),
  },
  share_list: {
    description: 'Every public view of this workspace, newest first, or with id the one of that item: what it is of, its address, who shared it and when.',
    input: { 'id?': 'string' },
    says: { id: 'Only the public view of this item.' },
    run: async (ctx, _actor, input: { id?: string }) => sharedViews(ctx, input.id),
  },
  share_revoke: {
    description: 'Take a public view down, at once: its address answers nothing, and the item itself is left as it is.',
    humanOnly: true,
    input: { id: 'string' },
    says: { id: 'The item whose public view to take down.' },
    run: async (ctx, actor, input: { id: string }) => unshare(ctx, actor, input.id),
  },
  share_ask: {
    description: 'Ask the person to make a view, document or item public: they are notified about it, and share it from its page. Sharing is theirs; this never shares.',
    input: { id: 'string', 'reason?': 'string' },
    says: { id: ITEM, reason: 'Why, in a sentence.' },
    run: async (ctx, actor, input: { id: string; reason?: string }) => shareAsk(ctx, actor, input.id, input.reason),
  },
  publish: {
    description: 'Publish a document as it stands: it becomes public, and what anyone reads at its address (/p/<workspace>/<id>) is this, frozen, until it is published again. Its lenses are kept as views a reader can explore. An agent may publish only where the owner allows it (agent_publish); elsewhere ask with the ask verb, action publish_ask.',
    input: { id: 'string', ...AUTHORITY },
    says: { id: DOCUMENT, ...AUTHORITY_SAYS },
    run: async (ctx, actor, input: { id: string; authority?: Said }) => publish(ctx, actor, input.id, input.authority),
  },
  unpublish: {
    description: 'Take a published document down: its address answers nothing, and it is shared with the workspace again.',
    humanOnly: true,
    input: { id: 'string' },
    says: { id: DOCUMENT },
    run: async (ctx, actor, input: { id: string }) => unpublish(ctx, actor, input.id),
  },
  publish_all: {
    description: 'Publish every open document an item holds (part_of, at any depth), then publish them again so each links to the others at their addresses. One whose path is taken is named, and the rest go ahead. An agent may only where the owner allows it, as with publish.',
    input: { within: 'string', ...AUTHORITY },
    says: { within: 'The item that holds the documents, such as a site’s project.', ...AUTHORITY_SAYS },
    run: async (ctx, actor, input: { within: string; authority?: Said }) => publishAll(ctx, actor, input.within, input.authority),
  },
  publish_plan: {
    query: true,
    description: 'Which documents an item holds and whether each is published as it stands: those not yet published or changed since are counted in to_publish.',
    input: { within: 'string' },
    says: { within: WITHIN },
    run: async (ctx, _actor, input: { within: string }) => publishPlan(ctx, input.within),
  },
  publish_ask: {
    description: 'Ask the person to publish an item’s documents: they are notified about the item, with what changed, and publish all of it with one click on its page. Publishing is theirs; this never publishes.',
    input: { within: 'string', 'reason?': 'string' },
    says: { within: WITHIN, reason: 'Why now, in a sentence.' },
    run: async (ctx, actor, input: { within: string; reason?: string }) => publishAsk(ctx, actor, input.within, input.reason),
  },
  published: {
    query: true,
    description: 'Whether a document is published, when and by whom, and whether its draft now says something other than what is published (changed): then only a human publishing it again changes what anyone reads.',
    input: { id: 'string' },
    says: { id: DOCUMENT },
    run: async (ctx, _actor, input: { id: string }) => publishedState(ctx, input.id),
  },
};
