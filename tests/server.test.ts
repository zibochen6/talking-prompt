import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { WebSocket } from 'ws';
import { createPromptServer } from '../server/app.ts';

async function client(url: string) {
  const ws = new WebSocket(url);
  const messages: any[] = [];
  const waiters = new Set<() => void>();
  ws.on('message', data => { messages.push(JSON.parse(data.toString())); for (const wake of waiters) wake(); });
  const next = (predicate: (message: any) => boolean) => new Promise<any>((resolve, reject) => {
    const timeout = setTimeout(() => { waiters.delete(check); reject(new Error('等待同步消息超时')); }, 4000);
    function check() {
      const index = messages.findIndex(predicate);
      if (index >= 0) { const [message] = messages.splice(index, 1); clearTimeout(timeout); waiters.delete(check); resolve(message); }
    }
    waiters.add(check); check();
  });
  await next(m => m.type === 'state');
  return { ws, next, send: (message: unknown) => ws.send(JSON.stringify(message)) };
}

test('真实服务：双端控制、迟到操作、连接数、时钟、重连和磁盘恢复', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'tongpin-test-'));
  await writeFile(join(dir, 'index.html'), '<!doctype html><title>test</title>');
  let app = createPromptServer({ dataDir: dir, distDir: dir });
  await new Promise<void>(resolve => app.server.listen(0, '127.0.0.1', resolve));
  let port = (app.server.address() as { port: number }).port;
  const clients: WebSocket[] = [];
  t.after(async () => { clients.forEach(ws => ws.terminate()); await app.close(); await rm(dir, { recursive: true, force: true }); });
  const a = await client(`ws://127.0.0.1:${port}/sync`); clients.push(a.ws);
  const b = await client(`ws://127.0.0.1:${port}/sync`); clients.push(b.ws);
  assert.equal((await a.next(m => m.type === 'state' && m.clients === 2)).clients, 2);
  const info = await fetch(`http://127.0.0.1:${port}/api/connection`).then(r => r.json());
  assert.equal(info.port, port); assert.equal(info.name, '同频');
  assert.match(await fetch(`http://127.0.0.1:${port}/`).then(r => r.text()), /doctype/);
  assert.equal((await fetch(`http://127.0.0.1:${port}/%2e%2e%2fsecret`)).status, 404);
  a.send({ type: 'apply', text: '一份用于多设备同步的测试文稿。'.repeat(100), docRevision: 0 });
  const applied = await b.next(m => m.type === 'state' && m.state.docRevision === 1);
  assert.equal(applied.state.position, 0);
  b.send({ type: 'play', docRevision: 1 });
  assert.equal((await a.next(m => m.type === 'state' && m.state.playing)).state.playing, true);
  b.send({ type: 'speed', speed: 600, docRevision: 1 });
  assert.equal((await a.next(m => m.type === 'state' && m.state.speed === 600)).state.speed, 600);
  const tick = await a.next(m => m.type === 'clock' && m.playing && m.position > 0);
  assert.equal(tick.text, undefined); assert.ok(tick.position > 0);
  a.send({ type: 'seek', position: 32.5, docRevision: 1 });
  const sought = await b.next(m => m.type === 'state' && m.state.position === 32.5);
  assert.equal(sought.state.playing, false);
  b.send({ type: 'apply', text: '迟到文稿', docRevision: 0 });
  assert.match((await b.next(m => m.type === 'error')).message, /文稿已更新/);
  b.ws.send('{invalid json'); assert.equal((await b.next(m => m.type === 'error')).type, 'error');
  b.send({ type: 'ping', clientTime: 123 });
  assert.equal((await b.next(m => m.type === 'pong')).clientTime, 123);
  b.ws.close();
  await a.next(m => m.type === 'state' && m.clients === 1);
  const c = await client(`ws://127.0.0.1:${port}/sync`); clients.push(c.ws);
  c.send({ type: 'sync' });
  const rejoined = await c.next(m => m.type === 'state');
  assert.equal(rejoined.state.position, 32.5); assert.equal(rejoined.state.speed, 600);
  a.send({ type: 'play', docRevision: 1 });
  await c.next(m => m.type === 'state' && m.state.playing);
  await app.close();
  const saved = JSON.parse(await readFile(join(dir, 'session.json'), 'utf8'));
  assert.ok(saved.position >= 32.5);
  app = createPromptServer({ dataDir: dir, distDir: dir });
  await new Promise<void>(resolve => app.server.listen(0, '127.0.0.1', resolve));
  port = (app.server.address() as { port: number }).port;
  const d = await client(`ws://127.0.0.1:${port}/sync`); clients.push(d.ws); d.send({ type: 'sync' });
  const restored = await d.next(m => m.type === 'state');
  assert.equal(restored.state.playing, false); assert.equal(restored.state.speed, 600); assert.equal(restored.state.text, saved.text);
});
