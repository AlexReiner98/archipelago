// The rule form apart (round three of the build pack, task e_gukkpccb): items of one type on one island whose field of
// file globs meets another's are refused, unless both link (depend_on, say) to one item of a named type (an overlap).
// Two globs meet where some path could match both (./globs.ts). A rule as data in a pack:
//   { "id": "lanes_apart", "type": "build.lane", "apart": { "field": "files", "link": "depends_on", "unless": "build.overlap" } }
// Checked as the pack loads (checkApart, through the slot loader.rule_apart in packs/loader/kernel/rule-check.ts, filled
// as this module loads) and judged in decide of the change as a whole (apartRefused): it refuses whatever sends it, as
// at_most does. Only open items count, and only on an island: what it reads is that island's items, by the island index.

import type { Q } from '../../database/kernel/db.ts';
import { fillApart } from '../../loader/kernel/rule-check.ts';
import type { Registry } from '../../loader/kernel/packs.ts';
import { fieldsAsLaidOver } from '../../loader/kernel/type-overlay.ts';
import { globsOf, meeting } from './globs.ts';
import type { FormOp } from './rule-forms.ts';
import type { RuleDef } from './rules.ts';

/** The field of globs on an item of the rule's type that must not meet another's, and what spares two that do: both linked by `link` to one item of type `unless`. */
export interface Apart { field: string; link: string; unless: string }

type Checked = Pick<Registry, 'types'> & Partial<Pick<Registry, 'relations'>>;
type Row = { id: string; type: string; title: string; status: string; props: Record<string, unknown> };
/** An item of the rule's type as it stands once the change applies: by id, or by its ref for one the change makes. */
type Held = { key: string; title: string; island: string; globs: string[] };

const word = (v: unknown) => typeof v === 'string' && /^[a-z][a-z0-9_.]*$/.test(v);
/** An island as props.island names it: a ref in braces for one this change makes. */
const islandKey = (v: unknown) => (typeof v === 'string' && v ? v.replace(/^\{([^{}\s]+)\}$/, '$1') : undefined);

/** Problems with an apart rule: the type it holds of and its field, the link and the type that spare it, and nothing it cannot do. */
export function checkApart(rule: RuleDef, at: string, reg: Checked): string[] {
  const problems: string[] = [];
  const a = rule.apart as Partial<Apart> | undefined;
  if (rule.at_most !== undefined || rule.must_link !== undefined || rule.unique !== undefined) problems.push(`${at}: apart is a rule of its own, beside no at_most, must_link or unique`);
  const type = rule.type ? reg.types.get(rule.type) : undefined;
  if (!type) problems.push(`${at}: apart needs the type it holds of (type)`);
  if (!a || typeof a !== 'object' || !word(a.field)) problems.push(`${at}: apart.field is the field of globs, like "files"`);
  else if (type && !fieldsAsLaidOver(type)[a.field!]) problems.push(`${at}: ${rule.type} has no field "${a.field}"`);
  if (!word(a?.link) || (reg.relations && !reg.relations.has(a!.link!))) problems.push(`${at}: apart.link is a link type the packs define`);
  if (!word(a?.unless) || !reg.types.has(a!.unless!)) problems.push(`${at}: apart.unless is the type of the item both link to, like an overlap`);
  if (rule.when !== undefined || (rule.then !== undefined && rule.then !== 'refuse')) problems.push(`${at}: apart refuses whatever sends the change: it takes no when, and then is refuse or left out`);
  return problems;
}
fillApart(checkApart);

/** What apart refuses: two open items of the rule's type on one island whose globs meet, not both linked to one item of the unless type. */
export async function apartRefused(q: Q, reg: Registry, rules: RuleDef[], ops: FormOp[]): Promise<string[]> {
  const these = rules.filter((r) => r.apart && r.type);
  if (!these.length || !ops.some((o) => o.op === 'create' || o.op === 'update' || o.op === 'unlink')) return [];
  const unlinked = ops.filter((o) => o.op === 'unlink' && o.relation).map((o) => o.relation!);
  const cut = unlinked.length ? (await q.query<{ id: string; from_id: string }>(`select id, from_id from relation where id = any($1::text[]) and valid_to is null`, [unlinked])).rows : [];
  const ids = [...new Set([...ops.flatMap((o) => (o.op === 'update' && o.id ? [o.id] : [])), ...cut.map((r) => r.from_id)])];
  const stored = new Map((ids.length ? (await q.query<Row>(`select id, type, title, status, props from entity where id = any($1::text[]) and archived_at is null`, [ids])).rows : []).map((r) => [r.id, r]));
  const archived = new Set(ops.filter((o) => o.op === 'archive' && o.id).map((o) => o.id!));
  const updated = (r: Row): Row => ops.filter((o) => o.op === 'update' && o.id === r.id).reduce((x, o) => ({ ...x, title: o.title ?? x.title, status: o.status ?? x.status, props: { ...x.props, ...o.props } }), r);
  const out: string[] = [];
  for (const rule of these) {
    const { field, link, unless } = rule.apart!;
    const family = reg.relationFamily(link);
    const kin = reg.family(rule.type!);
    const open = (type: string, status: string | undefined) => status === undefined || reg.isOpen(type, status);
    const held = (key: string, title: string, props: Record<string, unknown>): Held[] => {
      const island = islandKey(props?.island), globs = globsOf(props?.[field]);
      return island && globs.length ? [{ key, title, island, globs }] : [];
    };
    // What the change puts in question: an item made, one whose globs, island or status it changes, one it unlinks.
    const asked: Held[] = [];
    for (const [i, o] of ops.entries()) if (o.op === 'create' && o.type && reg.isA(o.type, rule.type!) && open(o.type, o.status)) asked.push(...held(o.ref ?? `op ${i + 1}`, String(o.title ?? o.type), o.props ?? {}));
    for (const r of stored.values()) {
      const touched = ops.some((o) => o.op === 'update' && o.id === r.id && (o.status !== undefined || (o.props && (field in o.props || 'island' in o.props)))) || cut.some((c) => c.from_id === r.id);
      const now = updated(r);
      if (touched && !archived.has(r.id) && reg.isA(r.type, rule.type!) && open(now.type, now.status)) asked.push(...held(r.id, now.title, now.props));
    }
    if (!asked.length) continue;
    // The others on each island in question, as the change leaves them: the island's items by the island index, the change's own beside them.
    const islands = [...new Set(asked.map((h) => h.island))];
    const { rows } = await q.query<Row>(`select id, type, title, status, props from entity where props->>'island' = any($1::text[]) and type = any($2::text[]) and archived_at is null limit 1000 -- index entity_island`, [islands, kin]);
    const others: Held[] = [...asked];
    for (const r of rows.map(updated)) if (!archived.has(r.id) && open(r.type, r.status) && !others.some((h) => h.key === r.id)) others.push(...held(r.id, r.title, r.props));
    // What each links to of the unless type, stored and in the change, less what it unlinks.
    const keys = others.map((h) => h.key);
    const ends = ops.filter((o) => o.op === 'link' && o.to && o.type && family.includes(reg.canonical(o.type))).map((o) => o.to!);
    const endTypes = new Map((ends.length ? (await q.query<{ id: string; type: string }>(`select id, type from entity where id = any($1::text[]) and archived_at is null`, [ends])).rows : []).map((r) => [r.id, r.type]));
    const { rows: links } = await q.query<{ id: string; from_id: string; to_id: string }>(
      `select r.id, r.from_id, r.to_id from relation r join entity e on e.id = r.to_id where r.from_id = any($1::text[]) and r.type = any($2::text[]) and r.valid_to is null and e.archived_at is null and e.type = any($3::text[]) limit 2000`,
      [keys, family, reg.family(unless)],
    );
    const spare = new Map<string, Set<string>>(keys.map((k) => [k, new Set()]));
    for (const r of links) if (!unlinked.includes(r.id) && !archived.has(r.to_id)) spare.get(r.from_id)?.add(r.to_id);
    for (const o of ops) {
      if (o.op !== 'link' || !o.from || !o.to || !o.type || !family.includes(reg.canonical(o.type))) continue;
      const t = ops.find((c) => c.op === 'create' && c.ref === o.to)?.type ?? endTypes.get(o.to);
      if (t && reg.isA(t, unless)) spare.get(o.from)?.add(o.to);
    }
    const seen = new Set<string>();
    for (const a of asked) for (const b of others) {
      if (a.key === b.key || a.island !== b.island) continue;
      const pair = [a.key, b.key].sort().join(' ');
      if (seen.has(pair)) continue;
      seen.add(pair);
      const shared = meeting(a.globs, b.globs);
      if (!shared.length || [...spare.get(a.key)!].some((x) => spare.get(b.key)!.has(x))) continue;
      const fill: Record<string, string> = { title: a.title, other: b.title, globs: shared.join(', ') };
      const fallback = `"{title}" and "{other}" both touch {globs}: they meet, so each ${link} one ${unless} first`;
      out.push(Object.entries(fill).reduce((s, [k, v]) => s.replaceAll(`{${k}}`, v), rule.say ?? fallback));
    }
  }
  return [...new Set(out)];
}
