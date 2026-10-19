// A token within some items reads the map as its person does, and writes only
// what is theirs. A token that leaks, or an agent that is led astray by what
// it reads, can then reach no further than the work it was given. What a
// change writes is checked on the write path (within.ts); the other tools are
// checked here, before they run. What such a token may call is a list: a tool
// that writes is on it with its check, the tools that only read are named,
// and anything else is refused.

import { repoByName, repoName } from './github.ts';
import { packTool } from './packtools.ts';
import { livesIn } from './places.ts';
import type { Actor, Archipelago } from './pelago.ts';
import { resolveRun } from './sessions.ts';
import { refuser, scopeWithin } from './within.ts';

export async function withinScope(l: Archipelago, actor: Actor, tool: string, input: Record<string, unknown>): Promise<void> {
  const within = actor.within ?? [];
  if (!within.length) return;
  const scope = await scopeWithin(l, within);
  const refuse = await refuser(l, within);
  const named = async (id: string) => `"${(await l.entity(id))?.title ?? id}"`;
  const mustBeIn = async (id: unknown, doing: string) => {
    if (typeof id === 'string' && !scope.has(id)) refuse(`${await named(id)} is not part of it, so this token cannot ${doing}.`);
  };
  const isRepo = async (given: unknown) => {
    const id = typeof given === 'string' && /^e_[a-z0-9]{8}$/.test(given) ? given : (await repoByName(l, repoName(String(given ?? ''))))?.id;
    if (!id || !scope.has(id)) refuse('It cannot speak for another repository.');
  };

  switch (tool) {
    // What a change writes is checked where every change is (within.ts), and so is what a pack's action writes.
    case 'change':
    case 'report':
      return;
    case 'undo': {
      const { rows } = await l.db.query<{ target_id: string | null }>(`select distinct target_id from event where changeset = $1`, [input.changeset]);
      for (const row of rows) if (row.target_id) await mustBeIn(row.target_id, 'undo a change to it');
      return;
    }
    case 'session_start':
    case 'session_update':
      return mustBeIn(input.task, 'take it on');
    // A story is told of the token's own work: the run is one of a session in its repository.
    case 'tell': {
      const run = await resolveRun(l, String(input.run ?? ''));
      if (!run) return;
      const { rows } = await l.db.query(`select 1 from relation where type = any($3::text[]) and from_id = $1 and to_id = any($2::text[]) and valid_to is null`, [run.id, [...scope], livesIn(l)]);
      if (!rows.length) refuse(`${await named(run.id)} is not a session there, so this token cannot tell its story.`);
      return;
    }
    case 'session_end':
      for (const id of (input.still_true ?? []) as string[]) await mustBeIn(id, 'vouch for it');
      return;
    case 'rechecked':
    case 'run_report':
      return isRepo(input.repo);
    case 'notify':
      return mustBeIn(input.about, 'send a notification about it');
    // A resource is taken or given back for work: one that something of this work needs, or one no work is said to
    // need (a lane everyone shares). One that only other work needs is that work's.
    case 'claim':
    case 'release': {
      const { rows } = await l.db.query<{ from_id: string }>(`select from_id from relation where type = any($2::text[]) and to_id = $1 and valid_to is null`, [input.resource, l.registry.relationFamily('needs')]);
      if (rows.length && !rows.some((r) => scope.has(r.from_id))) refuse(`Nothing there needs ${await named(String(input.resource))}, so this token cannot ${tool} it.`);
      if (tool === 'claim') await mustBeIn(input.for, 'hold a resource for it');
      return;
    }
    case 'picture_put':
      return mustBeIn(input.result, 'keep a picture for it');
    default:
      // Everything else is refused unless it only reads: a tool added later is not open to a limited token until it is
      // named here. A pack's action is let through: what it would write is checked as a change is, before it is applied.
      if (!READS.includes(tool) && !packTool(l.registry, tool)) refuse(`It cannot call ${tool}.`);
  }
}

/** Kernel tools a limited token may call that change nothing in the map: reading it, listening for the owner, pointing their screen. A pack's views are reads too. */
const READS = ['schema', 'search', 'get', 'view', 'events', 'proposals', 'picture', 'watch', 'show', 'document'];
