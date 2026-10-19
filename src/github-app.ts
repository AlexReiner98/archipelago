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
import { controlValue, GITHUB_APP, setControlValue } from './control.ts';
import type { Q } from './db.ts';
import { repoByName } from './github.ts';
import { env } from './env.ts';
import type { Archipelago } from './pelago.ts';
import { isSealed, seal, unseal } from './secrets.ts';
import { keep, kept, take } from './transient.ts';

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
}

export interface GithubAppOptions {
  /**
   * The database the app's credentials and its installations are kept in, the same for every server (src/control.ts).
   * None keeps them in this process (tests).
   */
  control?: () => Promise<Q>;
  /** The address this server is reached at, which GitHub is told to call and to send people back to. */
  origin: string;
  /** GitHub's API and site. Elsewhere only in tests. */
  api?: string;
  web?: string;
  /**
   * The whole database of a workspace, where what was begun here waits for GitHub to send its reader back: that may
   * be to another server than began it. None keeps it in this process (tests).
   */
  store?: (workspace: string) => Promise<Q | undefined>;
}

/** How long someone has to finish on GitHub what they started here. */
const PENDING_MINUTES = 15;

export class GithubApp {
  private readonly options: GithubAppOptions;
  private kept: Kept = { installations: {} };
  /** The app's credentials as last read, sealed, so they are opened again only when they change. */
  private sealed = '';
  private readonly pending = new Map<string, Pending & { expires: number }>();
  private readonly tokens = new Map<string, { token: string; expires: number }>();

  constructor(options: GithubAppOptions) {
    this.options = options;
  }

  /** What is kept, as it stands in the database now: another server may have created the app or connected a workspace. */
  private async fresh(): Promise<Kept> {
    const control = this.options.control && (await this.options.control());
    if (control) {
      const app = await controlValue<Credentials>(control, GITHUB_APP);
      const { rows } = await control.query<{ id: string; workspace: string; account: string }>(`select id, workspace, account from github_installation`);
      if (JSON.stringify(app ?? null) !== this.sealed) {
        this.sealed = JSON.stringify(app ?? null);
        this.kept.app = app && this.opened(app);
        // One brought from the file kept before secrets were sealed is sealed now.
        if (app && this.kept.app && (!isSealed(app.pem) || !isSealed(app.webhook_secret))) await this.saveApp();
      }
      this.kept.installations = Object.fromEntries(rows.map((r) => [r.id, { workspace: r.workspace, account: r.account }]));
    }
    // An app registered by hand comes in through the environment instead.
    const [id, pem, secret, slug] = ['ID', 'KEY', 'SECRET', 'SLUG'].map((name) => env(`GITHUB_APP_${name}`));
    if (!this.kept.app && id && pem && secret && slug) this.kept.app = { id: Number(id), slug, name: slug, pem: pem.replaceAll('\\n', '\n'), webhook_secret: secret };
    return this.kept;
  }

  /** The app's key and signing secret are sealed where they are kept; here they are open. */
  private opened(app: Credentials): Credentials | undefined {
    const [pem, webhook_secret] = [unseal(app.pem), unseal(app.webhook_secret)];
    if (pem && webhook_secret) return { ...app, pem, webhook_secret };
    console.error('The GitHub App\u2019s key cannot be opened with the sealing key this server has (PELAGO_SECRETS_KEY or secrets.key). The app has to be created again.');
    return undefined;
  }

  private async saveApp(): Promise<void> {
    const control = this.options.control && (await this.options.control());
    const app = this.kept.app;
    if (!control || !app) return;
    const sealed = { ...app, pem: seal(app.pem), webhook_secret: seal(app.webhook_secret) };
    await setControlValue(control, GITHUB_APP, sealed);
    this.sealed = JSON.stringify(sealed);
  }

  private get api(): string {
    return (this.options.api ?? 'https://api.github.com').replace(/\/$/, '');
  }

  private get web(): string {
    return (this.options.web ?? 'https://github.com').replace(/\/$/, '');
  }

  async app(): Promise<{ slug: string; name: string } | undefined> {
    const { app } = await this.fresh();
    return app && { slug: app.slug, name: app.name };
  }

  /** The installation a workspace connected, if it has. */
  async installationOf(workspace: string): Promise<{ id: string; account: string } | undefined> {
    const found = Object.entries((await this.fresh()).installations).find(([, i]) => i.workspace === workspace);
    return found && { id: found[0], account: found[1].account };
  }

  async workspaceOf(installation: string | number | undefined): Promise<string | undefined> {
    return installation === undefined ? undefined : (await this.fresh()).installations[String(installation)]?.workspace;
  }

  /**
   * A one-time word that ties what comes back from GitHub to what was started here. It begins with the workspace,
   * whose database keeps what it stands for.
   */
  private async begin(kind: Pending['kind'], workspace: string): Promise<string> {
    const state = `${workspace}.${randomBytes(24).toString('hex')}`;
    const db = await this.options.store?.(workspace);
    if (db) await keep(db, `github:${state}`, { kind, workspace } satisfies Pending, PENDING_MINUTES * 60_000);
    else {
      for (const [old, p] of this.pending) if (p.expires < Date.now()) this.pending.delete(old);
      this.pending.set(state, { kind, workspace, expires: Date.now() + PENDING_MINUTES * 60_000 });
    }
    return state;
  }

  /** What a state stands for, if it is one begun here and not run out; `once` takes it, so it cannot be used again. */
  private async pendingOf(state: string | null, once: boolean): Promise<Pending | undefined> {
    if (!state) return undefined;
    const db = this.options.store && (await this.options.store(state.split('.')[0]).catch(() => undefined));
    if (db) {
      return once ? (await take<Pending>(db, `github:${state}`))?.value : await kept<Pending>(db, `github:${state}`);
    }
    const found = this.pending.get(state);
    if (once) this.pending.delete(state);
    return found && found.expires >= Date.now() ? found : undefined;
  }

  private async finish(kind: Pending['kind'], state: string | null): Promise<Pending> {
    const found = await this.pendingOf(state, true);
    if (!found || found.kind !== kind) throw new Error('This was not started from Archipelago, or was started too long ago. Start again from the Workspace screen.');
    return found;
  }

  // ---- 1. creating the app ---------------------------------------------

  /** Where to send the server's owner to create the app: a page of ours that hands GitHub the manifest. */
  async startCreate(workspace: string): Promise<string> {
    const { app } = await this.fresh();
    if (app) throw new Error(`This server already has its GitHub App (${app.name}).`);
    return `${this.options.origin}/github/app/new?state=${await this.begin('create', workspace)}`;
  }

  /** The page that hands GitHub the manifest: a form that sends itself. */
  async createPage(state: string | null): Promise<string> {
    if (!state || (await this.pendingOf(state, false))?.kind !== 'create') throw new Error('This was not started from Archipelago. Start again from the Workspace screen.');
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
    await this.finish('create', state);
    if (!code) throw new Error('GitHub sent no code back.');
    const res = await fetch(`${this.api}/app-manifests/${encodeURIComponent(code)}/conversions`, { method: 'POST', headers: { accept: 'application/vnd.github+json' } });
    const made = (await res.json().catch(() => ({}))) as Partial<Credentials> & { message?: string };
    if (!res.ok || !made.id || !made.pem || !made.webhook_secret || !made.slug) throw new Error(`GitHub did not hand over the app (${res.status}${made.message ? `: ${made.message}` : ''}).`);
    this.kept.app = { id: made.id, slug: made.slug, name: made.name ?? made.slug, pem: made.pem, webhook_secret: made.webhook_secret };
    await this.saveApp();
  }

  /**
   * The app's owner can rename it on GitHub, and the address a workspace is sent to to connect follows its
   * name: GitHub is asked what the app is called now, and what is kept here is brought into line.
   */
  async refresh(): Promise<void> {
    const { app } = await this.fresh();
    if (!app) return;
    const now = (await this.asApp('/app')) as { slug?: string; name?: string };
    if (!now.slug || (now.slug === app.slug && (now.name ?? app.name) === app.name)) return;
    Object.assign(app, { slug: now.slug, name: now.name ?? now.slug });
    await this.saveApp();
  }

  // ---- 2. connecting a workspace ----------------------------------------

  /** Where to send a workspace's admin to choose repositories. */
  async startConnect(workspace: string): Promise<string> {
    const { app } = await this.fresh();
    if (!app) throw new Error('This server has no GitHub App yet. Its owner creates one from the Workspace screen of the default workspace.');
    return `${this.web}/apps/${app.slug}/installations/new?state=${await this.begin('connect', workspace)}`;
  }

  /** They chose, and GitHub sent them back: the installation is this workspace's from now on. */
  async installed(installation: string | null, state: string | null): Promise<{ workspace: string; installation: string }> {
    const { workspace } = await this.finish('connect', state);
    if (!installation || !/^\d+$/.test(installation)) throw new Error('GitHub sent no installation back.');
    const taken = (await this.fresh()).installations[installation];
    const elsewhere = new Error('That installation is already connected to another workspace.');
    if (taken && taken.workspace !== workspace) throw elsewhere;
    // Asked of GitHub, as the app: the id in the address is only what the browser said.
    const about = (await this.asApp(`/app/installations/${installation}`)) as { account?: { login?: string } };
    const account = about.account?.login ?? '';
    const control = this.options.control && (await this.options.control());
    if (control) {
      // Another server may have tied it to another workspace meanwhile: the first to write it has it.
      const { rows } = await control.query(
        `insert into github_installation (id, workspace, account) values ($1, $2, $3)
         on conflict (id) do update set account = excluded.account where github_installation.workspace = excluded.workspace returning id`,
        [installation, workspace, account],
      );
      if (!rows.length) throw elsewhere;
    }
    this.kept.installations[installation] = { workspace, account };
    return { workspace, installation };
  }

  /** Forget an installation: removed on GitHub, or disconnected here. */
  async forget(installation: string | number): Promise<void> {
    delete this.kept.installations[String(installation)];
    this.tokens.delete(String(installation));
    const control = this.options.control && (await this.options.control());
    if (control) await control.query(`delete from github_installation where id = $1`, [String(installation)]);
  }

  // ---- 3. what GitHub sends, and asking GitHub ---------------------------

  /** Whether a delivery was signed with the app's secret. */
  async signed(body: Buffer, header: string | string[] | undefined): Promise<boolean> {
    const secret = (await this.fresh()).app?.webhook_secret;
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

  private async asApp(path: string, method = 'GET'): Promise<unknown> {
    await this.fresh();
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
