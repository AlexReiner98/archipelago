// What the surface's tools ask of presence (docs/kernel-packs.md, "Service names"), answered as the map that asks:
// a step an agent took (act.report.step), an agent waiting in watch (act.query.listening, ./presence.ts), and what
// the owner's page is seeing now (answer.seeing). The screen is the asking map's workspace and the viewer it names.

import type { KernelContext } from '#pelago/kernel';
import { took, type Step } from './presence.ts';
import { NOW_MS, seeing, seenNow } from './seeing.ts';

const screen = (ctx: KernelContext, viewer?: string) => ({ workspace: ctx.workspace, viewer });

/** act.report.step: a step an agent took, kept for the screen it was taken on. */
export const step = (ctx: KernelContext, input: { step: Omit<Step, 'at'>; viewer?: string }) => took(ctx, screen(ctx, input.viewer), input.step);

/** answer.seeing: what the owner's page shows now, or null when it has said nothing in the last NOW_MS. */
export async function seeingNow(ctx: KernelContext, input: { run?: string; viewer?: string }) {
  const s = await seenNow(ctx, screen(ctx, input.viewer));
  return s && Date.now() - s.said <= NOW_MS ? { ...(await seeing(ctx, s, input.run)), address: s.at } : null;
}
