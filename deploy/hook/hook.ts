// GitHub's hook for the server, at /hooks/deploy behind Caddy. It checks the delivery is GitHub's (signed with
// DEPLOY_HOOK_SECRET) and says the tests passed (.github/workflows/tests.yml) on a push to the branch that deploys,
// then leaves that commit in queue/. CI is the gate: the server deploys only what passed there. The hook runs
// nothing itself and cannot reach Docker: on the host, archipelago-deploy.path sees the queue is not empty and runs
// deploy.sh.
//
//   node hook/hook.ts        (in the deploy-hook container: docker-compose.yml)

import { createHmac, timingSafeEqual } from 'node:crypto';
import { renameSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { join } from 'node:path';

const secret = process.env.DEPLOY_HOOK_SECRET ?? '';
const branch = process.env.DEPLOY_BRANCH || 'main';
const workflow = process.env.DEPLOY_WORKFLOW || 'Tests';
const queue = process.env.DEPLOY_QUEUE || '/queue';
const port = Number(process.env.DEPLOY_HOOK_PORT || 9000);

if (!secret) {
  console.error('DEPLOY_HOOK_SECRET is not set: no delivery could be checked.');
  process.exit(1);
}

function signed(body: Buffer, signature: string | undefined, key: string): boolean {
  if (!signature?.startsWith('sha256=')) return false;
  const want = Buffer.from(`sha256=${createHmac('sha256', key).update(body).digest('hex')}`);
  const got = Buffer.from(signature);
  return got.length === want.length && timingSafeEqual(got, want);
}

type WorkflowRun = { action?: string; workflow_run?: { name?: string; event?: string; conclusion?: string; head_branch?: string; head_sha?: string } };

const server = createServer((req, res) => {
  const answer = (code: number, text: string) => {
    res.writeHead(code, { 'content-type': 'text/plain' }).end(`${text}\n`);
  };
  if (req.method !== 'POST' || req.url !== '/hooks/deploy') return answer(404, 'not here');
  const chunks: Buffer[] = [];
  let size = 0;
  req.on('data', (chunk: Buffer) => {
    size += chunk.length;
    if (size > 5_000_000) req.destroy();
    else chunks.push(chunk);
  });
  req.on('end', () => {
    const body = Buffer.concat(chunks);
    if (!signed(body, req.headers['x-hub-signature-256'] as string | undefined, secret)) return answer(401, 'not signed');
    const event = req.headers['x-github-event'];
    if (event === 'ping') return answer(200, 'pong');
    if (event !== 'workflow_run') return answer(202, `ignored: ${event}`);
    let run: WorkflowRun;
    try {
      run = JSON.parse(body.toString('utf8'));
    } catch {
      return answer(400, 'not JSON');
    }
    const w = run.workflow_run ?? {};
    const passed = run.action === 'completed' && w.name === workflow && w.event === 'push' && w.conclusion === 'success' && w.head_branch === branch;
    if (!passed) return answer(202, `ignored: ${w.name} ${run.action} ${w.conclusion ?? ''} on ${w.head_branch}`);
    const sha = String(w.head_sha ?? '').replace(/[^0-9a-f]/g, '');
    if (sha.length !== 40) return answer(400, 'no commit');
    // Written aside and moved in, so the host never sees half a file. deploy.sh takes the newest and empties the
    // queue, so commits that pass during a deploy are one more deploy, not one each.
    const name = `${Date.now()}-${sha}`;
    const tmp = join(queue, `.${name}`);
    writeFileSync(tmp, `${sha}\n`);
    renameSync(tmp, join(queue, name));
    console.log(`queued ${sha} (${workflow} passed on ${branch})`);
    answer(202, `queued ${sha}`);
  });
});

server.listen(port, '0.0.0.0', () => console.log(`deploy hook on :${port}: ${workflow} passed on ${branch}`));
