// The GitHub App: one integration for the whole server, so connecting a
// repository is choosing it on GitHub and nothing else. No webhook to add in
// each repository, no workflow file, no secrets pasted into its settings.
//
// There are three moments:
//   1. The server's owner creates the app, once. Archipelago sends GitHub a
//      manifest saying what the app is and may do; GitHub answers with its
//      id, its key and the secret it signs with, and they are kept here.
//   2. A workspace's admin connects GitHub: they choose repositories on
//      GitHub, and GitHub sends them back with the installation's id, which
//      is tied to their workspace. Each chosen repository is put in the map.
//   3. GitHub delivers every push to one address, signed. The installation
//      says whose workspace it is for.
//
// What the app may do is read: the repositories' contents and metadata.

import { createHmac, createSign, randomBytes, timingSafeEqual } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { repoByName } from './github.ts';
import { env } from './env.ts';
import type { Archipelago } from './pelago.ts';
import { isSealed, seal, unseal } from './secrets.ts';

interface Credentials {
  id: number;
  slug: string;
  name: string;
  pem: string;
  webhook_secret: string;
}

interface Kept {
  app?: Credentials;
  /** Which workspace each installation of the app belongs to. */
  installations: Record<string, { workspace: string; account: string }>;
}

interface Pending {
  kind: 'create' | 'connect';
  workspace: string;
  expires: number;
}

export interface GithubAppOptions {
  /** Where the app's credentials are kept, beside the workspaces. Null keeps them in memory (tests). */
  dir: string | null;
  /** The address this server is reached at, which GitHub is told to call and to send people back to. */
  origin: string;
  /** GitHub's API and site. Elsewhere only in tests. */
  api?: string;
  web?: string;
}

/** How long someone has to finish on GitHub what they started here. */
const PENDING_MINUTES = 15;

export class GithubApp {
  private readonly options: GithubAppOptions;
  private kept: Kept;
  private readonly pending = new Map<string, Pending>();
  private readonly tokens = new Map<string, { token: string; expires: number }>();

  constructor(options: GithubAppOptions) {
    this.options = options;
    const file = this.file();
    this.kept = file && existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : { installations: {} };
    // On disk the app's key and signing secret are sealed; here they are open. A file written before that is sealed now.
    if (this.kept.app) {
      const { pem, webhook_secret } = this.kept.app;
      const open = { pem: unseal(pem), webhook_secret: unseal(webhook_secret) };
      if (!open.pem || !open.webhook_secret) {
        console.error('The GitHub App\u2019s key cannot be opened with the sealing key this server has (PELAGO_SECRETS_KEY or secrets.key). The app has to be created again.');
        this.kept.app = undefined;
      } else {
        Object.assign(this.kept.app, open);
        if (!isSealed(pem) || !isSealed(webhook_secret)) this.save();
      }
    }
    // An app registered by hand comes in through the environment instead.
    const [id, pem, secret, slug] = ['ID', 'KEY', 'SECRET', 'SLUG'].map((name) => env(`GITHUB_APP_${name}`));
    if (!this.kept.app && id && pem && secret && slug) this.kept.app = { id: Number(id), slug, name: slug, pem: pem.replaceAll('\\n', '\n'), webhook_secret: secret };
  }

  private file(): string | null {
    return this.options.dir && join(this.options.dir, 'github-app.json');
  }

  private save(): void {
    const file = this.file();
    if (!file) return;
    mkdirSync(this.options.dir!, { recursive: true });
    // It holds the app's key: for the server's own eyes.
    const app = this.kept.app && { ...this.kept.app, pem: seal(this.kept.app.pem), webhook_secret: seal(this.kept.app.webhook_secret) };
    writeFileSync(file, JSON.stringify({ ...this.kept, app }, null, 2) + '\n', { mode: 0o600 });
  }

  private get api(): string {
    return (this.options.api ?? 'https://api.github.com').replace(/\/$/, '');
  }

  private get web(): string {
    return (this.options.web ?? 'https://github.com').replace(/\/$/, '');
  }

  get app(): { slug: string; name: string } | undefined {
    return this.kept.app && { slug: this.kept.app.slug, name: this.kept.app.name };
  }

  /** The installation a workspace connected, if it has. */
  installationOf(workspace: string): { id: string; account: string } | undefined {
    const found = Object.entries(this.kept.installations).find(([, i]) => i.workspace === workspace);
    return found && { id: found[0], account: found[1].account };
  }

  workspaceOf(installation: string | number | undefined): string | undefined {
    return installation === undefined ? undefined : this.kept.installations[String(installation)]?.workspace;
  }

  /** A one-time word that ties what comes back from GitHub to what was started here. */
  private begin(kind: Pending['kind'], workspace: string): string {
    const now = Date.now();
    for (const [state, p] of this.pending) if (p.expires < now) this.pending.delete(state);
    const state = randomBytes(24).toString('hex');
    this.pending.set(state, { kind, workspace, expires: now + PENDING_MINUTES * 60_000 });
    return state;
  }

  private finish(kind: Pending['kind'], state: string | null): Pending {
    const found = state ? this.pending.get(state) : undefined;
    if (state) this.pending.delete(state);
    if (!found || found.kind !== kind || found.expires < Date.now()) throw new Error('This was not started from Archipelago, or was started too long ago. Start again from the Workspace screen.');
    return found;
  }

  // ---- 1. creating the app ---------------------------------------------

  /** Where to send the server's owner to create the app: a page of ours that hands GitHub the manifest. */
  startCreate(workspace: string): string {
    if (this.kept.app) throw new Error(`This server already has its GitHub App (${this.kept.app.name}).`);
    return `${this.options.origin}/github/app/new?state=${this.begin('create', workspace)}`;
  }

  /** The page that hands GitHub the manifest: a form that sends itself. */
  createPage(state: string | null): string {
    if (!state || this.pending.get(state)?.kind !== 'create') throw new Error('This was not started from Archipelago. Start again from the Workspace screen.');
    const { origin } = this.options;
    const manifest = {
      name: `Archipelago (${new URL(origin).host})`.slice(0, 34),
      url: origin,
      description: 'Keeps an Archipelago map true to the repositories it is connected to: every push is read against the open work.',
      hook_attributes: { url: `${origin}/github/app/hook` },
      redirect_url: `${origin}/github/app/created`,
      setup_url: `${origin}/github/app/installed`,
      setup_on_update: true,
      // Only its owner's account can install it until they choose otherwise on GitHub.
      public: false,
      default_permissions: { contents: 'read', metadata: 'read' },
      default_events: ['push'],
    };
    const attr = (text: string) => text.replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;');
    return `<!doctype html><meta charset="utf-8"><title>Archipelago</title>
<body style="font: 15px system-ui; padding: 40px">
<p>Taking you to GitHub to create the app…</p>
<form method="post" action="${attr(`${this.web}/settings/apps/new?state=${state}`)}">
<input type="hidden" name="manifest" value="${attr(JSON.stringify(manifest))}">
<noscript><button>Continue to GitHub</button></noscript>
</form>
<script>document.forms[0].submit()</script>`;
  }

  /** GitHub has made the app and sent its owner back with a code: exchanged, once, for what the app is. */
  async created(code: string | null, state: string | null): Promise<void> {
    this.finish('create', state);
    if (!code) throw new Error('GitHub sent no code back.');
    const res = await fetch(`${this.api}/app-manifests/${encodeURIComponent(code)}/conversions`, { method: 'POST', headers: { accept: 'application/vnd.github+json' } });
    const made = (await res.json().catch(() => ({}))) as Partial<Credentials> & { message?: string };
    if (!res.ok || !made.id || !made.pem || !made.webhook_secret || !made.slug) throw new Error(`GitHub did not hand over the app (${res.status}${made.message ? `: ${made.message}` : ''}).`);
    this.kept.app = { id: made.id, slug: made.slug, name: made.name ?? made.slug, pem: made.pem, webhook_secret: made.webhook_secret };
    this.save();
  }

  /**
   * The app's owner can rename it on GitHub, and the address a workspace is sent to to connect follows its
   * name: GitHub is asked what the app is called now, and what is kept here is brought into line.
   */
  async refresh(): Promise<void> {
    const app = this.kept.app;
    if (!app) return;
    const now = (await this.asApp('/app')) as { slug?: string; name?: string };
    if (!now.slug || (now.slug === app.slug && (now.name ?? app.name) === app.name)) return;
    Object.assign(app, { slug: now.slug, name: now.name ?? now.slug });
    this.save();
  }

  // ---- 2. connecting a workspace ----------------------------------------

  /** Where to send a workspace's admin to choose repositories. */
  startConnect(workspace: string): string {
    if (!this.kept.app) throw new Error('This server has no GitHub App yet. Its owner creates one from the Workspace screen of the default workspace.');
    return `${this.web}/apps/${this.kept.app.slug}/installations/new?state=${this.begin('connect', workspace)}`;
  }

  /** They chose, and GitHub sent them back: the installation is this workspace's from now on. */
  async installed(installation: string | null, state: string | null): Promise<{ workspace: string; installation: string }> {
    const { workspace } = this.finish('connect', state);
    if (!installation || !/^\d+$/.test(installation)) throw new Error('GitHub sent no installation back.');
    const taken = this.kept.installations[installation];
    if (taken && taken.workspace !== workspace) throw new Error('That installation is already connected to another workspace.');
    // Asked of GitHub, as the app: the id in the address is only what the browser said.
    const about = (await this.asApp(`/app/installations/${installation}`)) as { account?: { login?: string } };
    this.kept.installations[installation] = { workspace, account: about.account?.login ?? '' };
    this.save();
    return { workspace, installation };
  }

  /** Forget an installation: removed on GitHub, or disconnected here. */
  forget(installation: string | number): void {
    delete this.kept.installations[String(installation)];
    this.tokens.delete(String(installation));
    this.save();
  }

  // ---- 3. what GitHub sends, and asking GitHub ---------------------------

  /** Whether a delivery was signed with the app's secret. */
  signed(body: Buffer, header: string | string[] | undefined): boolean {
    const secret = this.kept.app?.webhook_secret;
    if (!secret || typeof header !== 'string') return false;
    const expected = Buffer.from(`sha256=${createHmac('sha256', secret).update(body).digest('hex')}`);
    const given = Buffer.from(header);
    return given.length === expected.length && timingSafeEqual(given, expected);
  }

  /** The app's own word to GitHub: a short-lived statement signed with its key. */
  private jwt(): string {
    const app = this.kept.app;
    if (!app) throw new Error('This server has no GitHub App.');
    const now = Math.floor(Date.now() / 1000);
    const part = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url');
    const said = `${part({ alg: 'RS256', typ: 'JWT' })}.${part({ iat: now - 60, exp: now + 540, iss: String(app.id) })}`;
    return `${said}.${createSign('RSA-SHA256').update(said).sign(app.pem, 'base64url')}`;
  }

  private async ask(path: string, authorization: string, method = 'GET'): Promise<unknown> {
    const res = await fetch(path.startsWith('http') ? path : `${this.api}${path}`, { method, headers: { accept: 'application/vnd.github+json', authorization, 'x-github-api-version': '2022-11-28', 'user-agent': 'pelago' }, signal: AbortSignal.timeout(20_000) });
    const answer = (await res.json().catch(() => ({}))) as { message?: string };
    if (!res.ok) throw new Error(`GitHub answered ${res.status}${answer.message ? `: ${answer.message}` : ''} to ${method} ${path}`);
    return answer;
  }

  private asApp(path: string, method = 'GET'): Promise<unknown> {
    return this.ask(path, `Bearer ${this.jwt()}`, method);
  }

  /** Ask GitHub something as one installation: what it may read in the repositories chosen for it. */
  async asInstallation(installation: string, path: string): Promise<unknown> {
    let held = this.tokens.get(installation);
    if (!held || held.expires < Date.now() + 60_000) {
      const made = (await this.asApp(`/app/installations/${installation}/access_tokens`, 'POST')) as { token: string; expires_at: string };
      held = { token: made.token, expires: Date.parse(made.expires_at) };
      this.tokens.set(installation, held);
    }
    return this.ask(path, `Bearer ${held.token}`);
  }

  /** The repositories an installation was given, as "owner/name". */
  async repositories(installation: string): Promise<string[]> {
    const names: string[] = [];
    for (let page = 1; page <= 10; page++) {
      const answer = (await this.asInstallation(installation, `/installation/repositories?per_page=100&page=${page}`)) as { repositories?: { full_name: string }[] };
      names.push(...(answer.repositories ?? []).map((r) => r.full_name));
      if ((answer.repositories ?? []).length < 100) break;
    }
    return names;
  }
}

/**
 * Put the repositories an installation was given into the map: each that the
 * map does not know by its address is made, as a repository with that
 * address. One it knows already is left as it is. It follows from what the
 * workspace's admin chose on GitHub, so it is not held for review.
 */
export async function addRepositories(l: Archipelago, names: string[], account: string): Promise<{ added: string[]; known: string[] }> {
  const added: string[] = [];
  const known: string[] = [];
  for (const name of names) ((await repoByName(l, name.toLowerCase())) ? known : added).push(name);
  if (added.length)
    await l.apply(
      'agent:github',
      {
        ops: added.map((name) => ({ op: 'create' as const, type: 'software.repo', title: `${name.split('/')[1]} repo`, props: { remote: `https://github.com/${name}` } })),
        reason: `Connected through the GitHub App${account ? ` on ${account}` : ''}`,
      },
      { authority: { of: 'human', basis: 'Chosen on GitHub when the app was installed', stated_by: 'agent:github' } },
    );
  return { added, known };
}
