// What a pack touches, read from its manifest alone: every declaration it makes, grouped as a person reads them, each
// one by name, with what it is in a few words and its whole definition as the manifest says it. Nothing is filtered
// out: the kernel's actions and the retention rules are listed with the rest. Where its use on the map can be counted,
// the declaration names how (`counts`), and src/pack-use.ts fills in how much.

import type { PackFile } from './packs.ts';

/** How a declaration's use is counted: items of a type, links of a link type, a rule's holds, refusals and asks, a view's reads, an instruction's sayings. */
export type Counted = { by: 'items' | 'links'; type: string } | { by: 'ruling' | 'view' | 'told'; id: string };

/** One thing a pack declares: its name in words, what it is in a few, its whole definition, and how its use is counted. */
export interface Touched {
  name: string;
  about: string;
  /** Which sort of thing it is, for the page: its marks and the controls that cover it. */
  sort?: string;
  /** The point of its description, for a tooltip. */
  hint?: string;
  /** The declaration as the manifest has it. */
  def: unknown;
  counts?: Counted;
  /** Filled by src/pack-use.ts: how much it was used, and in words what that is made of. */
  used?: number;
  said?: string;
}

type Entry = Record<string, unknown>;

/** The point of a description: up to its first full stop or colon, at most a short line. */
export const gist = (text: unknown) => {
  const point = String(text ?? '').split(/(?<=[.:])\s/)[0].replace(/[.:]$/, '');
  return point.length > 90 ? `${point.slice(0, 89)}…` : point;
};
/** A name, not an identifier: an id without a title is read as its last part, in words. */
const words = (id: unknown) => String(id ?? '').split('.').pop()!.replaceAll('_', ' ');
/** The same, as a name: its first letter a capital. */
const title = (id: unknown) => words(id).replace(/^./, (c) => c.toUpperCase());
const all = (v: unknown) => (Array.isArray(v) ? (v as Entry[]) : []);
const listed = (v: unknown) => (Array.isArray(v) ? v : v == null ? [] : [v]).map((x) => (typeof x === 'object' ? JSON.stringify(x) : String(x)));
const named = (e: Entry) => (e.title ? String(e.title) : title(e.id ?? e.of ?? e.name));
const fieldNames = (t: Entry) => Object.keys((t.fields as Entry) ?? {});

/** What a rule's when matches, in a few words: who, which op, of what, and what else it asks of the change. */
export function whenWords(when: unknown): string {
  const w = (when ?? {}) as Entry;
  const out: string[] = [];
  for (const [k, v] of Object.entries(w)) {
    if (k === 'actor' || k === 'op' || k === 'type') out.push(listed(v).join('/'));
    else if (k === 'fields') out.push(`fields ${listed(v).join(', ')}`);
    else if (k === 'matches') out.push(`${Object.keys((v as Entry) ?? {}).join(', ')} matching`);
    else if (k === 'status') out.push(`status ${[(v as Entry)?.from, (v as Entry)?.to].filter(Boolean).join('→')}`);
    else if (k === 'capability') out.push(typeof v === 'string' ? v : Object.keys((v as Entry) ?? {}).join(', '));
    else if (k === 'reply') out.push(`reply ${Object.entries((v as Entry) ?? {}).map(([f, x]) => (x === true ? f : x === false ? `not ${f}` : `${f} ${x}`)).join(', ')}`);
    else out.push(v === true ? words(k) : v === false ? `not ${words(k)}` : `${words(k)} ${listed(v).join('/')}`);
  }
  return out.join(' · ');
}

/** What a rule does: holds, refuses, needs fields, asks an agent, or keeps a stream. */
function ruleDoes(r: Entry): string {
  if (r.stream) return 'keeps';
  if (r.unique) return 'unique';
  if (r.then === 'hold') return 'holds';
  if (r.then === 'refuse') return 'refuses';
  if (r.then === 'ask') return 'asks';
  if (r.then && typeof r.then === 'object') return 'needs';
  return 'decides';
}

/** A retention rule's keep, in a few words. */
const keepWords = (k: Entry) => Object.entries(k ?? {}).map(([f, v]) => (v === true ? f : Array.isArray(v) ? `${f} ${v.map((t) => listed(t).join('/')).join(', ')}` : `${f} ${v}`)).join(', ');

function rule(p: PackFile, r: Entry): Touched {
  const does = ruleDoes(r);
  const then = r.then as Entry | string | undefined;
  const about =
    does === 'keeps' ? `${r.stream}: ${keepWords(r.keep as Entry)}${r.when ? ` (${whenWords(r.when)})` : ''}`
    : does === 'unique' ? `${r.type}: ${listed(r.unique).join(', ')}`
    : [does === 'needs' ? listed((then as Entry).require).join(', ') : '', whenWords(r.when)].filter(Boolean).join(' · ');
  // A reply rule asks; any other with a then decides a change: both are counted. What keeps a stream, or is unique, is not.
  const counts: Counted | undefined = does !== 'keeps' && does !== 'unique' && r.id ? { by: 'ruling', id: `${p.id}.${r.id}` } : undefined;
  return { name: title(r.id ?? r.type), about, sort: does, hint: gist(r.say), def: r, ...(counts && { counts }) };
}

/**
 * What a pack touches, read from its manifest's keys and grouped as a person reads them: the words it shares (shared),
 * what it adds to the map (types, links), what it shows (views), how things look and what agents are told (styles,
 * instructions), what decides a write or asks an agent (rules), what can be done through it (actions), what runs by
 * itself (runs), and what it reaches beyond the map (reach). Each group with how many, and every thing in it.
 */
export function packTouches(p: PackFile) {
  const styles = all(p.styles);
  const told = styles.filter((s) => s.type === 'instruction');
  const reach = (p.reach ?? {}) as Entry;
  const typeRow = (t: Entry): Touched => {
    const fields = fieldNames(t);
    if (t.of) return { name: title(t.of), about: `fields added: ${fields.map(words).join(', ')}`, sort: 'fields', def: t, counts: { by: 'items', type: String(t.of) } };
    const about = [`${fields.length} field${fields.length === 1 ? '' : 's'}`, t.extends && `a ${words(t.extends)}`, fields.length && fields.map(words).join(', ')].filter(Boolean).join(' · ');
    return { name: named(t), about, hint: gist(t.description), def: t, counts: { by: 'items', type: String(t.id) } };
  };
  const declared = new Map(all(p.types).filter((t) => t.id).map((t) => [String(t.id), t]));
  const groups: [string, Touched[]][] = [
    ['shared', listed((p as unknown as Entry).shared).map((id) => ({ name: title(id), about: declared.has(id) ? 'declared here' : 'declared by another pack', def: declared.get(id) ?? id, counts: { by: 'items', type: id } }))],
    ['types', all(p.types).map(typeRow)],
    ['links', all(p.links).map((r) => ({ name: named(r), about: [r.extends && `a ${words(r.extends)}`, (r.from || r.to) && `${listed(r.from).map(words).join('/') || 'any'} → ${listed(r.to).map(words).join('/') || 'any'}`].filter(Boolean).join(' · '), hint: gist(r.description), def: r, counts: { by: 'links', type: String(r.id) } }))],
    ['views', all(p.views).map((v) => {
      const screen = v.form === 'screen';
      const what = screen ? `a screen of ${all(v.pieces).map((x) => words(x.piece)).join(', ')}` : `${v.answer ? `answers ${words(v.answer)}` : v.lens ? 'a lens' : 'a read'}${v.lens && Object.keys(v.lens as Entry).length ? `: ${JSON.stringify(v.lens)}` : ''}`;
      return { name: named(v), about: what, sort: String(v.form ?? 'read'), hint: gist(v.description), def: v, ...(!screen && { counts: { by: 'view' as const, id: String(v.id) } }) };
    })],
    ['styles', [
      ...all(p.layouts).map((d) => ({ name: named(d), about: `a layout: ${words(d.shape ?? '')}, ${Object.keys((d.modules as Entry) ?? {}).length} modules`, sort: 'drawing', def: d })),
      ...styles.filter((s) => !told.includes(s)).map((s) => ({ name: named(s), about: [s.type ? `a ${words(s.type)}` : s.over === 'chosen' ? 'a theme' : 'a style', Array.isArray(s.on) && s.on.length ? `on ${(s.on as string[]).map(words).join(', ')}` : 'the whole map'].join(' · '), sort: s.over === 'chosen' ? 'theme' : 'preset', hint: gist(s.body ?? s.description), def: s })),
    ]],
    ['instructions', told.map((s) => ({ name: named(s), about: `for ${listed((s.props as Entry)?.for ?? s.for).join(', ') || 'no one'}`, hint: gist(s.body), def: s, counts: { by: 'told', id: String(s.id) } }))],
    ['rules', all(p.rules).map((r) => rule(p, r))],
    ['actions', all(p.actions).map((a) => ({ name: named(a), about: [a.kernel ? 'the kernel’s verb' : a.verb && `under ${a.verb}`, gist(a.description)].filter(Boolean).join(': '), sort: a.kernel ? 'kernel' : 'own', def: a }))],
    ['runs', all(p.handlers).map((r) => ({ name: title(r.event ?? r.schedule ?? r.webhook), about: r.event ? 'on an event' : r.webhook ? 'on a webhook' : r.every_minutes ? `every ${r.every_minutes} minutes` : 'on a schedule', def: r }))],
    ['reach', [...all(reach.hosts).map((x) => ({ name: String(x.host ?? x.id ?? x.name ?? 'a host'), about: 'a host it calls', def: x })), ...all(reach.secrets).map((x) => ({ name: title(x.name), about: 'a secret it holds', def: x })), ...all(reach.webhooks).map((x) => ({ name: title(x.id ?? x.name), about: 'a webhook it hears', def: x })), ...(reach.server ? [{ name: 'the server', about: 'what no one workspace can do', def: reach.server }] : []), ...(reach.launch ? [{ name: 'sessions', about: 'starts agent sessions when a person calls its action', def: reach.launch }] : [])]],
  ];
  return groups.map(([key, items]) => ({ key, n: items.length, items }));
}
