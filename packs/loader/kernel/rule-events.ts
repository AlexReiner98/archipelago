// The slot `rules.<on>` (docs/kernel-packs.md, "Slots"): a rule with `on` decides about an event, not a change, and
// what such a rule may say is its event's pack's to check, not the judge's. Rules opens the slot; the pack that
// decides about the event fills it, declaring `kernel.hooks["rules.<on>"]` (sessions: rules.reply_ended), and
// whoever else calls fillRuleEvent. The judge skips every rule with `on` (packs/rules/kernel/rules.ts, judge).
//
// The server's own internal packs (the packs folder beside its code) are read for their fillings when this module
// loads, before any registry checks a pack's rules: a check is pure, of a pack file's rule, and holds nothing of a
// map, so it is filled once for the process, an optional pack's too (its rules are checked whether a map runs it or
// not, as they were when the judge held the check itself). The rules pack imports no pack's code: it loads the
// function a manifest names, from that pack's own modules, as the loader does a hook (log-slots.ts).

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { isAbsolute, join, relative, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { isInternal, readManifest } from './manifest.ts';
import { OWN_PACKS } from './pack-folders.ts';
import type { RuleDef } from '../../rules/kernel/rules.ts';

/** What a pack says of the rules on its event: the problems with one, as checkRules reports them. */
export interface RuleEvent {
  pack: string;
  check(rule: RuleDef, at: string, known: (type: string) => boolean): string[];
}

const filled = new Map<string, RuleEvent>();

/** Fill the slot for an event: the pack that decides about it says what a rule on it may be. One pack per event. */
export function fillRuleEvent(on: string, event: RuleEvent): void {
  const had = filled.get(on);
  if (had && had.pack !== event.pack) throw new Error(`Rules on "${on}" are the ${had.pack} pack's, not the ${event.pack} pack's.`);
  filled.set(on, event);
}

const SLOT = 'rules.';

/** Fill the slot from the internal packs of a packs folder: each `kernel.hooks["rules.<on>"]`, a function of the pack's own modules. */
export async function fillFromPacks(folder: string): Promise<void> {
  if (!existsSync(folder)) return;
  for (const name of readdirSync(folder).sort()) {
    const file = join(folder, name, 'pack.json');
    if (!existsSync(file)) continue;
    const pack = readManifest(readFileSync(file, 'utf8'), file);
    if (!isInternal(pack)) continue;
    for (const [point, refs] of Object.entries(pack.kernel?.hooks ?? {})) {
      if (!point.startsWith(SLOT)) continue;
      for (const ref of [refs].flat()) {
        const [path, fn] = ref.split('#');
        const dir = resolve(folder, name, pack.kernel?.modules ?? 'kernel/');
        const at = resolve(dir, path);
        const inside = relative(dir, at);
        if (!inside || inside.startsWith('..') || isAbsolute(inside)) throw new Error(`The ${pack.id} pack names ${ref}, outside its modules`);
        const check = ((await import(pathToFileURL(at).href)) as Record<string, unknown>)[fn];
        if (typeof check !== 'function') throw new Error(`The ${pack.id} pack names ${ref}, which it does not export as a function`);
        fillRuleEvent(point.slice(SLOT.length), { pack: pack.id, check: check as RuleEvent['check'] });
      }
    }
  }
}

await fillFromPacks(OWN_PACKS);

/**
 * The problems with a rule on an event, as its filling says. On an event no pack decides about, each filling says
 * what it would want of it (its own event's name among them), as the judge said when it knew only reply_ended.
 */
export function checkOnEvent(rule: RuleDef, at: string, known: (type: string) => boolean): string[] {
  const event = filled.get(String(rule.on));
  if (event) return event.check(rule, at, known);
  const said = [...new Set([...filled.values()].flatMap((e) => e.check(rule, at, known)))];
  return said.length ? said : [`${at}: no pack decides about "${rule.on}"`];
}
