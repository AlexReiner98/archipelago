// What a session is told as it begins, on the session contract (./sessions.ts): a surface's start hook registers it
// here, and its end hook ends it, saying why; the shape of their answers is the surface's pack's adapter (Claude
// Code's handler.js). Any other client says the same through capture session_start and report session_end. It was the
// claude_code pack's, which keeps the actor its hooks act as (HOOK_AGENT, packs/claude_code/kernel/session-hook.ts);
// what it reads of other packs it asks by name: the frontier (runs), the place's views (query's read `view`), what
// agents settled (attention), and what every session is told (agents).

import type { KernelContext } from '#pelago/kernel';
import { resolveRun, sessionEnd, sessionStart } from './sessions.ts';
import type { Actor, Item } from './types.ts';

/** The actor a session's hooks act as: the name Claude Code's adapter says hooks acted under before there were surfaces (claude_code's reach.server.adapter.before.actor), as the log keeps it. */
export const HOOK_AGENT: Actor = { kind: 'agent', name: 'claude-code' };
/** Where what a session is told as it begins is said: the act that begins one (surface's BEGINS_AT, session_start). */
const BEGINS_AT = 'session_start';
/** Days after which what nobody confirmed is said to be possibly no longer true (attention's STALE_DAYS). */
const STALE_DAYS = 14;

/** The surface a hook's session is recorded under: what its adapter said, else the name the hooks have acted under since before there were surfaces. */
const hookSurface = (input: { surface?: unknown }) => (typeof input.surface === 'string' && input.surface ? input.surface : HOOK_AGENT.name);

/** The island a session works on, whose pack version it is told: its task's, once it has said one, else its repository's. None where neither is on an island. */
export async function sessionIsland(ctx: KernelContext, run: string | undefined): Promise<string | undefined> {
  if (!run) return undefined;
  return ((await ctx.reads({ run_island: run })) as string | null) ?? undefined;
}

/** Whether a view of this name is answered here: one a loaded pack declares (repo_work, handoff are the software pack's). */
const canAsk = (ctx: KernelContext, name: string) => ctx.registry.packs.some((p) => ((p.views ?? []) as { id: string; form?: string }[]).some((v) => v.form === undefined && v.id.slice(v.id.indexOf('.') + 1) === name));
const ask = (ctx: KernelContext, view: string, params: Record<string, unknown>) => ctx.reads({ view, params });

/** A session as it started, with the repository it is in and the workspace. */
type Started = Awaited<ReturnType<typeof sessionStart>> & { repo?: { id: string; title: string }; workspace: { id: string; name: string } };

/** What every session is told at `where`, filled in, on its island. */
export const toldAt = async (ctx: KernelContext, where: string, input: { about?: string; island?: string; fill?: Record<string, string> }) =>
  (await ctx.call<object, { said: { text: string }[] }>('answer.instructions', { where, ...(input.about && { about: input.about }), ...(input.island && { island: input.island }), ...(input.fill && { fill: input.fill }) })).said.map((one) => one.text);

/**
 * A surface's start hook: register the session and return the text to put in front of the model, so it starts
 * knowing what the map knows.
 */
export async function hookSessionStart(ctx: KernelContext, input: { session_id?: string; cwd?: string; remote?: string; commits?: unknown; source?: unknown; title?: unknown; parent?: unknown; surface?: unknown }): Promise<string> {
  // Claude Code says why it starts (startup, resume, clear, compact) and, from its record, what the chat is called; the
  // session that started it, if it knows one, is kept only when the map has it, so a hook never fails to register.
  const said = { source: typeof input.source === 'string' ? input.source : undefined, title: typeof input.title === 'string' ? input.title : undefined, parent: typeof input.parent === 'string' && input.parent && (await resolveRun(ctx, input.parent)) ? input.parent : undefined };
  const started = (await sessionStart(ctx, HOOK_AGENT, { session_id: input.session_id, cwd: input.cwd, remote: typeof input.remote === 'string' ? input.remote : undefined, surface: hookSurface(input), ...said })) as Started;
  const run = ((await ctx.reads({ ids: [started.run] })) as Item[])[0];
  const lines = [`This session is registered in Archipelago, the owner's map of work and dependencies, as run ${started.run}, called "${run?.title}" after this chat, on the workspace "${started.workspace.name}" (${started.workspace.id}).`];
  // How an item is named to a person on this server: [its name](link), the link the site gives its items here.
  lines.push(`Name an item to a person as [its name](${(await ctx.reads({ item_link: true })) as string}), never a bare id; ids stay in tool calls.`);
  const repo = 'repo' in started ? started.repo : undefined;
  if (repo) lines.push(`Repository: ${repo.title} (${repo.id}).`);
  // Where this session stands, on any map: the open items the sessions before it here worked on, each with why it
  // needs attention now (the runs pack's frontier). Read off the map, never a note one session left for the next.
  const here = await ctx.call<object, { lines: string[] }>('answer.frontier', { run: started.run, ...(input.cwd !== undefined && { cwd: input.cwd }), ...(typeof input.remote === 'string' && { remote: input.remote }), lines: true });
  lines.push('', ...here.lines);
  // Where the work there stands is the place's pack's to say: a repository's, the software pack's views.
  if (repo && canAsk(ctx, 'repo_work') && canAsk(ctx, 'handoff')) {
    const work = (await ask(ctx, 'repo_work', { repo: repo.id })) as { ready: { id: string; title: string; type: string; last_confirmed: string | Date }[]; blocked: { id: string; title: string; waiting_on: (string | undefined)[] }[] };
    // Where things stand is read off the map: how much has moved lately, and what sessions left, nobody has seen work, or bites here.
    const stand = (await ask(ctx, 'handoff', { repo: repo.id })) as { from: string | { title: string; began: string }; left?: unknown[]; unseen?: unknown[]; traps?: unknown[]; since_then: Record<'pushes' | 'settled' | 'opened' | 'sessions', unknown[]> & { counts: Record<'pushes' | 'settled' | 'opened' | 'sessions', number> }; to_shape?: { hubs: { id: string; title: string; inside: number }[] } };
    const n = (count: number, one: string, many = `${one}s`) => `${count} ${count === 1 ? one : many}`;
    const then = stand.since_then;
    const marks = [stand.left?.length && `${n(stand.left.length, 'checkout')} left unpushed (left)`, stand.unseen?.length && `${n(stand.unseen.length, 'item')} nobody has seen working (unseen)`, stand.traps?.length && `${n(stand.traps.length, 'trap')} in its files (traps)`].filter(Boolean);
    lines.push(`Where things stand: view "handoff" with repo ${repo.id}. ${typeof stand.from === 'object' ? `Since the last session here to end, ${stand.from.title}, began (${stand.from.began.slice(0, 16).replace('T', ' ')} UTC)` : 'In the last week'}: ${n(then.counts.pushes, 'push', 'pushes')}, ${n(then.counts.settled, 'item')} settled, ${n(then.counts.opened, 'item')} opened, ${n(then.counts.sessions, 'session')} ended.${marks.length ? ` And ${marks.join(', ')}.` : ''}`);
    const kind = (t: { type: string }) => `${ctx.registry.type(t.type)?.title ?? t.type}: `;
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
    // Only a map with a type of place that knows an address (a repository, in the code pack) is told to make one.
    const place = [...ctx.registry.types.values()].find((t) => t.capabilities.where?.address);
    if (place) lines.push(`Archipelago does not know a ${place.title.toLowerCase()} for this folder${input.remote ? ` (a checkout of ${input.remote})` : ''}. If its work belongs in the map, give a ${place.title.toLowerCase()} there this address as its ${place.capabilities.where!.address}.`);
  }
  // The owner is here, in chat, and mostly nowhere else: what agents settled since they last answered is put to them now.
  const asked = await ctx.call<object, { on_agents_judgment: number; on_owners_word: number; upto: number; questions: { id: string; title: string; answer: string; on: string }[] }>('answer.to_confirm', { limit: 15 });
  const judged = asked.questions.filter((q) => !q.on.startsWith('the owner'));
  if (asked.on_agents_judgment)
    lines.push(
      '',
      `For the owner, in your first reply: since they last looked, agents have settled ${asked.on_agents_judgment} ${asked.on_agents_judgment === 1 ? 'question' : 'questions'} on their own judgment${asked.on_owners_word ? ` (and recorded ${asked.on_owners_word} more as the owner's own answers in chat: say how many, and list them only if asked, with query "attention", reason to_confirm)` : ''}. Show them these, a line for each, and ask them to confirm or correct. When they have answered, call settle with action confirmed, upto ${asked.upto} and what they said; change or reopen what they correct.`,
      ...judged.map((q) => `- ${q.title}: ${q.answer} (${q.id})`),
      ...(asked.on_agents_judgment > judged.length ? [`- and ${asked.on_agents_judgment - judged.length} more: query "attention" with person "me" and reasons ["to_confirm"].`] : []),
    );
  // What may be held: the types with a capacity, the fields those say it in (a place that says nothing of it is no resource), and whether one says it as a number, so every item of it may be.
  const types = ctx.registry.having('capacity'), caps = types.map((t) => ctx.registry.type(t)?.capabilities.capacity);
  const [heldNow, holdable] = await Promise.all([
    ctx.reads({ holds: true }) as Promise<{ resource: string; held_by_title: string }[]>,
    ctx.reads({ holdable: { types, fields: [...new Set(caps.flatMap((c) => (typeof c === 'object' && c ? [(c as { field: string }).field] : [])))], any: caps.some((c) => typeof c === 'number') } }) as Promise<Item[]>,
  ]);
  for (const res of holdable.filter((one) => (ctx.registry.capacity(one as never) ?? Infinity) !== Infinity)) {
    const held = heldNow.find((h) => h.resource === res.id);
    lines.push('', `Exclusive resource "${res.title}" (${res.id}) is ${held ? `HELD by ${held.held_by_title}: do not use it` : 'free'}. Claim it with the pelago assign tool, action claim (holder ${started.run}), before using it, and give it back with revise, action release, after.`);
  }
  // What every session is told is kept on the map as instructions (the agents pack's): the core pack's, under the owner's;
  // on an island that tries a version of its pack, the version's (its task's island, else its repository's).
  lines.push('', ...(await toldAt(ctx, BEGINS_AT, { about: repo?.id, island: await sessionIsland(ctx, started.run), fill: { run: started.run } })));
  return lines.join('\n');
}

/** A surface's end hook: the chat itself has ended, whatever its reason (clear, logout, exit, other): its session ends, and its tab closes. */
export async function hookSessionEnd(ctx: KernelContext, input: { session_id?: string; reason?: string }): Promise<void> {
  if (!input.session_id) return;
  const run = await resolveRun(ctx, input.session_id, true);
  if (run) await sessionEnd(ctx, HOOK_AGENT, { run: run.id, outcome: 'finished', summary: input.reason ? `Session ended (${input.reason})` : undefined, reason: input.reason || 'other' });
}
