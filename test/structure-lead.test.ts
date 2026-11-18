// Every type opens on its band (decision e_khf3pf8g): each type a pack ships declares its lead, or "none" when its
// title is the point, or inherits one from what it extends. A starter that says nothing is refused here, so a new
// type is never drawn with no thought given to what its page opens on.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { checkCapabilities } from '../packs/loader/kernel/capabilities.ts';
import { packIds, raw, ROOT } from './structure-kit.ts';

interface TypeDecl { id: string; extends?: string; capabilities?: { lead?: unknown } }
const types = new Map<string, TypeDecl & { pack: string }>();
for (const p of packIds) {
  if (!existsSync(join(ROOT, 'packs', p, 'pack.json'))) continue;
  for (const t of (JSON.parse(raw(`packs/${p}/pack.json`)).types ?? []) as TypeDecl[]) types.set(t.id, { ...t, pack: p });
}

/** The lead a type opens on: its own, else the nearest it extends. */
const leadOf = (id: string, seen = new Set<string>()): unknown => {
  const t = types.get(id);
  if (!t || seen.has(id)) return undefined;
  seen.add(id);
  return t.capabilities?.lead ?? (t.extends ? leadOf(t.extends, seen) : undefined);
};

test('every type a pack ships opens on its band, or says it has none', () => {
  const missing = [...types.values()].filter((t) => leadOf(t.id) === undefined).map((t) => `${t.pack}: ${t.id}`);
  assert.deepEqual(missing, [], 'Declare capabilities.lead on the type or what it extends: a form (packs/loader/kernel/capabilities.ts, LEAD_FORMS), or "none".');
});

test('a lead is "none" or a form the page draws', () => {
  const bad = [...types.values()].flatMap((t) => {
    const lead = t.capabilities?.lead;
    if (lead === undefined || lead === 'none') return [];
    // Fields and links are checked where the type is loaded; here only the form.
    return checkCapabilities({ lead } as never, {}, new Set(['*'])).filter((p) => p.startsWith('lead is')).map((p) => `${t.pack}: ${t.id}: ${p}`);
  });
  assert.deepEqual(bad, []);
});
