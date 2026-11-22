/**
 * Sets the owner's gateway passphrase: its scrypt hash goes into the
 * gateway's database in the data folder, never the passphrase itself.
 * Setting it again also revokes every grant, so every client signs in anew.
 *
 *   npm run gateway:passphrase [-- --data dir]
 *
 * `--data` is the server's data folder (default app/.data here; live's is
 * <live worktree>/app/.data). The passphrase is read from the terminal
 * without echo, twice, or once from stdin when it is not a terminal.
 * Restart the server afterwards.
 */
import { dirname, join, resolve } from "node:path";
import { mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { GatewayStore, hashPassphrase } from "./store.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const { values } = parseArgs({ options: { data: { type: "string", default: join(root, "app", ".data") } } });
const MIN = 12;

/** One line from the terminal, not echoed. */
function hidden(prompt: string): Promise<string> {
  return new Promise((ok, fail) => {
    const input = process.stdin;
    process.stdout.write(prompt);
    input.setRawMode(true);
    input.resume();
    input.setEncoding("utf8");
    let s = "";
    const on = (chunk: string) => {
      for (const c of chunk) {
        if (c === "\r" || c === "\n") {
          done();
          return ok(s);
        }
        if (c === "\u0003") {
          done();
          return fail(new Error("cancelled"));
        }
        if (c === "\u007f" || c === "\b") s = s.slice(0, -1);
        else s += c;
      }
    };
    const done = () => {
      input.off("data", on);
      input.setRawMode(false);
      input.pause();
      process.stdout.write("\n");
    };
    input.on("data", on);
  });
}

async function piped(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const c of process.stdin) chunks.push(c as Buffer);
  return Buffer.concat(chunks).toString("utf8").split(/\r?\n/)[0] ?? "";
}

let pass: string;
if (process.stdin.isTTY) {
  pass = await hidden("Gateway passphrase: ");
  if ((await hidden("Again: ")) !== pass) {
    console.error("The two don't match; nothing was changed.");
    process.exit(1);
  }
} else pass = await piped();
if ([...pass].length < MIN) {
  console.error(`A passphrase needs at least ${MIN} characters; nothing was changed.`);
  process.exit(1);
}
const data = resolve(values.data);
mkdirSync(data, { recursive: true });
const store = new GatewayStore(join(data, "gateway.sqlite"));
store.setPassphrase(hashPassphrase(pass));
store.setFailures({ count: 0 });
const revoked = store.revoke(undefined, Date.now());
store.close();
console.log(`Passphrase set in ${join(data, "gateway.sqlite")}${revoked ? `; ${revoked} grant(s) revoked` : ""}. Restart the server.`);
