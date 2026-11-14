import { createServer, type ServerResponse } from 'node:http';
import { readFileSync, writeFileSync, mkdirSync, renameSync, existsSync, createReadStream, statSync } from 'node:fs';
import { resolve, extname, sep } from 'node:path';
import { networkInterfaces } from 'node:os';
import { WebSocketServer, WebSocket } from 'ws';
import { initialState, restoreState, settled, applyCommand, setFollowMode as applyFollowMode, reportVoicePosition, setVoiceStatus as applyVoiceStatus, type FollowMode, type PromptState, type VoiceStatus } from '../shared/state.ts';

export function createPromptServer(options: { dataDir: string; distDir: string; dev?: boolean }) {
  const statePath = resolve(options.dataDir, 'session.json');
  mkdirSync(options.dataDir, { recursive: true });
  let state = initialState();
  let warning = '';
  let modeHost: ((mode: FollowMode) => void) | null = null;
  const listeners = new Set<(current: PromptState) => void>();
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
  function broadcastClock() {
    const value = { type: 'clock', ...state, text: undefined, serverTime: Date.now(), clients: wss.clients.size, warning };
    for (const ws of wss.clients) send(ws, value);
  }
  function notify() { for (const listener of [...listeners]) listener(state); }
  const alive = new WeakMap<WebSocket, boolean>();
  wss.on('connection', ws => {
    alive.set(ws, true);
    ws.on('error', error => console.error('设备连接异常：', error.message));
    ws.on('pong', () => alive.set(ws, true));
    broadcast();
    ws.on('message', raw => {
      try {
        const command = JSON.parse(raw.toString());
        if (!command || typeof command !== 'object') throw new Error('无法识别的操作');
        if (command.type === 'ping') return send(ws, { type: 'pong', clientTime: command.clientTime, serverTime: Date.now() });
        if (command.type === 'sync') return send(ws, snapshot());
        // Phones may ask the desktop process to change mode. They cannot submit a position or a session.
        if (command.type === 'preferMode') {
          if (command.docRevision !== state.docRevision) throw new Error('文稿已更新，请等待同步后重试');
          if (command.mode !== 'timed' && command.mode !== 'voice') throw new Error('无法识别的跟随方式');
          if (command.mode === 'voice') {
            if (!modeHost) throw new Error('声控跟随需要在 Mac 应用里使用');
            modeHost('voice');
            return;
          }
          if (modeHost) { modeHost('timed'); return; }
          const timed = applyFollowMode(state, 'timed', Date.now());
          if (timed !== state) { state = timed; persist(); broadcast(); notify(); }
          return;
        }
        if (command.type === 'setMode' || command.type === 'voicePosition' || command.type === 'voiceSession' || command.type === 'voiceStatus') {
          throw new Error('无法识别的操作');
        }
        state = applyCommand(state, command, Date.now());
        persist();
        broadcast();
        notify();
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
    setModeHost(host: ((mode: FollowMode) => void) | null) { modeHost = host; },
    getState() { return state; },
    onState(listener: (current: PromptState) => void) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    setFollowMode(mode: FollowMode) {
      const next = applyFollowMode(state, mode, Date.now());
      if (next === state) return state;
      state = next; persist(); broadcast(); notify();
      return state;
    },
    submitVoicePosition(epoch: number, position: number) {
      const next = reportVoicePosition(state, epoch, position, Date.now());
      if (!next) return false;
      state = next;
      if (!state.playing) persist();
      broadcastClock();
      notify();
      return true;
    },
    setVoiceStatus(status: VoiceStatus) {
      const next = applyVoiceStatus(state, status);
      if (!next) return false;
      state = next;
      broadcastClock();
      notify();
      return true;
    },
    localCommand(input: unknown) {
      state = applyCommand(state, input, Date.now());
      persist(); broadcast(); notify();
      return state;
    },
    async close() {
      clearInterval(interval); clearInterval(heartbeat); persist();
      for (const ws of wss.clients) ws.terminate();
      await new Promise<void>(resolveClose => wss.close(() => resolveClose()));
      await new Promise<void>((resolveClose, reject) => server.close(error => error ? reject(error) : resolveClose()));
    }
  };
}
