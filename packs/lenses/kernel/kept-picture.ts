// answer.kept_picture: the picture of a view kept on the map (./query-saved.ts, keptPicture), for the publish pack, which
// freezes it when a document or a view is made public. Answered as the map that asks, under its row-level security.

import type { KernelContext } from '#pelago/kernel';
import { keptPicture } from './query-saved.ts';

export const keptPictureOf = (ctx: KernelContext, input: { id: string }) => keptPicture(ctx, String(input?.id));
