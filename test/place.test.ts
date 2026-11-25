import assert from "node:assert/strict";
import { test } from "node:test";
import { placeAdvice, temporaryPlace } from "../scripts/place.ts";

test("a folder that goes away is named with why: the temp folder, an app's per-session folder, a session's worktree", () => {
  const tmp = "C:\\Users\\me\\AppData\\Local\\Temp";
  assert.match(temporaryPlace("C:\\Users\\me\\AppData\\Local\\Temp\\run-1\\archipelago", tmp)!, /temp folder/);
  assert.match(temporaryPlace("C:\\Users\\me\\AppData\\Roaming\\Claude\\scratch-workspaces\\abc\\archipelago", tmp)!, /scratch-workspaces/);
  assert.match(temporaryPlace("/home/me/code/archipelago/.claude/worktrees/feature-1", "/tmp")!, /session's worktree/);
  assert.match(temporaryPlace("/tmp/archipelago", "/tmp")!, /temp folder/);
});

test("a folder kept is not: Documents, a code folder, a live worktree beside it", () => {
  const tmp = "C:\\Users\\me\\AppData\\Local\\Temp";
  assert.equal(temporaryPlace("C:\\Users\\me\\Documents\\GitHub\\archipelago", tmp), undefined);
  assert.equal(temporaryPlace("C:\\Users\\me\\Documents\\GitHub\\archipelago-live", tmp), undefined);
  assert.equal(temporaryPlace("/home/me/code/archipelago", "/tmp"), undefined);
  assert.equal(temporaryPlace("/home/me/.claude-notes/archipelago", "/tmp"), undefined, "only .claude/worktrees, not any .claude");
  assert.equal(temporaryPlace("/home/me/tmpl/archipelago", "/tmp"), undefined, "a folder whose name starts like the temp folder's is not in it");
});

test("the refusal says where a map that lasts goes, and how to go on anyway", () => {
  const words = placeAdvice("/tmp/archipelago", "it is in the system's temp folder (/tmp)");
  assert.match(words, /^refused: \/tmp\/archipelago won't last: it is in the system's temp folder/);
  assert.match(words, /git clone https:\/\/github\.com\/AlexReiner98\/archipelago\.git/);
  assert.match(words, /--here-anyway/);
});
