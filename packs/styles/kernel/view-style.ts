// The style a kept view is drawn in, for the lenses pack's picture of it (service answer.view_style): the presets, the
// workspace's, the view's own layout and settings, the style it names, with the drawing that style names.

import type { KernelContext } from '#pelago/kernel';
import { drawn, ownStyle, styleFor, type Kept } from './styles.ts';

/** `own` is what the view holds of how it is drawn (its style field); `have`, the drawing modules the page has. */
export async function viewStyle(ctx: KernelContext, input: { own?: unknown; have?: unknown }): Promise<{ style: Record<string, unknown> }> {
  const own = (input.own ?? {}) as Record<string, unknown>;
  const named = typeof own.style === 'string' ? own.style : undefined;
  const kept = (await ctx.reads({ looks: { types: ['style', 'layout'], ...(named && { named }) } })) as Kept[];
  const { style } = await styleFor(ctx, kept, { own: ownStyle(own), ...(named && { named }) });
  return { style: await drawn(ctx, style, input.have ?? []) };
}
