// A published picture's first frame, kept with it: at publish the server runs the picture's drawing once and keeps
// the scene it opens on, so a reader's page mounts it with the page's text, before the sandbox has started. Only a
// drawing whose code is the pack's own is run here (its hash is the pack's): a version changed on the map is code
// anyone who may change the map wrote, and runs only in the reader's sandbox. The page checks these marks as it
// checks any drawing's (ui/marks.js), and the sandbox takes the picture over once it answers.
//
// Text is measured by a width table of the house style's typeface (src/text-widths.ts), not by a canvas: a reader
// whose fonts differ sees names fit a little otherwise until the drawing lays them out with their own.

import { pathToFileURL } from 'node:url';
import { packDrawing } from './drawings.ts';
import type { Archipelago } from './pelago.ts';
import { OTHER, WIDTHS } from './text-widths.ts';

/** How wide a text is at px, by the width table. */
export const measure = (text: string, px: number) => ([...String(text)].reduce((w, ch) => w + (WIDTHS[ch] ?? OTHER), 0) * px) / 100;

type Frozen = { style?: Record<string, unknown>; first?: unknown } & Record<string, unknown>;
const plain = <T>(value: T): T => JSON.parse(JSON.stringify(value ?? null));

/** The scene a drawing opens on, given what the page would give it; null when it cannot be had here. */
export async function openingScene(entry: string, frozen: Frozen, types: Record<string, string> = {}, words: { fields?: Record<string, Record<string, string[]>>; relations?: Record<string, string> } = {}) {
  // What the page gives a drawing on a published page (ui/doc-lens.js, ui/drawing.js): the answer without its style,
  // and the style held still, without its code.
  const { style = {}, first: _first, ...answer } = frozen;
  const { drawing: _drawing, code: _code, ...fields } = { ...style, noLit: true, still: true } as Record<string, unknown>;
  const { picture } = await import(pathToFileURL(entry).href);
  const drawn = picture({ answer: plain(answer), style: plain(fields), types, fields: words.fields ?? {}, relations: words.relations ?? {}, reduced: false }, { measure, patch: () => {}, open: () => {}, frame: () => new Promise(() => {}) });
  // What plays after the first frame is the reader's: stopped before it starts.
  drawn?.end?.();
  return drawn?.scene ? plain(drawn.scene) : null;
}

/** Keep each picture's first frame with it (`first`), where its drawing is the pack's own. */
export async function framesFor(l: Pick<Archipelago, 'registry'>, lenses: Record<string, Frozen>) {
  for (const frozen of Object.values(lenses)) {
    const sent = frozen.style?.drawing as { id?: string; hash?: string } | undefined;
    const own = sent?.id ? packDrawing(l.registry, sent.id) : undefined;
    if (!own?.entry || own.hash !== sent?.hash) continue;
    // The titles of the types it holds, as the page would give them.
    const held = new Set(((frozen.items as { type?: string; root?: string }[] | undefined) ?? []).flatMap((i) => [i.type, i.root]).filter((t): t is string => Boolean(t)));
    const types = Object.fromEntries([...held].map((t) => [t, l.registry.type(t)?.title ?? t]));
    // The values each type's fields may take, and each link's title, as the page would give them (ui/drawing.js).
    const items = (frozen.items as { type?: string }[] | undefined) ?? [];
    const fields = Object.fromEntries(
      [...new Set(items.map((i) => i.type).filter((t): t is string => Boolean(t)))]
        .map((t) => [t, Object.fromEntries(Object.entries(l.registry.type(t)?.fields ?? {}).flatMap(([name, f]) => (Array.isArray((f as { values?: unknown }).values) ? [[name, (f as { values: string[] }).values]] : [])))])
        .filter(([, f]) => Object.keys(f as object).length),
    );
    const kinds = new Set(((frozen.links as { kind?: string }[] | undefined) ?? []).map((k) => k.kind).filter((k): k is string => Boolean(k)));
    const relations = Object.fromEntries([...kinds].map((k) => [k, l.registry.relations.get(k)?.title ?? k]));
    const scene = await openingScene(own.entry, frozen, types, { fields, relations }).catch(() => null);
    if (scene && !scene.message) frozen.first = scene;
  }
  return lenses;
}
