#!/usr/bin/env node
// A sketch runner: one prompt on the Claude Agent SDK, its session told to the map as the events of docs/sessions.md,
// the same vocabulary Claude Code's hooks speak (pelago-hook.mjs), with `source: "agent-sdk"`. The mapping from the
// SDK's messages to events is sdkEvents, a pure function (test/sdk-runner.test.ts): messages in, as the runner
// received them and when, events out. What a tool call, a test run, a commit and a reply's end are is read as the
// hook reads them, through pelago-events.mjs; the request that sends them is its eventsPost.
//
//   node scripts/pelago-sdk-runner.mjs "the prompt" [--title "what it is called"] [--parent <session id>]
//
// The SDK is not one of the project's dependencies: it is imported only if present (npm i --no-save
// @anthropic-ai/claude-agent-sdk, or installed globally with NODE_PATH set). It talks to the server PELAGO_URL with
// PELAGO_AGENT_TOKEN, as the hooks do.

import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { callEvents, eventsPost, gist, replyEnd, tokensOf } from './pelago-events.mjs';

const content = (m) => (Array.isArray(m?.message?.content) ? m.message.content : []);
// A run that ended because it was cut off (the runner's abort, or its tools aborted) was stopped, not failed.
const STOPPED = new Set(['aborted_streaming', 'aborted_tools']);

/**
 * The events of one prompt run on the SDK, from its messages as received: `[{ at, message }]` in order, `at` the
 * runner's clock when each came (the SDK's messages carry no time). One prompt is one turn, named `turn`; the
 * session starts on the SDK's init message and ends with `ended` (a reason, as `ended_by`), once the runner says so.
 * A subagent's own messages (parent_tool_use_id set) are its own, as a subagent's transcript is to the hook.
 * Read again with more messages, the same events and then new ones: the runner sends only what is new.
 */
export function sdkEvents(received, { prompt, turn = 't1', by = 'person', from, title, branch, parent, stopped, ended } = {}) {
  const events = [];
  const calls = new Map();
  let started = false, opened = false, closed = false, waiting = false, reply, last;
  const open = (at) => {
    if (opened) return;
    opened = true;
    events.push({ at, kind: 'turn.start', turn, by, ...(from && { from }), ...(by === 'person' && gist(prompt) && { gist: gist(prompt) }) });
  };
  for (const { at, message: m } of received) {
    last = at;
    if (m.type === 'system' && m.subtype === 'init' && !started) {
      started = true;
      events.push({ at, kind: 'session.start', ...(title && { title }), ...(branch && { branch }), ...(parent && { parent }) });
      open(at);
      continue;
    }
    // What the SDK says of itself before its init (hooks, status) opens no turn; the session has not started yet.
    if (m.type !== 'system') open(at);
    if (m.type === 'system' && m.subtype === 'session_state_changed') {
      // The session stops for a permission it must be given, and goes on once it is.
      if (m.state === 'requires_action' && !waiting) events.push({ at, kind: 'wait.start', turn, for: 'permission' });
      if (m.state !== 'requires_action' && waiting) events.push({ at, kind: 'wait.end', turn, for: 'permission' });
      waiting = m.state === 'requires_action';
    }
    if (m.parent_tool_use_id) continue;
    if (m.type === 'assistant') for (const part of content(m)) {
      if (part.type === 'tool_use') calls.set(part.id, part);
      if (part.type === 'text' && part.text?.trim()) reply = part.text;
    }
    // Calls answered in one message are told a millisecond apart: an event is the same one by its time, kind and turn.
    if (m.type === 'user') content(m).filter((p) => p.type === 'tool_result' && calls.has(p.tool_use_id)).forEach((part, i) => {
      events.push(...callEvents(calls.get(part.tool_use_id), part, new Date(Date.parse(at) + i).toISOString(), turn));
    });
    if (m.type === 'result' && !closed) {
      closed = true;
      if (waiting) events.push({ at, kind: 'wait.end', turn, for: 'permission' }), (waiting = false);
      const ok = m.subtype === 'success' && !m.is_error;
      const end = ok ? replyEnd(typeof m.result === 'string' && m.result.trim() ? m.result : reply)
        : { ended: STOPPED.has(m.terminal_reason) ? 'stopped' : 'failed', ...(gist(m.errors?.[0] ?? m.result ?? m.subtype) && { gist: gist(m.errors?.[0] ?? m.result ?? m.subtype) }) };
      events.push({ at, kind: 'turn.end', turn, ...end, ...(m.usage && { tokens: tokensOf(m.usage) }) });
    }
  }
  // A run the runner cut off, or that broke, hears no result: its turn ends as the runner says.
  if (stopped && opened && !closed && last) events.push({ at: last, kind: 'turn.end', turn, ended: stopped.ended ?? 'stopped', ...(gist(stopped.error) && { gist: gist(stopped.error) }) });
  if (ended && started && last) events.push({ at: last, kind: 'session.end', reason: String(ended).slice(0, 40) });
  return events;
}

/** The runner: runs the prompt, telling what is new after each message, and ends the session it registered. */
async function run(argv) {
  const flag = (name) => { const i = argv.indexOf(`--${name}`); return i < 0 ? undefined : argv.splice(i, 2)[1]; };
  const title = flag('title'), parent = flag('parent');
  const prompt = argv.join(' ').trim();
  if (!prompt) throw new Error('Give it a prompt: node scripts/pelago-sdk-runner.mjs "the prompt"');
  const sdk = await import('@anthropic-ai/claude-agent-sdk').catch(() => null);
  if (!sdk) throw new Error('The Agent SDK is not installed here. It is not a dependency of this project: npm i --no-save @anthropic-ai/claude-agent-sdk');
  const base = (process.env.PELAGO_URL || 'http://127.0.0.1:3100').replace(/\/$/, '');
  const token = process.env.PELAGO_AGENT_TOKEN;
  const cwd = process.cwd();
  const git = (...args) => { try { return execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 3000 }).trim(); } catch { return ''; } };
  const branch = git('rev-parse', '--abbrev-ref', 'HEAD') || undefined, remote = git('remote', 'get-url', 'origin') || undefined;
  const post = (path, body) => fetch(`${base}${path}`, { method: 'POST', headers: { 'content-type': 'application/json', ...(token && { authorization: `Bearer ${token}` }) }, body: JSON.stringify(body), signal: AbortSignal.timeout(10_000) });

  const received = [];
  let sessionId, sent = 0, clock = 0;
  const options = { prompt, title, branch, parent };
  // What is new since the last batch; the server drops what it has, so a batch lost is sent again with the next.
  const tell = async (more = {}) => {
    if (!sessionId) return;
    const events = sdkEvents(received, { ...options, ...more });
    const fresh = events.slice(sent);
    if (!fresh.length) return;
    try {
      const res = await fetch(...eventsPost({ base, token, session_id: sessionId, source: 'agent-sdk', events: fresh }));
      // The route answers what it kept, and what it refused and why, beside a 200.
      const answer = await res.json().catch(() => ({}));
      if (res.ok && !answer.problem) sent = events.length;
      if (!res.ok || answer.problem || answer.refused) console.error(`Archipelago events: ${base} answered ${res.status} ${JSON.stringify(answer)}`);
      else if (process.env.PELAGO_SDK_TOLD) console.error(`Archipelago events: ${fresh.map((e) => e.kind).join(', ')}: kept ${answer.kept}`);
    } catch (err) {
      console.error(`Archipelago events: ${base} did not answer (${err.message})`);
    }
  };
  const abort = new AbortController();
  process.once('SIGINT', () => abort.abort());
  let stopped;
  try {
    for await (const message of sdk.query({ prompt, options: { cwd, abortController: abort } })) {
      // The SDK's messages carry no time: each is stamped as it comes, never two at the same millisecond.
      clock = Math.max(Date.now(), clock + 1);
      received.push({ at: new Date(clock).toISOString(), message });
      if (message.type === 'system' && message.subtype === 'init' && !sessionId) {
        sessionId = message.session_id;
        // The run is made as Claude Code's is, by its session id; its events are kept on it.
        await post('/hooks/session-start', { session_id: sessionId, cwd, remote, title, parent, source: 'startup' }).catch((err) => console.error(`Archipelago session-start: ${err.message}`));
      }
      if (message.type === 'assistant' && !message.parent_tool_use_id) for (const part of content(message)) if (part.type === 'text') process.stdout.write(`${part.text}\n`);
      if (message.type !== 'stream_event') await tell();
    }
  } catch (err) {
    stopped = abort.signal.aborted ? { ended: 'stopped' } : { ended: 'failed', error: err.message };
    if (!abort.signal.aborted) console.error(err.message);
  }
  await tell({ stopped, ended: stopped?.ended === 'stopped' ? 'other' : 'exit' });
  if (sessionId) await post('/hooks/session-end', { session_id: sessionId, reason: 'exit' }).catch(() => {});
  if (stopped?.ended === 'failed') process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await run(process.argv.slice(2));
