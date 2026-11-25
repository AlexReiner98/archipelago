/**
 * The written plugin: the map writes the skills and memory files the harness
 * loads (20 Nov 2026: "Skills and memory are something the map
 * writes"). Adopting a file makes it a node on the map, said at the place
 * the harness loads it (`skill:<name>`, `memory:<scope>/<path>`); from then
 * on the file is written from that node's words, so a change through
 * `words.set` is what the next session loads.
 *
 * - Nodes: a graph item of type `node` (the words plugin's, which says it)
 *   with `file` (the file it writes) and `was` (the file's text when it was
 *   adopted). `held` (a reason) says it is held as written: the words plugin
 *   refuses to change or retire it, naming why. Without `held` it is open
 *   to refinement inside the map, by the learning loop or an agent.
 * - `written.adopt` ({ paths?, scan?, refine?, why? }): reads each file and
 *   makes its node, held unless `refine` is `open`. A loaded item at the
 *   same place (plugins/loaded) is marked `adopted`, so the map's node is the
 *   one said there. Adopting a file again takes its text as the words. A
 *   file the old map writes (it carries OLD_MARK) is left to it.
 * - `written.rule` ({ node, refine, why? }): opens a node to refinement, or
 *   holds it as written.
 * - Writing: as each change commits, a node's file is written with its
 *   words, but only over what this plugin last wrote or found there, or over
 *   `was`; a file changed outside the map is left alone and reported, until
 *   it is adopted again. Undoing a change writes the words it restores.
 *   Writing is an effect: when the plugin unloads, each file it wrote goes
 *   back to `was`, unless it changed since.
 *
 * - Placing (place.ts): a placer registered on `written.place` may say a
 *   node's file goes elsewhere (copies, and its own file taken away); the
 *   plugin writes there instead, and undoes it when the placer stops saying
 *   so or the plugin unloads.
 *
 * Injects graph.read and graph.watch to follow the nodes, action.register
 * for its actions; provides `written.place`. Server only: it reads and
 * writes files.
 */
import { readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import type { ActionContext, ActionRegister } from "../../spec/action.ts";
import type { Fact } from "../../spec/changeset.ts";
import type { Id, Json } from "../../spec/common.ts";
import { Refused } from "../../spec/common.ts";
import type { GraphRead, GraphWatch, Item } from "../../spec/graph.ts";
import { LIMIT_MAX } from "../../spec/graph.ts";
import type { Context, Plugin } from "../../runtime/core.ts";
import { OLD_MARK, discover, placeOf, type Scan } from "./files.ts";
import { Copies, KEY, type WrittenPlace, placers as makePlacers } from "./place.ts";

export const NODE = "node";
export const LOADED = "loaded";
export const ADOPT = "written.adopt";
export const RULE = "written.rule";
export const HELD = "Held as written when adopted: it changes by hand, or inside the map once its rule opens it.";

export interface WrittenConfig {
  /** The home folder: `~` in a memory place, and where a scan looks. */
  home?: string;
}

export interface AdoptInput {
  /** Files, or skill folders. */
  paths?: string[];
  /** Folders to look in for them. */
  scan?: Scan;
  /** `held` (the default): held as written. `open`: may be refined inside the map. */
  refine?: "open" | "held";
  /** Why it is held, said in a refusal. */
  why?: string;
}

export interface RuleInput {
  node: Id;
  refine: "open" | "held";
  why?: string;
}

const refuse = (code: string, message: string) => new Refused({ code, message, by: { plugin: "written" } });
const fold = (f: string) => f.replaceAll("\\", "/").replace(/^[a-z]:\//i, (d) => d.toLowerCase());
const newId = (p: string) => `${p}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

async function readText(file: string): Promise<string | undefined> {
  try {
    return await readFile(file, "utf8");
  } catch {
    return undefined;
  }
}

async function all(graph: GraphRead, type: string): Promise<Item[]> {
  const out: Item[] = [];
  for (let page = await graph.of(type, { limit: LIMIT_MAX }); ; page = await graph.of(type, { limit: LIMIT_MAX, after: page.next })) {
    out.push(...page.items);
    if (!page.next) return out;
  }
}

/** A node item the plugin writes a file from. */
const writes = (i: Item | null | undefined): i is Item => !!i && i.type === NODE && typeof i.fields.file === "string" && typeof i.fields.words === "string";

const written: Plugin<WrittenConfig> = {
  id: "written",
  about: "Writes the skills and memory files agents load, from the map.",
  inject: ["graph.read", "graph.watch", "action.register"],
  async apply(ctx: Context, config: WrittenConfig = {}) {
    const graph = ctx.get<GraphRead>("graph.read");
    const home = config.home ?? homedir();
    /** Per node: its file, what is on disk as far as this plugin knows (absent: it changed outside), and `was` to restore. */
    const mine = new Map<Id, { file: string; last?: string; was?: string; restores?: boolean }>();
    let queue: Promise<unknown> = Promise.resolve();
    const later = (work: () => Promise<void>) => (queue = queue.then(work, work).catch((e) => ctx.runtime.report(ctx.fiber, e)));
    const report = (e: unknown) => ctx.runtime.report(ctx.fiber, e);
    const placers = makePlacers();
    const copies = new Copies(report);
    ctx.effect(() => () => later(() => copies.undoAll()));

    const write = async (id: Id, file: string, text: string, was: string | undefined) => {
      const known = mine.get(id)!;
      await writeFile(file, text, "utf8");
      known.last = text;
      known.was = was;
      if (known.restores) return;
      known.restores = true;
      try {
        // The inverse: put back what was there, unless the file changed since.
        ctx.effect(() => async () => {
          const k = mine.get(id);
          if (!k || k.was === undefined || k.last === undefined) return;
          if ((await readText(k.file)) === k.last && k.last !== k.was) await writeFile(k.file, k.was, "utf8");
        });
      } catch {
        // Unloading: the file was written as the plugin left; nothing more to keep.
      }
    };

    /** Brings one node's files to its words: where a placer says, else its own file. */
    const ensure = async (item: Item) => {
      const words = String(item.fields.words);
      const own = String(item.fields.file);
      const files = placers.size ? await placers.ask(item, report) : null;
      const keepsOwn = files === null || files.some((f) => fold(f) === fold(own));
      await copies.place(item.id, (files ?? []).filter((f) => fold(f) !== fold(own)), words);
      if (keepsOwn) {
        await copies.putBack(item.id);
        await ensureOwn(item);
      } else {
        await copies.takeAway(item.id, own, words, mine.get(item.id)?.last);
      }
    };

    /** Brings one node's own file to its words, if the file is the map's to write. */
    const ensureOwn = async (item: Item) => {
      const id = item.id;
      const file = String(item.fields.file);
      const words = String(item.fields.words);
      const was = typeof item.fields.was === "string" ? item.fields.was : undefined;
      const disk = await readText(file);
      let known = mine.get(id);
      if (!known || fold(known.file) !== fold(file)) mine.set(id, (known = { file, ...(known?.restores ? { restores: true } : {}) }));
      if (disk === words) {
        known.last = words;
        known.was = was;
        return;
      }
      const ours = known.last !== undefined ? disk === known.last : disk === was;
      if (disk === undefined || !ours) {
        known.last = undefined;
        ctx.runtime.report(ctx.fiber, new Error(`written: ${file} changed outside the map, so it is left as it is. Adopt it again to take its words.`));
        return;
      }
      await write(id, file, words, was);
    };

    ctx.get<GraphWatch>("graph.watch").watch({ types: [NODE] }, (change) => {
      const ids = [...new Set(change.facts.map((f) => f[1]))];
      later(async () => {
        const now = await graph.get(ids);
        for (const item of now) if (writes(item)) await ensure(item);
      });
    });
    later(async () => {
      for (const item of await all(graph, NODE)) if (writes(item)) await ensure(item);
    });

    const everything = () => later(async () => {
      for (const item of await all(graph, NODE)) if (writes(item)) await ensure(item);
    });
    ctx.provide<WrittenPlace>(KEY, (caller, from) => ({
      placer: (def) => from.effect(() => {
        const dispose = placers.add(def, caller);
        everything();
        return () => {
          dispose();
          everything();
        };
      }),
      changed: everything,
    }));

    const register = ctx.get<ActionRegister>("action.register");

    register.register({
      name: ADOPT,
      title: "Adopt skill and memory files: the map writes them from now on",
      doc: "Each file becomes a node said at the place the harness loads it, held as written unless refine is open.",
      input: {
        type: "object",
        properties: {
          paths: { type: "array", items: { type: "string" }, description: "SKILL.md, CLAUDE.md, CLAUDE.local.md or MEMORY.md files, or skill folders" },
          scan: {
            type: "object",
            properties: { user: { type: "boolean" }, plugins: { type: "boolean" }, project: { type: "string" } },
            description: "Where to look: the user's own skills and CLAUDE.md, installed plugins' skills, a project folder",
          },
          refine: { type: "string", enum: ["open", "held"] },
          why: { type: "string" },
        },
      },
      async run(input: AdoptInput, call: ActionContext) {
        if (input.refine !== undefined && input.refine !== "open" && input.refine !== "held") throw refuse("written.refine", `refine is open or held, not ${JSON.stringify(input.refine)}.`);
        const paths = [...(input.paths ?? []), ...(input.scan ? await discover(input.scan, home) : [])];
        if (!paths.length) throw refuse("written.nothing", "Name the files to adopt (paths), or where to look for them (scan).");
        const nodes = await all(graph, NODE);
        const byFile = new Map(nodes.filter(writes).map((i) => [fold(String(i.fields.file)), i]));
        const loadedAt = new Map((await all(graph, LOADED)).map((i) => [String(i.fields.place), i]));
        const held = input.refine === "open" ? undefined : input.why?.trim() || HELD;
        const facts: Fact[] = [];
        const adopted: Json[] = [];
        const updated: Json[] = [];
        const skipped: Json[] = [];
        const seen = new Set<string>();
        for (const path of paths) {
          const found = await placeOf(path, home);
          if ("why" in found) {
            skipped.push({ file: path, why: found.why });
            continue;
          }
          if (seen.has(found.place)) continue;
          seen.add(found.place);
          const text = await readText(found.file);
          if (text === undefined) {
            skipped.push({ file: found.file, why: "No such file." });
            continue;
          }
          if (text.includes(OLD_MARK)) {
            skipped.push({ file: found.file, why: "The old map writes this file (it carries its mark): one writer per file, so it stays the old map's." });
            continue;
          }
          const had = byFile.get(fold(found.file));
          if (had) {
            if (had.fields.words === text) {
              skipped.push({ file: found.file, why: "Already adopted, and the map's words are what it holds." });
              continue;
            }
            // Adopted again: the file as it is now is the map's words, and what unloading restores.
            facts.push(["-", had.id, "words", had.fields.words as Json], ["+", had.id, "words", text]);
            if (had.fields.was !== undefined) facts.push(["-", had.id, "was", had.fields.was]);
            facts.push(["+", had.id, "was", text]);
            updated.push({ node: had.id, place: found.place, file: found.file });
            continue;
          }
          const id = newId("n");
          facts.push(
            ["+", id, "type", NODE],
            ["+", id, "title", found.title],
            ["+", id, "kind", found.kind],
            ["+", id, "at", [found.place]],
            ["+", id, "words", text],
            ["+", id, "file", found.file],
            ["+", id, "was", text],
          );
          if (held) facts.push(["+", id, "held", held]);
          // The loaded plugin stops saying its own node here: the map's is the one.
          const l = loadedAt.get(found.place);
          if (l) {
            if (l.fields.adopted !== undefined) facts.push(["-", l.id, "adopted", l.fields.adopted]);
            facts.push(["+", l.id, "adopted", id]);
          } else {
            const lid = newId("l");
            facts.push(["+", lid, "type", LOADED], ["+", lid, "title", found.title], ["+", lid, "kind", found.kind], ["+", lid, "place", found.place], ["+", lid, "path", found.file], ["+", lid, "adopted", id]);
          }
          adopted.push({ node: id, place: found.place, file: found.file, ...(held ? { held } : {}) });
        }
        if (facts.length) call.write(facts);
        return { adopted, updated, skipped };
      },
    });

    register.register({
      name: RULE,
      title: "Open a node to refinement inside the map, or hold it as written",
      input: {
        type: "object",
        properties: {
          node: { type: "string", description: "The node's item id" },
          refine: { type: "string", enum: ["open", "held"] },
          why: { type: "string", description: "Why it is held: what a refusal says" },
        },
        required: ["node", "refine"],
      },
      async run(input: RuleInput, call: ActionContext) {
        const [item] = await graph.get([input.node]);
        if (!item || item.type !== NODE) throw refuse("written.not_a_node", `${input.node} is not a node on the map.`);
        if (input.refine !== "open" && input.refine !== "held") throw refuse("written.refine", `refine is open or held, not ${JSON.stringify(input.refine)}.`);
        const had = item.fields.held;
        const want = input.refine === "held" ? input.why?.trim() || "Held as written." : undefined;
        if (had === want) return { node: input.node, refine: input.refine };
        const facts: Fact[] = [];
        if (had !== undefined) facts.push(["-", input.node, "held", had]);
        if (want !== undefined) facts.push(["+", input.node, "held", want]);
        call.write(facts);
        return { node: input.node, refine: input.refine };
      },
    });
  },
};

export default written;
