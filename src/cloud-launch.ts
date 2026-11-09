// Launching in the cloud: a hosted server has neither its workspaces' repositories nor a Claude CLI, so it starts the
// session on Anthropic's Managed Agents instead (the owner, 3 Nov 2026: decision e_h66tfm2g). The workspace's own
// Anthropic account pays for it, capped per session; the task's repository is cloned into its sandbox with the
// workspace's GitHub token, which never enters the sandbox; and it reaches this map's MCP endpoint with an agent token
// of its own, kept in a vault for that one session and revoked when it ends. As on this machine, the run is registered
// first, so it holds what the task needs or is refused, and a run someone else started only proposes.
//
// Nothing here waits on the session: each pass of the automations (src/automations.ts) asks after the sessions still
// open, and ends each run the moment its session has stopped.

import { randomUUID } from 'node:crypto';
import { createToken, revokeToken } from './auth.ts';
import { briefFor, promptFor, type LaunchInput, type StartedBy } from './launch-brief.ts';
import { anthropicAccount } from './model-account.ts';
import { ANTHROPIC, anthropicHeaders } from './model.ts';
import { wholeMap } from './outbox.ts';
import { actorId, type Actor, type Archipelago } from './pelago.ts';
import { sessionEnd, sessionStart, sessionUpdate } from './sessions.ts';
import { logged } from './logged.ts';

interface CloudConfig {
  /** This map's MCP endpoint as the internet reaches it: the session calls it from Anthropic's side. */
  mcpUrl: string;
  /** The server requires tokens, so each session is given one of its own. */
  auth?: boolean;
  /** Tests: Anthropic, faked. */
  fetch?: typeof fetch;
}

let cloud: CloudConfig | undefined;

export function configureCloud(next: CloudConfig | undefined): void {
  cloud = next;
}

export const cloudOn = (): boolean => Boolean(cloud);

const BETA = 'managed-agents-2026-04-01';
/** The workspace's GitHub token, sealed: what clones a task's repository into the session's sandbox. */
export const REPO_TOKEN = 'github_token';
/** The agent and environment made once per workspace, and the sessions still open (kept in settings, bounded). */
const AGENT = 'cloud_agent';
const ENVIRONMENT = 'cloud_environment';
const OPEN = 'cloud_runs';
/** What one session may spend when its launch names no cap, in US$. */
export const BUDGET_USD = 5;

interface OpenRun {
  run: string;
  session: string;
  vault?: string;
  token?: string;
}

const NO_ACCOUNT =
  'A cloud session runs on the workspace’s own Anthropic account, and none is connected. Its admin connects one on the Workspace page, under Model (an Anthropic API key).';

async function call<T = Record<string, unknown>>(key: string, method: string, path: string, body?: unknown): Promise<T> {
  const res = await (cloud?.fetch ?? fetch)(`${ANTHROPIC}${path}`, { method, headers: anthropicHeaders(key, [BETA]), body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(30_000) });
  const text = await res.text();
  if (!res.ok) {
    let said = '';
    try {
      said = String((JSON.parse(text) as { error?: { message?: unknown } }).error?.message ?? '');
    } catch {
      // Not JSON: said by its status alone.
    }
    throw new Error(`Anthropic answered ${res.status} to ${method} ${path.split('?')[0]}${said ? `: ${said.slice(0, 300)}` : ''}`);
  }
  return (text ? JSON.parse(text) : {}) as T;
}

/** Set by the server, never by a change: appended to the settings stream as the owner's settings are. */
async function keep(l: Archipelago, key: string, value: unknown): Promise<void> {
  await l.db.query(`insert into setting (key, value) values ($1, $2::jsonb) on conflict (key) do update set value = excluded.value`, [key, JSON.stringify(value)]);
  await l.record('settings', 'system', [['+', 'setting', key, value as string]]);
}

/** The agent this workspace's sessions run as, made again when the model or the map's address changes. */
async function agentFor(l: Archipelago, key: string, model: string): Promise<string> {
  const kept = await l.setting<{ id: string; model: string; mcp: string }>(AGENT);
  if (kept && kept.model === model && kept.mcp === cloud!.mcpUrl) return kept.id;
  // Unattended: the server judges each call (auto), and one it cannot judge stops the session, which ends the run.
  const ask = { permission_policy: { type: 'auto' } };
  const made = await call<{ id: string }>(key, 'POST', '/v1/agents', {
    name: `Archipelago ${l.workspace}`.slice(0, 100),
    model,
    system: 'You are started by an Archipelago map on one of its tasks. The task’s brief is your first message; the map is reached through the pelago tools.',
    mcp_servers: [{ type: 'url', name: 'pelago', url: cloud!.mcpUrl }],
    tools: [
      { type: 'agent_toolset_20260401', default_config: ask, configs: [{ name: 'web_fetch', enabled: false }, { name: 'web_search', enabled: false }] },
      { type: 'mcp_toolset', mcp_server_name: 'pelago', default_config: ask },
    ],
  });
  await keep(l, AGENT, { id: made.id, model, mcp: cloud!.mcpUrl });
  return made.id;
}

async function environmentFor(l: Archipelago, key: string): Promise<string> {
  const kept = await l.setting<string>(ENVIRONMENT);
  if (kept) return kept;
  const made = await call<{ id: string }>(key, 'POST', '/v1/environments', {
    name: `archipelago-${l.workspace}`.slice(0, 100),
    config: { type: 'cloud', networking: { type: 'limited', allow_package_managers: true, allow_mcp_servers: true } },
  });
  await keep(l, ENVIRONMENT, made.id);
  return made.id;
}

/** A GitHub repository's address as https://github.com/owner/name, from any form a remote is written in. */
export function githubUrl(address: string): string | undefined {
  const m = address.trim().match(/^(?:https?:\/\/(?:[^@/]+@)?|git@|ssh:\/\/git@)github\.com[:/]([\w.-]+)\/([\w.-]+?)(?:\.git)?\/?$/i);
  return m ? `https://github.com/${m[1]}/${m[2]}` : undefined;
}

export async function cloudLaunch(l: Archipelago, actor: Actor, input: LaunchInput, by?: StartedBy) {
  if (!cloud) throw new Error('Launching in the cloud is off on this server.');
  // Settings and secrets are the workspace's, whoever launches.
  const whole = await wholeMap(l);
  const account = await anthropicAccount(whole);
  if (!account) throw new Error(NO_ACCOUNT);
  const mode = input.mode ?? 'plan';
  const budget = input.budget_usd ?? BUDGET_USD;
  if (!(budget > 0 && budget <= 500)) throw new Error('A session’s cap is more than nothing and at most US$500.');
  const { brief, started } = await briefFor(l, actor, input, by);
  // Work with no repository (a weekly post, say) runs in an empty sandbox.
  const address = brief.repo?.address;
  const repo = address && githubUrl(address);
  if (address && !repo) throw new Error(`"${brief.task.title}" lives in ${address}, and a cloud session can clone only a GitHub repository.`);
  const repoToken = repo ? await whole.secret(REPO_TOKEN) : undefined;
  if (repo && !repoToken) throw new Error(`"${brief.task.title}" lives in ${repo}, and this workspace has no GitHub token to clone it with. Its admin gives one on the Workspace page.`);

  // Register first: this is what takes the lane, or tells us it is taken.
  const agent: Actor = { kind: 'agent', name: 'claude-cloud' };
  const begun = await sessionStart(l, agent, { task: input.task, ...(repo && { remote: repo }), session_id: randomUUID(), surface: 'claude-cloud', title: `Cloud (${mode}): ${brief.task.title}` });
  const run = begun.run;
  if (begun.status === 'waiting') {
    const why = (('blocked' in begun ? begun.blocked : undefined) ?? []).map((b) => b.why).join(' ');
    await sessionEnd(l, agent, { run, outcome: 'cancelled', summary: `Not launched: ${why}` });
    throw new Error(`Not launched. ${why}`);
  }
  // As on this machine: a token of its own for a day, revoked the moment it ends; one someone else started only proposes.
  const token = cloud.auth ? await createToken(l.db, l.workspace, { kind: 'agent', name: `launched:${run}`, expires_days: 1, entity: l.viewer || undefined, ...(started && { may: 'propose' as const }) }) : undefined;
  let vault: string | undefined;
  try {
    if (started) await l.apply(actorId(agent), { ops: [{ op: 'update', id: run, props: { started_by: started } }], reason: `Started by ${started.name}` });
    const [agentId, environment] = [await agentFor(whole, account.key, account.model), await environmentFor(whole, account.key)];
    if (token) {
      vault = (await call<{ id: string }>(account.key, 'POST', '/v1/vaults', { display_name: `Archipelago run ${run}` })).id;
      await call(account.key, 'POST', `/v1/vaults/${vault}/credentials`, { display_name: 'Archipelago', auth: { type: 'static_bearer', mcp_server_url: cloud.mcpUrl, token: token.token } });
    }
    const where = repo ? `You are in a cloud sandbox, with ${repo} cloned under /workspace.` : 'You are in a cloud sandbox with no repository: the work is on the map.';
    const session = await call<{ id: string }>(account.key, 'POST', '/v1/sessions', {
      agent: agentId,
      environment_id: environment,
      title: brief.task.title.slice(0, 200),
      metadata: { run, workspace: l.workspace },
      ...(vault && { vault_ids: [vault] }),
      ...(repo && { resources: [{ type: 'github_repository', url: repo, authorization_token: repoToken }] }),
      budget: { type: 'limit', max_list_cost: { amount: String(Math.round(budget * 100)), currency: 'USD' } },
      initial_events: [{ type: 'user.message', content: [{ type: 'text', text: promptFor(brief, mode, run, input.instructions, where) }] }],
    });
    await keep(whole, OPEN, [...((await whole.setting<OpenRun[]>(OPEN)) ?? []), { run, session: session.id, vault, token: token?.id }]);
    await sessionUpdate(l, agent, { run, note: `Started in the cloud: session ${session.id}, capped at US$${budget}` });
    return { run, session_id: session.id, mode, where: 'cloud' as const, ...(repo && { repo }), budget_usd: budget, claimed: ('claimed' in begun ? begun.claimed : undefined) ?? [] };
  } catch (err) {
    if (token) await revokeToken(l.db, token.id).catch(logged(`cloud launch ${run}: its token could not be revoked`));
    if (vault) await call(account.key, 'DELETE', `/v1/vaults/${vault}`).catch(logged(`cloud launch ${run}: its vault ${vault} could not be deleted`));
    await sessionEnd(l, agent, { run, outcome: 'failed', summary: `Could not start in the cloud: ${(err as Error).message}` });
    throw err;
  }
}

interface Session {
  status: string;
  stop_reason?: { type?: string } | null;
}

/** What the session last said, for its run's summary. */
async function lastSaid(key: string, session: string): Promise<string> {
  const page = await call<{ data?: { type: string; content?: { type: string; text?: string }[] }[] }>(key, 'GET', `/v1/sessions/${session}/events?order=desc&limit=50`).catch(logged(`cloud session ${session}: what it last said could not be read`, { data: [] }));
  const said = page.data?.find((ev) => ev.type === 'agent.message');
  return (said?.content ?? []).filter((c) => c.type === 'text' && c.text).map((c) => c.text).join('\n').trim();
}

const STOPPED: Record<string, string> = {
  requires_action: 'It stopped at a step nobody was there to allow.',
  budget_reached: 'It reached its spending cap.',
};

/** One pass over this workspace's cloud sessions still open: each that has stopped ends its run. Returns the runs ended. */
export async function checkCloud(given: Archipelago): Promise<string[]> {
  const l = await wholeMap(given);
  const open = (await l.setting<OpenRun[]>(OPEN)) ?? [];
  if (!cloud || !open.length) return [];
  const account = await anthropicAccount(l);
  if (!account) return [];
  const agent: Actor = { kind: 'agent', name: 'claude-cloud' };
  const ended: string[] = [];
  for (const o of open) {
    // Ended on the map (by its owner, or for going quiet): the session is stopped too.
    if (!(await l.entity(o.run))?.is_open) {
      await call(account.key, 'POST', `/v1/sessions/${o.session}/events`, { events: [{ type: 'user.interrupt' }] }).catch(logged(`cloud session ${o.session}: it could not be stopped`));
    } else {
      const s = await call<Session>(account.key, 'GET', `/v1/sessions/${o.session}`).catch(logged(`cloud session ${o.session}: it could not be read`));
      if (!s || (s.status !== 'idle' && s.status !== 'terminated')) continue;
      const why = STOPPED[s.stop_reason?.type ?? ''];
      const text = (await lastSaid(account.key, o.session)) || 'The session ended without a word.';
      await sessionEnd(l, agent, { run: o.run, outcome: why ? 'failed' : 'finished', summary: `${why ? `${why}\n\n` : ''}${text.slice(0, 6000)}\n\n(cloud session ${o.session})` }).catch(logged(`cloud session ${o.session}: its run ${o.run} could not be ended`));
    }
    if (o.token) await revokeToken(l.db, o.token).catch(logged(`cloud session ${o.session}: its token could not be revoked`));
    if (o.vault) await call(account.key, 'DELETE', `/v1/vaults/${o.vault}`).catch(logged(`cloud session ${o.session}: its vault ${o.vault} could not be deleted`));
    ended.push(o.run);
  }
  if (ended.length) await keep(l, OPEN, ((await l.setting<OpenRun[]>(OPEN)) ?? []).filter((o) => !ended.includes(o.run)));
  return ended;
}
