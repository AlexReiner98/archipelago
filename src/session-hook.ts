// Claude Code's adapter onto the session contract (src/sessions.ts): its SessionStart hook registers the session and
// answers what the model is told as it begins; its SessionEnd hook ends it, saying why. Any other client says the same
// through capture session_start and report session_end.

import { placeFor } from './places.ts';
import { askView, canAsk } from './askview.ts';
import { heldResources } from './blocking.ts';
import { toConfirm } from './confirm.ts';
import { sentCommits, unaccountedText } from './unaccounted.ts';
import { STALE_DAYS } from './attention.ts';
import { instructionsFor } from './instructions.ts';
import type { Archipelago, Entity } from './pelago.ts';
import { resolveRun, sessionEnd, sessionStart } from './sessions.ts';

/** What may be held, as a read names it: the types with a capacity, the fields those say it in (a place that says nothing of it is no resource), and whether one says it as a number, so every item of it may be. */
const holdableBy = (l: Archipelago) => {
  const types = l.registry.having('capacity'), caps = types.map((t) => l.registry.type(t)?.capabilities.capacity);
  return [types, [...new Set(caps.flatMap((c) => (typeof c === 'object' ? [c.field] : [])))], caps.some((c) => typeof c === 'number')];
};

/**
 * A Claude Code SessionStart hook: register the session and return the text
 * to put in front of the model, so it starts knowing what the map knows.
 */
export async function hookSessionStart(l: Archipelago, input: { session_id?: string; cwd?: string; remote?: string; commits?: unknown; source?: unknown; title?: unknown; parent?: unknown }): Promise<string> {
  // Claude Code says why it starts (startup, resume, clear, compact) and, from its record, what the chat is called; the
  // session that started it, if it knows one, is kept only when the map has it, so a hook never fails to register.
  const said = { source: typeof input.source === 'string' ? input.source : undefined, title: typeof input.title === 'string' ? input.title : undefined, parent: typeof input.parent === 'string' && input.parent && (await resolveRun(l, input.parent)) ? input.parent : undefined };
  const started = await sessionStart(l, { kind: 'agent', name: 'claude-code' }, { session_id: input.session_id, cwd: input.cwd, remote: typeof input.remote === 'string' ? input.remote : undefined, surface: 'claude-code', ...said });
  const lines = [`This session is registered in Archipelago, the owner's map of work and dependencies, as run ${started.run}, called "${(await l.entity(started.run))?.title}" after this chat, on the workspace "${started.workspace.name}" (${started.workspace.id}).`];
  const repo = 'repo' in started ? started.repo : undefined;
  if (repo) lines.push(`Repository: ${repo.title} (${repo.id}).`);
  // Where the work there stands is the place's pack's to say: a repository's, the software pack's views.
  if (repo && canAsk(l, 'repo_work') && canAsk(l, 'handoff')) {
    const work = (await askView(l, { kind: 'agent', name: 'claude-code' }, 'repo_work', { repo: repo.id })) as { ready: { id: string; title: string; type: string; last_confirmed: string | Date }[]; blocked: { id: string; title: string; waiting_on: (string | undefined)[] }[] };
    // Where things stand is read off the map: how much has moved lately, and what sessions left, nobody has seen work, or bites here.
    const stand = (await askView(l, { kind: 'agent', name: 'claude-code' }, 'handoff', { repo: repo.id })) as { from: string | { title: string; began: string }; left?: unknown[]; unseen?: unknown[]; traps?: unknown[]; since_then: Record<'pushes' | 'settled' | 'opened' | 'sessions', unknown[]> & { counts: Record<'pushes' | 'settled' | 'opened' | 'sessions', number> }; to_shape?: { hubs: { id: string; title: string; inside: number }[] } };
    const n = (count: number, one: string, many = `${one}s`) => `${count} ${count === 1 ? one : many}`;
    const then = stand.since_then;
    const marks = [stand.left?.length && `${n(stand.left.length, 'checkout')} left unpushed (left)`, stand.unseen?.length && `${n(stand.unseen.length, 'item')} nobody has seen working (unseen)`, stand.traps?.length && `${n(stand.traps.length, 'trap')} in its files (traps)`].filter(Boolean);
    lines.push(`Where things stand: view "handoff" with repo ${repo.id}. ${typeof stand.from === 'object' ? `Since the last session here to end, ${stand.from.title}, began (${stand.from.began.slice(0, 16).replace('T', ' ')} UTC)` : 'In the last week'}: ${n(then.counts.pushes, 'push', 'pushes')}, ${n(then.counts.settled, 'item')} settled, ${n(then.counts.opened, 'item')} opened, ${n(then.counts.sessions, 'session')} ended.${marks.length ? ` And ${marks.join(', ')}.` : ''}`);
    const kind = (t: { type: string }) => `${l.registry.type(t.type)?.title ?? t.type}: `;
    // What nobody has touched for a while is said to be so: it may no longer be true.
    const age = (t: { last_confirmed: string | Date }) => {
      const days = Math.floor((Date.now() - new Date(t.last_confirmed).getTime()) / 86_400_000);
      return days >= STALE_DAYS ? `, not confirmed for ${days} days: check it before relying on it` : '';
    };
    if (work.ready.length) lines.push('', 'Open work and issues here that nothing blocks:', ...work.ready.slice(0, 15).map((t) => `- ${kind(t)}${t.title} (${t.id})${age(t)}`));
    if (work.blocked.length) lines.push('', 'Blocked work here:', ...work.blocked.slice(0, 15).map((t) => `- ${t.title} (${t.id}), waiting on: ${t.waiting_on.join('; ')}`));
    // Work that is owed though nobody wrote it down: what has grown into the hub of its problem and has no view of its own.
    const owed = 'to_shape' in stand ? stand.to_shape!.hubs : [];
    if (owed.length)
      lines.push(
        '',
        'Hubs here with no view of their own (each holds enough to be the hub of its problem; when you work in one, give it its views: lens items about it, named for the questions they answer. View "hubs" says how much each holds):',
        ...owed.slice(0, 8).map((h) => `- ${h.title} (${h.id}), holding ${h.inside}`),
      );
  } else if (!repo) {
    lines.push(`Archipelago does not know a repository for this folder${input.remote ? ` (a checkout of ${input.remote})` : ''}. If its work belongs in the map, give a repository there this address as its remote.`);
  }
  // The owner is here, in chat, and mostly nowhere else: what agents settled since they last answered is put to them now.
  const ask = await toConfirm(l, { limit: 15 });
  const judged = ask.questions.filter((q) => !q.on.startsWith('the owner'));
  if (ask.on_agents_judgment)
    lines.push(
      '',
      `For the owner, in your first reply: since they last looked, agents have settled ${ask.on_agents_judgment} ${ask.on_agents_judgment === 1 ? 'question' : 'questions'} on their own judgment${ask.on_owners_word ? ` (and recorded ${ask.on_owners_word} more as the owner's own answers in chat: say how many, and list them only if asked, with query "attention", reason to_confirm)` : ''}. Show them these, a line for each, and ask them to confirm or correct. When they have answered, call settle with action confirmed, upto ${ask.upto} and what they said; change or reopen what they correct.`,
      ...judged.map((q) => `- ${q.title}: ${q.answer} (${q.id})`),
      ...(ask.on_agents_judgment > judged.length ? [`- and ${ask.on_agents_judgment - judged.length} more: query "attention" with person "me" and reasons ["to_confirm"].`] : []),
    );
  // The commits in this checkout that no one has accounted for are put to the session as unconfirmed answers are.
  if (repo) lines.push(...((u) => (u.length ? ['', ...u] : []))(await unaccountedText(l, sentCommits(input.commits), repo.id)));
  const [heldNow, { rows: holdable }] = await Promise.all([heldResources(l), l.db.query<Entity>(`select * from entity where type = any($1::text[]) and is_open and archived_at is null and (props ?| $2::text[] or $3) -- index entity_type`, holdableBy(l))]);
  for (const res of holdable.filter((one) => (l.registry.capacity(one) ?? Infinity) !== Infinity)) {
    const held = heldNow.find((h) => h.resource === res.id);
    lines.push('', `Exclusive resource "${res.title}" (${res.id}) is ${held ? `HELD by ${held.held_by_title}: do not use it` : 'free'}. Claim it with the pelago assign tool, action claim (holder ${started.run}), before using it, and give it back with revise, action release, after.`);
  }
  // What every session is told is kept on the map as instructions (src/instructions.ts): the core pack's, under the owner's.
  lines.push('', ...(await instructionsFor(l, 'session_start', { about: repo?.id, fill: { run: started.run } })).map((one) => one.text));
  return lines.join('\n');
}

export async function hookSessionEnd(l: Archipelago, input: { session_id?: string; reason?: string }): Promise<void> {
  if (!input.session_id) return;
  const run = await resolveRun(l, input.session_id, true);
  // The chat itself has ended, whatever its reason (clear, logout, exit, other): its session ends, and its tab closes.
  if (run) await sessionEnd(l, { kind: 'agent', name: 'claude-code' }, { run: run.id, outcome: 'finished', summary: input.reason ? `Session ended (${input.reason})` : undefined, reason: input.reason || 'other' });
}
