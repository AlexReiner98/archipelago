// What an agent's token may write, checked on the one write path (Archipelago.change). Its scope is within some
// items: each with all that lives in it, is part of it or is about it, and what goes with that. A token that may only
// report writes nothing but the readings its report tool sends; one that may propose has every change wait. What it
// sees is not narrowed here: that stays the database's, its person's view.

import { scopeOf } from './places.ts';
import { LINK_ITEM, TYPE_ITEM } from './type-overlay.ts';
import type { Actor, Archipelago, Op } from './pelago.ts';

/** Everything a token within these items may write to. */
export async function scopeWithin(l: Archipelago, within: string[]): Promise<Set<string>> {
  const scope = new Set<string>();
  for (const id of within) for (const inside of await scopeOf(l, id)) scope.add(inside);
  await widen(l, scope);
  return scope;
}

/** A refusal that names what the token is within. */
export async function refuser(l: Archipelago, within: string[]) {
  const titles = (await Promise.all(within.map(async (id) => (await l.entity(id))?.title ?? id))).join(' and ');
  return (what: string): never => {
    throw new Error(`This token is limited to the work of ${titles}. ${what}`);
  };
}

/** Whether this actor may write these ops: refused with the reason when it may not. */
export async function mayWrite(l: Archipelago, actor: Actor, ops: Op[], measured: boolean): Promise<void> {
  if (actor.kind === 'human') return;
  if (actor.may === 'report' && !measured) throw new Error('This token may only report: send what was measured with report (action health, or as Uptime Kuma posts it). It cannot change the map.');
  if (actor.within?.length) await opsWithin(l, actor.within, ops);
}

/** Refuse any op that reaches outside what the token is within. */
export async function opsWithin(l: Archipelago, within: string[], ops: Op[]): Promise<void> {
  const scope = await scopeWithin(l, within);
  const refuse = await refuser(l, within);
  const named = async (id: string) => `"${(await l.entity(id))?.title ?? id}"`;
  const mustBeIn = async (id: unknown, doing: string) => {
    if (typeof id === 'string' && !scope.has(id)) refuse(`${await named(id)} is not part of it, so this token cannot ${doing}.`);
  };
  // What a change makes is in scope once it is tied, in the same change, to something that is.
  const made = new Set(ops.flatMap((op) => (op.op === 'create' && op.ref ? [op.ref] : [])));
  const tied = new Set<string>();
  const inside = (key: string) => scope.has(key) || tied.has(key);
  for (let grew = true; grew; ) {
    grew = false;
    for (const op of ops) {
      if (op.op !== 'link') continue;
      for (const [mine, other] of [[op.from, op.to], [op.to, op.from]]) {
        if (!made.has(mine) || tied.has(mine) || !inside(other)) continue;
        tied.add(mine);
        grew = true;
      }
    }
  }
  // What it touches first, then what it makes: a link to what is not there is the better reason to give.
  for (const op of [...ops.filter((o) => o.op !== 'create'), ...ops.filter((o) => o.op === 'create')]) {
    if (op.op === 'define_type' || (op.op === 'create' && (op.type === TYPE_ITEM || op.type === LINK_ITEM))) refuse('It cannot define a type: that changes the whole map.');
    if (op.op === 'create' && !(op.ref && tied.has(op.ref))) refuse(`"${op.title}" is made without being tied to anything there: give it a ref and link it (is part of, is about) to something of that work in the same change.`);
    if (op.op === 'update') await mustBeIn(op.id, 'change it');
    if (op.op === 'archive' || op.op === 'restore') await mustBeIn(op.id, `${op.op} it`);
    if (op.op === 'link' && !made.has(op.from)) await mustBeIn(op.from, 'change what it is linked to');
    if (op.op === 'merge') {
      await mustBeIn(op.keep, 'merge it');
      await mustBeIn(op.drop, 'merge it');
    }
    if (op.op === 'unlink') {
      const { rows } = await l.db.query<{ from_id: string }>(`select from_id from relation where id = $1`, [op.relation]);
      if (rows[0]) await mustBeIn(rows[0].from_id, 'change what it is linked to');
    }
    if (op.op === 'forget') refuse('It cannot forget: that reaches the log, the backups and every read.');
  }
}

/**
 * What goes with the work as well: an item whose type belongs_with something in it (a test with the question it
 * helps answer, a result with its test), and so on out.
 */
async function widen(l: Archipelago, scope: Set<string>): Promise<void> {
  const rules = new Map<string, { relation: string; direction: 'out' | 'in'; types: string[] }>();
  for (const t of l.registry.types.values())
    for (const b of t.belongs_with ?? []) {
      const key = `${b.relation} ${b.direction}`;
      const rule = rules.get(key) ?? { ...b, types: [] };
      rule.types.push(t.id);
      rules.set(key, rule);
    }
  for (let grew = true, rounds = 0; grew && rounds < 4; rounds++) {
    grew = false;
    for (const { relation, direction, types } of rules.values()) {
      const [item, owner] = direction === 'out' ? ['from_id', 'to_id'] : ['to_id', 'from_id'];
      const { rows } = await l.db.query<{ id: string }>(
        `select r.${item} as id from relation r join entity e on e.id = r.${item}
         where r.type = any($1::text[]) and r.valid_to is null and r.${owner} = any($2::text[]) and e.type = any($3::text[]) and e.archived_at is null`,
        [l.registry.relationFamily(relation), [...scope], types],
      );
      for (const { id } of rows) if (!scope.has(id)) grew = Boolean(scope.add(id));
    }
  }
}
