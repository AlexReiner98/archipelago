/**
 * The live server: the one real sessions report to. It is map `live`
 * (scripts/maps.ts) served by a fixed commit from its own git worktree
 * outside this checkout, with hot reload off, so editing this checkout never
 * touches it. Its port is any free one: `npm run map -- ls` says which, and
 * connected folders find it by name.
 *
 *   node scripts/live.ts setup [--data-from dir]   make the worktree at main's head, install, (move data in);
 *                                                  refused in a folder that goes away (place.ts) without --here-anyway
 *   node scripts/live.ts start|stop|status          map live, served from the worktree (`map up|down --map live`)
 *   node scripts/live.ts promote [commit]           test the commit, move live to it, restart (default main)
 *   node scripts/live.ts rollback                   move live back to the commit before the last promote
 *   node scripts/live.ts copy                       copy live's map to the dev server's (app/.data here)
 *
 * The worktree is ../archipelago-live beside this checkout (an older
 * ../archipelago-next-live is used while it is still there), or
 * ARCHIPELAGO_LIVE. The map is <home>/maps/live (ARCHIPELAGO_HOME, default
 * ~/.archipelago), outside any checkout, so moving the worktree to another
 * commit leaves it as it is. Each promote is a line in promotions.log there.
 *
 * An older live kept its data in <worktree>/app/.data and ran on 5180. The
 * first `start` with no map live yet stops that server and moves its data in
 * (`--from`, which brings the folders it had connected, so they report to
 * map live from then on). Its folder stays as it was, as a backup.
 */
import { execFileSync, spawnSync } from "node:child_process";
import { appendFileSync, copyFileSync, existsSync, readFileSync, rmSync, rmdirSync, symlinkSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { placeAdvice, temporaryPlace } from "./place.ts";
import { hasMap, homeOf, mapDir, servedOf, snapshot } from "./maps.ts";

const here = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const older = join(here, "..", "archipelago-next-live");
const live = resolve(process.env.ARCHIPELAGO_LIVE ?? (existsSync(older) ? older : join(here, "..", "archipelago-live")));
const MAP = "live";
const home = homeOf();
const liveData = mapDir(MAP, home);
/** Where an older live kept its data, on fixed ports: moved into map live at its first start. */
const oldData = join(live, "app", ".data");
const devData = join(here, "app", ".data");
const promotions = join(liveData, "promotions.log");
const DEV_PAGE = "http://127.0.0.1:5280/app/";
const OLD_PAGE = "http://127.0.0.1:5180/app/";
/** What a commit needs for live to be a map: the map command. */
const MAPS = "scripts/archipelago.ts";

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: { "data-from": { type: "string" }, "here-anyway": { type: "boolean" } },
});

const git = (cwd: string, ...args: string[]) => execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
const short = (sha: string) => sha.slice(0, 7);
const answers = (url: string) => fetch(url, { signal: AbortSignal.timeout(1000) }).then(() => true, () => false);

/** Runs a command in the console, its output shown; true when it exits 0. */
function run(cwd: string, cmd: string, args: string[]): boolean {
  return spawnSync(cmd, args, { cwd, stdio: "inherit" }).status === 0;
}

/** Runs npm (a .cmd on Windows, so through the shell; the arguments are this script's own). */
function npm(cwd: string, ...args: string[]): boolean {
  return spawnSync(["npm", ...args].join(" "), { cwd, stdio: "inherit", shell: true }).status === 0;
}

/** Whether a commit can serve live as a map. */
const servesMaps = (sha: string) => spawnSync("git", ["cat-file", "-e", `${sha}:${MAPS}`], { cwd: here }).status === 0;

/** The older live, on fixed ports from <worktree>/app/.data (scripts/server.ts), stopped if it runs. */
function stopOld(): void {
  if (!existsSync(join(oldData, "server.pid"))) return;
  run(here, process.execPath, [join(here, "scripts", "server.ts"), "stop", "--root", live, "--data", oldData]);
}

/**
 * Map live, served from the worktree's own code: started detached (`map up`),
 * or stopped. It runs from its own worktree, so it is told the checkout
 * people work in (this one, ARCHIPELAGO_CHECKOUT): what its page offers to
 * connect. The first start moves an older live's data in.
 */
function server(verb: "start" | "stop"): boolean {
  if (verb === "stop") return run(here, process.execPath, ["--disable-warning=ExperimentalWarning", join(here, MAPS), "down", MAP]);
  if (!existsSync(join(live, MAPS))) {
    console.log(`live's worktree is at ${short(git(live, "rev-parse", "HEAD"))}, from before maps by name: move it on with npm run promote`);
    return false;
  }
  const from = !hasMap(liveData) && hasMap(oldData) ? oldData : undefined;
  if (from) {
    stopOld();
    console.log(`moving the older live's data into map ${MAP}: ${from} (left as it was, as a backup)`);
  }
  process.env.ARCHIPELAGO_CHECKOUT = here;
  const ok = run(live, process.execPath, ["--disable-warning=ExperimentalWarning", join(live, MAPS), "up", "--map", MAP, "--no-watch", ...(from ? ["--from", from] : [])]);
  // An older live's moves stay on record (a worktree at a commit before the move copies no ledger).
  if (ok && from && !existsSync(promotions) && existsSync(join(from, "promotions.log"))) copyFileSync(join(from, "promotions.log"), promotions);
  return ok;
}

async function status(): Promise<void> {
  console.log(`live's worktree at ${short(git(live, "rev-parse", "HEAD"))} in ${live}`);
  const s = servedOf(MAP, home);
  console.log(s ? `map ${MAP} runs (pid ${s.pid}) on http://127.0.0.1:${s.port}/app/, from ${s.checkout}${s.commit ? ` at ${s.commit}` : ""}` : `map ${MAP} isn't running${hasMap(liveData) ? "" : " and has no data yet"}: npm run live:start`);
  if (hasMap(oldData) && (await answers(OLD_PAGE))) console.log(`an older live still answers on ${OLD_PAGE}: npm run live:start stops it and moves its data into map ${MAP}${hasMap(liveData) ? " (already done: stop it with node scripts/server.ts stop --root <worktree> --data <worktree>/app/.data)" : ""}`);
}

function needLive(): void {
  if (!existsSync(join(live, ".git"))) {
    console.log(`no live worktree at ${live}: run node scripts/live.ts setup`);
    process.exit(1);
  }
}

/** Installs the worktree's packages when its lockfile differs from what was installed. */
function install(dir: string): boolean {
  const lock = join(dir, "package-lock.json");
  const stamp = join(dir, "node_modules", ".installed-lock");
  if (existsSync(stamp) && readFileSync(stamp, "utf8") === readFileSync(lock, "utf8")) return true;
  if (!npm(dir, "ci", "--no-audit", "--no-fund")) return false;
  copyFileSync(lock, stamp);
  return true;
}

/** Runs the tests at a commit, in a throwaway worktree that borrows this checkout's packages. */
function test(sha: string): boolean {
  const dir = join(tmpdir(), `archipelago-test-${short(sha)}`);
  if (existsSync(dir)) {
    spawnSync("git", ["worktree", "remove", "--force", dir], { cwd: here });
    rmSync(dir, { recursive: true, force: true });
  }
  git(here, "worktree", "add", "--detach", dir, sha);
  try {
    symlinkSync(join(here, "node_modules"), join(dir, "node_modules"), "junction");
    console.log(`testing ${short(sha)} in ${dir}`);
    return npm(dir, "test") && npm(dir, "run", "check");
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
  if (!servesMaps(sha)) {
    console.log(`refused: ${short(sha)} is from before maps by name (no ${MAPS}), so it can't serve map ${MAP}. Live stays at ${short(was)}.`);
    return false;
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
    // A map meant to last never starts in a folder that goes away (scripts/place.ts).
    const why = temporaryPlace(here) ?? temporaryPlace(live);
    if (why && !values["here-anyway"]) {
      console.log(placeAdvice(temporaryPlace(here) ? here : live, why));
      process.exit(1);
    }
    if (existsSync(join(live, ".git"))) {
      console.log(`live worktree already at ${live} (${short(git(live, "rev-parse", "HEAD"))})`);
    } else {
      const sha = git(here, "rev-parse", "main^{commit}");
      git(here, "worktree", "add", "--detach", live, sha);
      console.log(`live worktree at ${live}, ${short(sha)}`);
    }
    if (!install(live)) process.exit(1);
    if (values["data-from"]) {
      if (hasMap(liveData)) {
        console.log(`map ${MAP} already has data in ${liveData}: not copying over it`);
        process.exit(1);
      }
      // An older server's folder, moved in: its connected folders come with it.
      snapshot(resolve(values["data-from"]), liveData, { takeover: true });
      console.log(`moved data from ${resolve(values["data-from"])} into map ${MAP} (${liveData})`);
    }
    console.log("start it with: npm run live:start");
    break;
  }
  case "start":
    needLive();
    if (!server("start")) process.exitCode = 1;
    break;
  case "stop":
    needLive();
    if (!server("stop")) process.exitCode = 1;
    break;
  case "status":
    needLive();
    await status();
    break;
  case "promote": {
    needLive();
    if (git(here, "status", "--porcelain")) {
      console.log("refused: this checkout has uncommitted changes. Commit or stash them first.");
      process.exit(1);
    }
    const target = positionals[1] ?? "main";
    const sha = git(here, "rev-parse", `${target}^{commit}`);
    if (!servesMaps(sha)) {
      console.log(`refused: ${short(sha)} is from before maps by name (no ${MAPS}), so it can't serve map ${MAP}.`);
      process.exit(1);
    }
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
    if (await answers(DEV_PAGE)) {
      console.log(`the dev server answers on ${DEV_PAGE}: stop it first (npm run dev:stop)`);
      process.exit(1);
    }
    const from = hasMap(liveData) ? liveData : hasMap(oldData) ? oldData : undefined;
    if (!from) {
      console.log(`no live data in ${liveData}`);
      process.exit(1);
    }
    snapshot(from, devData);
    console.log(`copied live's map to ${devData}`);
    break;
  }
  default:
    console.log("node scripts/live.ts setup|start|stop|status|promote [commit]|rollback|copy");
    process.exitCode = 1;
}
