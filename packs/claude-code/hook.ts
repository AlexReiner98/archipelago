/**
 * A command hook that forwards to the adapter. Reads the hook input on
 * stdin, posts it to the adapter, prints the answer. If the adapter isn't
 * there, answers badly or is slow, it prints nothing and exits 0: a missing
 * map never stops the agent, and never shows as a hook error.
 *
 * Claude Code runs SessionStart only as a command; the user-level hooks
 * (README, "Every session") use this for every event, since an http hook to
 * a server that is down shows as an error.
 *
 *   node packs/claude-code/hook.ts [url]    (default http://127.0.0.1:5181/hook)
 *
 * ARCHIPELAGO_HOOK_URL sets the url, ARCHIPELAGO_HOOK_TIMEOUT_MS how long to
 * wait for the answer (default 3000).
 */
const url = process.argv[2] ?? process.env.ARCHIPELAGO_HOOK_URL ?? "http://127.0.0.1:5181/hook";
const timeout = Number(process.env.ARCHIPELAGO_HOOK_TIMEOUT_MS) || 3000;
try {
  const chunks: Buffer[] = [];
  for await (const c of process.stdin) chunks.push(c as Buffer);
  const res = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: Buffer.concat(chunks), signal: AbortSignal.timeout(timeout) });
  if (res.ok) process.stdout.write(await res.text());
} catch {
  // The adapter is down or slow: say nothing.
}
process.exit(0);
