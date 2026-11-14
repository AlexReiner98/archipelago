// A try of a code field, before it is kept (task e_p5zjynrb): an agent or a script (map-code watch --preview) sends
// the field whole as it would send it in a change, and the sender's own open pages draw with it, marked, at once. It is
// no fact: kept in the transient store (./root-transient.ts, packs/log/kernel/operational.ts) for minutes, under the
// sender's screen (the same key a show lands on, ./tool-change.ts whose), never in the log, never in a backup. The
// page's Save sends one ordinary change; Discard, or the minutes running out, drops it.
//
// A page waits for a try (tail, with `tries` and `wait`): this process wakes it the moment one is sent here; one sent to
// another server is found when it looks again, every WAKE_MS.

import { EventEmitter } from 'node:events';
import { z } from 'zod';
import { keep, kept } from '../../database/kernel/transient.ts';
import { bypassingRls } from '../../identity/kernel/outbox.ts';
import { drawingWith, type Layout } from '../../loader/kernel/layouts.ts';
import type { Archipelago } from '../../write/kernel/pelago.ts';
import { whose } from './tool-change.ts';
import type { Tool } from './tools.ts';

/** How long a try is kept after it was last sent. */
export const PREVIEW_MS = 15 * 60_000;
/** The most a page waits for a try in one call. */
const WAIT_MOST = 25;
/** How often a waiting page looks again, for a try sent to another server. */
const WAKE_MS = 2000;
/** The most a screen's tries hold, as text: a drawing's modules are tens of KB. */
const BYTES_MOST = 2_000_000;

/** One try: the field whole, and for a pack drawing's modules, the drawing it makes (its hash and all its modules). */
export interface Preview {
  item: string;
  field: string;
  value: unknown;
  /** Its title, for the page's mark. */
  title: string;
  /** For a layout that is the owner's version of a pack's drawing: that drawing with these modules. */
  drawing?: Layout;
  at: number;
}
export interface Kept {
  at: number;
  previews: Preview[];
}

const keyOf = (l: Archipelago) => {
  const w = whose(l);
  return `preview:${w.workspace}:${w.viewer ?? ''}`;
};
const woken = new EventEmitter().setMaxListeners(0);

/** The transient store, which only the whole database reaches: read and kept by this screen's key alone. */
const storeOf = async (l: Archipelago) => (await bypassingRls(l)).db;

/** What the screen has: the tries kept, with when they last moved. */
async function keptOf(l: Archipelago): Promise<Kept> {
  const db = await storeOf(l);
  return (await kept<Kept>(db, keyOf(l))) ?? { at: 0, previews: [] };
}

async function put(l: Archipelago, previews: Preview[]): Promise<Kept> {
  const was = await keptOf(l);
  // Never back in time: a page waiting after `at` is woken by any later move.
  const now: Kept = { at: Math.max(Date.now(), was.at + 1), previews };
  if (JSON.stringify(now).length > BYTES_MOST) throw new Error(`The tries kept for one person hold ${BYTES_MOST / 1e6} MB at most: discard one first.`);
  await keep(await storeOf(l), keyOf(l), now, PREVIEW_MS);
  woken.emit(keyOf(l), now.at);
  return now;
}

/** The item a try is of, as the sender may see it, with what it declares of the field. */
async function itemOf(l: Archipelago, item: string, field: string) {
  // Bounded by its id, read through the sender's own rows: an item they cannot see is no item.
  const { rows } = await l.db.query<{ type: string; title: string; preset: string | null }>(`select type, title, props->>'preset' as preset from entity where id = $1 and archived_at is null`, [item]);
  const row = rows[0];
  if (!row) throw new Error(`No item "${item}" you can see.`);
  const declared = l.registry.type(row.type)?.fields?.[field] as { code?: boolean; type?: string } | undefined;
  if (!declared?.code) throw new Error(`${row.title} has no code field "${field}": a try is of a field its type declares as code.`);
  return { ...row, declared };
}

/** A try as the page draws it: the field whole, checked against what its item's type declares of it (also a dry-run look's, ./tool-reads.ts). */
export async function tryOf(l: Archipelago, input: { item: string; field: string; value?: unknown }): Promise<Preview> {
  const it = await itemOf(l, input.item, input.field);
  const { value } = input;
  const isText = typeof value === 'string';
  const isModules = Boolean(value) && typeof value === 'object' && !Array.isArray(value) && Object.values(value as object).every((v) => typeof v === 'string');
  if (it.declared.type === 'string' ? !isText : !isModules) throw new Error(`value is ${input.field} whole: ${it.declared.type === 'string' ? 'its text' : 'an object of modules by name, each its text'}.`);
  const drawing = isModules && it.preset ? drawingWith(l.registry, it.preset, value as Record<string, unknown>) : undefined;
  return { item: input.item, field: input.field, value, title: it.title, ...(drawing && { drawing }), at: Date.now() };
}

export const PREVIEW_TOOLS: Record<string, Tool> = {
  preview: {
    description:
      'Try a code field before you keep it: the field whole (value), as change would send it, a layout’s code as text or its modules by name. ' +
      'Your own open pages draw it at once, marked as a try, in place of what the map holds; nobody else sees it, nothing is logged, and it lapses 15 minutes after you last send it. ' +
      'The person keeps it with Save on their page (one change), or you send it as a change. discard: true drops it.',
    input: {
      item: z.string().regex(/^e_[a-z0-9]{8}$/).describe('The item whose code it is, a layout.'),
      field: z.string().min(1).max(60).describe('Its code field: code, or modules for a pack drawing’s version.'),
      value: z.unknown().optional().describe('The field whole: text for code, an object of modules by name for modules.'),
      discard: z.boolean().optional().describe('true to drop the try of this field.'),
    },
    run: async (l, _actor, input: { item: string; field: string; value?: unknown; discard?: boolean }) => {
      const { previews } = await keptOf(l);
      const others = previews.filter((p) => !(p.item === input.item && p.field === input.field));
      if (input.discard) return { discarded: others.length < previews.length, at: (await put(l, others)).at };
      const preview = await tryOf(l, input);
      const now = await put(l, [...others, preview]);
      return { previewing: true, at: now.at, ...(preview.drawing && { hash: preview.drawing.hash }), until: new Date(Date.now() + PREVIEW_MS).toISOString() };
    },
  },
};

/**
 * The tries the person looking sent, for their page to draw with (tail, with `tries`): at once, or when they move
 * after `after` (the `at` of the last answer), waiting up to `wait` seconds.
 */
export async function triesAfter(l: Archipelago, after: number, wait = 0): Promise<Kept> {
  const until = Date.now() + Math.min(wait, WAIT_MOST) * 1000;
  const key = keyOf(l);
  for (;;) {
    const now = await keptOf(l);
    if (now.at > after || Date.now() >= until) return now;
    await new Promise<void>((resolve) => {
      const done = () => (clearTimeout(timer), woken.off(key, done), resolve());
      const timer = setTimeout(done, Math.min(WAKE_MS, Math.max(0, until - Date.now())));
      woken.on(key, done);
    });
  }
}
