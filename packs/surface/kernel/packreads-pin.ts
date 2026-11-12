// A view that reads another is made against what that other answered then: its pack, at a version. Pinned, the read
// is refused when what answers now is another pack or another version of it, saying both, rather than hand the asking
// view an answer of a shape it was not made for (task e_exet8395). A pin says the pack, and its version, the SHA-256
// of its manifest (src/pack-versions.ts), or both. Whether the name is one of the kernel's own views is said by what
// answers the read (the filling of `view`, surface.reads): the reads API names none.

import { parts } from '../../loader/kernel/manifest.ts';
import { KERNEL_PACKS } from '../../loader/kernel/packorder.ts';
import type { Archipelago } from '../../../src/pelago.ts';

export type Pin = { pack: string; version?: string; manifest?: string };

const short = (id: string) => id.slice(id.indexOf('.') + 1);

/** The pack that answers a view by its short name here: the kernel's own views are its root pack's; else the first pack to load that declares it (src/askview.ts). */
export function answeredBy(l: Archipelago, name: string, kernelView: boolean): string | undefined {
  if (kernelView) return KERNEL_PACKS[0];
  return l.registry.packs.find((p) => parts(p).views.some((v) => short(v.id) === name))?.id;
}

/** Refuses the read when the view is not answered by the pinned pack at the pinned version and manifest. */
export function pinned(l: Archipelago, view: string, pin: Pin, kernelView: boolean): void {
  if (!pin || typeof pin !== 'object' || typeof pin.pack !== 'string') throw new Error('pin is { pack, version?, manifest? }');
  if (pin.version === undefined && pin.manifest === undefined) throw new Error('pin says a version, a manifest hash, or both');
  const by = answeredBy(l, view, kernelView);
  const pack = by ? l.registry.packs.find((p) => p.id === by) : undefined;
  const now = { pack: by ?? null, version: pack?.version ?? null, manifest: (by && l.registry.hashes.get(by)) ?? null };
  const differs = now.pack !== pin.pack || (pin.version !== undefined && now.version !== pin.version) || (pin.manifest !== undefined && now.manifest !== pin.manifest);
  if (differs) {
    const said = (p: { pack: string | null; version?: string | null; manifest?: string | null }) =>
      p.pack ? `${p.pack}${p.version ? ` ${p.version}` : ''}${p.manifest ? ` (manifest ${p.manifest.slice(0, 12)})` : ''}` : 'no pack';
    throw new Error(`The view "${view}" is pinned to ${said(pin)}; here it is answered by ${said(now)}.`);
  }
}
