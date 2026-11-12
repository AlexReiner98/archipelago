// What the anatomy sync works with: the files it reads, the items and links an extractor wants on the island, and the
// key that finds an item again. An extractor owns a kind of file and turns those files into keyed items and links; a
// sync compares what every extractor wants with what the island holds, by key, and sends only the difference.

/** A file as the sync reads it: its path, its text, the git blob hash it had, and the repository it is in. */
export interface Source { path: string; text: string; blob: string; repo: 'open_core' | 'hosted' }

/** An item an extractor wants, under the key that finds it again. */
export interface Want { key: string; type: string; title: string; body: string; props: Record<string, unknown> }

/** A link an extractor wants, its ends named by key. */
export interface WantLink { type: string; from: string; to: string; props?: Record<string, unknown> }

/** What the extractors want of the island. */
export interface Model { items: Want[]; links: WantLink[] }

/** One kind of source: which files it reads and what it makes of them. */
export interface Extractor { id: string; owns: (path: string) => boolean; extract: (files: Source[]) => Model }

/** The link types the sync makes: it may take back one of these it no longer wants, and no other. */
export const MADE_LINKS = ['part_of', 'anatomy.requires', 'anatomy.uses', 'anatomy.provides', 'anatomy.calls', 'anatomy.grants', 'anatomy.extends', 'anatomy.joins', 'anatomy.hears', 'anatomy.records', 'anatomy.moved_from', 'anatomy.kept_in', 'anatomy.imports', 'anatomy.tests'];

const cut = (s: string, n: number) => (s.length > n ? s.slice(0, n - 1).trimEnd() + '…' : s);
/** A title: a name of 60 characters at most. */
export const title = (s: string) => cut(s, 60);
/** A note's lead: its first two sentences, 400 characters at most. */
export const gist = (s: unknown) => cut(String(s ?? '').split(/(?<=\.)\s/).slice(0, 2).join(' '), 400);

/** The key an item of the island has, read back off its type, its fields and the pack it is part of. */
export function keyOf(type: string, props: Record<string, any>, pack?: string): string | undefined {
  switch (type) {
    case 'anatomy.pack': return props.pack_id && `pack:${props.pack_id}`;
    case 'anatomy.bundle': return props.bundle_id && `bundle:${props.bundle_id}`;
    case 'anatomy.name': return props.name && `name:${props.name}`;
    case 'anatomy.module': return props.path && `module:${props.path}`;
    case 'anatomy.test': return props.path && `test:${props.path}`;
    case 'anatomy.type': return props.type_id && `type:${props.adds_fields ? `${props.type_id}+${pack}` : props.type_id}`;
    case 'anatomy.link_type': return props.link_id && `link:${props.link_id}`;
    case 'anatomy.part': return pack && props.part_id && `part:${pack}:${props.part}:${props.part_id}:${props.side}`;
    case 'anatomy.store': return pack && props.store_id && `store:${pack}:${props.store_id}`;
    case 'anatomy.principle': return props.check && `check:${props.check}`;
    case 'anatomy.sync': return 'sync';
    default: return undefined;
  }
}

/** Every extractor's wants as one: each key once (the first extractor to want it), and no link to a key nobody wants. */
export function merge(models: Model[]): Model {
  const items = new Map<string, Want>();
  for (const m of models) for (const i of m.items) if (!items.has(i.key)) items.set(i.key, i);
  const seen = new Set<string>(), links: WantLink[] = [];
  for (const m of models) for (const l of m.links) {
    const k = `${l.type}|${l.from}|${l.to}`;
    if (seen.has(k) || l.from === l.to || !items.has(l.from) || !items.has(l.to)) continue;
    seen.add(k); links.push(l);
  }
  return { items: [...items.values()], links };
}
