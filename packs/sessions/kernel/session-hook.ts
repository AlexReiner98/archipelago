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

/** Where each part of what a session is told as it begins is worded: an instruction for session_start:<part>, which the owner may reword on the map. */
const PART = (name: string) => `${BEGINS_AT}:${name}`;
/** The names in braces filled in; one the fill does not have is left as it is (the agents pack's `filled`, copied). */
export const fillIn = (text: string, fill: Record<string, string>) => text.replace(/\{([a-z_]+)\}/g, (all, name: string) => fill[name] ?? all);

/** The words at several places, read at once, each one string (what is said there, one after another), said to `run` on its island. */
export const wordsAt = async (ctx: KernelContext, wheres: string[], input: { run?: string; island?: string; about?: string }) =>
  (await ctx.call<object, { at: Record<string, string> }>('answer.instructions', { wheres, ...(input.run && { run: input.run }), ...(input.island && { island: input.island }), ...(input.about && { about: input.about }) })).at;

/** Days since an item was last confirmed, when that is long enough that it may no longer be true; else undefined. */
const stale = (t: { last_confirmed: string | Date }) => {
  const days = Math.floor((Date.now() - new Date(t.last_confirmed).getTime()) / 86_400_000);
  return days >= STALE_DAYS ? days : undefined;
};

/**
 * A surface's start hook: register the session and return the text to put in front of the model, so it starts
 * knowing what the map knows. Every sentence of it is the words of an instruction (session_start:<part>, which the
 * owner may reword on the map); only what fills them in, read off the map, is said here.
 */
export async function hookSessionStart(ctx: KernelContext, input: { session_id?: string; cwd?: string; remote?: string; commits?: unknown; source?: unknown; title?: unknown; parent?: unknown; surface?: unknown }): Promise<string> {
  // Claude Code says why it starts (startup, resume, clear, compact) and, from its record, what the chat is called; the
  // session that started it, if it knows one, is kept only when the map has it, so a hook never fails to register.
  const said = { source: typeof input.source === 'string' ? input.source : undefined, title: typeof input.title === 'string' ? input.title : undefined, parent: typeof input.parent === 'string' && input.parent && (await resolveRun(ctx, input.parent)) ? input.parent : undefined };
  const started = (await sessionStart(ctx, HOOK_AGENT, { session_id: input.session_id, cwd: input.cwd, remote: typeof input.remote === 'string' ? input.remote : undefined, surface: hookSurface(input), ...said })) as Started;
  const run = ((await ctx.reads({ ids: [started.run] })) as Item[])[0];
  const repo = 'repo' in started ? started.repo : undefined;
  // On an island that tries a version of its pack, the version's words (its task's island, else its repository's).
  const island = await sessionIsland(ctx, started.run);
  // What is read off the map comes first, so only the parts that will be said are asked for, and counted as said.
  // Where this session stands, on any map: the open items the sessions before it here worked on, each with why it
  // needs attention now (the runs pack's frontier). Read off the map, never a note one session left for the next.
  const here = await ctx.call<object, { lines: string[] }>('answer.frontier', { run: started.run, ...(input.cwd !== undefined && { cwd: input.cwd }), ...(typeof input.remote === 'string' && { remote: input.remote }), lines: true });
  // Where the work there stands is the place's pack's to say: a repository's, the software pack's views.
  type Work = { ready: { id: string; title: string; type: string; last_confirmed: string | Date }[]; blocked: { id: string; title: string; waiting_on: (string | undefined)[] }[] };
  type Stand = { from: string | { title: string; began: string }; left?: unknown[]; unseen?: unknown[]; traps?: unknown[]; since_then: Record<'pushes' | 'settled' | 'opened' | 'sessions', unknown[]> & { counts: Record<'pushes' | 'settled' | 'opened' | 'sessions', number> }; to_shape?: { hubs: { id: string; title: string; inside: number }[] } };
  const viewed = repo && canAsk(ctx, 'repo_work') && canAsk(ctx, 'handoff') ? repo : undefined;
  const work = viewed ? ((await ask(ctx, 'repo_work', { repo: viewed.id })) as Work) : undefined;
  // Where things stand is read off the map: how much has moved lately, and what sessions left, nobody has seen work, or bites here.
  const stand = viewed ? ((await ask(ctx, 'handoff', { repo: viewed.id })) as Stand) : undefined;
  // Only a map with a type of place that knows an address (a repository, in the code pack) is told to make one.
  const place = repo ? undefined : [...ctx.registry.types.values()].find((t) => t.capabilities.where?.address);
  // The owner is here, in chat, and mostly nowhere else: what agents settled since they last answered is put to them now.
  const asked = await ctx.call<object, { on_agents_judgment: number; on_owners_word: number; upto: number; questions: { id: string; title: string; answer: string; on: string }[] }>('answer.to_confirm', { limit: 15 });
  const judged = asked.questions.filter((q) => !q.on.startsWith('the owner'));
  // What may be held: the types with a capacity, the fields those say it in (a place that says nothing of it is no resource), and whether one says it as a number, so every item of it may be.
  const types = ctx.registry.having('capacity'), caps = types.map((t) => ctx.registry.type(t)?.capabilities.capacity);
  const [heldNow, holdable] = await Promise.all([
    ctx.reads({ holds: true }) as Promise<{ resource: string; held_by_title: string }[]>,
    ctx.reads({ holdable: { types, fields: [...new Set(caps.flatMap((c) => (typeof c === 'object' && c ? [(c as { field: string }).field] : [])))], any: caps.some((c) => typeof c === 'number') } }) as Promise<Item[]>,
  ]);
  const resources = holdable.filter((one) => (ctx.registry.capacity(one as never) ?? Infinity) !== Infinity).map((res) => ({ res, held: heldNow.find((h) => h.resource === res.id) }));
  const ready = work?.ready.slice(0, 15) ?? [];
  const owed = stand?.to_shape?.hubs ?? [];
  const marked = stand ? [stand.left?.length, stand.unseen?.length, stand.traps?.length].some(Boolean) : false;
  const parts = [
    'registered',
    'item_link',
    ...(repo ? ['repository'] : []),
    ...(stand ? ['handoff', typeof stand.from === 'object' ? 'handoff_since' : 'handoff_week', ...(marked ? ['handoff_marks'] : [])] : []),
    ...(ready.length ? ['ready', ...(ready.some((t) => stale(t) !== undefined) ? ['stale'] : [])] : []),
    ...(work?.blocked.length ? ['blocked'] : []),
    ...(owed.length ? ['hubs'] : []),
    ...(place ? ['no_place', ...(input.remote ? ['no_place_remote'] : [])] : []),
    ...(asked.on_agents_judgment ? ['to_confirm', ...(asked.on_owners_word ? ['to_confirm_owners'] : []), ...(asked.on_agents_judgment > judged.length ? ['to_confirm_more'] : [])] : []),
    ...(resources.length ? ['resource', ...(resources.some((r) => r.held) ? ['resource_held'] : []), ...(resources.some((r) => !r.held) ? ['resource_free'] : [])] : []),
  ];
  // Each part is worded by an instruction on the map (the agents pack's): the sessions pack's preset, under the owner's version of it.
  const words = await wordsAt(ctx, parts.map(PART), { run: started.run, island, about: repo?.id });
  const say = (part: string, fill: Record<string, string> = {}) => fillIn(words[PART(part)] ?? '', fill);
  const n = (count: number, one: string, many = `${one}s`) => `${count} ${count === 1 ? one : many}`;
  const lines = [say('registered', { run: started.run, title: run?.title ?? '', workspace: started.workspace.name, workspace_id: started.workspace.id })];
  // How an item is named to a person on this server: [its name](link), the link the site gives its items here.
  lines.push(say('item_link', { link: (await ctx.reads({ item_link: true })) as string }));
  if (repo) lines.push(say('repository', { title: repo.title, id: repo.id }));
  lines.push('', ...here.lines);
  if (viewed && stand && work) {
    const then = stand.since_then;
    const counts = `${n(then.counts.pushes, 'push', 'pushes')}, ${n(then.counts.settled, 'item')} settled, ${n(then.counts.opened, 'item')} opened, ${n(then.counts.sessions, 'session')} ended`;
    const since = typeof stand.from === 'object' ? say('handoff_since', { title: stand.from.title, began: stand.from.began.slice(0, 16).replace('T', ' ') }) : say('handoff_week');
    const marks = [stand.left?.length && `${n(stand.left.length, 'checkout')} left unpushed (left)`, stand.unseen?.length && `${n(stand.unseen.length, 'item')} nobody has seen working (unseen)`, stand.traps?.length && `${n(stand.traps.length, 'trap')} in its files (traps)`].filter(Boolean).join(', ');
    lines.push([say('handoff', { repo: viewed.id, since, counts }), marks && say('handoff_marks', { marks })].filter(Boolean).join(' '));
    const kind = (t: { type: string }) => `${ctx.registry.type(t.type)?.title ?? t.type}: `;
    // What nobody has touched for a while is said to be so: it may no longer be true.
    const age = (t: { last_confirmed: string | Date }) => {
      const days = stale(t);
      return days === undefined ? '' : `, ${say('stale', { days: String(days) })}`;
    };
    if (ready.length) lines.push('', say('ready'), ...ready.map((t) => `- ${kind(t)}${t.title} (${t.id})${age(t)}`));
    if (work.blocked.length) lines.push('', say('blocked'), ...work.blocked.slice(0, 15).map((t) => `- ${t.title} (${t.id}), waiting on: ${t.waiting_on.join('; ')}`));
    // Work that is owed though nobody wrote it down: what has grown into the hub of its problem and has no view of its own.
    if (owed.length) lines.push('', say('hubs'), ...owed.slice(0, 8).map((h) => `- ${h.title} (${h.id}), holding ${h.inside}`));
  } else if (place) {
    const remote = input.remote ? ` ${say('no_place_remote', { remote: input.remote })}` : '';
    lines.push(say('no_place', { place: place.title.toLowerCase(), address: String(place.capabilities.where!.address), remote }));
  }
  if (asked.on_agents_judgment) {
    const owners = asked.on_owners_word ? ` ${say('to_confirm_owners', { count: String(asked.on_owners_word) })}` : '';
    lines.push(
      '',
      say('to_confirm', { count: String(asked.on_agents_judgment), questions: asked.on_agents_judgment === 1 ? 'question' : 'questions', owners, upto: String(asked.upto) }),
      ...judged.map((q) => `- ${q.title}: ${q.answer} (${q.id})`),
      ...(asked.on_agents_judgment > judged.length ? [`- ${say('to_confirm_more', { count: String(asked.on_agents_judgment - judged.length) })}`] : []),
    );
  }
  for (const { res, held } of resources) lines.push('', say('resource', { title: res.title, id: res.id, state: held ? say('resource_held', { holder: held.held_by_title }) : say('resource_free'), run: started.run }));
  // And what every session is told as it begins, the core pack's and the packs' (session_start), under the owner's.
  lines.push('', ...(await toldAt(ctx, BEGINS_AT, { about: repo?.id, island, fill: { run: started.run } })));
  // What its tools' descriptions told it is kept as said to its run (the agents pack's TOOLS): not said here again.
  await toldAt(ctx, 'tool:*', { about: repo?.id, island, fill: { run: started.run } }).catch((err: Error) => ctx.said?.(`tool sayings for ${started.run}: ${err.message}`));
  return lines.join('\n');
}

/** A surface's end hook: the chat itself has ended, whatever its reason (clear, logout, exit, other): its session ends, and its tab closes. */
export async function hookSessionEnd(ctx: KernelContext, input: { session_id?: string; reason?: string }): Promise<void> {
  if (!input.session_id) return;
  const run = await resolveRun(ctx, input.session_id, true);
  if (run) await sessionEnd(ctx, HOOK_AGENT, { run: run.id, outcome: 'finished', summary: input.reason ? `Session ended (${input.reason})` : undefined, reason: input.reason || 'other' });
}
