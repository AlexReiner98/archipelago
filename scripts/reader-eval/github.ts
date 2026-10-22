// The stand-in GitHub a replay reads through: GitHub's answers recorded when the fixtures were exported, kept in one
// file beside them. What the model asks for that was not recorded (a file at some commit, a commit it chose to read)
// is read from a checkout of the repository with git, or else asked of GitHub with the gh command line and kept,
// so that the next replay of the same push is offline.

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';

export type Answers = Record<string, unknown>;

export const loadAnswers = (file: string): Answers => (existsSync(file) ? (JSON.parse(readFileSync(file, 'utf8')) as Answers) : {});
export const saveAnswers = (file: string, answers: Answers) => writeFileSync(file, JSON.stringify(answers));

/** Ask GitHub, as the person signed in to gh. */
export function gh(path: string): unknown {
  const out = execFileSync('gh', ['api', '-H', 'Accept: application/vnd.github+json', path.replace(/^\//, '')], { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] });
  return JSON.parse(out);
}

/** A file at a commit, from a checkout, as GitHub's contents API answers. */
function fromGit(checkout: string, path: string, ref: string): unknown {
  const content = execFileSync('git', ['-C', checkout, 'show', `${ref}:${path}`], { maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'ignore'] });
  return { type: 'file', path, size: content.length, content: content.toString('base64') };
}

export interface StandIn {
  /** GitHub's answer to a GET, as the App's installation. */
  asInstallation(installation: string, path: string): Promise<unknown>;
  repositories(installation: string): Promise<string[]>;
  /** What was answered from somewhere other than the recording. */
  misses: string[];
}

/**
 * GitHub as a replay sees it. `online` lets what was not recorded be asked of GitHub (and kept in `answers`);
 * `checkout` is a clone of the repository to read files from.
 */
export function standIn(answers: Answers, opts: { checkout?: string; online?: boolean } = {}): StandIn {
  const misses: string[] = [];
  return {
    misses,
    async repositories() {
      return [];
    },
    async asInstallation(_installation, path) {
      if (path in answers) return answers[path];
      const contents = /^\/repos\/[^/]+\/[^/]+\/contents\/([^?]*)\?ref=(.+)$/.exec(path);
      if (contents && opts.checkout) {
        try {
          return fromGit(opts.checkout, decodeURIComponent(contents[1]), decodeURIComponent(contents[2]));
        } catch {
          // Not in this checkout: GitHub, if it may be asked.
        }
      }
      if (!opts.online) throw new Error(`Not found (${path.split('?')[0]} was not recorded).`);
      misses.push(path);
      try {
        return (answers[path] = gh(path));
      } catch (err) {
        throw new Error(`GitHub answered: ${String((err as { stderr?: string }).stderr ?? (err as Error).message).trim().slice(0, 300)}`);
      }
    },
  };
}
