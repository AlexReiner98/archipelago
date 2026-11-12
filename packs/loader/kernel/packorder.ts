// Which packs run, and in what order. A pack is active when it is on and every name it requires has an active
// provider; waiting when it is on but one has none (it says which, and why); off when the owner turned it off here or
// the server does not enable it. A waiting or off pack registers nothing, and its items behave as dormant. The
// kernel's own packs are always on, and the server starts whatever state the others are in.
//
// A pack requires names, never packs (decision e_f9ybsuce, after the Cordis paper): a capability (`has:when`), a type
// or link type (`type:event`) or a kind of event (`event:item.due`). Whichever active pack declares it provides it, so
// a provider can be swapped without its consumers knowing. What a pack provides is read off what it declares, never
// claimed. A bare pack id is the old form, kept for a bundle's two halves.
//
// What a pack reads of a type it does not own is named too (task e_f9x7ddeh): a field (`field:due@task`), a status
// (`status:done@task`) or a phase some status stands in (`phase:finished@task`). It is checked by shape, as a record
// type's width is: the type as its provider declares it (its lineage, and fields other packs add to it) may have more,
// never less. A version in its provider's place is checked the same way (src/island-pin.ts).
//
// A service (`service:answer.attention`, docs/kernel-packs.md) is a function an in-process pack provides under its
// manifest's `kernel` key (src/services.ts). One pack owns a name, and a caller's declared shape is met by its provider
// or the caller waits, saying which field.

import { phasesOf } from '../../../src/phases.ts';
import type { PackFile, TypeDef } from './packs.ts';
import { kernelOf, meets, providedBy } from './services.ts';

export type PackState = { state: 'active' | 'waiting' | 'off'; why?: string };

/**
 * The pack of words every map starts with: the kinds, root relations and the shared set. Never off. Which packs run in
 * the server's process (root and service) is not listed here: each says so in its manifest's `kernel` (isInternal,
 * src/manifest.ts), and is always on too (src/packs.ts).
 */
export const KERNEL_PACKS = ['core'];

/**
 * The packs a pack took declarations from, keeping their ids (task e_qhtt4phv): those its manifest names in
 * `moved_from`, and the kernel's, from which every pack may take (the core audit, e_sjhbyf52). Which maps are given the
 * pack that took them is src/pack-moved.ts's.
 */
export const movedFrom = (pack: { id: string; moved_from?: string[] }): string[] => [...KERNEL_PACKS, ...(pack.moved_from ?? [])].filter((p) => p !== pack.id);

/**
 * Whether a pack may declare an id: its own `<pack>.<name>`, or a name a pack it took declarations from gave
 * (movedFrom). The kernel's pack names anything, so a bare name (no pack in it) is the kernel's: kept by a pack whose
 * `moved_from` names the kernel's pack outright (task e_2a94ypah: core's "needs" screen, moved to work_views).
 */
export const ownsId = (pack: { id: string; moved_from?: string[] }, id: string): boolean =>
  KERNEL_PACKS.includes(pack.id) ||
  [pack.id, ...movedFrom(pack)].some((p) => id.startsWith(`${p}.`)) ||
  (!id.includes('.') && (pack.moved_from ?? []).some((p) => KERNEL_PACKS.includes(p)));

/** The kernel's own kinds of event (src/due.ts, src/notify.ts): always provided, by core. */
export const KERNEL_EVENTS = ['item.due', 'notification.made'];

/** A name a pack requires or uses, read: what it asks for, and of what. A bare id is a pack: the old form. */
export type Need = { by: 'has' | 'type' | 'event' | 'service' | 'field' | 'status' | 'phase' | 'pack'; name: string; of?: string };
/** The forms that name what is read of a type: <what>@<type>. */
const SHAPED = ['field', 'status', 'phase'] as const;
const FORMS = ['has', 'type', 'event', 'service', ...SHAPED] as const;
const shaped = (by: string) => (SHAPED as readonly string[]).includes(by);
/** Whether a manifest's entry of requires or uses is a name in one of these forms; what they are, for its refusal. */
export const isName = (n: unknown): n is string => {
  const m = typeof n === 'string' ? /^(?:([a-z]+):)?([\w.-]+(@[\w.-]+)?)$/.exec(n) : null;
  return !!m && (m[1] === undefined ? !m[3] : (FORMS as readonly string[]).includes(m[1]) && shaped(m[1]) === !!m[3]);
};
const SAYS: Record<string, string> = { has: 'capability', type: 'id', event: 'kind', service: 'family>.<name' };
export const NAME_FORMS = `a name is ${FORMS.map((f) => `${f}:<${SAYS[f] ?? `${f}>@<type`}>`).join(', ')}, or a pack's id (the old form)`;
export function needOf(name: string): Need {
  const at = name.indexOf(':');
  const by = name.slice(0, at) as Need['by'];
  if (at <= 0 || !(FORMS as readonly string[]).includes(by)) return { by: 'pack', name };
  const rest = name.slice(at + 1);
  if (!shaped(by)) return { by, name: rest };
  const [what, of] = rest.split('@');
  return { by, name: what, of };
}

type Decl = { pack: string; def: TypeDef };
/** Each pack's own declaration of a type, among `all`. */
const declsOf = (id: string, all: PackFile[]): Decl[] => all.flatMap((p) => (p.types ?? []).filter((t): t is TypeDef => !('of' in t) && t.id === id).map((def) => ({ pack: p.id, def })));
/** A declaration and its ancestors', nearest first: a parent is read as the first pack that declares it. */
function lineageOf(d: Decl, all: PackFile[]): Decl[] {
  const chain = [d];
  const parent = (c: Decl): Decl | undefined => (c.def.extends ? declsOf(c.def.extends, all)[0] : undefined);
  for (let up = parent(d); up && !chain.some((c) => c.def.id === up!.def.id); up = parent(up)) chain.push(up);
  return chain;
}
/** The head every type has (src/head.ts, ownHead): a need of one is met wherever the type is. */
const HEAD = ['status', 'confidence', 'source', 'owner'];

/** The packs that give a type, as each declares it, what a shaped need names: its declarer, or the pack adding the field. */
function shapedProviders(need: Need, all: PackFile[]): string[] {
  const out = new Set<string>();
  for (const d of declsOf(need.of!, all)) {
    const chain = lineageOf(d, all);
    if (need.by === 'field') {
      if (HEAD.includes(need.name) || chain.some((c) => c.def.fields?.[need.name])) out.add(d.pack);
      for (const p of all) for (const t of p.types ?? []) if ('of' in t && chain.some((c) => c.def.id === t.of) && t.fields[need.name]) out.add(p.id);
      continue;
    }
    const statuses = chain.find((c) => c.def.statuses)?.def.statuses;
    if (!statuses) continue;
    const has = need.by === 'status' ? [...statuses.open, ...statuses.closed].includes(need.name) : Object.values(phasesOf(statuses, chain.map((c) => c.def.statuses?.phases))).includes(need.name as never);
    if (has) out.add(d.pack);
  }
  return [...out];
}

/** Why nobody provides a shaped need, as a phrase: no pack declares the type, or the type as each declares it lacks it. */
function shapeMissing(need: Need, all: PackFile[]): string {
  const by = [...new Set(declsOf(need.of!, all).map((d) => d.pack))];
  return by.length ? `${need.of} as ${by.join(', ')} declare${by.length === 1 ? 's' : ''} it has no ${need.by} ${need.name}` : `no pack here declares ${need.of}`;
}

/**
 * The packs among `packs` that provide a name, by id: those declaring a type with that capability, the one declaring
 * that type or link type, the one whose handlers record that event (core for the kernel's), the one whose `kernel`
 * provides that service, the one whose type has
 * the field, status or phase asked of it (by shape: more is fine, less is none), or the pack itself.
 */
export function providersOf(name: string, packs: Iterable<PackFile>): string[] {
  const need = needOf(name);
  const all = [...packs];
  const own = (p: PackFile) => (p.types ?? []).filter((t) => !('of' in t)) as { id: string; capabilities?: Record<string, unknown> }[];
  const of = (keep: (p: PackFile) => boolean) => all.filter(keep).map((p) => p.id);
  switch (need.by) {
    case 'has': return of((p) => own(p).some((t) => t.capabilities?.[need.name] !== undefined));
    case 'type': return of((p) => own(p).some((t) => t.id === need.name) || (p.links ?? []).some((r) => r.id === need.name));
    case 'service': return of((p) => providedBy(p).includes(need.name));
    case 'event': return KERNEL_EVENTS.includes(need.name) ? of((p) => KERNEL_PACKS.includes(p.id)) : of((p) => (p.handlers ?? []).some((h) => !('schedule' in h) && (h.records ?? []).includes(need.name)));
    case 'pack': return of((p) => p.id === need.name);
    default: return shapedProviders(need, all);
  }
}

/**
 * The active packs left without a provider were the packs `gone` all taken out at once (one, or a bundle's): what
 * taking them out sends to waiting (task e_5h5kprqm), and so on down, since a pack that waits provides nothing. A
 * dependent inside `gone` is not counted: it goes out with them. As in the Cordis paper, the consumers deactivate
 * first and the provider is withdrawn after.
 */
export function dependentsOf(active: PackFile[], gone: string[]): string[] {
  const out = new Set(gone);
  for (let more = true; more; ) {
    const rest = active.filter((p) => !out.has(p.id));
    const lost = rest.filter((p) => (p.requires ?? []).some((r) => !providersOf(r, rest).length && providersOf(r, active).some((id) => out.has(id))));
    for (const p of lost) out.add(p.id);
    more = lost.length > 0;
  }
  return [...out].filter((id) => !gone.includes(id));
}

/**
 * Put the packs found in load order and say the state of each. `off` is what is off, each with why. The workspace's own
 * pack ("local") requires nothing: it uses whichever packs are active, and a type of it that extends a type no
 * active pack has is left to the type table.
 */
export function orderPacks(found: Map<string, PackFile>, off: Map<string, string>, local: string): { ordered: PackFile[]; states: Map<string, PackState> } {
  const states = new Map<string, PackState>();
  const ordered: PackFile[] = [];
  const owners = new Map<string, string>();
  const namesOf = (p: PackFile) => [...(p.types ?? []).flatMap((t) => ('of' in t ? [] : [t.id])), ...(p.links ?? []).map((r) => r.id), ...providedBy(p).map((n) => `service:${n}`)];
  const visit = (pack: PackFile, trail: string[]): PackState => {
    const known = states.get(pack.id);
    if (known) return known;
    if (off.has(pack.id) && !KERNEL_PACKS.includes(pack.id)) return set(pack, { state: 'off', why: off.get(pack.id) });
    if (trail.includes(pack.id)) return set(pack, { state: 'waiting', why: `in a cycle: ${[...trail, pack.id].join(' -> ')}` });
    if (pack.id !== local) {
      for (const name of pack.requires ?? []) {
        const providers = providersOf(name, found.values());
        if (providers.includes(pack.id)) continue; // it provides what it requires itself
        const states = providers.map((id) => ({ id, ...visit(found.get(id)!, [...trail, pack.id]) }));
        const need = needOf(name);
        const live = states.find((s) => s.state === 'active');
        if (live && need.by === 'service') {
          // Checked by shape: what the caller declared it calls the name with, against what its provider declares.
          const said = kernelOf(pack).calls?.[need.name];
          const why = said && meets(kernelOf(found.get(live.id)!).provides?.[need.name] ?? {}, said);
          if (why) return set(pack, { state: 'waiting', why: `needs ${name} as it calls it, and ${live.id}'s ${why}` });
        }
        if (live) continue;
        const why = need.by === 'pack' ? `needs ${name}, which is ${states[0]?.state ?? 'not on this server'}`
          : !providers.length ? `needs ${name}: ${need.of ? shapeMissing(need, [...found.values()]) : 'no pack here provides it'}`
          : `needs ${name}, which ${states.map((s) => `${s.id} is ${s.state}`).join(', ')}`;
        return set(pack, { state: 'waiting', why });
      }
      // One owner per name: a pack declaring a type or link type, or providing a service, another active pack owns waits until that one goes.
      const taken = namesOf(pack).filter((n) => owners.has(n));
      if (taken.length) return set(pack, { state: 'waiting', why: `${taken.map((n) => `${n} is ${owners.get(n)}'s`).join(', ')}: one pack owns a name` });
    }
    for (const n of namesOf(pack)) owners.set(n, pack.id);
    ordered.push(pack);
    return set(pack, { state: 'active' });
  };
  const set = (pack: PackFile, state: PackState) => (states.set(pack.id, state), state);
  const core = found.get('core');
  if (!core) throw new Error('No core pack');
  visit(core, []);
  const rest = [...found.values()].filter((p) => p.id !== local).sort((a, b) => a.id.localeCompare(b.id));
  for (const pack of rest) visit(pack, []);
  if (found.has(local)) visit(found.get(local)!, []);
  return { ordered, states };
}
