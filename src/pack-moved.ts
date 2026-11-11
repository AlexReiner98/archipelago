// Declarations moved between packs (the core audit, task e_sjhbyf52; any pack, task e_qhtt4phv): what pack A declared
// once (a rule, a view, a style or instruction, an action, a layout) and pack B declares now, by A's id or by A's
// `<A>.<name>` renamed `<B>.<name>`. B names A in its manifest's `moved_from` (the kernel's packs it never needs to
// name, src/packorder.ts movedFrom). A map that had A on had those, so B is added to it with them, once, as a pack that
// took over a type is (takenOver, src/packstate.ts). What A declared is read off its manifests kept on this map's log,
// so a map made after the move, whose log never kept a manifest of A that held them, is not given B this way: it starts
// with what the server starts it with. A types and link types move by takenOver, by their ids or their moved_from.

import type { Archipelago } from './pelago.ts';
import { KERNEL_PACKS, movedFrom } from './packorder.ts';
import { LOCAL_PACK, type PackFile } from './packs.ts';

/** The keys whose entries carry an id that may move between packs. */
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

/** What a manifest declared, by its hash: a manifest's text never changes under its hash, so it is read once. */
const byHash = new Map<string, Set<string>>();

/** The ids each of these packs declared in any manifest of it this log keeps, by pack. */
async function keptIds(l: Archipelago, packs: string[]): Promise<Map<string, Set<string>>> {
  const facts = packs.map((k) => `pack:${k}`);
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
 * Whether a pack declares what a pack it took declarations from (movedFrom) declared once and declares no longer: by
 * the same id, or by that pack's `<from>.<name>` renamed `<pack>.<name>`. `gone` is by the pack it left.
 */
export function holdsMoved(pack: PackFile, gone: Map<string, Set<string>>): boolean {
  const from = movedFrom(pack);
  for (const id of declaredIds(pack)) {
    for (const [source, ids] of gone) {
      if (!from.includes(source)) continue;
      if (ids.has(id)) return true;
      if (id.startsWith(`${pack.id}.`) && ids.has(`${source}.${id.slice(pack.id.length + 1)}`)) return true;
    }
  }
  return false;
}

/**
 * The packs this log never named that hold now what a pack on this map (a kernel pack, or one the log added) declared
 * in a manifest the log keeps, and declares no longer. A pack the owner took out is named on the log, and so is never
 * added this way; neither is one kept as an item; and one the owner took out never passes on what it held.
 */
export async function movedPacks(l: Archipelago, named: (id: string) => boolean, on: (id: string) => boolean): Promise<Set<string>> {
  const out = new Set<string>();
  const candidates = l.registry.found.filter((p) => p.id !== LOCAL_PACK && !KERNEL_PACKS.includes(p.id) && !named(p.id) && !l.registry.made.has(p.id));
  if (!candidates.length) return out;
  const sources = [...new Set(candidates.flatMap((p) => movedFrom(p)))].filter((id) => KERNEL_PACKS.includes(id) || on(id));
  if (!sources.length) return out;
  const kept = await keptIds(l, sources);
  const gone = new Map<string, Set<string>>();
  for (const [source, ids] of kept) {
    const now = declaredIds(l.registry.found.find((p) => p.id === source));
    const lost = new Set([...ids].filter((id) => !now.has(id)));
    if (lost.size) gone.set(source, lost);
  }
  if (!gone.size) return out;
  for (const p of candidates) if (holdsMoved(p, gone)) out.add(p.id);
  return out;
}
