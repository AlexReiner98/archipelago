// What a session's hooks are answered, in no surface's shape (packs/loader/kernel/server-adapter.ts puts it in one): a session started,
// was prompted, ended a turn, ended.
// Where a session last heard up to is kept in the workspace's database (the transient store, root.transient), so its
// next prompt is answered as well by a server it has not spoken to before. On the pack's context of the map the hook's
// token reads (packs/sessions/kernel/hook-answers.ts makes it): what the server holds (whether a setup is behind, the actions offered,
// what people did) is asked of root.sessions, the rest by the names of the packs that answer it.

import type { KernelContext } from '#pelago/kernel';
import { askOnReply } from './replies.ts';
import { hookWithin, labelled, promptNamed, recordUsage, resolveRun, sessionBegan, sessionHeard, sessionPrompted } from './sessions.ts';
import { HOOK_AGENT as HOOK_ACTOR, hookSessionEnd, hookSessionStart, sessionIsland, toldAt } from './session-hook.ts';
import { addTouched } from './touched.ts';
import { fileSaid } from './file-said.ts';
import { keepStands } from './stands.ts';
import { takeEvents } from './session-events.ts';

export interface HookBody {
  session_id?: string;
  cwd?: string;
  remote?: string;
  reason?: string;
  tokens?: number;
  /** The items the session's calls to the map have named so far, read from its transcript (packs/sessions/kernel/touched.ts). */
  touched?: unknown;
  /** What Claude Code calls the session, read from its transcript: the title the owner gave it, else the one it made. */
  title?: unknown;
  /** At the start: why Claude Code started it (startup, resume, clear, compact). */
  source?: unknown;
  /** At a prompt: what was typed, as Claude Code passes it (packs/runs/kernel/frontier-prompt.ts narrows the session's start by the first). */
  prompt?: unknown;
  /** At a turn's end: what the reply did since the owner's last message (packs/sessions/kernel/reply-rules.ts), and that message's id. */
  reply?: unknown;
  turn?: unknown;
  /** Claude Code's: the agent is going on because a Stop hook asked it to. */
  stop_hook_active?: unknown;
  setup?: string;
  /** At the file-used event: the file read or changed, and the instructions the session has been told about files already. */
  path?: unknown;
  said?: unknown;
  /** At a turn's end and at the end: where the session's place stands, a small flat object its pack reads (packs/sessions/kernel/stands.ts). */
  stands?: unknown;
  /** What stands was called until 10 Nov 2026, still sent by hooks set up before then: read as stands. */
  git?: unknown;
  /** At the events route: the adapter's batch of raw events, in the vocabulary of docs/sessions.md (packs/sessions/kernel/session-events.ts). */
  events?: unknown;
}

/** What a hook is answered from, but the map: the adapter at packs/sessions/kernel/hook-answers.ts hands the map as the pack's context. */
export interface HookAsk {
  /** The items the token writes within; none for everything. */
  within: string[];
  /** A token that may only report speaks for no session. */
  may?: string;
  body: HookBody;
  /** This server: the commit it runs and when it started. */
  running: { commit?: string; started: string };
  /** The address the hook called, for the setup command. */
  origin: string;
  /** Says the run a session is registered as beside the answer (a header), for the hook to keep: Claude Code reads only the answer. */
  ran?: (run: string) => void;
}

/** How long a session's place is kept after it was last heard from. */
const HEARD_MS = 7 * 86_400_000;
const heardKey = (session: string | undefined) => `heard:${session ?? ''}`;

const LIMITED =
  'This machine’s Archipelago token is limited to some repositories, and this folder is not a checkout of one that is theirs: the session is not registered in Archipelago, and its work is not kept there. Tell the owner in your first reply; a token for this repository is made in Settings.';

const actionsKey = (session: string | undefined) => `actions:${session ?? ''}`;

/** What one request leaves for the next, in the whole workspace's transient store (root.transient), so a server it has not spoken to before reads it too. */
const kept = async <T = unknown>(ctx: KernelContext, key: string) => (await ctx.call('root.transient', { kept: key })) as T | undefined;
const keep = (ctx: KernelContext, key: string, value: unknown, ms: number) => ctx.call('root.transient', { keep: { key, value, ms } });

/** What is said at `where` (an instruction's `for`), one after another: what to do about it is the instructions'. */
const sayAt = async (ctx: KernelContext, where: string, fill: Record<string, string>, session?: string) =>
  (await toldAt(ctx, where, { fill, island: await sessionIsland(ctx, session && (await resolveRun(ctx, session, true))?.id) })).join(' ');

// A client keeps the tools as they were when it connected; what to do about it is practice's instruction for server_restarted.
const restarted = async (ctx: KernelContext, { started, commit }: HookAsk['running'], added: string[] | undefined, session?: string) =>
  `The Archipelago server has restarted since this session began (at ${started}${commit ? `, now running commit ${commit.slice(0, 7)}` : ''}). ${
    added?.length ? `Actions new since you were given the tools: ${added.join('; ')}. ` : added ? 'No action is new since you were given the tools. ' : ''
  }${await sayAt(ctx, 'server_restarted', {}, session)}`.trimEnd();

/**
 * What a session is told at a hook, the same for any surface: told, words added to what it reads next; go_on, why it
 * is asked to go on at a reply's end; said, the ids told beside the words. Anything else (the events route's count)
 * is passed as it is. A surface's adapter puts it in that surface's shape (packs/loader/kernel/server-adapter.ts).
 */
export interface Neutral {
  told?: string;
  go_on?: string;
  said?: string[];
  [more: string]: unknown;
}

const told = (text: string, extra: object = {}): Neutral => ({ told: text, ...extra });

/** The command that sets a project up from this server (the connect pack's setupCommand, copied: a string of the address). */
const setupCommand = (origin: string) => `node -e "fetch('${origin}/connect/setup.mjs').then(r=>r.text()).then(t=>${'import'}('data:text/javascript,'+encodeURIComponent(t)))"`;
/** How many of the newest changes a session is given whole (the query pack's summary, NEWEST). */
const NEWEST = 5;
/** Counts by a key, the most first. */
const countBy = <T>(items: T[], key: (item: T) => string): Record<string, number> => {
  const counts = new Map<string, number>();
  for (const item of items) counts.set(key(item), (counts.get(key(item)) ?? 0) + 1);
  return Object.fromEntries([...counts].sort((a, b) => b[1] - a[1]));
};
/** What the server says of itself and of what people did, as the map the hook reads keeps it (root.sessions). */
const server = <O>(ctx: KernelContext, ask: Record<string, unknown>) => ctx.call<Record<string, unknown>, O>('root.sessions', ask);
/** Text the owner typed, not an event or another session's message: what is asked of the session is narrowed by it (the runs pack's askedBy, copied). */
function askedBy(prompt: unknown): string | undefined {
  const text = String(prompt ?? '').replace(/<system-reminder>[\s\S]*?<\/system-reminder>/g, '').trim();
  if (!text || text.startsWith('<') || /^(Another Claude session sent a message|Background \(|Task \()/.test(text)) return undefined;
  return text.slice(0, 300);
}

/** What a session is told at one hook, or undefined for an event there is none for. */
export async function sessionAnswer(ctx: KernelContext, event: string, call: HookAsk): Promise<Neutral | undefined> {
  const { within, body, running } = call;
  if (call.may === 'report') return {};
  // A token within some items registers and speaks for sessions in the places that are theirs, and for no others.
  if (within.length && !(await hookWithin(ctx, within, body, event === 'session-start'))) {
    return event === 'session-start' ? told(LIMITED) : {};
  }
  // A file read or changed: what bites there, said once (packs/sessions/kernel/file-said.ts). The ids it said go back beside the answer, for the hook to keep.
  if (event === 'file-used') {
    const said = await fileSaid(ctx, body).catch((err) => void console.error(`hook file: ${(err as Error).message}`));
    return said ? told(said.text, { said: said.ids }) : {};
  }
  // An adapter's batch of what the session did, kept as raw events on its run.
  if (event === 'events') return (await takeEvents(ctx, body)) as Neutral;
  // Said in the server's log, so "did the hook run?" has an answer.
  console.log(`hook ${event} from session ${body.session_id ?? 'unknown'}`);
  // One chat is one session: a prompt takes up a run that was ended while the chat went on, before anything is kept on it.
  if (event === 'prompt') await sessionPrompted(ctx, body.session_id, HOOK_ACTOR).catch((err) => console.error(`hook take up: ${(err as Error).message}`));
  // The hook counts what the session has used so far; it is recorded before anything else, so an ending session's last tokens reach its work.
  if (event !== 'session-start') await recordUsage(ctx, body.session_id, body.tokens).catch((err) => console.error(`hook usage: ${(err as Error).message}`));
  // And what it touched, so that report, action session_end, asks about those when it ends.
  const run = event !== 'session-start' && body.session_id && (Array.isArray(body.touched) || typeof body.title === 'string' || (event === 'prompt' && typeof body.prompt === 'string')) ? await resolveRun(ctx, body.session_id, true) : undefined;
  if (run) await addTouched(ctx, run.id, body.touched).catch((err) => console.error(`hook touched: ${(err as Error).message}`));
  if (run) await labelled(ctx, run, body.title).catch((err) => console.error(`hook title: ${(err as Error).message}`));
  if (run && event === 'prompt' && typeof body.title !== 'string') await promptNamed(ctx, run, body.prompt).catch((err) => console.error(`hook prompt title: ${(err as Error).message}`));
  // Where its place stands, kept on the run while it is open: at the end, before the run is closed.
  if (event === 'stop' || event === 'session-end') await keepStands(ctx, body.session_id, body.stands ?? body.git).catch((err) => console.error(`hook stands: ${(err as Error).message}`));
  if (event === 'prompt') {
    // Each time the owner sends a session a message, the session is told what the owner has done in the map since
    // it last heard: a decision made in the UI reaches the session with the next thing they say.
    await sessionHeard(ctx, body.session_id, 'begin').catch((err) => console.error(`hook heard: ${(err as Error).message}`));
    const heard = await kept<number>(ctx, heardKey(body.session_id));
    const { changes, described } = heard === undefined ? { changes: [], described: '' } : await server<{ changes: { seq: number; action: string }[]; described: string }>(ctx, { changes: { after: heard, newest: NEWEST } });
    await keep(ctx, heardKey(body.session_id), changes.at(-1)?.seq ?? heard ?? (await server<number>(ctx, { heard: true })), HEARD_MS);
    const lines: string[] = [];
    // A session that began before this server did has lived through a restart: after a deploy its client still
    // holds the tools as they were when it connected. Said once, at its first prompt after the restart.
    const restartKey = `restart:${running.started}:${body.session_id ?? ''}`;
    const began = (await kept(ctx, restartKey)) ? undefined : await sessionBegan(ctx, body.session_id);
    await keep(ctx, restartKey, true, HEARD_MS);
    if (began && began.getTime() < Date.parse(running.started)) {
      // Which actions are new is told against what the session was given, or was last told of.
      const now = await server<string[]>(ctx, { offered: true });
      const had = await kept<string[]>(ctx, actionsKey(body.session_id));
      lines.push(await restarted(ctx, running, had && now.filter((a) => !had.includes(a)), body.session_id));
      await keep(ctx, actionsKey(body.session_id), now, HEARD_MS);
    }
    // How many of each, and the newest few: the rest is one query away.
    const counts = changes.length > NEWEST ? countBy(changes, (c) => c.action) : undefined;
    const tally = counts ? `${changes.length} changes (${Object.entries(counts).map(([action, n]) => `${n} ${action}`).join(', ')}); the newest ${NEWEST}, the rest with query events:\n` : '';
    // And what the owner is looking at now, so "this" in their message has a referent (packs/presence/kernel/seeing.ts).
    const asking = body.session_id ? await resolveRun(ctx, body.session_id, true) : undefined;
    const looking = (await ctx.call<object, { line: string | null }>('answer.seeing_line', { whose: await ctx.reads({ whose: true }), ...(asking && { run: asking.id }) }).catch(() => undefined))?.line;
    if (looking) lines.push(looking);
    if (changes.length) lines.push(`Since you last heard from Archipelago, the owner did this in the map (web UI or CLI). Take it into account, and act on it if it is addressed to you:\n${tally}${described}`);
    // The first thing the owner asks a session narrows where it stands: what the map has settled on it (packs/runs/kernel/frontier-prompt.ts).
    const asked = askedBy(body.prompt);
    const narrowKey = `narrowed:${body.session_id ?? ''}`;
    if (asked && body.session_id && !(await kept(ctx, narrowKey))) {
      await keep(ctx, narrowKey, true, HEARD_MS);
      const found = await ctx.call<object, { text: string | null }>('answer.narrowed', { text: asked, said: true }).catch((err) => console.error(`hook narrow: ${(err as Error).message}`));
      const on = found?.text ?? undefined;
      if (on) lines.push(on);
    }
    return lines.length ? told(lines.join('\n\n')) : {};
  }
  if (event === 'session-start') {
    await keep(ctx, heardKey(body.session_id), await server<number>(ctx, { heard: true }), HEARD_MS);
    await keep(ctx, actionsKey(body.session_id), await server<string[]>(ctx, { offered: true }), HEARD_MS);
    const known = body.session_id ? await resolveRun(ctx, body.session_id) : undefined;
    let additionalContext = await hookSessionStart(ctx, body);
    // The hook keeps it in the checkout, where the commit-msg hook the setup installs finds it to name the run in a commit.
    const run = body.session_id ? await resolveRun(ctx, body.session_id, true) : undefined;
    if (run) call.ran?.(run.id);
    // A new one gets a tab of its own on the owner's page, or the tab of the one a clear ended in its chat; one taken up
    // again after it ended gets its tab back; one still open has its own already.
    if (run && (!known || !known.is_open)) {
      const takes = typeof run.props.took_over === 'string' ? run.props.took_over : undefined;
      await ctx.call('act.report.took', { whose: await ctx.reads({ whose: true }), step: { kind: 'show', actor: HOOK_ACTOR.name, hash: `e/${run.id}`, opens: true, canvas: true, run: run.id, ...(takes && { takes }) } }).catch((err) => console.error(`hook tab: ${(err as Error).message}`));
    }
    // A project keeps the files it was given when it was set up; the server moves on. A session is told when its
    // project is behind, since nothing else would: an old hook counts less, and old rules name tools as they were.
    if (await server<boolean>(ctx, { behind: body.setup ?? null })) {
      const behind = await sayAt(ctx, 'setup_behind', { command: setupCommand(call.origin) }, body.session_id);
      if (behind) additionalContext += `\n\n${behind}`;
    }
    return told(additionalContext);
  }
  if (event === 'session-end') {
    await hookSessionEnd(ctx, body);
    return {};
  }
  // The end of a turn: the session was heard from and its count (taken above) is up to date, so one long turn does
  // not go a whole session without its tokens. A rule on the reply's end may ask the agent to go on, once.
  if (event === 'stop') {
    await sessionHeard(ctx, body.session_id, 'until').catch((err) => console.error(`hook heard: ${(err as Error).message}`));
    const asking = body.session_id ? await resolveRun(ctx, body.session_id, true) : undefined;
    const ask = await askOnReply(ctx, asking, body).catch((err) => void console.error(`hook reply rules: ${(err as Error).message}`));
    return ask ? { go_on: ask } : {};
  }
  return undefined;
}
