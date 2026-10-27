// The GitHub App: one integration for the whole server, so connecting a repository is choosing it on GitHub and
// nothing else. No webhook to add in each repository, no workflow file, no secrets pasted into its settings.
//
// There are three moments:
//   1. The server's owner creates the app, once. Archipelago hands GitHub a manifest saying what the app is and may
//      do; GitHub answers with its id, its key and the secret it signs with. The kernel keeps those three, sealed:
//      this pack never sees them (keep, on the request).
//   2. A workspace's admin connects GitHub: they choose repositories on GitHub, and GitHub sends them back with the
//      installation's id, which is tied to their workspace (connection.make). Each chosen repository is put in
//      that map (workspace.add).
//   3. GitHub delivers everything to one address, signed with the secret the kernel keeps. The installation says
//      whose workspace it is for, and a push is handed to the GitHub pack there (workspace.deliver).
//
// What the app may do on GitHub is read the repositories' contents, metadata and pull requests, and write one thing:
// the check on the main branch that every commit is accounted for (checks.js). It runs in the kernel's sandbox:
// it asks GitHub through the host it declares (ctx.request), and the kernel signs as the app or as an installation.

import { CHECK, postCheck, rerun } from './checks.js';

/** Back to the Workspace page, once done on GitHub. */
const BACK = { redirect: '/#/workspace' };
const NOT_STARTED = 'This was not started from Archipelago, or was started too long ago. Start again from the Workspace screen.';

/** What GitHub answered, or why not. */
async function ask(ctx, request) {
  const made = await ctx.request({ host: 'api', ...request });
  if (made.status >= 300) throw new Error(`GitHub answered ${made.status}${made.body?.message ? `: ${made.body.message}` : ''} to ${request.method ?? 'GET'} ${request.path}`);
  return made.body ?? {};
}

/**
 * The app as GitHub calls it now. Asked of GitHub when it is not kept yet: an app whose key was given to the server
 * by hand (its environment) is known by asking. Undefined when the server has none.
 */
export async function appOf(ctx) {
  const kept = await ctx.store.get('app');
  if (kept?.slug) return kept;
  return ask(ctx, { path: '/app' }).then(
    async (now) => {
      if (!now.slug) return undefined;
      const app = { slug: now.slug, name: now.name ?? now.slug };
      await ctx.store.put('app', app);
      return app;
    },
    () => undefined,
  );
}

/** Whether the server has its app, for the Workspace page. */
export async function status(_input, ctx) {
  const app = await appOf(ctx);
  return { answer: { ready: Boolean(app), name: app?.name ?? null } };
}

/** Where to send an admin: to create the app (setup, once for the server), or to choose repositories. */
export async function start(input, ctx) {
  const app = await appOf(ctx);
  if (input.purpose === 'setup') {
    if (app) throw new Error(`This server already has its GitHub App (${app.name}).`);
    return { answer: { url: `${ctx.origin}/x/github_app/new?state=${input.state}` } };
  }
  if (!app) throw new Error('This server has no GitHub App yet. Its owner creates one from the Workspace screen of the default workspace.');
  return { answer: { url: `${ctx.hosts.web}/apps/${app.slug}/installations/new?state=${input.state}` } };
}

/** What the page hands GitHub: where, and the manifest of the app. Only for a creation begun here. */
export async function manifest(input, ctx) {
  const begun = await ctx.act('begun.get', { state: input.state });
  if (begun.purpose !== 'setup') throw new Error(NOT_STARTED);
  const origin = ctx.origin;
  return {
    answer: {
      action: `${ctx.hosts.web}/settings/apps/new?state=${input.state}`,
      manifest: {
        name: `Archipelago (${new URL(origin).host})`.slice(0, 34),
        url: origin,
        description: 'Keeps an Archipelago map true to the repositories it is connected to: every push is read against the open work.',
        hook_attributes: { url: `${origin}/x/github_app/hook/events` },
        redirect_url: `${origin}/x/github_app/created`,
        setup_url: `${origin}/x/github_app/installed`,
        setup_on_update: true,
        // Only its owner's account can install it until they choose otherwise on GitHub.
        public: false,
        // Checks to post the one on the main branch (checks.js); pull requests to read the commits of one into it.
        default_permissions: { contents: 'read', metadata: 'read', checks: 'write', pull_requests: 'read' },
        default_events: ['push', 'pull_request', 'check_run'],
      },
    },
  };
}

/** GitHub made the app and sent its owner back with a code: traded, once, for what the app is. Its secrets go to the kernel. */
export async function created(input, ctx) {
  const begun = await ctx.act('begun.take', { state: input.state });
  if (begun.purpose !== 'setup') throw new Error(NOT_STARTED);
  if (!input.code) throw new Error('GitHub sent no code back.');
  const made = await ctx.request({ host: 'api', method: 'POST', path: `/app-manifests/${encodeURIComponent(input.code)}/conversions`, anonymous: true, keep: { pem: 'key', webhook_secret: 'hook', id: 'app_id' } });
  const kept = made.kept ?? [];
  if (made.status >= 300 || !made.body?.slug || !['key', 'hook', 'app_id'].every((k) => kept.includes(k))) throw new Error(`GitHub did not hand over the app (${made.status}${made.body?.message ? `: ${made.body.message}` : ''}).`);
  await ctx.store.put('app', { slug: made.body.slug, name: made.body.name ?? made.body.slug });
  return { answer: BACK };
}

/** The repositories an installation was given, as "owner/name". */
export async function repositories(ctx, installation) {
  const names = [];
  for (let page = 1; page <= 10; page++) {
    const answer = await ask(ctx, { path: `/installation/repositories?per_page=100&page=${page}`, as: installation });
    names.push(...(answer.repositories ?? []).map((r) => r.full_name));
    if ((answer.repositories ?? []).length < 100) break;
  }
  return names;
}

/** Put repositories in the map of the workspace an installation is for: each one it does not know by its address. */
export function addRepositories(ctx, installation, names, account) {
  return ctx.act('workspace.add', {
    connection: installation,
    type: 'repo',
    unique: 'remote',
    items: names.map((name) => ({ title: `${name.split('/')[1]} repo`.slice(0, 60), props: { remote: `https://github.com/${name}` } })),
    reason: `Connected through the GitHub App${account ? ` on ${account}` : ''}`,
  });
}

/**
 * Sent back after choosing repositories: the first time with the word that says whose workspace it is for, later
 * (the choice changed on GitHub) without one, when the installation is known already.
 */
export async function installed(input, ctx) {
  const id = String(input.installation_id ?? '');
  if (!/^\d+$/.test(id)) throw new Error('GitHub sent no installation back.');
  let connection = await ctx.act('connection.get', { id });
  if (input.state || !connection) {
    if (!input.state || (await ctx.act('begun.get', { state: input.state })).purpose !== 'connect') throw new Error(NOT_STARTED);
    // Asked of GitHub, as the app: the id in the address is only what the browser said.
    const about = await ask(ctx, { path: `/app/installations/${id}` });
    connection = await ctx.act('connection.make', { state: input.state, id, account: about.account?.login ?? '' });
  }
  await addRepositories(ctx, id, await repositories(ctx, id), connection.account);
  return { answer: BACK };
}

/** Everything the app's installations do arrives here, checked by the kernel; the installation says whose workspace it is for. */
export async function events(input, ctx) {
  const event = input.headers?.['x-github-event'];
  const payload = input.payload ?? {};
  if (event === 'ping') return { answer: { recorded: false, reason: 'pong' } };
  const installation = payload.installation?.id === undefined ? undefined : String(payload.installation.id);
  if (event === 'installation' && payload.action === 'deleted' && installation) {
    await ctx.act('connection.drop', { id: installation });
    return { answer: { recorded: true, forgotten: payload.installation.id } };
  }
  const connection = installation && (await ctx.act('connection.get', { id: installation }));
  if (!connection) return { answer: { recorded: false, reason: 'No workspace here has connected this installation. Connect GitHub from the Workspace screen.' } };
  if (event === 'installation_repositories') return { answer: await addRepositories(ctx, installation, (payload.repositories_added ?? []).map((r) => r.full_name), payload.installation?.account?.login ?? '') };
  if (event === 'check_run' && payload.action === 'rerequested' && payload.check_run?.name === CHECK) return { answer: await rerun(ctx, payload) };
  if (event !== 'push' && event !== 'pull_request') return { answer: { recorded: false, reason: `Only pushes and pull requests are taken in, not "${event}".` } };
  // The push is the GitHub pack's to take in there, as from its own webhook: this delivery is already checked. What
  // it answers may be the check on the main branch, which is posted here.
  const delivery = input.headers?.['x-github-delivery'];
  const answer = await ctx.act('workspace.deliver', { connection: installation, event: 'repo.push', payload, headers: { 'x-github-event': event, ...(delivery && { 'x-github-delivery': delivery }) } });
  return { answer: await postCheck(ctx, installation, payload, answer) };
}

/** The app's owner can rename it on GitHub, and the address a workspace is sent to follows its name: asked every hour. */
export async function refresh(_input, ctx) {
  const kept = await ctx.store.get('app');
  const now = await ask(ctx, { path: '/app' }).catch(() => undefined);
  if (!now?.slug) return { answer: { changed: false } };
  const app = { slug: now.slug, name: now.name ?? now.slug };
  if (kept?.slug === app.slug && kept?.name === app.name) return { answer: { changed: false } };
  await ctx.store.put('app', app);
  return { answer: { changed: true, ...app } };
}
