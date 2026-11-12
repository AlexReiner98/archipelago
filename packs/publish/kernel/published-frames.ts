// A published picture's first frame, kept with it: at publish the server runs the picture's drawing once, in a
// sandboxed process of its own (root.scene, the loader's: src/drawing-box.ts runs it), and keeps the scene it opens on,
// so a reader's page mounts it with the page's text, before the sandbox has started. Only a drawing whose code is the
// pack's own is run (the loader finds it by its id among what the packs ship, and its hash must be the pack's): a
// version changed on the map is code anyone who may change the map wrote, and runs only in the reader's sandbox. The
// page checks these marks as it checks any drawing's (ui/marks.js), and the sandbox takes the picture over once it
// answers.

import type { KernelContext } from '#pelago/kernel';

type Frozen = { style?: Record<string, unknown>; first?: unknown } & Record<string, unknown>;
type Words = { types?: Record<string, string>; fields?: Record<string, Record<string, string[]>>; relations?: Record<string, string> };
/** What root.scene answers: the scene, and whether the stylesheet it sent is one a drawing's may be. */
export type Drawn = { scene: Record<string, unknown> | null; css_ok: boolean };
const plain = <T>(value: T): T => JSON.parse(JSON.stringify(value ?? null));

/**
 * What the page gives a drawing on a published page (ui/doc-lens.js, ui/layout.js): the answer without its style, and
 * the style held still, without its code.
 */
export function openingInput(frozen: Frozen, words: Words = {}) {
  const { style = {}, first: _first, ...answer } = frozen;
  const { drawing: _drawing, code: _code, ...fields } = { ...style, noLit: true, still: true } as Record<string, unknown>;
  return { answer: plain(answer), style: plain(fields), types: words.types ?? {}, fields: words.fields ?? {}, relations: words.relations ?? {}, reduced: false };
}

/** The words the page would give a drawing of `frozen`: the titles of the types it holds, the values each type's fields may take, each link's title. */
export function wordsOf(ctx: Pick<KernelContext, 'registry'>, frozen: Frozen): Required<Words> {
  const items = (frozen.items as { type?: string; root?: string }[] | undefined) ?? [];
  const held = new Set(items.flatMap((i) => [i.type, i.root]).filter((t): t is string => Boolean(t)));
  const types = Object.fromEntries([...held].map((t) => [t, ctx.registry.type(t)?.title ?? t]));
  const fields = Object.fromEntries(
    [...new Set(items.map((i) => i.type).filter((t): t is string => Boolean(t)))]
      .map((t) => [t, Object.fromEntries(Object.entries(ctx.registry.type(t)?.fields ?? {}).flatMap(([name, f]) => (Array.isArray((f as { values?: unknown }).values) ? [[name, (f as { values: string[] }).values]] : [])))])
      .filter(([, f]) => Object.keys(f as object).length),
  );
  const kinds = new Set(((frozen.links as { kind?: string }[] | undefined) ?? []).map((k) => k.kind).filter((k): k is string => Boolean(k)));
  const relations = Object.fromEntries([...kinds].map((k) => [k, ctx.registry.relations.get(k)?.title ?? k]));
  return { types, fields, relations };
}

/**
 * The scene the pack's drawing `drawing` opens `frozen` on, given the words the page would give it (and only where its
 * hash is `hash`, when given), with whether its stylesheet may be used; null when it cannot be had.
 */
export async function drawnOf(ctx: Pick<KernelContext, 'registry' | 'call'>, frozen: Frozen, drawing: string, hash?: string): Promise<Drawn | null> {
  const input = openingInput(frozen, wordsOf(ctx, frozen));
  const drawn = await ctx.call<unknown, Drawn | null>('root.scene', { id: drawing, ...(hash !== undefined && { hash }), input }).catch(() => null);
  return drawn?.scene && !drawn.scene.message ? drawn : null;
}

/** The scene the pack's drawing opens `frozen` on; null when it cannot be had. */
export const sceneOf = async (ctx: Pick<KernelContext, 'registry' | 'call'>, frozen: Frozen, drawing: string, hash?: string) => (await drawnOf(ctx, frozen, drawing, hash))?.scene ?? null;

/** Keep each picture's first frame with it (`first`), where its drawing is the pack's own. */
export async function framesFor(ctx: Pick<KernelContext, 'registry' | 'call'>, lenses: Record<string, Frozen>) {
  for (const frozen of Object.values(lenses)) {
    const sent = frozen.style?.drawing as { id?: string; hash?: string } | undefined;
    if (!sent?.id) continue;
    // Its hash must be the pack's own: a drawing sent with none, or another, is not run here.
    const scene = await sceneOf(ctx, frozen, sent.id, typeof sent.hash === 'string' ? sent.hash : '');
    if (scene) frozen.first = scene;
  }
  return lenses;
}
