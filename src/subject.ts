// An item that lives with what it is about (task e_ehwndqcw; decisions under e_zqap4dhg): a type that declares the
// capability `subject` (core's automation) is made with a link of that type to its subject, in the same change, and
// keeps one while it is live. It takes its subject's place: on an island map it lands on the subject's island, and it
// is as visible as its subject unless the change says otherwise. A subject that lives on no island (an actor, the
// kernel's own, an item made before islands) leaves it map-wide. The kernel reads the capability, never a type's name.

import type { Archipelago } from './pelago.ts';
import type { Op } from './pelago-types.ts';
import type { Registry } from './packs.ts';

type Create = Extract<Op, { op: 'create' }>;
type Link = Extract<Op, { op: 'link' }>;
interface Place { island?: string; visibility?: string; title: string }

/** The link types that tie an item of this type to its subject: the one its type names and its flavours; none when it names none. */
const subjectLinks = (reg: Registry, type: string | undefined) => {
  const link = type ? reg.type(type)?.capabilities.subject?.link : undefined;
  return link ? reg.relationFamily(link) : [];
};

/** The subject this change ties a new item to, by its ref: the first link of its subject's type from it. */
const tieOf = (ops: Op[], ref: string | undefined, links: string[]) =>
  ref === undefined ? undefined : (ops.find((o) => o.op === 'link' && o.from === ref && links.includes(o.type)) as Link | undefined);

/** Where a subject is, as this change leaves it: an item made in it by its ref, else the map's. */
async function placeOf(map: Archipelago, ops: Op[], key: string): Promise<Place | undefined> {
  const made = ops.find((o): o is Create => o.op === 'create' && o.ref === key);
  if (made) return { island: made.props?.island as string | undefined, visibility: made.visibility, title: made.title };
  const found = await map.entity(key);
  return found && { island: (found.props.island as string | undefined) ?? undefined, visibility: found.visibility, title: found.title };
}

/**
 * Put each new item that lives with its subject where its subject is: its island, when the subject has one and the op
 * names none, and its visibility, when the op says none. Written into the op (a copy), so the log says where it went.
 * Run before the island rules place what names no island, so what it is tied to decides first.
 */
export async function placeWithSubject(map: Archipelago, reg: Registry, ops: Op[]): Promise<void> {
  for (const [i, op] of ops.entries()) {
    if (op.op !== 'create') continue;
    const tie = tieOf(ops, op.ref, subjectLinks(reg, op.type));
    const there = tie && (await placeOf(map, ops, tie.to));
    if (!there) continue;
    const island = reg.onIslands && op.props?.island === undefined && there.island ? { island: there.island } : undefined;
    const visibility = op.visibility === undefined && there.visibility ? { visibility: there.visibility as Create['visibility'] } : undefined;
    if (island || visibility) ops[i] = { ...op, ...visibility, ...(island && { props: { ...op.props, ...island } }) };
  }
}

/** Why ops break the rule, as sentences: a new item made with no subject, one put on another island than its subject's, or the last tie to a live item's subject taken away. */
export async function subjectRefusals(map: Archipelago, reg: Registry, ops: Op[]): Promise<string[]> {
  const errors: string[] = [];
  for (const [i, op] of ops.entries()) {
    const where = `op ${i + 1} (${op.op})`;
    if (op.op === 'create') {
      const links = subjectLinks(reg, op.type);
      if (!links.length) continue;
      const link = reg.type(op.type)!.capabilities.subject!.link;
      const tie = tieOf(ops, op.ref, links);
      if (!tie) { errors.push(`${where}: a ${op.type} lives with what it is about: give it a ref and link it in the same change, { op: 'link', type: '${link}', from: <its ref>, to: <the item it is about> }`); continue; }
      const there = await placeOf(map, ops, tie.to);
      const island = op.props?.island ?? undefined;
      if (reg.onIslands && there && island !== there.island) errors.push(`${where}: a ${op.type} lives on the island of what it is about ("${there.title}"${there.island ? `, on ${there.island}` : ', on none'}), not ${String(island)}`);
    } else if (op.op === 'unlink') {
      const { rows } = await map.db.query<{ from_id: string; type: string }>(`select from_id, type from relation where id = $1 and valid_to is null`, [op.relation]);
      const tie = rows[0];
      const from = tie && (await map.entity(tie.from_id));
      if (!from || from.archived_at || !subjectLinks(reg, from.type).includes(tie.type)) continue;
      if (ops.some((o) => (o.op === 'archive' && o.id === from.id) || (o.op === 'link' && o.from === from.id && subjectLinks(reg, from.type).includes(o.type)))) continue;
      const cut = ops.flatMap((o) => (o.op === 'unlink' ? [o.relation] : []));
      const { rows: left } = await map.db.query(`select 1 from relation where from_id = $1 and valid_to is null and type = any($2::text[]) and id <> all($3::text[]) limit 1`, [from.id, subjectLinks(reg, from.type), cut]);
      if (!left.length) errors.push(`${where}: "${from.title}" lives with what it is about: link it to its new subject in this change, or archive it`);
    }
  }
  return errors;
}
