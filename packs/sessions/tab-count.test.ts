// The tab bar's count of the sessions waiting on the owner (the sessions pack's part sessions.tab_count, task e_82rggead, docs/sessions.md):
// which open sessions count, in what order, what the tooltip says, where a press goes, and a tab's state mark.

import assert from 'node:assert/strict';
import { test } from 'node:test';
type Open = { id: string; title?: string; session?: { state: string; for?: string; line?: string; since: string } };
// A part's module, plain JavaScript with no types of its own.
const { countGoes, countTip, onYou, stateSaid } = (await import(`./parts/tab_count/${'state.js'}`)) as {
  onYou: (open: Open[]) => Open[];
  countTip: (yours: Open[], nameOf: (s: Open) => string) => string;
  countGoes: (yours: Open[], tabs: { id: string; chat?: string; follows?: string }[]) => { tab?: string; page?: string } | null;
  stateSaid: (session?: Open['session']) => { state: string; mark?: string; said: string } | null;
};

const at = (min: number) => new Date(Date.UTC(2026, 10, 3, 12, min)).toISOString();
const open: Open[] = [
  { id: 'e_working1', title: 'Busy', session: { state: 'working', line: 'Builds', since: at(0) } },
  { id: 'e_yourmove', title: 'Done asking', session: { state: 'your_move', line: 'Which way?', since: at(20) } },
  { id: 'e_unwired1', title: 'Old server' },
  { id: 'e_waiting1', title: 'Waits', session: { state: 'waiting', for: 'approval', line: 'May I push?', since: at(10) } },
  { id: 'e_blocked1', title: 'Stuck', session: { state: 'blocked', line: 'Needs CI', since: at(5) } },
  { id: 'e_waiting2', title: 'Waits later', session: { state: 'waiting', line: 'Run it?', since: at(30) } },
];

test('only waiting and your_move count, the one waiting longest first; a run with no session counts as nothing', () => {
  assert.deepEqual(onYou(open).map((s) => s.id), ['e_waiting1', 'e_yourmove', 'e_waiting2']);
  assert.deepEqual(onYou([{ id: 'e_unwired1' }]), []);
  assert.deepEqual(onYou([]), []);
});

test('the same since is ordered by run, so the count goes to the same one every time', () => {
  const same = [
    { id: 'e_bbbbbbbb', session: { state: 'waiting', since: at(1) } },
    { id: 'e_aaaaaaaa', session: { state: 'your_move', since: at(1) } },
  ];
  assert.deepEqual(onYou(same).map((s) => s.id), ['e_aaaaaaaa', 'e_bbbbbbbb']);
});

test('the tooltip lists them by line, oldest first, each with its mark', () => {
  assert.equal(countTip(onYou(open), (s) => s.title ?? s.id), '? Waits: May I push?\n↩ Done asking: Which way?\n? Waits later: Run it?');
});

test('a press goes to the oldest one’s own tab, else a tab following it, else its page', () => {
  const yours = onYou(open);
  assert.deepEqual(countGoes(yours, [{ id: 't1' }, { id: 't2', follows: 'e_waiting1' }, { id: 't3', chat: 'e_waiting1' }]), { tab: 't3' });
  assert.deepEqual(countGoes(yours, [{ id: 't1' }, { id: 't2', follows: 'e_waiting1' }]), { tab: 't2' });
  assert.deepEqual(countGoes(yours, [{ id: 't1', chat: 'e_yourmove' }]), { page: '#/e/e_waiting1' });
  assert.equal(countGoes([], [{ id: 't1' }]), null);
});

test('a tab’s state: a mark where it waits on the owner or is blocked, words with what it waits for, nothing unwired', () => {
  assert.deepEqual(stateSaid(open[3].session), { state: 'waiting', mark: '?', said: 'waits on you: approval' });
  assert.deepEqual(stateSaid(open[1].session), { state: 'your_move', mark: '↩', said: 'your move' });
  assert.equal(stateSaid(open[0].session)?.mark, undefined);
  assert.equal(stateSaid(undefined), null);
  assert.equal(stateSaid({ state: 'unheard', since: at(0) }), null);
});

