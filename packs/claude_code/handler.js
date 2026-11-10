// Claude Code, as a server pack (task e_4234gh6h, decision e_hhsepkpe). It knows Claude Code's wire and nothing of the
// map: what a session is told is the kernel's, handed here neutrally to be put in the shape Claude Code's hooks read;
// what a headless `claude -p` prints is read here, one line at a time, into what the kernel records on its run.

/** The kernel's hook events, which the hook script (scripts/pelago-hook.mjs) already calls by their own names. */
const EVENTS = ['session-start', 'prompt', 'stop', 'session-end', 'file-used', 'events'];

/** Claude Code's name for the hook each event answers. */
const HOOK_EVENT = { 'session-start': 'SessionStart', prompt: 'UserPromptSubmit', 'file-used': 'PostToolUse' };

const isObject = (v) => typeof v === 'object' && v !== null && !Array.isArray(v);

/** A hook's body to the kernel's: the same, as the hook script sends it; an event the kernel does not answer is not asked. */
export function hookIn({ event, body }) {
  return EVENTS.includes(event) ? { event, body: isObject(body) ? body : {} } : {};
}

/** The kernel's neutral answer in Claude Code's shape: told as the hook's additional context, go_on as a Stop hook's block, the rest beside. */
export function hookOut({ event, answer }) {
  const { told, go_on, ...rest } = isObject(answer) ? answer : {};
  if (typeof told === 'string') return { hookSpecificOutput: { hookEventName: HOOK_EVENT[event] ?? event, additionalContext: told }, ...rest };
  if (typeof go_on === 'string') return { decision: 'block', reason: go_on, ...rest };
  return rest;
}

/**
 * One line of `claude -p --output-format stream-json`: what it said (the last text of a message, or the plan it put
 * forward), and at its result that it is done, how, and the tokens it used (input and output, not cached re-reads).
 * In plan mode the result comes back empty: what it said before it is then what its run ends with.
 */
export function read({ line }) {
  let m;
  try {
    m = JSON.parse(line);
  } catch {
    return null; // Not every line is JSON; the transcript keeps it either way.
  }
  if (!isObject(m)) return null;
  if (m.type === 'assistant') {
    let said;
    let plan;
    for (const part of Array.isArray(m.message?.content) ? m.message.content : []) {
      if (part?.type === 'text' && typeof part.text === 'string' && part.text.trim()) said = part.text;
      if (part?.type === 'tool_use' && part.name === 'ExitPlanMode' && typeof part.input?.plan === 'string') plan = part.input.plan;
    }
    return plan || said ? { said: plan || said } : null;
  }
  if (m.type !== 'result') return null;
  const u = isObject(m.usage) ? m.usage : {};
  const tokens = (Number(u.input_tokens) || 0) + (Number(u.output_tokens) || 0);
  return {
    done: true,
    outcome: m.is_error ? 'failed' : 'finished',
    ...(typeof m.result === 'string' && m.result.trim() && { said: m.result }),
    ...(tokens > 0 && { tokens }),
  };
}

const answered = (fn) => (input) => ({ answer: fn(input) });
export default { hook_in: answered(hookIn), hook_out: answered(hookOut), read: answered(read) };
