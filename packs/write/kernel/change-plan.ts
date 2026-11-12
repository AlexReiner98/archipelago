// Planning a change: its ops checked against the schema and the map as it is now, before anything is written. The
// write path (packs/write/kernel/pelago.ts) asks it before a change is judged and again before it is applied.

import { undeclaredColumns } from '../../loader/kernel/head.ts'; import { typedProblems } from '../../loader/kernel/fields.ts';
import { bodyAfter } from './ops.ts'; import { mergeRefusals } from './merge.ts';
import { currentNames, typesAfter } from '../../loader/kernel/type-items.ts'; import { privateDependencies } from '../../rules/kernel/private-deps.ts';
import { publicTypes, type Entity, type Op } from './pelago-types.ts'; import { OWNED_BY } from './owner-link.ts'; import { islandRefusals } from '../../loader/kernel/island-items.ts'; import { islandRegistry, pinRefusals } from '../../loader/kernel/island-pin.ts';
import type { Archipelago } from './pelago.ts';
import { validate, type Who } from './write-hooks.ts';

/** Validate ops against the schema and the current map, and by what fills write.validate (packs/write/kernel/write-hooks.ts): who, where a change is judged. Throws listing every problem. */
export async function planChange(map: Archipelago, ops: Op[], who?: Who): Promise<{ warnings: string[] }> {
  if (!ops.length) throw new Error('A change needs at least one op.'); currentNames(map.registry, ops);
  const errors: string[] = [], warnings: string[] = [];
  const refs = new Map<string, string>(), refIslands = new Map<string, unknown>(); // ref -> type, and the island it is made on
  const seen = new Set<string>(), dropped = new Set<string>(); // dropped: what this change has merged away so far
  const reg = await typesAfter(map, ops); // a type made in this change can be used in it (packs/loader/kernel/type-items.ts)

  const typeOf = async (key: string, where: string): Promise<string | undefined> => {
    const local = refs.get(key);
    if (local) return local;
    const found = await map.entity(key);
    if (!found) errors.push(`${where}: no entity or ref "${key}"`);
    else if (found.archived_at) warnings.push(`${where}: "${found.title}" (${key}) is archived`);
    return found?.type;
  };
  const existing = async (id: string, where: string) => {
    const found = await map.entity(id);
    if (!found) errors.push(`${where}: no entity "${id}"`);
    return found;
  };
  // Saying an owner makes an owned_by link (packs/write/kernel/owner-link.ts), so it is checked as that link op is: both ends.
  const checkOwner = async (item: string | undefined, owner: string, where: string) => {
    const type = await typeOf(owner, where);
    const problem = item && type ? reg.checkRelation(OWNED_BY, item, type) : undefined;
    if (problem) errors.push(`${where}: ${problem}`);
  };

  // A kept view that walks part_of either way for more than a step climbs to what holds its start and draws all of it.
  const climbs = (type: string | undefined, props: Record<string, unknown> | undefined, where: string) => {
    const walk = props?.walk as { over?: unknown; steps?: unknown } | undefined;
    if (!type || !reg.isA(type, 'lens') || !walk || !Array.isArray(walk.over) || !(Number(walk.steps) >= 2)) return;
    const holds = reg.relationFamily('part_of');
    const both = walk.over.filter((t): t is string => typeof t === 'string' && holds.includes(t));
    if (both.length) warnings.push(`${where}: its walk follows ${both.join(', ')} either way for ${walk.steps} steps, so it climbs to what holds where it starts and draws all of that: write ${both[0]}< to walk down (what is in it) or ${both[0]}> to walk up`);
  };

  for (const [i, op] of ops.entries()) {
    const where = `op ${i + 1} (${op.op})`;
    switch (op.op) {
      case 'create': {
        if (!op.title?.trim()) errors.push(`${where}: title is required`);
        const here = await islandRegistry(map, op.props?.island, reg); // an item is checked against the version of its pack its island runs
        errors.push(...here.check(op.type, op.status, op.props ?? {}).map((p) => `${where}: ${p}`));
        if (op.owner) await checkOwner(reg.type(op.type) && op.type, op.owner, where);
        const type = here.type(op.type);
        if (!type) break; if (type.retired) errors.push(`${where}: ${op.type} is retired here: no new item is made of it`);
        if (op.visibility === 'public' && !type.public) errors.push(`${where}: a ${op.type} cannot be public. Only these can: ${publicTypes(reg).join(', ')}.`);
        errors.push(...[...typedProblems(op.type, type.fields, op.props ?? {}), ...undeclaredColumns(type, op)].map((p) => `${where}: ${p}`));
        if (op.ref) {
          if (refs.has(op.ref)) errors.push(`${where}: ref "${op.ref}" is used twice`);
          refs.set(op.ref, op.type); refIslands.set(op.ref, op.props?.island);
        }
        const root = type.base;
        const key = `${root}\n${op.title.trim().toLowerCase()}`;
        if (seen.has(key)) warnings.push(`${where}: "${op.title}" appears more than once in this change`);
        seen.add(key);
        const { rows } = await map.db.query<Entity>(
          `select id, type, title from entity where lower(title) = lower($1) and type = any($2::text[]) and archived_at is null`,
          [op.title.trim(), reg.family(root)],
        );
        for (const dup of rows) warnings.push(`${where}: possible duplicate of existing ${dup.type} "${dup.title}" (${dup.id})`);
        climbs(op.type, op.props, where);
        break;
      }
      case 'update': {
        const target = await existing(op.id, where);
        if (!target) break;
        const here = await islandRegistry(map, op.props?.island ?? target.props.island, reg);
        errors.push(...[...here.check(target.type, op.status, op.props ?? {}), ...typedProblems(target.type, here.type(target.type)?.fields ?? {}, op.props ?? {}, target.props), ...undeclaredColumns(here.type(target.type), op)].map((p) => `${where}: ${p}`));
        if (op.visibility === 'public' && !reg.type(target.type)?.public) errors.push(`${where}: "${target.title}" is a ${target.type}, which cannot be public. Only these can: ${publicTypes(reg).join(', ')}.`);
        if (op.title !== undefined && !op.title.trim()) errors.push(`${where}: title cannot be empty`);
        try {
          bodyAfter(target.body, op);
        } catch (e) {
          errors.push(`${where}: "${target.title}": ${(e as Error).message}`);
        }
        if (op.owner) await checkOwner(target.type, op.owner, where);
        climbs(target.type, op.props, where);
        break;
      }
      case 'link': {
        const from = await typeOf(op.from, where);
        const to = await typeOf(op.to, where);
        if (op.from === op.to) errors.push(`${where}: cannot link an entity to itself`);
        if (from && to) {
          // A link is judged by the version its from item's island runs, as that item is.
          const island = refIslands.has(op.from) ? refIslands.get(op.from) : (await map.entity(op.from))?.props.island;
          const problem = (await islandRegistry(map, island, reg)).checkRelation(op.type, from, to);
          if (problem) errors.push(`${where}: ${problem}`);
        }
        break;
      }
      case 'unlink': {
        const { rows } = await map.db.query(`select 1 from relation where id = $1 and valid_to is null`, [op.relation]);
        if (!rows.length) errors.push(`${where}: no active relation "${op.relation}"`);
        break;
      }
      case 'archive': case 'forget':
        await existing(op.id, where);
        if (op.op === 'forget' && (ops.length > 1 || op.reasons?.some((c) => !/^[cp]_\w+$/.test(c)))) errors.push(`${where}: a forget is a change of its own, and its reasons name change sets (c_…) or held changes (p_…)`);
        break;
      case 'restore': {
        const target = await existing(op.id, where);
        if (target && !target.archived_at) errors.push(`${where}: "${target.title}" is not archived`);
        break;
      }
      case 'merge': {
        const keep = await existing(op.keep, where);
        const drop = await existing(op.drop, where);
        errors.push(...(await mergeRefusals(map.db, where, keep, drop, dropped)));
        if (keep && drop && keep.type !== drop.type) warnings.push(`${where}: merging a ${drop.type} into a ${keep.type}`);
        break;
      }
      case 'define_type':
        errors.push(...reg.checkNewType(op.type).map((p) => `${where}: ${p}`));
        break;
    }
  }
  // An item kept with its subject is the placement pack's to check (answer.subject_refusals), judged by this registry.
  const subject = (await (await import('../../loader/kernel/kernel-context.ts')).callAs<{ refusals: string[] }>(map, 'answer.subject_refusals', { ops, registry: reg })).refusals;
  errors.push(...(await islandRefusals(map, reg, ops)), ...subject, ...(await pinRefusals(map, reg, ops)));
  const checked = await validate({ map, reg, who }, ops); // a view's twins, an automation's trigger, and what packs check
  errors.push(...checked.refusals); warnings.push(...checked.warnings);
  if (!errors.length) errors.push(...(await privateDependencies(map, ops)));
  if (errors.length) throw new Error(`Change rejected:\n- ${errors.join('\n- ')}`);
  return { warnings };
}
