// What the attention pack answers the query pack by name (pack.json, kernel.provides): the lens term moved's set.

import type { KernelContext } from '#pelago/kernel';
import { movedIds } from './moved.ts';

/** `answer.moved`: every open item whose reading has moved, as the viewer may see them (the lens term `moved`). */
export const moved = async (ctx: KernelContext, _input: unknown) => ({ ids: await movedIds(ctx) });
