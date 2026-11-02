import { createServer, type ServerResponse } from 'node:http';
import { readFileSync, writeFileSync, mkdirSync, renameSync, existsSync, createReadStream, statSync } from 'node:fs';
import { resolve, extname, sep } from 'node:path';
import { networkInterfaces } from 'node:os';
import { WebSocketServer, WebSocket } from 'ws';
import { initialState, restoreState, settled, applyCommand } from '../shared/state.ts';

export function createPromptServer(options: { dataDir: string; distDir: string; dev?: boolean }) {
  const statePath = resolve(options.dataDir, 'session.json');
  mkdirSync(options.dataDir, { recursive: true });
  let state = initialState();
  let warning = '';
  if (existsSync(statePath)) {
    try { state = restoreState(JSON.parse(readFileSync(statePath, 'utf8')), Date.now()); }
    catch (error) {
      renameSync(statePath, `${statePath}.backup-${Date.now()}`);
      warning = '上次保存的数据无法读取，原文件已备份。请重新应用文稿。';
      console.error(warning, error);
    }
  }
  function persist() {
    try {
      writeFileSync(`${statePath}.tmp`, JSON.stringify(settled(state, Date.now())), 'utf8');
      renameSync(`${statePath}.tmp`, statePath);
      if (warning.startsWith('无法保存')) warning = '';
    } catch (error) {
      warning = '无法保存到 Mac，请检查磁盘空间和文件夹权限。';
      console.error(warning, error);
    }
  }
  const json = (res: ServerResponse, value: unknown, code = 200) => {
    res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify(value));
  };
  let devHandler: ((req: any, res: any, next: () => void) => void) | undefined;
  const server = createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    if (req.method !== 'GET' && req.method !== 'HEAD') return json(res, { error: '不支持此操作' }, 405);
    if (url.pathname === '/api/connection') {
      const address = server.address();
      const port = typeof address === 'object' && address ? address.port : 3210;
      const addresses = Object.entries(networkInterfaces()).flatMap(([name, entries]) =>
        (entries ?? []).filter(entry => !entry.internal && entry.family === 'IPv4' && !name.startsWith('utun'))
          .map(entry => ({ name, url: `http://${entry.address}:${port}`, priority: name === 'en0' ? 0 : name.startsWith('en') ? 1 : 2 })))
        .sort((a, b) => a.priority - b.priority);
      return json(res, { name: '同频', port, addresses, localUrl: `http://localhost:${port}` });
    }
    if (devHandler) return devHandler(req, res, () => json(res, { error: '页面不存在' }, 404));
    let path: string;
    try { path = resolve(options.distDir, `.${decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname)}`); }
    catch { return json(res, { error: '地址无效' }, 400); }
    if (!path.startsWith(`${resolve(options.distDir)}${sep}`) || !existsSync(path) || !statSync(path).isFile())
      return json(res, { error: '页面不存在，请先构建应用' }, 404);
    const contentTypes: Record<string, string> = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png' };
    res.writeHead(200, { 'Content-Type': contentTypes[extname(path)] ?? 'application/octet-stream',
      'Cache-Control': extname(path) === '.html' ? 'no-cache' : 'public, max-age=3600', 'X-Content-Type-Options': 'nosniff' });
    if (req.method === 'HEAD') return res.end();
    createReadStream(path).on('error', () => res.destroy()).pipe(res);
  });
  const wss = new WebSocketServer({ noServer: true, maxPayload: 512 * 1024 });
  server.on('upgrade', (req, socket, head) => {
    if (new URL(req.url ?? '/', 'http://localhost').pathname !== '/sync') {
      if (!options.dev) socket.destroy();
      return;
    }
    try {
      if (req.headers.origin && new URL(req.headers.origin).host !== req.headers.host) { socket.destroy(); return; }
    } catch { socket.destroy(); return; }
    wss.handleUpgrade(req, socket, head, ws => wss.emit('connection', ws, req));
  });
  const send = (ws: WebSocket, message: unknown) => {
    if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(message));
  };
  function snapshot() { return { type: 'state', state: settled(state, Date.now()), serverTime: Date.now(), clients: wss.clients.size, warning }; }
  function broadcast() { const value = snapshot(); for (const ws of wss.clients) send(ws, value); }
  const alive = new WeakMap<WebSocket, boolean>();
  wss.on('connection', ws => {
    alive.set(ws, true);
    ws.on('error', error => console.error('设备连接异常：', error.message));
    ws.on('pong', () => alive.set(ws, true));
    broadcast();
    ws.on('message', raw => {
      try {
        const command = JSON.parse(raw.toString());
        if (command.type === 'ping') return send(ws, { type: 'pong', clientTime: command.clientTime, serverTime: Date.now() });
        if (command.type === 'sync') return send(ws, snapshot());
        state = applyCommand(state, command, Date.now());
        persist();
        broadcast();
      } catch (error) {
        send(ws, { type: 'error', message: error instanceof Error ? error.message : '操作失败' });
        send(ws, snapshot());
      }
    });
    ws.on('close', broadcast);
  });
  const interval = setInterval(() => {
    const next = settled(state, Date.now());
    const ended = state.playing && !next.playing;
    state = next;
    if (state.playing || ended) persist();
    for (const ws of wss.clients) send(ws, { type: 'clock', ...state, text: undefined, serverTime: Date.now(), clients: wss.clients.size, warning });
  }, 1000);
  const heartbeat = setInterval(() => {
    for (const ws of wss.clients) {
      if (!alive.get(ws)) { ws.terminate(); continue; }
      alive.set(ws, false); ws.ping();
    }
  }, 10_000);
  return {
    server,
    setDevHandler(handler: typeof devHandler) { devHandler = handler; },
    async close() {
      clearInterval(interval); clearInterval(heartbeat); persist();
      for (const ws of wss.clients) ws.terminate();
      await new Promise<void>(resolveClose => wss.close(() => resolveClose()));
      await new Promise<void>((resolveClose, reject) => server.close(error => error ? reject(error) : resolveClose()));
    }
  };
}
