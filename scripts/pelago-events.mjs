// What a Claude Code session did, as the events of docs/sessions.md, read from what its hooks are given and from its
// transcript: a gist of what was said, never a transcript. The hook (pelago-hook.mjs) loads it and sends what it
// answers to /hooks/events; nothing here reads a file, the network or the environment, so it is tested as input
// in, events out (test/hook-events.test.ts). A turn is named by Claude Code's prompt_id (promptId on the
// transcript's lines); the tools of a turn, its tests and commits are read off the transcript, each at its own
// time, so sending them again changes nothing.

// As the hook reads them: the map's tools (and any other workspace's), an item's id, the tools that write a file,
// a commit command, a line of the transcript's text, and a message its person wrote.
const MAP_TOOL = /^mcp__(pelago|lattice)__/;
const ANY_MAP_TOOL = /^mcp__(pelago|lattice)([-_][\w-]*?)?__/;
const ITEM = /\be_[a-z0-9]{8}\b/g;
const EDITS = new Set(['Edit', 'Write', 'MultiEdit', 'NotebookEdit']);
const COMMIT = new RegExp(String.raw`(^|[\s;&|(])git(\s+(-[Cc]\s+("[^"]*"|'[^']*'|\S+)|--?[\w-]+(=\S+)?))*\s+commit(?![\w-])`);
const textOf = (content) => (typeof content === 'string' ? content : Array.isArray(content) ? content.map((p) => p.text ?? '').join('\n') : '');
const prompted = (entry) =>
  entry.type === 'user' &&
  !entry.isMeta &&
  !entry.isCompactSummary &&
  (typeof entry.message?.content === 'string' ||
    (Array.isArray(entry.message?.content) && entry.message.content.some((p) => p.type === 'text') && !entry.message.content.some((p) => p.type === 'tool_result')));

const REMINDER = /<system-reminder>[\s\S]*?<\/system-reminder>/g;
export const gist = (text, n = 200) => {
  const line = String(text ?? '').replace(REMINDER, '').replace(/<[^>\n]+>/g, ' ').trim().split(/\n\s*\n|\n/)[0]?.trim() ?? '';
  return (/^[\s\S]*?[.!?](?=\s|$)/.exec(line)?.[0] ?? line).slice(0, n) || undefined;
};
const INTERRUPTED = /^\[Request interrupted by user/;
/** Who a prompt is from: its person, another session, or an event the app or Claude Code put in. */
export function promptedBy(prompt) {
  const text = String(prompt ?? '').replace(REMINDER, '').trim();
  const peer = /<cross-session-message from="([^"]+)"/.exec(text);
  if (peer) return { by: 'session', from: peer[1] };
  if (/^(Background|Task) \(from the session that started this one\)/.test(text)) return { by: 'session' };
  const tag = /^(?:Another Claude session sent a message:\s*)?<([a-z][\w-]*)[\s>]/.exec(text)?.[1];
  if (tag && (/-(event|message|notification)$/.test(tag) || tag === 'scheduled-task')) return { by: 'event', from: tag };
  return { by: 'person', gist: gist(text) };
}
const TESTS = /(^|[\s;&|(])(npm (run )?test(:[\w-]+)?|npx (vitest|jest|playwright test)|node --test|vitest|jest|pytest|dotnet test|cargo test|go test)(?![\w-])/;
export const kindOf = (tool) =>
  ANY_MAP_TOOL.test(tool) ? 'map' : EDITS.has(tool) ? 'edit' : /^(Read|NotebookRead)$/.test(tool) ? 'read' : /^(Bash|PowerShell|BashOutput)$/.test(tool) ? 'shell'
    : /^(Grep|Glob|LS|ToolSearch)$/.test(tool) ? 'search' : /^(WebFetch|WebSearch)$/.test(tool) || /Browser|chrome/.test(tool) ? 'web' : /^(Agent|Task)$/.test(tool) ? 'agent' : 'other';
const count = (out, re) => Number(re.exec(out)?.[1] ?? NaN);

const entriesOf = (text) => text.split('\n').flatMap((line) => { try { return line.trim() ? [JSON.parse(line)] : []; } catch { return []; } });
const startsTurn = (e) => prompted(e) && !INTERRUPTED.test(textOf(e.message.content));

/**
 * The events of the transcript's last turn: its tools, tests and commits. Given the prompt just sent (`current`),
 * of the turn before it, and that turn's end when its person stopped it: a turn stopped hears no Stop.
 */
export function turnEvents(text, current) {
  const entries = entriesOf(text);
  const starts = entries.flatMap((e, i) => (startsTurn(e) ? [i] : []));
  const now = current && starts.length && (entries[starts.at(-1)].promptId === current.prompt_id || textOf(entries[starts.at(-1)].message.content).trim() === String(current.prompt ?? '').trim());
  const from = starts.at(now ? -2 : -1);
  if (from === undefined) return [];
  const turnEntries = entries.slice(from, now ? starts.at(-1) : undefined);
  const ending = Boolean(current);
  const turn = turnEntries[0].promptId;
  const calls = new Map();
  const events = [];
  for (const e of turnEntries) {
    for (const part of Array.isArray(e.message?.content) ? e.message.content : []) {
      if (part.type === 'tool_use') calls.set(part.id, part);
      const call = part.type === 'tool_result' && calls.get(part.tool_use_id);
      if (!call) continue;
      const at = e.timestamp, ok = !part.is_error, out = textOf(part.content), input = call.input ?? {};
      const file = EDITS.has(call.name) && (input.file_path ?? input.notebook_path);
      const items = MAP_TOOL.test(call.name) ? [...new Set([...JSON.stringify(input).matchAll(ITEM), ...(call.name.endsWith('__change') ? out.matchAll(ITEM) : [])].map((m) => m[0]))] : [];
      events.push({ at, kind: 'tool.end', turn, tool: kindOf(call.name), name: call.name, ok, ...(file && { files: [file] }), ...(items.length && { items }) });
      const command = typeof input.command === 'string' ? input.command : '';
      if (kindOf(call.name) === 'shell' && TESTS.test(command)) {
        const passed = count(out, /^[ℹ#] pass (\d+)/m) || count(out, /(\d+) passed/);
        const failed = Number.isFinite(count(out, /^[ℹ#] fail (\d+)/m)) ? count(out, /^[ℹ#] fail (\d+)/m) : count(out, /(\d+) failed/);
        events.push({ at, kind: 'test.run', turn, ok: ok && !(failed > 0), ...(Number.isFinite(passed) && { passed }), ...(Number.isFinite(failed) && { failed }), command: command.slice(0, 120) });
      }
      if (kindOf(call.name) === 'shell' && COMMIT.test(command)) for (const m of out.matchAll(/^\[[^\]\n]*? ([0-9a-f]{7,40})\] (.*)$/gm)) events.push({ at, kind: 'commit', turn, sha: m[1], subject: m[2].slice(0, 200) });
    }
  }
  const last = turnEntries.at(-1);
  if (ending && last?.type === 'user' && INTERRUPTED.test(textOf(last.message?.content))) events.push({ at: last.timestamp, kind: 'turn.end', turn, ended: 'stopped' });
  return events.map((e) => (e.turn ? e : (({ turn: _, ...rest }) => rest)(e)));
}

/** How the transcript's last turn ended, for its Stop: on a question or not, its reply's gist, and what it used. */
export function turnEnd(text, said) {
  const entries = entriesOf(text);
  const from = entries.findLastIndex(startsTurn);
  const turnEntries = from < 0 ? [] : entries.slice(from);
  const used = new Map();
  let asked, reply;
  for (const e of turnEntries) {
    if (e.type !== 'assistant') continue;
    const u = e.message?.usage;
    if (u) used.set(e.message.id ?? e.uuid, { input: u.input_tokens ?? 0, output: u.output_tokens ?? 0, cache_read: u.cache_read_input_tokens ?? 0, cache_write: u.cache_creation_input_tokens ?? 0 });
    for (const part of Array.isArray(e.message?.content) ? e.message.content : []) {
      if (part.type === 'tool_use' && /__wrap_up$/.test(part.name ?? '')) asked = typeof part.input?.ask === 'string' && part.input.ask.trim() ? part.input.ask.trim() : undefined;
      if (part.type === 'text' && part.text?.trim()) reply = part.text;
    }
  }
  reply = typeof said.last_assistant_message === 'string' && said.last_assistant_message.trim() ? said.last_assistant_message : reply;
  const paragraph = String(reply ?? '').trim().split(/\n\s*\n/).at(-1)?.trim() ?? '';
  const question = asked ?? (paragraph.endsWith('?') ? paragraph : undefined);
  const tokens = [...used.values()].reduce((sum, u) => Object.fromEntries(Object.keys(u).map((k) => [k, sum[k] + u[k]])), { input: 0, output: 0, cache_read: 0, cache_write: 0 });
  const turn = said.prompt_id ?? turnEntries[0]?.promptId;
  return { at: new Date().toISOString(), kind: 'turn.end', ...(turn && { turn }), ended: question ? 'asked' : 'done', ...(question && { question: question.slice(0, 500) }), ...(gist(reply) && { gist: gist(reply) }), ...(used.size && { tokens }) };
}

/** What a Notification hook says the session waits on, or null: permission for a tool, or an answer from its person. */
export function waitStart(said, at = new Date().toISOString()) {
  const type = said.notification_type ?? (/permission/i.test(said.message ?? '') ? 'permission_prompt' : undefined);
  const waits = type === 'permission_prompt' ? 'permission' : /^(elicitation_dialog|elicitation_url_dialog|agent_needs_input)$/.test(type ?? '') ? 'input' : null;
  return waits && { at, kind: 'wait.start', ...(said.prompt_id && { turn: said.prompt_id }), for: waits, ...(gist(said.message) && { gist: gist(said.message) }) };
}

/** A turn that ended in an error (StopFailure): what the error was, as its gist. */
export function failedEnd(said, at = new Date().toISOString()) {
  const said_ = gist(said.error ?? said.last_assistant_message);
  return { at, kind: 'turn.end', ...(said.prompt_id && { turn: said.prompt_id }), ended: 'failed', ...(said_ && { gist: said_ }) };
}
