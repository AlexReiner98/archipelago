// What the publish pack reads of the map and of those who act, through its context alone (docs/kernel-packs.md, "The
// in-process context"): an item by its id, the types that can be public, and the small pure helpers its modules share,
// copied from where the kernel keeps them (a pack imports no other pack): who an actor is, on whose authority it acts,
// which types a piece is drawn on, a type's shown fields, a document's sections and a picture's steps as a reader may
// have them.

import type { KernelContext } from '#pelago/kernel';

/** Who acts, as the kernel hands it (src/pelago-types.ts, Actor): only what publishing reads of it. */
export interface Actor {
  kind: 'human' | 'agent';
  name: string;
  person?: string;
  may?: string;
}

/** On whose authority (src/pelago-types.ts, Authority): as the log keeps it. */
export type Authority = { of: 'human' | 'agent'; who?: string; basis?: string; stated_by?: string };
export type Said = Pick<Authority, 'of' | 'basis'>;

/** An item as the reads give it (`entities`): every column the asker may read. */
export type Item = {
  id: string;
  type: string;
  title: string;
  status: string;
  body: string;
  visibility: string;
  private_to?: string | null;
  archived_at?: unknown;
  updated_at: string | Date;
  props: Record<string, unknown>;
};

const ID = /^e_[a-z0-9]{8}$/;

/** How an actor is named in the log: `<kind>:<name>` (src/pelago-types.ts, actorId). */
export const actorId = (actor: Actor) => `${actor.kind}:${actor.name}`;

/** The authority an act is logged with (src/authority.ts, authorityOf): a human's own, or an agent's saying whose word it acts on. */
export function authorityOf(human: boolean, me: string, claimed?: Said): Authority {
  if (human) return { of: 'human', who: me };
  if (claimed?.of !== 'human') return { of: 'agent', who: me, ...(claimed?.basis && { basis: claimed.basis }) };
  if (!claimed.basis?.trim()) throw new Error('Change rejected:\n- authority: to act on a human’s word, say what they said and where (authority.basis).');
  return { of: 'human', basis: claimed.basis, stated_by: me };
}

/** An item of this map by its id, as the one asking may read it (archived too), or null. */
export async function itemOf(ctx: KernelContext, id: string): Promise<Item | null> {
  if (!ID.test(id)) return null;
  const rows = (await ctx.reads({ entities: [id] })) as Item[];
  return rows[0] ?? null;
}

/** Some items of this map by id, as the one asking may read them (archived too). */
export const itemsOf = async (ctx: KernelContext, ids: string[]): Promise<Item[]> => (ids.length ? ((await ctx.reads({ entities: ids })) as Item[]) : []);

/** The types a document is read whole as and can be public, and of those each finished status as type:status (the walls' public-document.ts). */
export const publishable = async (ctx: KernelContext) => (await ctx.reads({ publishable: true })) as { types: string[]; finished: string[] };

/** The type a view is kept as (core's lens), and whether a type is one (src/query-saved.ts, isKept). */
const KEPT = 'lens';
export const isKept = (ctx: Pick<KernelContext, 'registry'>, type: string) => ctx.registry.isA(type, KEPT);

/** The types a pack's screen draws this piece on, flavours included (Registry.drawnWith). */
export function drawnWith(registry: KernelContext['registry'], piece: string): string[] {
  type Screen = { form?: string; on?: string[]; pieces?: { piece?: string }[] };
  const screens = registry.packs.flatMap((p) => ((p as { views?: Screen[] }).views ?? []).filter((v) => v.form === 'screen'));
  const on = screens.filter((s) => (s.pieces ?? []).some((p) => p.piece === piece)).flatMap((s) => s.on ?? []);
  return [...new Set(on.flatMap((t) => registry.family(t)))];
}

/** Of an item's fields, those its type's pack marks as shown (src/documents.ts, shownOf). */
export const shownOf = (ctx: Pick<KernelContext, 'registry'>, type: string, props: Record<string, unknown>) => {
  const defs = (ctx.registry.type(type)?.fields ?? {}) as Record<string, { shown?: boolean }>;
  return Object.fromEntries(Object.entries(props ?? {}).filter(([key, value]) => defs[key]?.shown && value != null));
};

/** A line that brings an item in: its id and nothing else. */
const SECTION = /^[ \t]*(e_[a-z0-9]{8})[ \t]*$/;
/** The ids a document's note brings in, in the order it brings them (src/documents.ts, sectionIds). */
export const sectionIds = (body: string): string[] => [...new Set(body.split('\n').flatMap((line) => SECTION.exec(line)?.[1] ?? []))];

/** A step of a kept view's picture (src/query-steps.ts, Step): what a reader may be given of it. */
export interface Step {
  add?: string[];
  remove?: string[];
  titles?: Record<string, string | null>;
  fields?: Record<string, Record<string, unknown>>;
  lit?: [string, string][];
  link?: [string, string][];
  unlink?: [string, string][];
  flag?: Record<string, string | null>;
  chapter?: { name: string; when?: string; count?: number };
  lines?: { by: string; text: string }[];
  look?: string | null;
  quick?: boolean;
  card?: { title: string; text?: string };
}

/** The steps as a reader of a published picture may have them: naming only what the picture shows them (src/query-steps.ts, stepsShown). */
export function stepsShown(steps: Step[], shown: Set<string>): Step[] {
  const only = <T>(byId: Record<string, T> | undefined) => byId && Object.fromEntries(Object.entries(byId).filter(([id]) => shown.has(id)));
  // Only what a step is known to say: anything else kept in it is not the reader's.
  return steps.map((s) => ({
    ...(s.chapter && { chapter: { name: s.chapter.name, ...(s.chapter.when !== undefined && { when: s.chapter.when }), ...(s.chapter.count !== undefined && { count: s.chapter.count }) } }),
    ...(s.lines && { lines: s.lines.map((l) => ({ by: l.by, text: l.text })) }),
    ...(s.look !== undefined && { look: s.look }),
    ...(s.quick && { quick: true }),
    ...(s.card && { card: { title: s.card.title, ...(s.card.text !== undefined && { text: s.card.text }) } }),
    ...(s.add && { add: s.add.filter((id) => shown.has(id)) }),
    ...(s.remove && { remove: s.remove.filter((id) => shown.has(id)) }),
    ...(s.titles && { titles: only(s.titles) }),
    ...(s.fields && { fields: only(s.fields) }),
    ...(s.flag && { flag: only(s.flag) }),
    ...(s.lit && { lit: s.lit.filter(([a, b]) => shown.has(a) && shown.has(b)) }),
    ...(s.link && { link: s.link.filter(([a, b]) => shown.has(a) && shown.has(b)) }),
    ...(s.unlink && { unlink: s.unlink.filter(([a, b]) => shown.has(a) && shown.has(b)) }),
  }));
}
