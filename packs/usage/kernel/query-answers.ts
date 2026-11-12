// What the usage pack answers the query pack by name (pack.json, kernel.provides): the standing view usage.

import type { KernelContext } from '#pelago/kernel';
import { usage } from './usage.ts';

/** `answer.usage`: what the workspace uses of each limit and what that use is made of; admin: the asker is an admin (members are counted for them alone). */
export const usageOf = (ctx: KernelContext, input: Record<string, unknown> & { admin?: boolean }) => usage(ctx, input ?? {}, { admin: input?.admin === true });
