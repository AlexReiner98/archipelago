// The reads of the reads API the query pack answers (surface's slot surface.reads, by the read's key): a view by its
// name, and what falls in a window of time. Each is handed the context of the map that asks, so it reads as the asker.

import type { KernelContext } from '#pelago/kernel';
import { askPackView, VIEWS } from './views.ts';
import { LENS_LIMIT } from './query-flat.ts';
import { placeAll, readAxis, zoneOf, type TimeAxis } from './timeaxis.ts';

/** A view's pin: the pack that answers it and the version (or manifest hash) the asking view was made against. */
type Pin = { pack: string; version?: string; manifest?: string };

const short = (id: string) => id.slice(id.indexOf('.') + 1);

/** The pack that answers a view by its short name here: the kernel's own views are core's; else the first pack to load that declares it. */
function answeredBy(ctx: KernelContext, name: string, kernelView: boolean): string | undefined {
  if (kernelView) return 'core';
  return ctx.registry.packs.find((p) => ((p.views ?? []) as { id: string; form?: string }[]).some((v) => v.form === undefined && short(v.id) === name))?.id;
}

/** Refuses the read when the view is not answered by the pinned pack at the pinned version and manifest (task e_exet8395). */
function pinned(ctx: KernelContext, view: string, pin: Pin, kernelView: boolean): void {
  if (!pin || typeof pin !== 'object' || typeof pin.pack !== 'string') throw new Error('pin is { pack, version?, manifest? }');
  if (pin.version === undefined && pin.manifest === undefined) throw new Error('pin says a version, a manifest hash, or both');
  const by = answeredBy(ctx, view, kernelView);
  const pack = by ? ctx.registry.packs.find((p) => p.id === by) : undefined;
  const now = { pack: by ?? null, version: pack?.version ?? null, manifest: (by && ctx.registry.hashes.get(by)) ?? null };
  const differs = now.pack !== pin.pack || (pin.version !== undefined && now.version !== pin.version) || (pin.manifest !== undefined && now.manifest !== pin.manifest);
  if (differs) {
    const said = (p: { pack: string | null; version?: string | null; manifest?: string | null }) =>
      p.pack ? `${p.pack}${p.version ? ` ${p.version}` : ''}${p.manifest ? ` (manifest ${p.manifest.slice(0, 12)})` : ''}` : 'no pack';
    throw new Error(`The view "${view}" is pinned to ${said(pin)}; here it is answered by ${said(now)}.`);
  }
}

/** `view`: a kernel view, a lens preset (attention, hubs) or a pack's view, each by its short name (repo_work); refused when pinned to another. */
export async function view(ctx: KernelContext, q: { view: string; params?: Record<string, unknown>; pin?: Pin }): Promise<unknown> {
  const found = VIEWS[q.view];
  if (q.pin !== undefined) pinned(ctx, q.view, q.pin, Boolean(found));
  return found ? found.run(ctx, q.params ?? {}) : askPackView(ctx, q.view, q.params ?? {});
}

/** `placed`: items of some types placed in a window of time, each with where it falls. */
export async function placed(ctx: KernelContext, q: { placed: TimeAxis & { types: string[] }; fields?: string[] }): Promise<unknown> {
  const axis = readAxis(q.placed);
  const rows = (await ctx.reads({ placed_rows: { types: q.placed.types, since: axis.from, limit: LENS_LIMIT }, ...(q.fields !== undefined && { fields: q.fields }) })) as { row: Record<string, unknown>; at: { id: string; type: string; status: string; is_open: boolean; props: Record<string, unknown>; created_at: Date } }[];
  const spans = await placeAll(ctx, rows.map((r) => r.at), axis, await zoneOf(ctx));
  return rows.filter((r) => spans.get(r.at.id)?.length).map((r) => ({ ...r.row, open: r.at.is_open, time: spans.get(r.at.id) }));
}
