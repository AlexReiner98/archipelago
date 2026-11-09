// What Claude Code's hooks are answered (POST /hooks/<event>): a session started, was prompted, ended a turn, ended.
// Where a session last heard up to is kept in the workspace's database (src/transient.ts), so its next prompt is
// answered as well by a server it has not spoken to before.

import { SETUP_VERSION, setupCommand } from './connect.ts';
import { addCommits } from './commits.ts';
import type { Q } from './db.ts';
import type { Archipelago, May } from './pelago.ts';
import { askOnReply } from './replies.ts';
import { hookWithin, recordUsage, resolveRun, sessionBegan, sessionHeard, sessionPrompted } from './sessions.ts';
import { hookSessionEnd, hookSessionStart } from './session-hook.ts';
import { sessionLabelled } from './session-name.ts';
import { addTouched } from './touched.ts';
import { fileSaid } from './file-said.ts';
import { keepGit } from './git-state.ts';
import { sessionOpened } from './tool-change.ts';
import { describeChanges, humanChanges, latestSeq, offeredActions } from './tools.ts';
import { summed } from './summary.ts';
import { seeingLine } from './seeing.ts';
import { keep, kept } from './transient.ts';
import { takeEvents } from './session-events.ts';

export interface HookBody {
  session_id?: string;
  cwd?: string;
  remote?: string;
  reason?: string;
  tokens?: number;
  /** The items the session's calls to the map have named so far, read from its transcript (src/touched.ts). */
  touched?: unknown;
  /** What Claude Code calls the session, read from its transcript: the title the owner gave it, else the one it made. */
  title?: unknown;
  /** At the start: why Claude Code started it (startup, resume, clear, compact). */
  source?: unknown;
  /**
   * At the start: the checkout's newest commits (id and message), which the session is asked to account for. After
   * it: the commits the session has made so far, by full sha, and those its reply made or pushed (src/commits.ts).
   */
  commits?: unknown;
  turn_commits?: unknown;
  /** At a turn's end: what the reply did since the owner's last message (src/reply-rules.ts), and that message's id. */
  reply?: unknown;
  turn?: unknown;
  /** Claude Code's: the agent is going on because a Stop hook asked it to. */
  stop_hook_active?: unknown;
  setup?: string;
  /** At the file-used event: the file read or changed, and the instructions the session has been told about files already. */
  path?: unknown;
  said?: unknown;
  /** At a turn's end and at the end: where the checkout stands (src/git-state.ts). */
  git?: unknown;
  /** At the events route: the adapter's batch of raw events, in the vocabulary of docs/sessions.md (src/session-events.ts). */
  events?: unknown;
}

export interface HookCall {
  /** The whole workspace's database, where what one request leaves for the next is kept. */
  whole: Q;
  /** The map as the token's person sees it. */
  pelago: Archipelago;
  /** The items the token writes within; none for everything. */
  within: string[];
  /** A token that may only report speaks for no session. */
  may?: May;
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

// Claude Code lists the tools again when it reconnects after a restart (for some minutes after the stream drops), but
// what its model already read of them (a tool loaded with ToolSearch) is the description as it was.
const restarted = ({ started, commit }: HookCall['running'], added: string[] | undefined) =>
  `The Archipelago server has restarted since this session began (at ${started}${commit ? `, now running commit ${commit.slice(0, 7)}` : ''}). ${
    added?.length ? `Actions new since you were given the tools: ${added.join('; ')}. ` : added ? 'No action is new since you were given the tools. ' : ''
  }A pelago tool's description you read before the restart may be the old one: call an action by name under its verb even if that description lacks it (query with name actions gives its inputs), or load the tool again (ToolSearch, select:mcp__pelago__<verb>) for the new one. If a pelago tool is missing altogether or answers that it is not connected, the client gave up reconnecting: ask the owner to reconnect it (in Claude Code: /mcp, pelago, Reconnect), and until then call it as plain JSON: POST /agent/<tool> on the same server with the same token. And if a pelago tool answers with a web page or "502" while the server is coming back, do not send it again through MCP (each such answer is a whole page in your context): wait until GET /health answers, then send it as plain JSON.`;

/** The answer to one hook, or undefined for an event there is none for. */
export async function answerHook(event: string, call: HookCall): Promise<object | undefined> {
  const { whole, pelago, within, body, running } = call;
  if (call.may === 'report') return {};
  // A token within some items registers and speaks for sessions in the places that are theirs, and for no others.
  if (within.length && !(await hookWithin(pelago, within, body, event === 'session-start'))) {
    return event === 'session-start' ? { hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext: LIMITED } } : {};
  }
  // A file read or changed: what bites there, said once (src/file-said.ts). The ids it said go back beside the answer, for the hook to keep.
  if (event === 'file-used') {
    const told = await fileSaid(pelago, body).catch((err) => void console.error(`hook file: ${(err as Error).message}`));
    return told ? { hookSpecificOutput: { hookEventName: 'PostToolUse', additionalContext: told.text }, said: told.ids } : {};
  }
  // An adapter's batch of what the session did, kept as raw events on its run.
  if (event === 'events') return takeEvents(pelago, body);
  // Said in the server's log, so "did the hook run?" has an answer.
  console.log(`hook ${event} from session ${body.session_id ?? 'unknown'}`);
  // One chat is one session: a prompt takes up a run that was ended while the chat went on, before anything is kept on it.
  if (event === 'prompt') await sessionPrompted(pelago, body.session_id).catch((err) => console.error(`hook take up: ${(err as Error).message}`));
  // The hook counts what the session has used so far; it is recorded before anything else, so an ending session's last tokens reach its work.
  if (event !== 'session-start') await recordUsage(pelago, body.session_id, body.tokens).catch((err) => console.error(`hook usage: ${(err as Error).message}`));
  // And what it touched, so that report, action session_end, asks about those when it ends.
  const run = event !== 'session-start' && body.session_id && (Array.isArray(body.touched) || Array.isArray(body.commits) || typeof body.title === 'string') ? await resolveRun(pelago, body.session_id, true) : undefined;
  if (run) await addTouched(whole, run.id, body.touched).catch((err) => console.error(`hook touched: ${(err as Error).message}`));
  if (run) await addCommits(whole, run.id, body.commits).catch((err) => console.error(`hook commits: ${(err as Error).message}`));
  if (run) await sessionLabelled(pelago, run, body.title).catch((err) => console.error(`hook title: ${(err as Error).message}`));
  // Where its checkout stands, kept on the run while it is open: at the end, before the run is closed.
  if (event === 'stop' || event === 'session-end') await keepGit(pelago, body.session_id, body.git).catch((err) => console.error(`hook git: ${(err as Error).message}`));
  if (event === 'prompt') {
    // Each time the owner sends a session a message, the session is told what the owner has done in the map since
    // it last heard: a decision made in the UI reaches the session with the next thing they say.
    await sessionHeard(pelago, body.session_id, 'begin').catch((err) => console.error(`hook heard: ${(err as Error).message}`));
    const heard = await kept<number>(whole, heardKey(body.session_id));
    const changes = heard === undefined ? [] : await humanChanges(pelago, heard);
    await keep(whole, heardKey(body.session_id), changes.at(-1)?.seq ?? heard ?? (await latestSeq(pelago)), HEARD_MS);
    const told: string[] = [];
    // A session that began before this server did has lived through a restart: after a deploy its client still
    // holds the tools as they were when it connected. Said once, at its first prompt after the restart.
    const restartKey = `restart:${running.started}:${body.session_id ?? ''}`;
    const began = (await kept(whole, restartKey)) ? undefined : await sessionBegan(pelago, body.session_id);
    await keep(whole, restartKey, true, HEARD_MS);
    if (began && began.getTime() < Date.parse(running.started)) {
      // Which actions are new is told against what the session was given, or was last told of.
      const now = offeredActions(pelago.registry);
      const had = await kept<string[]>(whole, actionsKey(body.session_id));
      told.push(restarted(running, had && now.filter((a) => !had.includes(a))));
      await keep(whole, actionsKey(body.session_id), now, HEARD_MS);
    }
    // How many of each, and the newest few: the rest is one query away.
    const { newest, counts, more } = summed(changes, (c) => c.action);
    const tally = counts ? `${newest.length + more!} changes (${Object.entries(counts).map(([action, n]) => `${n} ${action}`).join(', ')}); the newest ${newest.length}, the rest with query events:\n` : '';
    // And what the owner is looking at now, so "this" in their message has a referent (src/seeing.ts).
    const asking = body.session_id ? await resolveRun(pelago, body.session_id, true) : undefined;
    const looking = await seeingLine(pelago, whole, asking?.id).catch(() => undefined);
    if (looking) told.push(looking);
    if (changes.length) told.push(`Since you last heard from Archipelago, the owner did this in the map (web UI or CLI). Take it into account, and act on it if it is addressed to you:\n${tally}${describeChanges(newest)}`);
    return told.length ? { hookSpecificOutput: { hookEventName: 'UserPromptSubmit', additionalContext: told.join('\n\n') } } : {};
  }
  if (event === 'session-start') {
    await keep(whole, heardKey(body.session_id), await latestSeq(pelago), HEARD_MS);
    await keep(whole, actionsKey(body.session_id), offeredActions(pelago.registry), HEARD_MS);
    const known = body.session_id ? await resolveRun(pelago, body.session_id) : undefined;
    let additionalContext = await hookSessionStart(pelago, body);
    // The hook keeps it in the checkout, where the commit-msg hook the setup installs finds it to name the run in a commit.
    const run = body.session_id ? await resolveRun(pelago, body.session_id, true) : undefined;
    if (run) call.ran?.(run.id);
    // A new one gets a tab of its own on the owner's page, or the tab of the one a clear ended in its chat; one taken up
    // again after it ended gets its tab back; one still open has its own already.
    if (run && (!known || !known.is_open)) await sessionOpened(pelago, { kind: 'agent', name: 'claude-code' }, run.id, undefined, typeof run.props.took_over === 'string' ? run.props.took_over : undefined).catch((err) => console.error(`hook tab: ${(err as Error).message}`));
    // A project keeps the files it was given when it was set up; the server moves on. A session is told when its
    // project is behind, since nothing else would: an old hook counts less, and old rules name tools as they were.
    if (body.setup !== SETUP_VERSION)
      additionalContext += `\n\nThis folder's Archipelago files (hooks, working rules, the bump skill) are older than the server's. Tell the owner in your first reply, and with their yes bring them up to date by running this in the folder (it holds no secret, and with nobody at a terminal it renews only what Archipelago wrote there before):${setupCommand(call.origin)} . What it changes takes effect in the next session.`;
    return { hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext } };
  }
  if (event === 'session-end') {
    await hookSessionEnd(pelago, body);
    return {};
  }
  // The end of a turn: the session was heard from and its count (taken above) is up to date, so one long turn does
  // not go a whole session without its tokens. A rule on the reply's end may ask the agent to go on, once.
  if (event === 'stop') {
    await sessionHeard(pelago, body.session_id, 'until').catch((err) => console.error(`hook heard: ${(err as Error).message}`));
    const asking = body.session_id ? await resolveRun(pelago, body.session_id, true) : undefined;
    return (await askOnReply(whole, pelago, asking, body).catch((err) => console.error(`hook reply rules: ${(err as Error).message}`))) ?? {};
  }
  return undefined;
}
