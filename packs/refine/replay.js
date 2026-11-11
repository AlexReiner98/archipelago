// A fixed replay set, worked out without the map (the replays pack's types; task e_bagaw58f): which tasks a set takes
// and the held briefs it makes of them, and the sessions a replay asks the kernel to start. The handler reads; this
// answers. True replay under an old pack version waits on the log as the source of truth (e_jqck6rz6): until then a
// replay runs live, on a map that runs the version named, and is refused anywhere else.

/** How many tasks a set holds: enough to judge a change on, few enough to run twice. */
export const SET_LEAST = 5;
export const SET_MOST = 10;

const ISO = (d) => new Date(d).toISOString();

/**
 * What freezing asks of the map. set: the set (or null for a new one, named by title); held: its held briefs (props
 * task, order); asked: each task asked for, in order, as { id, task (the item, or null), brief (its brief view) }.
 * Tasks the set holds keep their brief. Throws, saying why, when a task is not finished or has nowhere to run.
 */
export function freezeAnswer({ set, title, held, asked, now }) {
  if (!set && !(typeof title === 'string' && title.trim())) throw new Error('A new replay set needs a title.');
  const have = new Set(held.map((b) => b.props?.task));
  const fresh = [];
  for (const { id, task, brief } of asked) {
    if (have.has(id) || fresh.some((f) => f.id === id)) continue;
    if (!task) throw new Error(`No task "${id}" on this map.`);
    if (task.is_open) throw new Error(`"${task.title}" is not finished: only finished work is replayed, so two versions are judged on what was done.`);
    if (!brief?.repo?.path) throw new Error(`"${task.title}" is not linked to a repository with a local path, so a replay has nowhere to run it.`);
    fresh.push({ id, task, brief });
  }
  const total = held.length + fresh.length;
  if (total < SET_LEAST || total > SET_MOST) throw new Error(`A replay set holds ${SET_LEAST} to ${SET_MOST} tasks; this one would hold ${total}.`);
  const into = set ? set.id : 'set';
  const ops = set ? [] : [{ op: 'create', ref: 'set', type: 'replays.set', title: title.trim(), status: 'current', body: `${SET_LEAST} to ${SET_MOST} finished tasks with their briefs held, run again under a named pack version.` }];
  const start = held.reduce((n, b) => Math.max(n, Number(b.props?.order ?? -1) + 1), 0);
  fresh.forEach(({ id, task, brief }, i) => {
    ops.push(
      { op: 'create', ref: `b${i}`, type: 'replays.brief', title: task.title.slice(0, 60), body: brief.text, props: { task: id, repo: brief.repo.title, path: brief.repo.path, frozen_at: ISO(now), order: start + i } },
      { op: 'link', type: 'part_of', from: `b${i}`, to: into },
    );
  });
  return {
    ops,
    reason: `Held ${fresh.length} briefs for the replay set${set ? ` "${set.title}"` : ''}`,
    answer: { set: set ? set.id : '{set}', held: total, added: fresh.map((f) => f.id) },
  };
}

/** Why a replay may not run under `version` (<pack>@<version>) where `packs` are in force, or undefined. */
export function versionRefused(version, packs) {
  const [pack, wanted] = typeof version === 'string' ? version.split('@') : [];
  if (!pack || !wanted) return `Name the version as <pack>@<version>, e.g. core@0.1.0, not "${version}".`;
  const here = packs.find((p) => p.id === pack);
  if (!here) return `No pack "${pack}" is on here.`;
  if (here.version !== wanted) return `This map runs ${pack}@${here.version}, not ${wanted}: replay on a map that runs the version named.`;
  return undefined;
}

/**
 * The sessions a replay asks the kernel to start: each held brief of the set, in its order, run as it is, its run
 * naming the set, the version and the task. Throws, saying why, when the version is not in force or the set is short.
 */
export function replayAnswer({ set, briefs, version, packs, mode, instructions }) {
  if (!set.is_open) throw new Error(`"${set.title}" is retired.`);
  const wrong = versionRefused(version, packs);
  if (wrong) throw new Error(wrong);
  if (briefs.length < SET_LEAST || briefs.length > SET_MOST) throw new Error(`"${set.title}" holds ${briefs.length} briefs; a replay needs ${SET_LEAST} to ${SET_MOST}.`);
  const ordered = [...briefs].sort((a, b) => Number(a.props?.order ?? 0) - Number(b.props?.order ?? 0));
  const launches = ordered.map((b) => ({
    task: b.props.task,
    ...(mode && { mode }),
    ...(instructions && { instructions }),
    brief: { task: { id: b.props.task, title: b.title }, repo: { title: b.props.repo, path: b.props.path }, text: b.body ?? '' },
    by: { id: set.id, name: `${set.title} (${version})`, version, task: b.props.task, brief: b.id },
  }));
  return { launches, answer: { set: set.id, version, briefs: ordered.length } };
}
