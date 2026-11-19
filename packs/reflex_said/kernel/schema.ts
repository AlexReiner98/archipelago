// Types and the checks they imply, as nodes of the tree (Alex, 19 Nov 2026: "every single source on the map"). Most
// refusals an agent meets are not rules but the schema: a field its type does not have, a status it does not list, a
// value outside a field's, a link to an end it does not take. Decided without the map: the registry's types and
// links and the runs' refusals in, nodes and each check's refusals out. A type's words are its description; editing
// one on the map is its type item (a type naming it as its preset). Imports nothing; schema-read.ts reads.

/** A type as the registry resolves it: what a node and its checks are read from. */
export interface TypeDecl {
  id: string;
  pack: string;
  title: string;
  description: string;
  system?: boolean;
  statuses?: { open: string[]; closed: string[] };
  fields: Record<string, { type?: string; values?: unknown[]; system?: boolean }>;
}

/** A link type: its ends. */
export interface LinkDecl {
  id: string;
  pack?: string;
  title: string;
  from: string[];
  to: string[];
}

export interface SchemaNode {
  id: string;
  kind: 'type' | 'check';
  pack: string;
  tier: 'schema';
  for: string[];
  title: string;
  /** A type's words: its description. */
  words?: string;
  /** A check's: what it guards (fields, status, values, ends, ops). */
  guards?: string;
  /** A check's refusals in the window, when each was. */
  fired?: string[];
}

/** The checks every change meets whatever its types: its ops' shape, a type that exists, a name a few words. */
const OP_CHECKS: [string, string][] = [
  ['check:change:type', 'A type that exists'],
  ['check:change:ops', 'Ops that name what they act on'],
  ['check:change:title', 'A name in a few words'],
];

/** Each type as a node, and the checks it implies: its fields, its statuses, each field whose values are listed; each link type's ends. */
export function schemaNodes(types: TypeDecl[], links: LinkDecl[]): SchemaNode[] {
  const out: SchemaNode[] = OP_CHECKS.map(([id, title]) => ({ id, kind: 'check', pack: 'core', tier: 'schema', for: ['tool:change'], title, guards: 'ops' }));
  for (const t of types) {
    const at = `tool:change:${t.id}`;
    out.push({ id: `type:${t.id}`, kind: 'type', pack: t.pack, tier: 'schema', for: [at], title: t.title, words: t.description });
    out.push({ id: `check:${t.id}:fields`, kind: 'check', pack: t.pack, tier: 'schema', for: [at], title: `${t.title}: only its fields`, guards: 'fields' });
    if (t.statuses?.open.length) out.push({ id: `check:${t.id}:status`, kind: 'check', pack: t.pack, tier: 'schema', for: [`${at}:status`], title: `${t.title}: one of its statuses`, guards: 'status' });
    for (const [f, def] of Object.entries(t.fields)) {
      if (def.system || !(Array.isArray(def.values) || def.type === 'enum')) continue;
      out.push({ id: `check:${t.id}:${f}`, kind: 'check', pack: t.pack, tier: 'schema', for: [`${at}:${f}`], title: `${t.title}: ${f} one of its values`, guards: 'values' });
    }
  }
  for (const l of links) {
    if (l.from.includes('*') && l.to.includes('*')) continue;
    out.push({ id: `check:link:${l.id}`, kind: 'check', pack: l.pack ?? 'core', tier: 'schema', for: [`tool:change:link:${l.id}`], title: `${l.title}: its ends`, guards: 'ends' });
  }
  return out;
}

/**
 * The check a refusal's words name, or none (a rule's, said in its own words): an unknown field, a status, a value, a
 * link's end, the op's shape. Read off the write path's own wording.
 */
export function checkOf(said: string): string | undefined {
  const s = said.replace(/^Change refused(?: \([^)]*\))?:\s*/, '').replace(/^op \d+ \(\w+\):\s*/, '');
  let m: RegExpExecArray | null;
  if ((m = /^([a-z]\w*(?:\.[a-z]\w*)*) has no field "/.exec(s))) return `check:${m[1]}:fields`;
  if ((m = /^status "[^"]*" is not valid for ([a-z]\w*(?:\.[a-z]\w*)*)/.exec(s))) return `check:${m[1]}:status`;
  if ((m = /^([a-z][\w]*(?:\.[a-z][\w]*)?)\.([a-z_]\w*) (?:must be|needs) /.exec(s))) return `check:${m[1]}:${m[2]}`;
  if ((m = /^"([a-z]\w*(?:\.[a-z]\w*)*)" must (?:point to|come from) /.exec(s))) return `check:link:${m[1]}`;
  if (/^unknown type "/.test(s)) return 'check:change:type';
  if (/^(no entity or ref|no active relation|ref "[^"]*" is used twice)/.test(s)) return 'check:change:ops';
  if (/\btitle\b.*\b\d+ characters at most\b|characters at most.*\btitle\b/i.test(s)) return 'check:change:title';
  return undefined;
}

/**
 * The nodes with each check's refusals in the window (the runs' refused beats, when each was). A check a refusal names
 * that no node implied (a field whose value has a shape rather than a list) is drawn too, where its type's are.
 */
export function withFired(nodes: SchemaNode[], refusals: { at: string; said: string }[]): SchemaNode[] {
  const fired = new Map<string, string[]>();
  for (const r of refusals) {
    const id = checkOf(r.said);
    if (id) fired.set(id, [...(fired.get(id) ?? []), r.at]);
  }
  const known = new Set(nodes.map((n) => n.id));
  const more = [...fired.keys()].filter((id) => !known.has(id)).map((id): SchemaNode => {
    const [, type, field] = id.split(':');
    const of = nodes.find((n) => n.id === `type:${type}`);
    return { id, kind: 'check', pack: of?.pack ?? 'core', tier: 'schema', for: [`tool:change:${type}${field ? `:${field}` : ''}`], title: `${of?.title ?? type}: ${field ?? 'its shape'}`, guards: 'values' };
  });
  return [...nodes, ...more].map((n) => (n.kind === 'check' ? { ...n, fired: (fired.get(n.id) ?? []).sort() } : n));
}
