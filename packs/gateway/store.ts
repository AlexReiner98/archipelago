/**
 * What the gateway keeps, in one SQLite database (Node's built-in
 * `node:sqlite`) in the ignored data folder: the owner's passphrase as an
 * scrypt hash, the failed sign-ins, the clients that registered, and the
 * grants with their codes and tokens. A code or token is kept only as its
 * SHA-256: what is at rest can't be replayed.
 */
import { createHash, randomBytes, scrypt, scryptSync, timingSafeEqual } from "node:crypto";
import { DatabaseSync, type StatementSync } from "node:sqlite";

const SCHEMA = `
CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS clients (id TEXT PRIMARY KEY, name TEXT NOT NULL, redirects TEXT NOT NULL, created INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS codes (
  hash TEXT PRIMARY KEY, client TEXT NOT NULL, redirect TEXT NOT NULL, challenge TEXT NOT NULL,
  scope TEXT NOT NULL, expires INTEGER NOT NULL, used INTEGER NOT NULL DEFAULT 0, grant_id TEXT
);
CREATE TABLE IF NOT EXISTS grants (
  id TEXT PRIMARY KEY, client TEXT NOT NULL, scope TEXT NOT NULL,
  created INTEGER NOT NULL, used INTEGER NOT NULL, revoked INTEGER
);
CREATE TABLE IF NOT EXISTS tokens (
  hash TEXT PRIMARY KEY, grant_id TEXT NOT NULL, kind TEXT NOT NULL,
  expires INTEGER NOT NULL, used INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS tokens_grant ON tokens (grant_id);
`;
const LAYOUT = "1";

/** scrypt's cost: N = 2^15, r = 8 (32 MiB), about 0.1 s a try. */
const COST = { N: 1 << 15, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };

export interface PassphraseHash {
  salt: string;
  hash: string;
  N: number;
  r: number;
  p: number;
}

export const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");
export const secret = () => randomBytes(32).toString("base64url");

/** The passphrase's hash, for the data folder. Never the passphrase itself. */
export function hashPassphrase(passphrase: string): PassphraseHash {
  const salt = randomBytes(16);
  const hash = scryptSync(passphrase.normalize("NFC"), salt, 32, COST);
  return { salt: salt.toString("base64"), hash: hash.toString("base64"), N: COST.N, r: COST.r, p: COST.p };
}

/** Whether `passphrase` is the one hashed, compared in constant time. */
export function checkPassphrase(passphrase: string, h: PassphraseHash): Promise<boolean> {
  const want = Buffer.from(h.hash, "base64");
  return new Promise((ok) =>
    scrypt(passphrase.normalize("NFC"), Buffer.from(h.salt, "base64"), want.length, { N: h.N, r: h.r, p: h.p, maxmem: COST.maxmem }, (err, got) =>
      ok(!err && got.length === want.length && timingSafeEqual(got, want)),
    ),
  );
}

export interface Client {
  id: string;
  name: string;
  redirects: string[];
  created: number;
}

export interface Grant {
  id: string;
  client: string;
  scope: string;
  created: number;
  used: number;
  revoked?: number;
}

export interface Code {
  client: string;
  redirect: string;
  challenge: string;
  scope: string;
  expires: number;
  used: boolean;
  grant?: string;
}

export interface Token {
  grant: string;
  kind: "access" | "refresh";
  expires: number;
  used: boolean;
}

export interface Failures {
  count: number;
  /** Locked until this time (ms), when set. */
  until?: number;
}

export class GatewayStore {
  readonly db: DatabaseSync;
  private readonly q: Record<string, StatementSync>;

  constructor(file: string = ":memory:") {
    this.db = new DatabaseSync(file);
    if (file !== ":memory:") this.db.exec("PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL;");
    this.db.exec("PRAGMA busy_timeout = 5000;");
    this.db.exec(SCHEMA);
    const layout = this.db.prepare("SELECT value FROM meta WHERE key = 'layout'").get() as { value: string } | undefined;
    if (!layout) this.db.prepare("INSERT INTO meta (key, value) VALUES ('layout', ?)").run(LAYOUT);
    else if (layout.value !== LAYOUT) throw new Error(`gateway ${file} has layout ${layout.value}; this pack reads ${LAYOUT}`);
    const p = (sql: string) => this.db.prepare(sql);
    this.q = {
      meta: p("SELECT value FROM meta WHERE key = ?"),
      setMeta: p("INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value"),
      client: p("SELECT * FROM clients WHERE id = ?"),
      addClient: p("INSERT INTO clients (id, name, redirects, created) VALUES (?, ?, ?, ?)"),
      clients: p("SELECT COUNT(*) AS n FROM clients"),
      pruneClients: p("DELETE FROM clients WHERE created < ? AND id NOT IN (SELECT client FROM grants WHERE revoked IS NULL)"),
      code: p("SELECT * FROM codes WHERE hash = ?"),
      addCode: p("INSERT INTO codes (hash, client, redirect, challenge, scope, expires) VALUES (?, ?, ?, ?, ?, ?)"),
      useCode: p("UPDATE codes SET used = 1, grant_id = ? WHERE hash = ?"),
      pruneCodes: p("DELETE FROM codes WHERE expires < ?"),
      grant: p("SELECT * FROM grants WHERE id = ?"),
      addGrant: p("INSERT INTO grants (id, client, scope, created, used) VALUES (?, ?, ?, ?, ?)"),
      touch: p("UPDATE grants SET used = ? WHERE id = ?"),
      revoke: p("UPDATE grants SET revoked = ? WHERE id = ? AND revoked IS NULL"),
      revokeAll: p("UPDATE grants SET revoked = ? WHERE revoked IS NULL"),
      dropTokens: p("DELETE FROM tokens WHERE grant_id = ?"),
      dropAllTokens: p("DELETE FROM tokens"),
      grants: p("SELECT * FROM grants WHERE (? IS NULL OR id < ?) ORDER BY id DESC LIMIT ?"),
      refreshEnd: p("SELECT MAX(expires) AS e FROM tokens WHERE grant_id = ? AND kind = 'refresh' AND used = 0"),
      token: p("SELECT * FROM tokens WHERE hash = ?"),
      addToken: p("INSERT INTO tokens (hash, grant_id, kind, expires) VALUES (?, ?, ?, ?)"),
      useToken: p("UPDATE tokens SET used = 1 WHERE hash = ?"),
      pruneTokens: p("DELETE FROM tokens WHERE expires < ?"),
    };
  }

  close(): void {
    if (this.db.isOpen) this.db.close();
  }

  private meta<T>(key: string): T | undefined {
    const row = this.q.meta!.get(key) as { value: string } | undefined;
    return row ? (JSON.parse(row.value) as T) : undefined;
  }

  passphrase(): PassphraseHash | undefined {
    return this.meta<PassphraseHash>("passphrase");
  }
  setPassphrase(h: PassphraseHash): void {
    this.q.setMeta!.run("passphrase", JSON.stringify(h));
  }
  failures(): Failures {
    return this.meta<Failures>("failures") ?? { count: 0 };
  }
  setFailures(f: Failures): void {
    this.q.setMeta!.run("failures", JSON.stringify(f));
  }

  client(id: string): Client | undefined {
    const r = this.q.client!.get(id) as { id: string; name: string; redirects: string; created: number } | undefined;
    return r ? { id: r.id, name: r.name, redirects: JSON.parse(r.redirects), created: r.created } : undefined;
  }
  /** Registers a client, after dropping unused ones older than `stale`; undefined when `max` are kept. */
  addClient(name: string, redirects: string[], now: number, max: number, stale: number): Client | undefined {
    this.q.pruneClients!.run(now - stale);
    if ((this.q.clients!.get() as { n: number }).n >= max) return undefined;
    const c: Client = { id: `c_${randomBytes(16).toString("base64url")}`, name, redirects, created: now };
    this.q.addClient!.run(c.id, c.name, JSON.stringify(c.redirects), c.created);
    return c;
  }

  /** A new code for the owner's consent; its secret is returned once, its hash kept. */
  addCode(c: Omit<Code, "used" | "grant">, now: number): string {
    this.q.pruneCodes!.run(now - 24 * 3600_000);
    const code = secret();
    this.q.addCode!.run(sha256(code), c.client, c.redirect, c.challenge, c.scope, c.expires);
    return code;
  }
  code(code: string): Code | undefined {
    const r = this.q.code!.get(sha256(code)) as { client: string; redirect: string; challenge: string; scope: string; expires: number; used: number; grant_id: string | null } | undefined;
    return r ? { client: r.client, redirect: r.redirect, challenge: r.challenge, scope: r.scope, expires: r.expires, used: !!r.used, ...(r.grant_id ? { grant: r.grant_id } : {}) } : undefined;
  }
  /** Marks a code spent, with the grant it became, if any. */
  useCode(code: string, grant?: string): void {
    this.q.useCode!.run(grant ?? null, sha256(code));
  }

  addGrant(client: string, scope: string, now: number): Grant {
    const g: Grant = { id: `g_${now.toString(36).padStart(9, "0")}_${randomBytes(6).toString("base64url")}`, client, scope, created: now, used: now };
    this.q.addGrant!.run(g.id, g.client, g.scope, g.created, g.used);
    return g;
  }
  grant(id: string): Grant | undefined {
    const r = this.q.grant!.get(id) as { id: string; client: string; scope: string; created: number; used: number; revoked: number | null } | undefined;
    return r ? { id: r.id, client: r.client, scope: r.scope, created: r.created, used: r.used, ...(r.revoked ? { revoked: r.revoked } : {}) } : undefined;
  }
  touch(id: string, now: number): void {
    this.q.touch!.run(now, id);
  }
  /** Revokes a grant, or every grant, and drops their tokens. How many were revoked. */
  revoke(id: string | undefined, now: number): number {
    if (id === undefined) {
      const n = Number(this.q.revokeAll!.run(now).changes);
      this.q.dropAllTokens!.run();
      return n;
    }
    const n = Number(this.q.revoke!.run(now, id).changes);
    this.q.dropTokens!.run(id);
    return n;
  }
  /** Grants, newest first, a page at a time. */
  grants(limit: number, after?: string): { items: (Grant & { until?: number })[]; next?: string } {
    const rows = this.q.grants!.all(after ?? null, after ?? null, limit + 1) as { id: string }[];
    const items = rows.slice(0, limit).map((r) => {
      const g = this.grant(r.id)!;
      const e = (this.q.refreshEnd!.get(g.id) as { e: number | null }).e;
      return { ...g, ...(e && !g.revoked ? { until: e } : {}) };
    });
    return { items, ...(rows.length > limit ? { next: items[items.length - 1]!.id } : {}) };
  }

  /** A new token of the grant; its secret is returned once, its hash kept. */
  addToken(grant: string, kind: Token["kind"], expires: number): string {
    const t = secret();
    this.q.addToken!.run(sha256(t), grant, kind, expires);
    return t;
  }
  token(t: string): Token | undefined {
    const r = this.q.token!.get(sha256(t)) as { grant_id: string; kind: Token["kind"]; expires: number; used: number } | undefined;
    return r ? { grant: r.grant_id, kind: r.kind, expires: r.expires, used: !!r.used } : undefined;
  }
  useToken(t: string): void {
    this.q.useToken!.run(sha256(t));
  }
  /** Drops tokens expired a day ago. A spent refresh token stays until then, so its reuse is still seen. */
  prune(now: number): void {
    this.q.pruneTokens!.run(now - 24 * 3600_000);
  }
}
