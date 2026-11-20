/**
 * A command hook that forwards to the adapter, for the hooks Claude Code
 * runs only as commands (SessionStart). Reads the hook input on stdin, posts
 * it to the adapter, prints the answer. If the adapter isn't there it prints
 * nothing and exits 0: a missing map never stops the agent.
 *
 *   node packs/claude-code/hook.ts [url]    (default http://127.0.0.1:5181/hook)
 */
const url = process.argv[2] ?? process.env.ARCHIPELAGO_HOOK_URL ?? "http://127.0.0.1:5181/hook";
const chunks: Buffer[] = [];
for await (const c of process.stdin) chunks.push(c as Buffer);
try {
  const res = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: Buffer.concat(chunks), signal: AbortSignal.timeout(30000) });
  if (res.ok) process.stdout.write(await res.text());
} catch {
  // The adapter is down: say nothing.
}
