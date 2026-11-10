// The tests' launching pack (test/server-launch.test.ts): it reads the lines its stand-in agent prints, as the
// claude_code pack will read Claude Code's stream-json. It sees each line and nothing else: no token, no map.
export default {
  read({ line }) {
    let m;
    try {
      m = JSON.parse(line);
    } catch {
      return { answer: null };
    }
    if (m.kind === 'said') return { answer: { said: m.text } };
    if (m.kind === 'usage') return { answer: { tokens: m.tokens } };
    if (m.kind === 'end') return { answer: { done: true, said: m.text, outcome: m.ok ? 'finished' : 'failed' } };
    return { answer: null };
  },
};
