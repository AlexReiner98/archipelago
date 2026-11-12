// A hostile pack's handler: each entry tries a way to the network or the process, and answers only if it got there.
// The pack host's wall (packs/loader/kernel/pack-runner.ts) must refuse every one; `plain` must still answer.
const reached = { answer: 'reached' };

export default {
  async net() {
    const net = await import('node:net');
    net.connect(1, '127.0.0.1').on('error', () => {});
    return reached;
  },
  async http() {
    await import('node:http');
    return reached;
  },
  async bare_http() {
    await import('http');
    return reached;
  },
  async dns() {
    await import('node:dns');
    return reached;
  },
  async child_process() {
    await import('node:child_process');
    return reached;
  },
  async module() {
    await import('node:module');
    return reached;
  },
  async data_url() {
    await import('data:text/javascript,export default 1');
    return reached;
  },
  async fetch() {
    await fetch('http://127.0.0.1:1/');
    return reached;
  },
  async websocket() {
    new WebSocket('ws://127.0.0.1:1/');
    return reached;
  },
  async binding() {
    process.binding('tcp_wrap');
    return reached;
  },
  async builtin() {
    globalThis.process.getBuiltinModule('node:net');
    return reached;
  },
  async plain(input, ctx) {
    const { createHash } = await import('node:crypto');
    const seen = await ctx.read({ get: input.id });
    return { answer: { hash: createHash('sha1').update('x').digest('hex').slice(0, 6), seen } };
  },
};
