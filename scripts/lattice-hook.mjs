// A Claude Code hook that tells Lattice about the session: started, a prompt
// sent, ended. Claude Code hands the hook its input as JSON on stdin and
// reads the answer from stdout; this passes both through to the Lattice
// server the machine is connected to (LATTICE_URL and LATTICE_AGENT_TOKEN,
// the same two that .mcp.json reads), or to the one on this machine when
// those are not set.
//
//   node scripts/lattice-hook.mjs session-start | prompt | session-end
//
// It never fails the session: if the server is away it says so on stderr and
// answers nothing.

const name = process.argv[2];
const base = (process.env.LATTICE_URL || 'http://127.0.0.1:3100').replace(/\/$/, '');
const token = process.env.LATTICE_AGENT_TOKEN;

let input = '';
for await (const chunk of process.stdin) input += chunk;

try {
  const res = await fetch(`${base}/hooks/${name}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(token && { authorization: `Bearer ${token}` }) },
    body: input.trim() || '{}',
    signal: AbortSignal.timeout(10_000),
  });
  const answer = await res.text();
  if (res.ok) process.stdout.write(answer);
  else console.error(`Lattice ${name} hook: ${base} answered ${res.status}`);
} catch (err) {
  console.error(`Lattice ${name} hook: ${base} did not answer (${err.message})`);
}
