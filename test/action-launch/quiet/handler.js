// Answers n sessions to start on a task, each from a brief it holds (test/pack-action-launch.test.ts).
export default {
  async 'quiet.go'(input) {
    const launches = Array.from({ length: input.n }, (_, i) => ({
      task: input.task,
      brief: { task: { id: input.task, title: `Held ${i}` }, repo: { title: 'Repo', path: '.' }, text: `# Held ${i}` },
      by: { id: input.task, name: `Round ${i}`, round: i },
    }));
    return { launches };
  },
};
