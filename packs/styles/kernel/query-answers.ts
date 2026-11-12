// What the styles pack answers the query pack by name (pack.json, kernel.provides): the standing view style.

import type { KernelContext } from '#pelago/kernel';
import { pageStyle } from './styles.ts';

/** `answer.page_style`: how a page looks, as the standing view style answers it (styles.ts, pageStyle). */
export const pageStyleOf = (ctx: KernelContext, input: Parameters<typeof pageStyle>[1]) => pageStyle(ctx, input ?? {});
