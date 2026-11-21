/**
 * profile: which runs a node is for. See profile.md.
 *
 * Edition 5 (20 Nov 2026). The spec owns only the read side, so the
 * pack that keeps profiles can be replaced: what a profile is on the map,
 * its links and the terms it matches with are that pack's.
 */
import type { NodeInfo, RunInfo } from "./agent.ts";
import type { Capability, Dispose, Id } from "./common.ts";

/** A profile a run is in. */
export interface ProfileInfo {
  id: Id;
  title: string;
  /**
   * `match`: the run's facts fit it. `part`: a profile the run is in is part
   * of it, at any depth.
   */
  by: "match" | "part";
  /** Whether it holds nodes back now; false: it only records what it would hold back (a shadow). */
  holding: boolean;
}

/**
 * Whether a run hears a node, and why not. `shadow`: it hears it, but would
 * not once the profiles that hold it back hold anything (a profile in
 * shadow only records what it would hold back).
 */
export type Hearing = { hears: true; shadow?: string } | { hears: false; why: string };

/** `profile.read`. */
export interface ProfileRead {
  /** The profiles a run is in, by its facts: those it matches, then what each is part of. */
  of(run: RunInfo): Promise<ProfileInfo[]>;
  /** Whether a run hears a node. A node in no profile is heard by every run. */
  hears(run: RunInfo, node: NodeInfo): Promise<Hearing>;
  /** The nodes loaded now that a profile holds, and those it takes out, by node id (`pack/name`); its parts' not included. */
  nodes(profile: Id): Promise<{ in: string[]; out: string[] }>;
  /** Calls `on` when profiles, or what they hold, change. */
  watch(on: () => void): Dispose;
}

export interface Capabilities {
  "profile.read": ProfileRead;
}

export const capabilities: Capability[] = [
  { key: "profile.read", since: 5, doc: "Which profiles a run is in, whether it hears a node, and what a profile holds." },
];
