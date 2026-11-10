// The tests' adapter: rover's hooks are begin, turn and ping, its body { sid, dir }; what it reads back is { context }
// or { keep_going }. ping is no hook the kernel is asked.
const EVENTS = { begin: 'session-start', turn: 'stop' };
export default {
  inward: ({ event, body }) => ({ answer: EVENTS[event] ? { event: EVENTS[event], body: { session_id: body.sid, cwd: body.dir } } : {} }),
  outward: ({ event, kernel, answer }) => ({
    answer: answer.told !== undefined ? { context: answer.told, on: event } : answer.go_on !== undefined ? { keep_going: answer.go_on } : { on: event, kernel: kernel ?? null },
  }),
};
