// The human surface. A thin client over the running server's local API, so it
// uses exactly the tools agents use, plus the two only a human may call.

import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { newSecret, OPERATOR_RESET_FILE } from './auth.ts';
import { loadConfig } from './config.ts';
import { env } from './env.ts';

const USAGE = `pelago <command>

  init "<name>" [email]        set yourself as the workspace owner
  status                       pending proposals, connections, held resources
  review [id]                  list pending proposals, or show one in full
  approve <id|all> [--except a,b]   apply a proposal (leave out refs or #n ops)
  reject <id> [note]           reject a proposal
  view [name] [json-params]    answer a standing question (no name lists them)
  search <text> [type]         find entities
  get <id>                     one entity with relations and history
  events [limit]               the activity log
  call <tool> [json | @file]   call any tool directly
  operator-reset               replace a lost operator secret (run it on the
                               server's own machine, with the server running)

Start the server first:  npm start`;

const base = `http://127.0.0.1:${loadConfig().port}`;

async function call<T = unknown>(tool: string, input: unknown = {}): Promise<T> {
  let res: Response;
  try {
    const headers: Record<string, string> = { 'content-type': 'application/json' };
    if (env('TOKEN')) headers.authorization = `Bearer ${env('TOKEN')}`;
    res = await fetch(`${base}/api/${tool}`, { method: 'POST', headers, body: JSON.stringify(input) });
  } catch {
    throw new Error(`Cannot reach pelago at ${base}. Start it with: npm start`);
  }
  const body = (await res.json()) as { result?: T; error?: string };
  if (res.status === 401) throw new Error('This server requires a token. Set PELAGO_TOKEN to your token and try again.');
  if (!res.ok) throw new Error(body.error);
  return body.result as T;
}

const print = (value: unknown) => console.log(JSON.stringify(value, null, 2));

interface ProposalRow {
  id: string;
  ts: string;
  actor: string;
  reason: string;
  source: { uri: string } | null;
  ops: Record<string, unknown>[];
  warnings: string[];
}

function describeOp(op: Record<string, any>): string {
  switch (op.op) {
    case 'create': {
      const extra = [op.status, op.owner && `owner ${op.owner}`, op.props && Object.keys(op.props).length ? JSON.stringify(op.props) : '']
        .filter(Boolean)
        .join(', ');
      return `create ${op.type} "${op.title}"${op.ref ? ` [${op.ref}]` : ''}${extra ? `  (${extra})` : ''}`;
    }
    case 'update': {
      const { op: _op, id, ...changes } = op;
      return `update ${id}: ${JSON.stringify(changes)}`;
    }
    case 'link':
      return `link   ${op.from} --${op.type}--> ${op.to}`;
    case 'unlink':
      return `unlink ${op.relation}`;
    case 'archive':
      return `archive ${op.id}`;
    case 'restore':
      return `restore ${op.id}`;
    case 'merge':
      return `merge  ${op.drop} into ${op.keep}`;
    case 'define_type':
      return `define type ${op.type.id}${op.type.extends ? ` (flavour of ${op.type.extends})` : ''}: ${op.type.description}`;
    default:
      return JSON.stringify(op);
  }
}

function showProposal(p: ProposalRow, full: boolean): void {
  console.log(`\n${p.id}  by ${p.actor}  ${new Date(p.ts).toLocaleString()}  (${p.ops.length} ops)`);
  console.log(`  why:    ${p.reason}`);
  if (p.source) console.log(`  source: ${p.source.uri}`);
  for (const w of p.warnings) console.log(`  warning: ${w}`);
  if (!full) return;
  for (const [i, op] of p.ops.entries()) {
    console.log(`  #${String(i + 1).padEnd(3)} ${describeOp(op)}`);
    if (op.op === 'create' && op.body) console.log(`         ${String(op.body).replaceAll('\n', ' ').slice(0, 160)}`);
  }
}

async function main(): Promise<void> {
  const [command, ...args] = process.argv.slice(2);
  switch (command) {
    case 'init':
      if (!args[0]) throw new Error('Usage: pelago init "<name>" [email]');
      return print(await call('init', { name: args[0], email: args[1] }));

    case 'status': {
      const [pending, connections, now] = await Promise.all([
        call<ProposalRow[]>('proposals'),
        call<{ title: string; status: string; url: string }[]>('check_connections'),
        call<{ counts: { ready: number; blocked: number } }>('view', { name: 'attention', params: { reasons: ['ready', 'blocked'], limit: 1 } }),
      ]);
      console.log(`Proposals awaiting review: ${pending.length}`);
      console.log(`Work ready to take up: ${now.counts.ready}   blocked: ${now.counts.blocked}`);
      for (const c of connections) console.log(`Connection ${c.title}: ${c.status}  (${c.url})`);
      return;
    }

    case 'review': {
      const pending = await call<ProposalRow[]>('proposals');
      const shown = args[0] ? pending.filter((p) => p.id === args[0]) : pending;
      if (!shown.length) return console.log(args[0] ? `No pending proposal ${args[0]}` : 'Nothing to review.');
      for (const p of shown) showProposal(p, Boolean(args[0]) || shown.length === 1);
      console.log(`\nApprove with: pelago approve <id>   (or: approve all, approve <id> --except ref,#3)`);
      return;
    }

    case 'approve': {
      if (!args[0]) throw new Error('Usage: pelago approve <id|all> [--except a,b]');
      const flag = args.indexOf('--except');
      const except = flag >= 0 ? (args[flag + 1] ?? '').split(',').filter(Boolean) : undefined;
      const ids = args[0] === 'all' ? (await call<ProposalRow[]>('proposals')).map((p) => p.id) : [args[0]];
      for (const id of ids) {
        try {
          const result = await call<{ changeset: string; created: Record<string, string> }>('decide', { proposal: id, approve: true, except });
          console.log(`${id} approved: ${Object.keys(result.created).length} entities created (changeset ${result.changeset})`);
        } catch (err) {
          console.error(`${id} not applied: ${(err as Error).message}`);
          process.exitCode = 1;
        }
      }
      return;
    }

    case 'reject':
      if (!args[0]) throw new Error('Usage: pelago reject <id> [note]');
      return print(await call('decide', { proposal: args[0], approve: false, note: args.slice(1).join(' ') || undefined }));

    case 'view':
      return print(await call('view', { name: args[0], params: args[1] ? JSON.parse(args[1]) : undefined }));

    case 'search':
      return print(await call('search', { q: args[0], type: args[1] }));

    case 'get':
      return print(await call('get', { id: args[0] }));

    case 'events':
      return print(await call('events', { limit: args[0] ? Number(args[0]) : 30 }));

    case 'call': {
      if (!args[0]) throw new Error('Usage: pelago call <tool> [json | @file]');
      const raw = args[1]?.startsWith('@') ? readFileSync(args[1].slice(1), 'utf8') : args[1];
      return print(await call(args[0], raw ? JSON.parse(raw) : {}));
    }

    case 'operator-reset': {
      // Being able to write beside the server's data is the proof of who is
      // asking: the server reads this file, once, and compares.
      const dir = join(loadConfig().dataDir, '..', 'workspaces');
      const proof = newSecret('reset');
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, OPERATOR_RESET_FILE), proof, { mode: 0o600 });
      try {
        const res = await fetch(`${base}/operator/reset`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ proof }) });
        const body = (await res.json()) as { result?: { operator_secret: string; note: string }; error?: string };
        if (res.status === 404) throw new Error('This server has no operator: it runs without tokens.');
        if (!res.ok || !body.result) throw new Error(body.error ?? `The server answered ${res.status}.`);
        console.log(`New operator secret (shown once):
  ${body.result.operator_secret}
The old one no longer works.`);
      } finally {
        rmSync(join(dir, OPERATOR_RESET_FILE), { force: true });
      }
      return;
    }

    default:
      console.log(USAGE);
  }
}

main().catch((err) => {
  console.error((err as Error).message);
  process.exit(1);
});
