// The map and its single write path. Every change to items and links goes through change(): it is validated, judged
// by the rules (src/rules.ts), then either applied or stored as a proposal for a human, and always logged.

import { agentChanges, beginApplying, decide, DEFAULT_AGENT_POLICY, type Policy } from './rules.ts'; import { renamedQuery } from './query-names.ts';
import { mayWrite } from './within.ts'; import { roomToStore, stillWritable } from './standing.ts'; import { authorityOf } from './authority.ts';
import { anyone, newId, reader, scoped, type Db, type Q } from './db.ts';
import { once } from './merge.ts'; import { readEvents, type EventQuery } from './eventlog.ts'; import { doneFact, type Done } from './activity.ts';
import type { Registry } from './packs.ts'; import { currentNames } from './type-items.ts'; import { noTwins } from './view-twins.ts';
import { isSealed, seal, unseal } from './secrets.ts';
import { KEPT_FIELDS } from './operational.ts'; import { operationalFacts, record, type OpFact, type OpStream } from './streams.ts';
import { search, type SearchInput } from './search.ts'; import { layoutOf } from './layout-changes.ts';
import { append, headOf, type Fact } from './log.ts'; import { projectDecision, projectFacts, stamp } from './replay.ts'; import { linkFacts } from './facts.ts';
import { decideProposal } from './proposals.ts'; import { guardedFetch } from './outbound.ts'; import { needHuman } from './actor-checks.ts';
import { ACTIVE_HOLDS, actorId, type Actor, type Authority, type ChangeInput, type Entity, type Op, type Proposal } from './pelago-types.ts';
import { planChange } from './change-plan.ts'; import { placeOnIslands } from './island-items.ts'; import { placeWithSubject } from './subject.ts'; import { applyChange, letThrough } from './change-apply.ts';

export * from './pelago-types.ts';
export type { Level, OpKind, Policy } from './rules.ts';
export { DEFAULT_AGENT_POLICY } from './rules.ts';

type Props = Record<string, unknown>;

export { BLOCKING_RELATIONS } from './private-deps.ts';

export class Archipelago {
  readonly db: Db;
  readonly registry: Registry;
  readonly policy: Policy;
  /** The workspace this map belongs to. Each has its own database. */
  readonly workspace: string;
  /**
   * The person whose view this is. Undefined means unscoped: the whole map,
   * as one person on one machine or the system itself sees it.
   */
  readonly viewer: string | undefined;

  /**
   * An item's fields as this view may select them from entity. Anyone with
   * no login may not read the column: the database gives them the few fields
   * the public page shows.
   */
  readonly props: string;

  /** The share a guest reads under (src/guests.ts): set only on a guest's map, which reads and never writes. */
  readonly reads?: string;

  constructor(db: Db, registry: Registry, policy: Partial<Policy> = {}, workspace = 'default', viewer?: string, props = 'props') {
    this.db = db;
    this.registry = registry;
    this.policy = { ...DEFAULT_AGENT_POLICY, ...policy };
    this.workspace = workspace;
    this.viewer = viewer;
    this.props = props;
  }

  /** This map as anyone sees it with no login: only what is public. Ask it of the whole map, not of one person's view. */
  forAnyone(): Archipelago {
    return new Archipelago(anyone(this.db), this.registry, this.policy, this.workspace, '', 'pelago_public_props(id) as props');
  }

  /** This map as one person sees it. An empty viewer sees only what is shared; an admin also sees every token and setting. */
  as(viewer: string, admin = false): Archipelago {
    return new Archipelago(scoped(this.db, viewer, admin), this.registry, this.policy, this.workspace, viewer);
  }

  /** This map as a guest reads it: only the view of the share they were given, as it is now, and only reading. */
  asReader(share: string, guest: string): Archipelago {
    return Object.assign(new Archipelago(reader(this.db, share, guest), this.registry, this.policy, this.workspace, guest), { reads: share });
  }

  /** Whether new things are private to their author unless they say otherwise. */
  async defaultVisibility(q: Q = this.db): Promise<'private' | 'shared'> {
    const { rows } = await q.query<{ value: string }>(`select value from setting where key = 'default_visibility'`);
    return rows[0]?.value === 'shared' ? 'shared' : 'private';
  }

  /**
   * What becomes of an agent's change in this workspace: applied as it is
   * made, with the log and undo as the record ("apply"), or held until a
   * human has looked ("hold"). The workspace's setting; without one, what the
   * server's policy comes to. Only the workspace's own "apply" lets an agent
   * settle a decision or a hypothesis.
   */
  async agentChanges(): Promise<'apply' | 'hold'> {
    return agentChanges(this.db, this.policy);
  }

  // ---- writes ----------------------------------------------------------

  /** measured: a report's reading (a part up or down), applied at once as a measurement, not anyone's judgment. */
  async change(actor: Actor, input: ChangeInput, measured = false) {
    if (!input.reason?.trim()) throw new Error('Every change needs a reason.');
    currentNames(this.registry, input.ops); await placeWithSubject(this, this.registry, input.ops); await placeOnIslands(this, this.registry, input.ops, input.island); await stillWritable(this.workspace); await roomToStore(this.workspace); await mayWrite(this, actor, input.ops, measured);
    if (actor.kind !== 'human' && !input.pack) await noTwins(this, input.ops);
    const { warnings } = await this.plan(input.ops);
    const me = actorId(actor);
    const claimed = input.authority;
    const authority = authorityOf(actor.kind === 'human', me, claimed);
    // Whether it applies, waits or is refused is the rules' to say (src/rules.ts), and the answer names the rule.
    const who = { human: actor.kind === 'human', reading: measured, may: actor.may, asked: input.hold, said: Boolean(claimed), ownerSaid: claimed?.of === 'human' && Boolean(claimed.basis?.trim()), pack: input.pack, ...(await layoutOf(this, actor, input)) };
    const verdict = await decide(this.db, this.registry, who, input.ops, this.policy);
    if (verdict.outcome === 'refuse') throw new Error(`Change rejected:\n${verdict.refused.map((r) => `- ${r}`).join('\n')}`);
    // A question an agent settled, where the owner lets it, is put to them by the next session they talk to.
    const answered: { id: string; title: string; status: string; outcome?: string; authority: Authority }[] = [];
    if (actor.kind !== 'human' && verdict.outcome === 'apply') {
      const questions = new Set(this.registry.having('settles'));
      for (const op of input.ops) {
        if (op.op !== 'update' || !op.status) continue;
        const e = await this.entity(op.id);
        if (!e || !questions.has(e.type) || !e.is_open || !this.registry.type(e.type)?.statuses.closed.includes(op.status)) continue;
        answered.push({ id: e.id, title: e.title, status: op.status, outcome: { ...e.props, ...op.props }.outcome as string | undefined, authority });
      }
    }

    const by = { id: me, ...(actor.token && { token: actor.token }) };
    if (verdict.outcome === 'hold') {
      const id = newId('p');
      // What it would do on the map as it is now, with the ids it would make: approved with nothing moved, it appends these facts.
      const { facts = [], ids = {}, created: would = {} } = await this.apply(me, input, { authority, dry: true });
      const base = (await headOf(this.db)).pos, rule = verdict.by && { rule: verdict.by.rule, pack: verdict.by.pack, say: verdict.by.say };
      // The queue is a projection of the pending stream: the record makes its row (src/replay.ts).
      await this.db.transaction(async (tx) =>
        projectDecision(tx, await append(tx, this.workspace, 'pending', { id, actor: by, authority, held_by: rule ?? null, reason: input.reason, source: input.source ?? null, action: input.action ?? null, undoes: input.undoes ?? null, ...(input.run && { run: input.run }), base, ops: input.ops, warnings, ids, private_to: this.viewer || null }, facts)),
      );
      return {
        status: 'proposed' as const,
        proposal: id,
        held_by: verdict.by,
        warnings, would_make: would,
        note: 'Nothing has changed yet: this waits for a person. would_make names what it makes once approved. Those ids do not exist until then, so send what builds on them in this same change, or carry on with other work.',
      };
    }
    const spared = [...new Map(verdict.spared.flat().map((r) => [`${r.pack}.${r.rule}`, { rule: r.rule, pack: r.pack }])).values()];
    const applied = { ...(await this.apply(me, input, { authority, token: actor.token, rule: { outcome: 'apply', spared } })), ...letThrough(verdict.spared) };
    return answered.length ? { ...applied, answered } : applied;
  }

  /** `ops`, when given, replaces the proposed ops: the reviewer's corrected version. One at a time: a second click while one applies is refused, not applied again. */
  decide(actor: Actor, input: Parameters<typeof decideProposal>[2]) { return once(input.proposal, () => decideProposal(this, actor, input)); }

  /** Validate ops against the schema and the current map (src/change-plan.ts). Throws listing every problem. */
  plan(ops: Op[]): Promise<{ warnings: string[] }> { return planChange(this, ops); }

  /** Apply a change without consulting policy (src/change-apply.ts): for human changes, approved proposals, and the system's own bookkeeping. */
  apply(actor: string, input: ChangeInput, opts?: Parameters<typeof applyChange>[3]) { return applyChange(this, actor, input, opts); }

  /** A change set the system appends in a migration (a pack moves a type or a kind, places move to their stream): what moved, and nothing else. */
  async moved(tx: Q, action: string, reason: string, facts: Fact[]) {
    await projectFacts(tx, this.registry, await stamp(tx), facts, true);
    await append(tx, this.workspace, 'facts', { id: newId('c'), actor: { id: 'system' }, authority: null, rule: { outcome: 'apply', spared: [] }, reason, source: null, action, undoes: null, keys: [] }, facts);
  }

  /** Each item's kind column, its type's starter (the last of its lineage in the type table), where the row lacks it or has another (src/head.ts): when a workspace opens. */
  fillKinds = async () => (await this.db.query(`update entity e set kind = t.def->'lineage'->>-1 from type_def t where t.id = e.type and t.def ? 'lineage' and e.kind is distinct from t.def->'lineage'->>-1 returning e.id`)).rows.length;

  /**
   * Move every item of a type (or link of a relation) no pack defines any more to the one that took it over
   * (moved_from): a one-time migration as a pack takes it out of another, logged as one event. All else stays. The
   * screens (on) and the views kept on the map (their lens) that name the old one name the new one. An item whose
   * status the new type names otherwise takes its status there (statuses: the old status to the new one).
   */
  async retype(from: string, to: string, what: 'entity' | 'relation' = 'entity', statuses: Record<string, string> = {}): Promise<number> {
    return this.db.transaction(async (tx) => {
      const { rows } = await tx.query<{ id: string; status?: string; from_id?: string; to_id?: string }>(
        what === 'entity' ? `select id, status from entity where type = $1 -- index entity_type` : `select id, from_id, to_id from relation where type = $1`,
        [from],
      );
      // What names it in its settings: a screen in on, a view kept on the map in its lens (src/query-names.ts).
      const { rows: held } = await tx.query<{ id: string; type: string; props: Props }>(`select id, type, props from entity where type = any($1::text[]) -- index entity_type`, [[...this.registry.family('screen'), ...this.registry.family('lens')]]);
      const on = (p: Props) => (what === 'entity' && Array.isArray(p.on) && p.on.includes(from) ? { on: p.on.map((t) => (t === from ? to : t)) } : {});
      const named = held.map((r) => ({ id: r.id, props: this.registry.isA(r.type, 'lens') ? renamedQuery(r.props, from, to, what) : on(r.props) })).filter((r) => Object.keys(r.props).length);
      const reason = `Every ${from} is a ${to} now: its pack took the ${what === 'entity' ? 'type' : 'relation'} over.`;
      const facts = rows.flatMap((r): Fact[] => (what === 'entity' ? [['+', r.id, 'type', to], ...(r.status && statuses[r.status] ? [['+', r.id, 'status', statuses[r.status]] as Fact] : [])] : [['+', r.id, 'link', [to, r.from_id, r.to_id]]]));
      for (const r of named) for (const [k, v] of Object.entries(r.props)) facts.push(['+', r.id, k, v]);
      if (facts.length) await this.moved(tx, 'type.moved', reason, facts);
      return rows.length;
    });
  }

  /**
   * Something done that is no change to the map and is kept in no other stream (a push heard, a pack turned on), in
   * the activity stream (src/activity.ts), in the transaction given. An entry about an item is as visible as the item.
   */
  /** Record what was done; answers its seq, the number readers of events know it by. */
  async log(q: Q, e: Done): Promise<number | undefined> {
    return (await this.record('activity', e.actor, [doneFact(e)], e.reason || undefined, q === this.db ? undefined : q))[0]?.seq;
  }

  // ---- operational state (src/operational.ts) ------------------------------
  // These take effect at once for agents too and are never held: coordination that waits for approval is no coordination.

  /**
   * The one write to an item that skips change: bookkeeping no one states as a fact (a session's heartbeat, an
   * automation's last firing), and who may read a notification. Only the fields src/operational.ts names; out of the
   * item's history, so it does not look newly confirmed. The event's actor and reason, when given, go with its stream's entry.
   */
  async operational(id: string, set: { props?: Props; unset?: string[]; add?: Record<string, number>; reach?: { private_to: string | null; visibility?: 'shared' } }, event?: { actor: string; action: string; reason?: string; detail?: Props }) {
    const named = [...Object.keys(set.props ?? {}), ...(set.unset ?? []), ...Object.keys(set.add ?? {})].filter((k) => !KEPT_FIELDS.includes(k));
    if (named.length) throw new Error(`${named.join(', ')} is a fact about the item: change it through change`);
    const { rows } = await this.db.query<{ props: Props; visibility: string; private_to: string | null }>(
      `update entity set props = ((props || $2::jsonb) - $3::text[]) || coalesce((select jsonb_object_agg(k, coalesce((props->>k)::numeric, 0) + v::numeric) from jsonb_each_text($4::jsonb) a(k, v)), '{}'),
         visibility = coalesce($5, visibility), private_to = case when $6 then $7 else private_to end where id = $1 returning props, visibility, private_to`,
      [id, JSON.stringify(set.props ?? {}), set.unset ?? [], JSON.stringify(set.add ?? {}), set.reach?.visibility ?? null, Boolean(set.reach), set.reach?.private_to ?? null],
    );
    for (const [stream, facts] of rows[0] ? operationalFacts(id, set, rows[0]) : []) await this.record(stream, event?.actor ?? 'system', facts, event?.reason);
  }

  /** Append to a compacted stream at once (src/streams.ts), kept by the retention rules the packs declare. */
  record(stream: OpStream, actor: string, facts: OpFact[], reason?: string, tx?: Q) {
    return tx ? record(tx, this.workspace, stream, actor, facts, { rules: this.registry.rules, reason }) : this.db.transaction((t) => record(t, this.workspace, stream, actor, facts, { rules: this.registry.rules, reason }));
  }

  async claim(actor: Actor, input: { resource: string; holder: string; for?: string; reason: string }) {
    return this.db.transaction(async (tx) => {
      await tx.query(`select pelago_hold_lock($1)`, [input.resource]); // one claim of it at a time (src/db.ts): what is held is read after
      const resource = await this.entity(input.resource, tx);
      if (!resource || !this.registry.capacity(resource)) throw new Error(`"${input.resource}" is not a resource: nothing of its type can be held`);
      const holder = await this.entity(input.holder, tx);
      if (!holder) throw new Error(`No item "${input.holder}" to hold it`);
      if (input.for && !(await this.entity(input.for, tx))) throw new Error(`No item "${input.for}"`);
      if (resource.status !== 'available') throw new Error(`"${resource.title}" is ${resource.status}`);

      const { rows: held } = await tx.query<{ id: string; from_id: string; valid_from: Date; title: string }>(
        `select h.id, h.from_id, h.valid_from, h.holder_title as title from ${ACTIVE_HOLDS} h where h.to_id = $1`,
        [resource.id],
      );
      const mine = held.find((h) => h.from_id === holder.id);
      if (mine) return { status: 'already_held' as const, relation: mine.id };
      if (held.length >= this.registry.capacity(resource)!) {
        const h = held[0];
        throw new Error(`"${resource.title}" is held by "${h.title}" (${h.from_id}) since ${h.valid_from.toISOString()}. It must be released first.`);
      }
      const id = newId('r');
      await tx.query(`insert into relation (id, type, from_id, to_id, props) values ($1, 'holds', $2, $3, $4::jsonb)`, [id, holder.id, resource.id, JSON.stringify(input.for ? { for: input.for } : {})]);
      await this.record('claims', actorId(actor), linkFacts({ id, type: 'holds', from_id: holder.id, to_id: resource.id, props: input.for ? { for: input.for } : {}, confidence: 1 }) as OpFact[], input.reason, tx);
      return { status: 'claimed' as const, relation: id };
    });
  }

  async release(actor: Actor, input: { resource: string; holder?: string; reason: string }) {
    const { rows } = await this.db.query<{ id: string; from_id: string }>(
      `update relation set valid_to = now() where type = 'holds' and to_id = $1 and valid_to is null and ($2::text is null or from_id = $2) returning id, from_id`,
      [input.resource, input.holder ?? null],
    );
    await this.record('claims', actorId(actor), rows.map((r): OpFact => ['-', r.id, 'link']), input.reason);
    return { released: rows.length };
  }

  /** Ping every connection's URL and record whether it is reachable. */
  async checkConnections(actor: Actor) {
    const { rows } = await this.db.query<Entity>(`select * from entity where type = any($1::text[]) and archived_at is null and is_open`, [this.registry.family('connection')]);
    const out = [];
    for (const conn of rows) {
      const url = conn.props.url as string | undefined;
      if (!url) continue;
      // Any HTTP answer, even an error status, means something is listening; asked through the guard (src/outbound.ts).
      const reachable = await guardedFetch(url, { signal: AbortSignal.timeout(2000) }).then(() => true, () => false);
      const status = reachable ? 'available' : 'unavailable';
      await this.record('observations', actorId(actor), [['+', conn.id, 'status', status]]);
      if (status !== conn.status) {
        await this.db.query(`update entity set status = $2, updated_at = now() where id = $1`, [conn.id, status]);
        await this.log(this.db, { actor: actorId(actor), action: 'connection.check', target: conn.id, reason: 'Reachability changed', detail: { title: conn.title, from: conn.status, to: status } });
      }
      out.push({ id: conn.id, title: conn.title, url, status });
    }
    return out;
  }

  // ---- settings --------------------------------------------------------

  async setting<T>(key: string): Promise<T | undefined> {
    const { rows } = await this.db.query<{ value: T }>(`select value from setting where key = $1`, [key]);
    const value = rows[0]?.value;
    // The owner is a person: one merged into another is that other, so what waits on the owner still finds them.
    return key === 'me' && typeof value === 'string' ? ((await this.mergedInto(value)) as T) : value;
  }

  /** The item an id now is: itself, or the item it was merged into (a few merges deep at most). */
  private async mergedInto(id: string): Promise<string> {
    for (let hop = 0; hop < 5; hop++) {
      const { rows } = await this.db.query<{ into: string }>(
        `select f.value #>> '{}' as into from log_fact f join entity e on e.id = f.id and e.archived_at is not null
         where f.stream = 'facts' and f.id = $1 and f.field = 'merged_into' order by f.pos desc limit 1 -- index log_fact_history`,
        [id],
      );
      if (!rows.length) return id;
      id = rows[0].into;
    }
    return id;
  }

  /**
   * A setting that is a secret the server has to use (a key, a signing
   * secret): stored sealed, so the database and its backups do not hold it.
   * One stored before secrets were sealed is sealed the first time it is
   * read. One that cannot be opened here reads as not set.
   */
  async secret(key: string): Promise<string | undefined> {
    const stored = await this.setting<string>(key);
    if (typeof stored !== 'string' || !stored) return undefined;
    if (!isSealed(stored)) await this.setSecret(key, stored);
    return unseal(stored);
  }

  async setSecret(key: string, value: string | undefined): Promise<void> {
    if (!value) await this.db.query(`delete from setting where key = $1`, [key]);
    else await this.db.query(`insert into setting (key, value) values ($1, $2::jsonb) on conflict (key) do update set value = excluded.value`, [key, JSON.stringify(seal(value))]);
    await this.record('settings', 'system', [value ? ['+', 'secret', key, true] : ['-', 'secret', key]]); // the name only: the value is the vault's
  }

  /** Create (or find) the person this workspace belongs to and make them the default for views. */
  async init(actor: Actor, input: { name: string; email?: string }) {
    needHuman(actor, 'Only a human can set the workspace owner.');
    const found = await this.db.query<{ id: string }>(`select id from entity where type = 'person' and lower(title) = lower($1) and archived_at is null -- index entity_type_title`, [input.name]);
    let id = found.rows[0]?.id;
    if (!id) id = (await this.apply(actorId(actor), { ops: [{ op: 'create', ref: 'me', type: 'person', title: input.name, props: input.email ? { email: input.email } : {} }], reason: 'Workspace owner' })).created.me;
    const begun = (await this.setting('me')) === undefined ? await beginApplying(this.db) : [];
    await this.db.query(`insert into setting (key, value) values ('me', $1::jsonb) on conflict (key) do update set value = excluded.value`, [JSON.stringify(id)]);
    await this.record('settings', actorId(actor), [['+', 'setting', 'me', id], ...begun]);
    return { me: id };
  }

  // ---- reads -----------------------------------------------------------

  async entity(id: string, q: Q = this.db): Promise<Entity | undefined> {
    const { rows } = await q.query<Entity>(`select * from entity where id = $1`, [id]);
    return rows[0];
  }

  async search(input: SearchInput) {
    if (input.type && !this.registry.type(this.registry.canonical(input.type))) throw new Error(`Unknown type "${input.type}"`);
    return search(this.db, (type) => this.registry.family(type), input);
  }

  /** Whether an item is there though the reader may not see it (pelago_item_hidden, src/schema.ts). */
  async hidden(id: string): Promise<boolean> {
    if (!/^e_[a-z0-9]{8}$/.test(id)) return false;
    return Boolean((await this.db.query<{ h: boolean }>(`select pelago_item_hidden($1) as h`, [id])).rows[0]?.h);
  }

  async get(id: string) {
    const entity = await this.entity(id);
    // One the reader may not see is said to be hidden, not missing: an agent can tell a private item from a wrong id.
    if (!entity) throw new Error((await this.hidden(id)) ? `Item "${id}" is private to someone else: you cannot read it` : `No item "${id}"`);
    const rel = `r.id as relation, r.type, r.props, r.confidence, e.id, e.type as entity_type, e.title, e.status`;
    // All at once: on a database over the network each read is a few round trips, and the trail is several reads.
    const [out, inc, events, source, trail, mentioned_in] = await Promise.all([
      this.db.query(`select ${rel} from relation r join entity e on e.id = r.to_id where r.from_id = $1 and r.valid_to is null`, [id]),
      this.db.query(`select ${rel} from relation r join entity e on e.id = r.from_id where r.to_id = $1 and r.valid_to is null`, [id]),
      readEvents(this.db, { target: id, limit: 8 }),
      entity.source_id ? this.entity(entity.source_id) : undefined,
      this.trail(id),
      this.mentionedIn(id),
    ]);
    return {
      entity,
      source: source && { id: source.id, title: source.title, uri: source.props.uri },
      trail,
      mentioned_in,
      outgoing: out.rows,
      incoming: inc.rows,
      recent_events: events.map(({ seq, ts, actor, action, changeset, reason, detail }) => ({ seq, ts, actor, action, changeset, reason, detail })),
    };
  }

  /**
   * Where an item sits: what it is part of, what that is part of, and so on, outermost first, each with the views
   * kept about it (lenses, not shortcuts), so a page can lead back up to a picture it was reached from. Led to two
   * things, it goes up the nearer: the one that is itself part of something. Only what the asker may see.
   */
  async trail(id: string) {
    const trail: { id: string; type: string; title: string; views: { id: string; title: string }[] }[] = [];
    const seen = new Set([id]);
    for (let at = id; trail.length < 8; ) {
      const { rows } = await this.db.query<{ id: string; type: string; title: string }>(
        `select e.id, e.type, e.title from relation r join entity e on e.id = r.to_id
         where r.from_id = $1 and r.type = 'part_of' and r.valid_to is null and e.archived_at is null
         order by exists (select 1 from relation u where u.from_id = e.id and u.type = 'part_of' and u.valid_to is null) desc, e.title`,
        [at],
      );
      const next = rows.find((r) => !seen.has(r.id));
      if (!next) break;
      seen.add(next.id);
      trail.unshift({ ...next, views: [] });
      at = next.id;
    }
    if (!trail.length) return trail;
    const { rows } = await this.db.query<{ id: string; title: string; about: string }>(
      `select v.id, v.title, a.to_id as about from entity v join relation a on a.from_id = v.id and a.type = 'about' and a.valid_to is null
       where v.type = any($1::text[]) and v.archived_at is null and v.is_open and a.to_id = any($2::text[])
       order by (v.props ->> 'place')::numeric nulls last, v.title`,
      [this.registry.family('lens'), trail.map((t) => t.id)],
    );
    for (const v of rows) trail.find((t) => t.id === v.about)?.views.push({ id: v.id, title: v.title });
    return trail;
  }

  /**
   * What names an item in its text or its fields (a note that points at it, a document that brings it in, a
   * decision whose reasons cite it): the way back for a link written as an id, which no relation records.
   * Documents first, then the newest. The system's own records are left out. Only what the asker may see.
   */
  async mentionedIn(id: string) {
    const { rows } = await this.db.query<{ id: string; type: string; title: string; status: string }>(
      `select e.id, e.type, e.title, e.status from mention m join entity e on e.id = m.from_id
       where m.to_id = $1 and e.archived_at is null and e.type not like 'sys.%' order by e.type = any($2::text[]) desc, e.updated_at desc limit 30`,
      [id, this.registry.drawnWith('document')],
    );
    return rows;
  }

  async events(input: EventQuery) {
    return readEvents(this.db, input);
  }

  async proposals(input: { status?: string } = {}) {
    const { rows } = await this.db.query<Proposal>(`select * from proposal where status = $1 order by ts -- index proposal_status`, [input.status ?? 'pending']);
    return rows;
  }
}

/**
 * The restore path (src/operational.ts): a backup's items and links merged into the map as they were, never applied
 * again as changes, since their events come with them. An item on both sides keeps whichever was edited later; a link
 * ended on either side is ended. Answers, for each link written, whether it was new.
 */
export async function restoreRows(tx: Q, entities: string, relations: string): Promise<{ added: boolean }[]> {
  const { rows: cols } = await tx.query<{ set: string }>(`select string_agg(format('%I = excluded.%I', column_name, column_name), ', ') as set from information_schema.columns where table_schema = 'public' and table_name = 'entity' and column_name <> 'id'`);
  // One statement: rows that point at each other (an entity's owner) are checked together.
  await tx.query(`insert into entity select * from jsonb_populate_recordset(null::entity, $1::jsonb) on conflict (id) do update set ${cols[0].set} where excluded.updated_at > entity.updated_at`, [entities]);
  const { rows } = await tx.query<{ added: boolean }>(
    `insert into relation select i.* from jsonb_populate_recordset(null::relation, $1::jsonb) i
     where exists (select 1 from entity where id = i.from_id) and exists (select 1 from entity where id = i.to_id)
     on conflict (id) do update set valid_to = excluded.valid_to where relation.valid_to is null and excluded.valid_to is not null
     returning (xmax = 0) as added`,
    [relations],
  );
  return rows;
}
