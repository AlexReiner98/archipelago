/**
 * Moves a map from the old Archipelago server, through its own reads (the
 * `query` tool's plain-JSON door, /agent/query), never its database. How
 * each item lands is scripts/pelago-map.ts.
 *
 *   node scripts/from-pelago.ts read <dump.json> [--url U] [--gets]
 *       every item and link (flat, every field, notes whole), and which items
 *       were last set on the owner's say; --gets adds each item's own get
 *       (its source, owner, confidence), paced to the server's limit
 *   node scripts/from-pelago.ts land <dump.json> <sets.jsonl>
 *       the living map's change sets, and what was left behind
 *   node scripts/from-pelago.ts import <sets.jsonl> --data <dir>
 *       each set through interchange.import, on the write chain of a runtime
 *       over that data folder (stop its server first)
 *   node scripts/from-pelago.ts archive <dump.json> <name> --data <dir> [--title T]
 *       an archive: <dir>/archives/<name>.sqlite, read only from then on
 *   node scripts/from-pelago.ts check <dump.json> --data <dir> [--archive name] [--spot N]
 *       counts per base and per link, and N notes compared, against the dump
 *       and, given a token, against the old server as it is now
 *
 * The token: PELAGO_TOKEN, or --token-file (read, never printed), or
 * --login, a module exporting accessToken(origin) (the plugin's sign-in), or
 * --agent-token, PELAGO_AGENT_TOKEN (the old plugin's own).
 */
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { setTimeout as sleep } from "node:timers/promises";
import type { ActionInvoke } from "../spec/action.ts";
import type { Authority, Json } from "../spec/common.ts";
import type { Fact } from "../spec/changeset.ts";
import { Runtime, type Plugin } from "../runtime/core.ts";
import { Loader, type Entry } from "../runtime/loader.ts";
import { Store } from "../plugins/graph/store.ts";
import { archiveHeader, archiveLand, landArchive, landFocus, LANDS, SAID, type Dump, type OldGet } from "./pelago-map.ts";

const { positionals, values } = parseArgs({
  allowPositionals: true,
  options: {
    url: { type: "string", default: process.env.PELAGO_URL ?? "https://app.archipelago.tools" },
    "token-file": { type: "string" },
    login: { type: "string" },
    "agent-token": { type: "boolean", default: false },
    gets: { type: "boolean", default: false },
    data: { type: "string" },
    title: { type: "string" },
    archive: { type: "string" },
    spot: { type: "string", default: "20" },
  },
});
const [cmd, a, b] = positionals;
const root = resolve(import.meta.dirname, "..");
/** The most items one flat read sends. */
const FLAT = 2000;
/** Items a chunk names, so two chunks stay under FLAT. */
const CHUNK = 900;
/** The pause after each read. */
const PACE = 400;

async function token(): Promise<string | undefined> {
  if (process.env.PELAGO_TOKEN) return process.env.PELAGO_TOKEN;
  if (values["agent-token"] && process.env.PELAGO_AGENT_TOKEN) return process.env.PELAGO_AGENT_TOKEN;
  if (values["token-file"]) return readFileSync(values["token-file"], "utf8").trim();
  if (values.login) return (await import(pathToFileURL(resolve(values.login)).href)).accessToken(values.url);
  return undefined;
}

async function query(tok: string | undefined, input: Json): Promise<any> {
  for (let wait = 1000; ; wait = Math.min(wait * 2, 30_000)) {
    const res = await fetch(`${values.url!.replace(/\/$/, "")}/agent/query`, {
      method: "POST",
      headers: { "content-type": "application/json", ...(tok ? { authorization: `Bearer ${tok}` } : {}) },
      body: JSON.stringify(input),
      signal: AbortSignal.timeout(180_000),
    });
    // Busy, or a gateway between: wait and ask again. Every read is paced, to be gentle on a live server.
    if ([429, 502, 503, 504].includes(res.status)) {
      await res.text().catch(() => "");
      if (wait >= 30_000) throw new Error(`query ${JSON.stringify(input).slice(0, 80)}: still ${res.status} after backing off`);
      await sleep(wait);
      continue;
    }
    const text = await res.text();
    await sleep(PACE);
    if (res.status !== 200) throw new Error(`query ${JSON.stringify(input).slice(0, 80)}: ${res.status} ${text.slice(0, 200)}`);
    return JSON.parse(text).result;
  }
}

const need = (v: string | undefined, what: string): string => {
  if (!v) {
    console.error(`give ${what}`);
    process.exit(1);
  }
  return v;
};

async function read(out: string) {
  const tok = await token();
  const schema = await query(tok, { name: "schema", params: { full: true } });
  // One flat read sends at most FLAT items. First every item's id, a type at a time: a type's
  // term finds the types made from it too, so one that comes back full is read again without them.
  const ids = new Set<string>();
  for (const t of schema.types as { id: string }[]) {
    const not: string[] = [];
    for (;;) {
      const r = await query(tok, { name: "flat", params: { filter: { find: [`type ${t.id}`], not }, limit: FLAT } });
      for (const i of r.items as { id: string }[]) ids.add(i.id);
      if (r.items.length < FLAT) break;
      const more = [...new Set((r.items as { type: string }[]).filter((i) => i.type !== t.id).map((i) => `type ${i.type}`))].filter((x) => !not.includes(x));
      if (!more.length) throw new Error(`${t.id} alone has ${FLAT} items or more: read it by date ranges`);
      not.push(...more);
    }
  }
  // Then in chunks of ids, each read named item by item: whole, and every pair of chunks for the links among them.
  const chunks: string[][] = [];
  for (const id of ids) {
    if (!chunks.length || chunks.at(-1)!.length >= CHUNK) chunks.push([]);
    chunks.at(-1)!.push(`id ${id}`);
  }
  const items = new Map<string, Dump["items"][number]>();
  const links = new Map<string, Dump["links"][number]>();
  const byOwner = new Set<string>();
  for (const find of chunks) {
    const r = await query(tok, { name: "flat", params: { filter: { find, not: [] }, limit: FLAT, fields: true, notes: "whole" } });
    for (const i of r.items) items.set(i.id, i);
    const o = await query(tok, { name: "flat", params: { filter: { find, only: ["by owner"], not: [] }, limit: FLAT } });
    for (const i of o.items) byOwner.add(i.id);
  }
  for (let x = 0; x < chunks.length; x++) {
    for (let y = x; y < chunks.length; y++) {
      const find = x === y ? chunks[x]! : [...chunks[x]!, ...chunks[y]!];
      const r = await query(tok, { name: "flat", params: { filter: { find, not: [] }, limit: FLAT } });
      for (const l of r.links) links.set(l.id, l);
    }
  }
  if (items.size !== ids.size) throw new Error(`read ${items.size} items whole of ${ids.size} found`);
  console.log({ found: ids.size, chunks: chunks.length });
  const dump: Dump = {
    origin: values.url,
    read_at: new Date().toISOString(),
    items: [...items.values()],
    links: [...links.values()],
    by_owner: [...byOwner],
  };
  if (values.gets) {
    const gets: Record<string, OldGet> = {};
    let n = 0;
    for (const it of dump.items) {
      const e = (await query(tok, { name: "get", params: { id: it.id, full: true } })).entity;
      gets[it.id] = { source_id: e.source_id, created_at: e.created_at, confidence: e.confidence, owner: e.owner, visibility: e.visibility, archived_at: e.archived_at };
      if (++n % 100 === 0) console.log(`${n} of ${dump.items.length}`);
      await sleep(300);
    }
    dump.gets = gets;
  }
  writeFileSync(out, JSON.stringify(dump));
  console.log({ items: dump.items.length, links: dump.links.length, by_owner: dump.by_owner!.length, gets: dump.gets ? Object.keys(dump.gets).length : 0 });
}

/** A runtime over a data folder with the plugins a move goes through, and an invoke as the mover. */
async function runtime(data: string) {
  const rt = new Runtime();
  rt.onError = (f, e) => console.error(`[${f.plugin.id}]`, e);
  const mover: Plugin = { id: "mover", inject: ["action.invoke"], apply() {} };
  const loader = new Loader(rt, {
    base: pathToFileURL(root + "/").href,
    import: async (url: string) => (url.endsWith("/mover") ? { default: mover } : import(url)),
  });
  const tree: Entry[] = [
    { id: "graph", plugin: "plugins/graph/index.ts", config: { db: join(data, "graph.sqlite") } },
    { id: "action", plugin: "plugins/action/index.ts" },
    { id: "types", plugin: "plugins/types/index.ts" },
    { id: "work", plugin: "plugins/work/index.ts" },
    { id: "question", plugin: "plugins/question/index.ts" },
    { id: "record", plugin: "plugins/record/index.ts" },
    { id: "actor", plugin: "plugins/actor/index.ts" },
    { id: "links", plugin: "plugins/links/index.ts" },
    { id: "branch", plugin: "plugins/branch/index.ts" },
    { id: "schema", plugin: "plugins/schema/index.ts", config: { db: join(data, "schema.sqlite") } },
    { id: "history", plugin: "plugins/history/index.ts", config: { db: join(data, "history.sqlite") } },
    { id: "interchange", plugin: "plugins/interchange/index.ts" },
    { id: "mover", plugin: "mover" },
  ];
  await loader.apply(tree);
  await rt.settle();
  const fiber = loader.fiber("mover");
  if (fiber?.state !== "active") throw new Error(`the mover isn't active: ${JSON.stringify(loader.status())}`);
  const ctx = fiber.ctx.intercept({ actor: { id: "agent:interchange", kind: "agent" } });
  return { invoke: ctx.get<ActionInvoke>("action.invoke"), stop: () => loader.apply([]) };
}

interface Line {
  authority: Authority;
  reason: string;
  facts: Fact[];
}

async function importSets(file: string, data: string) {
  const lines = readFileSync(file, "utf8").split(/\r?\n/).filter((l) => l.trim()).map((l) => JSON.parse(l) as Line);
  const { invoke, stop } = await runtime(data);
  let sets = 0;
  let facts = 0;
  try {
    for (const l of lines) {
      const out = await invoke.invoke<{ facts: number }>({ action: "interchange.import", input: { facts: l.facts } as unknown as Json, authority: l.authority, reason: l.reason });
      if (!out.ok) {
        console.error(`refused at set ${sets + 1} (${l.reason}): ${out.refused.code} ${out.refused.message}`);
        console.error(JSON.stringify(out.refused.detail ?? null).slice(0, 2000));
        process.exitCode = 1;
        break;
      }
      sets++;
      facts += l.facts.length;
      console.log(`${out.change}: ${l.reason}`);
    }
  } finally {
    await stop();
  }
  console.log({ sets, facts });
}

function makeArchive(dumpFile: string, name: string, data: string) {
  if (!/^[a-z0-9][a-z0-9_-]{0,39}$/.test(name)) throw new Error(`not an archive name: ${name}`);
  const dump = JSON.parse(readFileSync(dumpFile, "utf8")) as Dump;
  const dir = join(data, "archives");
  mkdirSync(dir, { recursive: true });
  const file = join(dir, `${name}.sqlite`);
  for (const f of [file, `${file}-wal`, `${file}-shm`]) rmSync(f, { force: true });
  const store = new Store(file);
  const { facts, counts } = landArchive(dump);
  for (let k = 0; k < facts.length; k += 20_000) store.apply({ header: archiveHeader(dump.origin ?? "the old server"), facts: facts.slice(k, k + 20_000) });
  const meta = store.db.prepare("INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value");
  meta.run("title", values.title ?? name);
  meta.run("read_at", dump.read_at ?? "");
  store.db.exec("PRAGMA wal_checkpoint(TRUNCATE); PRAGMA journal_mode = DELETE;");
  store.close();
  console.log({ archive: file, ...counts });
}

/** Where an old item lands, as a base (or `node`), for counting. */
function landsAs(type: string): string | undefined {
  if (SAID.has(type)) return "node";
  const l = LANDS[type];
  return l ? (l.type === "branch" ? "work" : l.type) : undefined;
}

async function check(dumpFile: string, data: string) {
  const dump = JSON.parse(readFileSync(dumpFile, "utf8")) as Dump;
  const name = values.archive;
  const file = name ? join(data, "archives", `${name}.sqlite`) : join(data, "graph.sqlite");
  if (!existsSync(file)) throw new Error(`no ${file}`);
  const store = new Store(file, 0, { readOnly: true });
  const all = new Map<string, { type: string; fields: Record<string, Json> }>();
  for (let p = store.all({ limit: 500 }); ; p = store.all({ limit: 500, after: p.next })) {
    for (const i of p.items) all.set(i.id, i);
    if (!p.next) break;
  }
  const baseOf = (t: string) => (t === "branch" ? "work" : t);
  const problems: string[] = [];
  // Every old item: there, and as the base it should be.
  const expect: Record<string, number> = {};
  const found: Record<string, number> = {};
  let sources = 0;
  for (const i of dump.items) {
    const want = name ? baseOf(archiveLand(i)?.type ?? i.type) : landsAs(i.type);
    if (!want) continue;
    const got = all.get(i.id);
    if (!name && i.type === "source") {
      if (got) sources++;
      continue;
    }
    expect[want] = (expect[want] ?? 0) + 1;
    if (!got) {
      problems.push(`missing ${i.id} (${i.type})`);
      continue;
    }
    const at = baseOf(got.type);
    found[at] = (found[at] ?? 0) + 1;
    if (at !== want) problems.push(`${i.id} is ${got.type}, expected ${want}`);
    if (got.fields.title !== i.title) problems.push(`${i.id} title differs`);
  }
  // Links: each old link of a kind that moves, between moved items, is there (by id).
  let linksWant = 0;
  let linksGot = 0;
  for (const l of dump.links) {
    if (!all.has(l.from) || !all.has(l.to)) continue;
    const there = all.get(l.id);
    if (name || (there && typeof there.fields.from === "string")) linksWant++;
    else continue;
    if (there && there.fields.from === l.from && there.fields.to === l.to) linksGot++;
    else problems.push(`link ${l.id} (${l.type}) missing`);
  }
  // Spot checks: notes of N items, spread through the dump, start with the old note.
  const n = Number(values.spot);
  const withNotes = dump.items.filter((i) => i.body && all.has(i.id));
  const spots: { id: string; ok: boolean }[] = [];
  for (let k = 0; k < Math.min(n, withNotes.length); k++) {
    const i = withNotes[Math.floor((k * withNotes.length) / Math.min(n, withNotes.length))]!;
    const f = all.get(i.id)!.fields;
    const note = String(f.note ?? f.words ?? "");
    const ok = note.startsWith(i.body!);
    spots.push({ id: i.id, ok });
    if (!ok) problems.push(`note of ${i.id} differs from the dump`);
  }
  // With a token, the same notes read again from the old server now: what it says today, not the dump.
  let fresh: string | undefined;
  const tok = await token();
  if (tok) {
    let same = 0;
    for (const s of spots) {
      const e = (await query(tok, { name: "get", params: { id: s.id, full: true } })).entity;
      const f = all.get(s.id)!.fields;
      if (String(f.note ?? f.words ?? "").startsWith(String(e.body ?? ""))) same++;
      else problems.push(`note of ${s.id} differs from the old server now (changed since the read?)`);
      await sleep(300);
    }
    fresh = `${same} of ${spots.length}`;
  }
  const counts = store.counts();
  store.close();
  console.log(JSON.stringify({ map: name ?? "living", expect, found, ...(name ? {} : { sources }), links: { want: linksWant, got: linksGot }, spots: `${spots.filter((s) => s.ok).length} of ${spots.length}`, ...(fresh ? { spots_on_the_old_server: fresh } : {}), store: counts, problems: problems.slice(0, 50), problem_count: problems.length }, null, 1));
  if (problems.length) process.exitCode = 1;
}

switch (cmd) {
  case "read":
    await read(need(a, "the dump file"));
    break;
  case "land": {
    const dump = JSON.parse(readFileSync(need(a, "the dump file"), "utf8")) as Dump;
    const landed = landFocus(dump);
    writeFileSync(need(b, "the sets file"), landed.groups.map((g) => JSON.stringify(g)).join("\n") + "\n");
    console.log(JSON.stringify({ sets: landed.groups.length, facts: landed.groups.reduce((n, g) => n + g.facts.length, 0), ...landed.counts }, null, 1));
    break;
  }
  case "import":
    await importSets(need(a, "the sets file"), need(values.data, "--data"));
    break;
  case "archive":
    makeArchive(need(a, "the dump file"), need(b, "the archive's name"), need(values.data, "--data"));
    break;
  case "check":
    await check(need(a, "the dump file"), need(values.data, "--data"));
    break;
  default:
    console.log("node scripts/from-pelago.ts read|land|import|archive|check ... (see the head of this file)");
    process.exitCode = 1;
}
