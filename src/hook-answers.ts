// What Claude Code's hooks are answered (POST /hooks/<event>): a session started, was prompted, ended a turn, ended.
// Where a session last heard up to is kept in the workspace's database (src/transient.ts), so its next prompt is
// answered as well by a server it has not spoken to before.

import { SETUP_VERSION, setupCommand } from './connect.ts';
import type { Q } from './db.ts';
import type { Archipelago, May } from './pelago.ts';
import { hookSessionEnd, hookSessionStart, hookWithin, recordUsage, resolveRun, sessionBegan, sessionHeard } from './sessions.ts';
import { addTouched } from './touched.ts';
import { describeChanges, humanChanges, latestSeq } from './tools.ts';
import { summed } from './summary.ts';
import { keep, kept } from './transient.ts';

export interface HookBody {
  session_id?: string;
  cwd?: string;
  remote?: string;
  reason?: string;
  tokens?: number;
  /** The items the session's calls to the map have named so far, read from its transcript (src/touched.ts). */
  touched?: unknown;
  setup?: string;
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
}

/** How long a session's place is kept after it was last heard from. */
const HEARD_MS = 7 * 86_400_000;
const heardKey = (session: string | undefined) => `heard:${session ?? ''}`;

const LIMITED =
  'This machine’s Archipelago token is limited to some repositories, and this folder is not a checkout of one that is theirs: the session is not registered in Archipelago, and its work is not kept there. Tell the owner in your first reply; a token for this repository is made on the Workspace screen.';

const restarted = ({ started, commit }: HookCall['running']) =>
  `The Archipelago server has restarted since this session began (at ${started}${commit ? `, now running commit ${commit.slice(0, 7)}` : ''}). If that was a deploy, its tools may have changed, and your client still holds the list from when it connected: a tool, an action or an input that CLAUDE.md or a tool's answer names, but your list lacks, is there on the server (the tools are query, change, undo and the six verbs, each taking an action by name). Ask the owner to reconnect the pelago MCP server, or until then call the tool as plain JSON: POST /agent/<tool> on the same server with the same token. And if a pelago tool answers with a web page or "502" while the server is coming back, do not send it again through MCP (each such answer is a whole page in your context): wait until GET /health answers, then send it as plain JSON.`;

/** The answer to one hook, or undefined for an event there is none for. */
export async function answerHook(event: string, call: HookCall): Promise<object | undefined> {
  const { whole, pelago, within, body, running } = call;
  if (call.may === 'report') return {};
  // A token within some items registers and speaks for sessions in the places that are theirs, and for no others.
  if (within.length && !(await hookWithin(pelago, within, body, event === 'session-start'))) {
    return event === 'session-start' ? { hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext: LIMITED } } : {};
  }
  // Said in the server's log, so "did the hook run?" has an answer.
  console.log(`hook ${event} from session ${body.session_id ?? 'unknown'}`);
  // The hook counts what the session has used so far; it is recorded before anything else, so an ending session's last tokens reach its work.
  if (event !== 'session-start') await recordUsage(pelago, body.session_id, body.tokens).catch((err) => console.error(`hook usage: ${(err as Error).message}`));
  // And what it touched, so that report, action session_end, asks about those when it ends.
  const run = event !== 'session-start' && body.session_id && Array.isArray(body.touched) ? await resolveRun(pelago, body.session_id, true) : undefined;
  if (run) await addTouched(whole, run.id, body.touched).catch((err) => console.error(`hook touched: ${(err as Error).message}`));
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
    if (began && began.getTime() < Date.parse(running.started)) told.push(restarted(running));
    // How many of each, and the newest few: the rest is one query away.
    const { newest, counts, more } = summed(changes, (c) => c.action);
    const tally = counts ? `${newest.length + more!} changes (${Object.entries(counts).map(([action, n]) => `${n} ${action}`).join(', ')}); the newest ${newest.length}, the rest with query events:\n` : '';
    if (changes.length) told.push(`Since you last heard from Archipelago, the owner did this in the map (web UI or CLI). Take it into account, and act on it if it is addressed to you:\n${tally}${describeChanges(newest)}`);
    return told.length ? { hookSpecificOutput: { hookEventName: 'UserPromptSubmit', additionalContext: told.join('\n\n') } } : {};
  }
  if (event === 'session-start') {
    await keep(whole, heardKey(body.session_id), await latestSeq(pelago), HEARD_MS);
    let additionalContext = await hookSessionStart(pelago, body);
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
  // The end of a turn: nothing to say back, but the session was heard from and its count (taken above) is
  // up to date, so one long turn does not go a whole session without its tokens.
  if (event === 'stop') {
    await sessionHeard(pelago, body.session_id, 'until').catch((err) => console.error(`hook heard: ${(err as Error).message}`));
    return {};
  }
  return undefined;
}
