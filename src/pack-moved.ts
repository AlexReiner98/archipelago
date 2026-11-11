// Packs moved out of the kernel (the core audit, task e_sjhbyf52): what core declared once (a rule, a view, a style, an
// action, a layout) and a pack declares now. A map that had core had those, so the pack that holds them now is added
// to it with them, once, as a pack that took over a type is (takenOver, src/packstate.ts). What the kernel's packs
// declared is read off their manifests kept on this map's log, so a map made after the move, whose log never kept a
// manifest that held them, is not given the pack this way: it starts with what the server starts it with.

import type { Archipelago } from './pelago.ts';
import { KERNEL_PACKS } from './packorder.ts';
import { LOCAL_PACK, type PackFile } from './packs.ts';

/** The keys whose entries carry an id that may move out of the kernel. */
const KEYS = ['rules', 'views', 'styles', 'actions', 'layouts'] as const;

/** The ids a manifest declares under those keys. */
export function declaredIds(manifest: unknown): Set<string> {
  const out = new Set<string>();
  if (!manifest || typeof manifest !== 'object') return out;
  for (const key of KEYS) {
    const list = (manifest as Record<string, unknown>)[key];
    if (!Array.isArray(list)) continue;
    for (const d of list) if (d && typeof d === 'object' && typeof (d as { id?: unknown }).id === 'string') out.add((d as { id: string }).id);
  }
  return out;
}

/** What a kernel manifest declared, by its hash: a manifest's text never changes under its hash, so it is read once. */
const byHash = new Map<string, Set<string>>();

/** The ids each kernel pack declared in any manifest of it this log keeps, by pack. */
async function keptKernelIds(l: Archipelago): Promise<Map<string, Set<string>>> {
  const facts = KERNEL_PACKS.map((k) => `pack:${k}`);
  const { rows } = await l.db.query<{ id: string; manifest: string }>(`select distinct id, value->>'manifest' as manifest from log_fact where stream = 'facts' and field = 'pack' and id = any($1::text[]) and value->>'text' is not null -- index log_fact_kept`, [facts]);
  const unread = rows.map((r) => r.manifest).filter((h) => !byHash.has(h));
  if (unread.length) {
    const texts = await l.db.query<{ manifest: string; text: string }>(`select distinct on (value->>'manifest') value->>'manifest' as manifest, value->>'text' as text from log_fact where stream = 'facts' and field = 'pack' and id = any($1::text[]) and value->>'manifest' = any($2::text[]) and value->>'text' is not null -- index log_fact_kept`, [facts, unread]);
    for (const r of texts.rows) {
      let parsed: unknown;
      try {
        parsed = JSON.parse(r.text);
      } catch {
        parsed = null;
      }
      byHash.set(r.manifest, declaredIds(parsed));
    }
  }
  const out = new Map<string, Set<string>>();
  for (const r of rows) {
    const pack = r.id.slice('pack:'.length);
    const ids = out.get(pack) ?? new Set<string>();
    for (const id of byHash.get(r.manifest) ?? []) ids.add(id);
    out.set(pack, ids);
  }
  return out;
}

/**
 * Whether a pack declares what a kernel pack declared once and declares no longer: by the same id, or by the kernel's
 * `<kernel>.<name>` renamed `<pack>.<name>`.
 */
export function holdsMoved(pack: PackFile, gone: Map<string, Set<string>>): boolean {
  for (const id of declaredIds(pack)) {
    for (const [kernel, ids] of gone) {
      if (ids.has(id)) return true;
      if (id.startsWith(`${pack.id}.`) && ids.has(`${kernel}.${id.slice(pack.id.length + 1)}`)) return true;
    }
  }
  return false;
}

/**
 * The packs this log never named that hold now what a kernel pack declared in a manifest the log keeps, and declares no
 * longer. A pack the owner took out is named on the log, and so is never added this way; neither is one kept as an item.
 */
export async function movedFromKernel(l: Archipelago, named: (id: string) => boolean): Promise<Set<string>> {
  const out = new Set<string>();
  const candidates = l.registry.found.filter((p) => p.id !== LOCAL_PACK && !KERNEL_PACKS.includes(p.id) && !named(p.id) && !l.registry.made.has(p.id));
  if (!candidates.length) return out;
  const kept = await keptKernelIds(l);
  const gone = new Map<string, Set<string>>();
  for (const [kernel, ids] of kept) {
    const now = declaredIds(l.registry.found.find((p) => p.id === kernel));
    const lost = new Set([...ids].filter((id) => !now.has(id)));
    if (lost.size) gone.set(kernel, lost);
  }
  if (!gone.size) return out;
  for (const p of candidates) if (holdsMoved(p, gone)) out.add(p.id);
  return out;
}
