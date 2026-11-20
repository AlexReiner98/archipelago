/**
 * The live server: the one real sessions report to. It runs a fixed commit
 * from its own git worktree outside this checkout, with hot reload off and
 * its own data, so editing this checkout never touches it.
 *
 *   node scripts/live.ts setup [--data-from dir]   make the worktree at main's head, install, (copy data in)
 *   node scripts/live.ts start|stop|status          the live server, on 5180 (adapter 5181, bridge 5182)
 *   node scripts/live.ts promote [commit]           test the commit, move live to it, restart (default main)
 *   node scripts/live.ts rollback                   move live back to the commit before the last promote
 *   node scripts/live.ts copy                       copy live's data to the dev server's (app/.data here)
 *
 * The worktree is ../archipelago-next-live beside this checkout, or
 * ARCHIPELAGO_LIVE. Its data is <worktree>/app/.data: ignored, so checking
 * out another commit there leaves it as it is. Each promote is a line in
 * promotions.log there.
 */
import { execFileSync, spawnSync } from "node:child_process";
import { appendFileSync, copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, rmdirSync, symlinkSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

const here = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const live = resolve(process.env.ARCHIPELAGO_LIVE ?? join(here, "..", "archipelago-next-live"));
const liveData = join(live, "app", ".data");
const devData = join(here, "app", ".data");
const promotions = join(liveData, "promotions.log");
const DEV_PAGE = "http://127.0.0.1:5280/app/";

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: { "data-from": { type: "string" } },
});

const git = (cwd: string, ...args: string[]) => execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
const short = (sha: string) => sha.slice(0, 7);

/** Runs a command in the console, its output shown; true when it exits 0. */
function run(cwd: string, cmd: string, args: string[]): boolean {
  return spawnSync(cmd, args, { cwd, stdio: "inherit", shell: process.platform === "win32" }).status === 0;
}

/** The live server, through scripts/server.ts: no hot reload, default ports. */
function server(verb: "start" | "stop" | "status"): boolean {
  return run(here, process.execPath, [join(here, "scripts", "server.ts"), verb, "--root", live, "--data", liveData, "--no-watch"]);
}

function needLive(): void {
  if (!existsSync(join(live, ".git"))) {
    console.log(`no live worktree at ${live}: run node scripts/live.ts setup`);
    process.exit(1);
  }
}

/** Copies a data folder's graph and exchange journal, consistent even while a server writes them. */
function snapshot(from: string, to: string): void {
  mkdirSync(to, { recursive: true });
  const db = join(from, "graph.sqlite");
  if (existsSync(db)) {
    for (const f of ["graph.sqlite", "graph.sqlite-wal", "graph.sqlite-shm"]) rmSync(join(to, f), { force: true });
    const src = new DatabaseSync(db, { readOnly: true });
    src.exec(`VACUUM INTO '${join(to, "graph.sqlite").replaceAll("'", "''")}'`);
    src.close();
  }
  const journal = join(from, "exchange.jsonl");
  if (existsSync(journal)) {
    const text = readFileSync(journal);
    // Up to the last whole line: a write may be under way.
    writeFileSync(join(to, "exchange.jsonl"), text.subarray(0, text.lastIndexOf(10) + 1));
  }
}

/** Installs the worktree's packages when its lockfile differs from what was installed. */
function install(dir: string): boolean {
  const lock = join(dir, "package-lock.json");
  const stamp = join(dir, "node_modules", ".installed-lock");
  if (existsSync(stamp) && readFileSync(stamp, "utf8") === readFileSync(lock, "utf8")) return true;
  if (!run(dir, "npm", ["ci", "--no-audit", "--no-fund"])) return false;
  copyFileSync(lock, stamp);
  return true;
}

/** Runs the tests at a commit, in a throwaway worktree that borrows this checkout's packages. */
function test(sha: string): boolean {
  const dir = join(tmpdir(), `archipelago-next-test-${short(sha)}`);
  if (existsSync(dir)) {
    spawnSync("git", ["worktree", "remove", "--force", dir], { cwd: here });
    rmSync(dir, { recursive: true, force: true });
  }
  git(here, "worktree", "add", "--detach", dir, sha);
  try {
    symlinkSync(join(here, "node_modules"), join(dir, "node_modules"), "junction");
    console.log(`testing ${short(sha)} in ${dir}`);
    return run(dir, "npm", ["test"]) && run(dir, "npm", ["run", "check"]);
  } finally {
    // The junction alone, never what it points to.
    try {
      unlinkSync(join(dir, "node_modules"));
    } catch {
      rmdirSync(join(dir, "node_modules"));
    }
    spawnSync("git", ["worktree", "remove", "--force", dir], { cwd: here });
  }
}

/** Moves live to a commit and restarts it; back to where it was if it doesn't come up. */
function move(sha: string, why: string): boolean {
  const was = git(live, "rev-parse", "HEAD");
  if (was === sha) {
    console.log(`live is already at ${short(sha)}`);
    return server("start");
  }
  server("stop");
  git(live, "checkout", "--quiet", "--detach", sha);
  if (install(live) && server("start")) {
    appendFileSync(promotions, `${new Date().toISOString()}\t${was}\t${sha}\t${why}\n`);
    console.log(`live moved ${short(was)} -> ${short(sha)}. Back with: node scripts/live.ts rollback`);
    return true;
  }
  console.log(`live didn't come up at ${short(sha)}: back to ${short(was)}`);
  server("stop");
  git(live, "checkout", "--quiet", "--detach", was);
  install(live);
  server("start");
  return false;
}

const verb = positionals[0] ?? "status";
switch (verb) {
  case "setup": {
    if (existsSync(join(live, ".git"))) {
      console.log(`live worktree already at ${live} (${short(git(live, "rev-parse", "HEAD"))})`);
    } else {
      const sha = git(here, "rev-parse", "main^{commit}");
      git(here, "worktree", "add", "--detach", live, sha);
      console.log(`live worktree at ${live}, ${short(sha)}`);
    }
    if (!install(live)) process.exit(1);
    if (values["data-from"]) {
      if (existsSync(join(liveData, "graph.sqlite"))) {
        console.log(`live already has data in ${liveData}: not copying over it`);
        process.exit(1);
      }
      snapshot(resolve(values["data-from"]), liveData);
      console.log(`copied data from ${resolve(values["data-from"])} to ${liveData}`);
    }
    console.log("start it with: node scripts/live.ts start");
    break;
  }
  case "start":
  case "stop":
  case "status":
    needLive();
    if (verb === "status") console.log(`live at ${short(git(live, "rev-parse", "HEAD"))} in ${live}`);
    if (!server(verb)) process.exitCode = 1;
    break;
  case "promote": {
    needLive();
    if (git(here, "status", "--porcelain")) {
      console.log("refused: this checkout has uncommitted changes. Commit or stash them first.");
      process.exit(1);
    }
    const target = positionals[1] ?? "main";
    const sha = git(here, "rev-parse", `${target}^{commit}`);
    if (!test(sha)) {
      console.log(`refused: the tests fail at ${short(sha)}. Live stays at ${short(git(live, "rev-parse", "HEAD"))}.`);
      process.exit(1);
    }
    if (!move(sha, `promote ${target}`)) process.exitCode = 1;
    break;
  }
  case "rollback": {
    needLive();
    const lines = existsSync(promotions) ? readFileSync(promotions, "utf8").trim().split("\n").filter(Boolean) : [];
    const [, was, now] = lines.at(-1)?.split("\t") ?? [];
    if (!was || !now) {
      console.log("nothing to roll back: no promote on record");
      process.exit(1);
    }
    // The commit before the last move; it ran live before, so no tests.
    if (!move(was, `rollback from ${short(now)}`)) process.exitCode = 1;
    break;
  }
  case "copy": {
    needLive();
    try {
      await fetch(DEV_PAGE, { signal: AbortSignal.timeout(1000) });
      console.log(`the dev server answers on ${DEV_PAGE}: stop it first (npm run dev:stop)`);
      process.exit(1);
    } catch {}
    if (readdirSync(liveData).length === 0) {
      console.log(`no live data in ${liveData}`);
      process.exit(1);
    }
    snapshot(liveData, devData);
    console.log(`copied live's data to ${devData}`);
    break;
  }
  default:
    console.log("node scripts/live.ts setup|start|stop|status|promote [commit]|rollback|copy");
    process.exitCode = 1;
}
