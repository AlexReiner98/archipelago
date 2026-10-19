// The deployed stack as a diagram: what runs where once Archipelago is on its own server, as the plan on the map
// says ("Plan: the sovereign stack and a fast loop", e_yyupdh9r). Not read from code: the services are listed here,
// so this is the one diagram to change by hand when the stack changes.

import { html, legend, style, type Edge, type Page, type Vertex } from './diagram-xml.ts';

interface Box { id: string; title: string; says: string; x: number; y: number; w?: number; h?: number; in?: string; tone: keyof typeof TONES; dashed?: boolean }
interface Wire { from: string; to: string; says: string; dashed?: boolean; tone?: string }

const TONES = {
  public: { fill: '#dae8fc', stroke: '#6c8ebf' },
  app: { fill: '#d5e8d4', stroke: '#82b366' },
  data: { fill: '#fff2cc', stroke: '#d6b656' },
  model: { fill: '#e1d5e7', stroke: '#9673a6' },
  ops: { fill: '#f5f5f5', stroke: '#666666' },
  outside: { fill: '#ffffff', stroke: '#999999' },
};

const AREAS: Array<{ id: string; title: string; x: number; y: number; w: number; h: number; fill: string }> = [
  { id: 'vps', title: 'OVHcloud VPS, Beauharnois, Quebec: Docker Compose', x: 260, y: 0, w: 760, h: 620, fill: '#fbfbf7' },
  { id: 'canada', title: 'OVH Object Storage, Beauharnois', x: 1080, y: 400, w: 240, h: 150, fill: '#fffdf0' },
  { id: 'paris', title: 'Scaleway, Paris', x: 1080, y: 180, w: 240, h: 150, fill: '#faf5fc' },
];

const BOXES: Box[] = [
  { id: 'people', title: 'People', says: 'the web UI at app.archipelago.tools', x: 0, y: 40, tone: 'outside' },
  { id: 'agents', title: 'Agent sessions', says: 'Claude Code over MCP, hooks', x: 0, y: 130, tone: 'outside' },
  { id: 'github', title: 'GitHub', says: 'push webhook, the GitHub App', x: 0, y: 220, tone: 'outside' },
  { id: 'laptop', title: 'Owner’s laptop', says: 'local server on a pulled copy', x: 0, y: 470, tone: 'outside' },
  { id: 'caddy', title: 'Caddy', says: 'the only public service: TLS, the trusted proxy, blue or green', x: 30, y: 40, w: 230, in: 'vps', tone: 'public' },
  { id: 'blue', title: 'app-blue', says: 'node src/server.ts, stateless', x: 510, y: 170, in: 'vps', tone: 'app' },
  { id: 'green', title: 'app-green', says: 'the idle colour, next deploy', x: 270, y: 170, in: 'vps', tone: 'app', dashed: true },
  { id: 'staging', title: 'staging', says: 'any branch, on a copy of live; acts on nothing outside', x: 30, y: 170, in: 'vps', tone: 'app', dashed: true },
  { id: 'deploy', title: 'Deploy script', says: 'build, test, migrate, start idle colour, switch, drain', x: 330, y: 40, in: 'vps', tone: 'ops' },
  { id: 'postgres', title: 'Postgres 17, pg_trgm', says: 'a control database (registry, GitHub App, local packs) and one database per workspace, row level security', x: 150, y: 320, w: 300, h: 70, in: 'vps', tone: 'data' },
  { id: 'litellm', title: 'LiteLLM', says: 'every model call: the push reader', x: 510, y: 320, in: 'vps', tone: 'model' },
  { id: 'backrest', title: 'pgBackRest', says: 'base backups and WAL', x: 510, y: 470, in: 'vps', tone: 'data' },
  { id: 'kuma', title: 'Uptime Kuma', says: 'watches /health on each colour', x: 560, y: 40, w: 180, in: 'vps', tone: 'ops' },
  { id: 'wireguard', title: 'WireGuard', says: 'the laptop’s way in', x: 30, y: 470, w: 100, in: 'vps', tone: 'ops' },
  { id: 'scaleway', title: 'Inference', says: 'prompts answered, nothing stored', x: 20, y: 50, in: 'paris', tone: 'model' },
  { id: 'storage', title: 'Backups', says: 'pgBackRest’s repository', x: 20, y: 50, in: 'canada', tone: 'data' },
];

const WIRES: Wire[] = [
  { from: 'people', to: 'caddy', says: 'HTTPS' },
  { from: 'agents', to: 'caddy', says: 'MCP, /hooks' },
  { from: 'github', to: 'caddy', says: 'webhook' },
  { from: 'caddy', to: 'blue', says: 'live' },
  { from: 'caddy', to: 'green', says: 'after the switch', dashed: true },
  { from: 'caddy', to: 'staging', says: 'staging.archipelago.tools', dashed: true },
  { from: 'caddy', to: 'deploy', says: 'a push' },
  { from: 'deploy', to: 'green', says: 'starts, waits for /health' , dashed: true },
  { from: 'blue', to: 'postgres', says: 'SQL; leader by advisory lock' },
  { from: 'green', to: 'postgres', says: '', dashed: true },
  { from: 'staging', to: 'postgres', says: 'copies by pg_dump, pg_restore', dashed: true },
  { from: 'blue', to: 'litellm', says: 'reads pushes' },
  { from: 'litellm', to: 'scaleway', says: 'prompts' },
  { from: 'backrest', to: 'postgres', says: 'WAL' },
  { from: 'backrest', to: 'storage', says: 'backups' },
  { from: 'laptop', to: 'wireguard', says: 'tunnel' },
  { from: 'wireguard', to: 'postgres', says: 'npm run pull', dashed: true },
  { from: 'wireguard', to: 'litellm', says: 'model calls', dashed: true },
];

export function stackDiagram(): Page[] {
  const vertices: Vertex[] = [], edges: Edge[] = [];
  for (const a of AREAS) {
    vertices.push({ id: a.id, label: a.title, x: a.x, y: a.y, w: a.w, h: a.h, style: style({ shape: 'swimlane', startSize: 30, html: 1, fontStyle: 1, fontSize: 13, rounded: 1, fillColor: a.fill, swimlaneFillColor: a.fill, strokeColor: '#888888' }) });
  }
  for (const b of BOXES) {
    const t = TONES[b.tone];
    vertices.push({
      id: b.id, label: `<b>${html(b.title)}</b><br><font style="font-size:10px">${html(b.says)}</font>`, parent: b.in,
      x: b.x, y: b.y + (b.in ? 30 : 0), w: b.w ?? 200, h: b.h ?? 56,
      style: style({ rounded: 1, html: 1, whiteSpace: 'wrap', fontSize: 12, fillColor: t.fill, strokeColor: t.stroke, dashed: b.dashed ? 1 : 0 }),
    });
  }
  WIRES.forEach((w, i) => edges.push({
    id: `w${i}-${w.from}-${w.to}`, from: w.from, to: w.to, label: w.says,
    style: style({ html: 1, rounded: 1, endArrow: 'open', fontSize: 10, labelBackgroundColor: '#ffffff', dashed: w.dashed ? 1 : 0, strokeColor: w.tone ?? '#555555' }),
  }));
  vertices.push(...legend('legend', 1080, 0, [
    [TONES.public.stroke, 'public edge'], [TONES.app.stroke, 'the app, two colours and staging'], [TONES.data.stroke, 'data and its backups'],
    [TONES.model.stroke, 'model calls'], ['#999999', 'dashed: idle, on demand or a copy'],
  ]));
  return [{ id: 'stack', name: 'Deployed stack', vertices, edges }];
}
