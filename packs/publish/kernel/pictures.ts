// The pictures kept for items whose page shows one: a figure (a test result's, a commit's, an experiment's, an issue's, a
// note's, a file's), and the still of a lens. What a test run found is the software pack's test_report, which asks for
// pictures to be dropped. Keeping one is the rules root's (root.picture: the walls' SVG check, room to store, the write
// and its observation); what may be kept on what is said here first.

import type { KernelContext } from '#pelago/kernel';
import { actorId, drawnWith, itemOf, type Actor } from './map.ts';

/** The most a kept picture may weigh. A capture of a view at screen size is well under it. */
export const PICTURE_MAX = 1_000_000;
/** An SVG is a figure baked from a drawing's shapes, kept only when it is drawing alone (src/svg-figure.ts). */
export const PICTURE_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/svg+xml'] as const;

/**
 * Keep the picture for an item whose page shows one (a screen of it draws a
 * figure: a test result, a commit, an experiment, an issue, a note, a file), or for a lens the picture a link
 * shows in place of the live one. A result's is meant for one that is shown
 * in public: until then the picture stays in the repository it was made in.
 * There is one per item; sent again, it replaces what was kept.
 */
export async function putPicture(ctx: KernelContext, actor: Actor, input: { result: string; data: string; content_type: string }) {
  const result = await itemOf(ctx, input.result);
  if (!result) throw new Error(`picture_put: there is no item "${input.result}".`);
  const keeps = [...drawnWith(ctx.registry, 'figure'), ...ctx.registry.family('lens')];
  if (!keeps.includes(result.type)) throw new Error(`picture_put: "${input.result}" is of type ${result.type}, and a picture is kept only on a type whose page shows one (${keeps.join(', ')}). For one to be kept on a ${result.type}, a pack needs a screen on that type with the figure piece.`);
  if (!(PICTURE_TYPES as readonly string[]).includes(input.content_type)) throw new Error(`picture_put: the picture must be one of ${PICTURE_TYPES.join(', ')}, not ${input.content_type}.`);
  const bytes = Buffer.from(input.data, 'base64');
  if (!bytes.length) throw new Error('picture_put: "data" is empty. Send the file as base64.');
  if (bytes.length > PICTURE_MAX) throw new Error(`picture_put: the picture is ${bytes.length} bytes; the most kept is ${PICTURE_MAX}. Make it smaller.`);
  await ctx.call('root.picture', { id: result.id, actor: actorId(actor), content_type: input.content_type, data: bytes.toString('base64') });
  return { result: result.id, size: bytes.length, content_type: input.content_type };
}

/** The picture kept for a result, as base64, or null when none is. */
export async function getPicture(ctx: KernelContext, input: { result: string }) {
  const kept = (await ctx.reads({ picture: input.result })) as { content_type: string; size: number; data: string } | null;
  return kept ? { result: input.result, content_type: kept.content_type, size: kept.size, data: kept.data } : null;
}

/** act.capture.picture: the tool surface's picture_put, as the actor it names. */
export const pictureAct = (ctx: KernelContext, input: { actor: Actor; result: string; data: string; content_type: string }) => putPicture(ctx, input.actor, input);
