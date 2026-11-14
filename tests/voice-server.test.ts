import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readFileSync } from 'node:fs';
import { WebSocket } from 'ws';
import { createPromptServer } from '../server/app.ts';

async function openClient(url: string) {
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
  await next(message => message.type === 'state');
  return { ws, next, send: (message: unknown) => ws.send(JSON.stringify(message)) };
}

test('手机不能提交声控位置；只有本机进程能推进，而且旧世代无效', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'tongpin-voice-'));
  await writeFile(join(dir, 'index.html'), '<!doctype html><title>test</title>');
  const app = createPromptServer({ dataDir: dir, distDir: dir });
  await new Promise<void>(resolve => app.server.listen(0, '127.0.0.1', resolve));
  const port = (app.server.address() as { port: number }).port;
  const phone = await openClient(`ws://127.0.0.1:${port}/sync`);
  const mac = await openClient(`ws://127.0.0.1:${port}/sync`);
  try {
    assert.equal((await fetch(`http://127.0.0.1:${port}/api/voice`, { method: 'POST' })).status, 405);
    mac.send({ type: 'preferMode', mode: 'voice', docRevision: 0 });
    assert.match((await mac.next(message => message.type === 'error')).message, /Mac 应用/);
    assert.equal(app.getState().mode, 'timed');

    app.setModeHost(mode => { app.setFollowMode(mode); });
    mac.send({ type: 'preferMode', mode: 'voice', docRevision: 0 });
    assert.equal((await phone.next(message => message.type === 'state' && message.state.mode === 'voice')).state.mode, 'voice');

    mac.send({ type: 'apply', text: '我们今天出发去看海', docRevision: 0 });
    const applied = await phone.next(message => message.type === 'state' && message.state.docRevision === 1);
    mac.send({ type: 'voicePosition', epoch: applied.state.voiceEpoch, position: 8, docRevision: 1 });
    assert.match((await mac.next(message => message.type === 'error')).message, /无法识别/);
    mac.send({ type: 'setMode', mode: 'timed', docRevision: 1 });
    assert.equal((await mac.next(message => message.type === 'error')).type, 'error');
    mac.send({ type: 'voiceSession', docRevision: 1 });
    assert.equal((await mac.next(message => message.type === 'error')).type, 'error');
    assert.equal(app.getState().position, 0);
    assert.equal(app.getState().mode, 'voice');

    mac.send({ type: 'play', docRevision: 1 });
    const playing = await phone.next(message => message.type === 'state' && message.state.playing);
    const epoch = playing.state.voiceEpoch;
    assert.equal(app.submitVoicePosition(epoch - 1, 4), false);
    assert.equal(app.submitVoicePosition(epoch, 4), true);
    const followed = await phone.next(message => message.type === 'clock' && message.position === 4);
    assert.equal(followed.text, undefined);
    assert.equal(followed.mode, 'voice');
    assert.equal(app.submitVoicePosition(epoch, 3), false);
    assert.equal(app.getState().position, 4);

    mac.send({ type: 'pause', docRevision: 1 });
    await phone.next(message => message.type === 'state' && !message.state.playing && message.state.voiceEpoch > epoch);
    assert.equal(app.submitVoicePosition(epoch, 6), false);
    assert.equal(app.getState().position, 4);
    assert.ok(app.getState().voiceEpoch > epoch);
  } finally {
    phone.ws.terminate();
    mac.ws.terminate();
    await app.close();
    await rm(dir, { recursive: true, force: true });
  }
});

test('页面不会加载识别库，麦克风数据也不进入同步通道', () => {
  const root = new URL('..', import.meta.url);
  const read = (path: string) => readFileSync(new URL(path, root), 'utf8');
  for (const path of ['src/App.tsx', 'src/usePrompt.ts', 'src/Reader.tsx', 'src/voice-capture.ts', 'server/app.ts']) {
    assert.equal(read(path).includes('sherpa-onnx'), false, path);
  }
  const capture = read('src/voice-capture.ts');
  assert.equal(/new WebSocket|\/sync/.test(capture), false);
  assert.match(capture, /getUserMedia/);
  assert.match(read('src/desktop-host.ts'), /kind === 'desktop'/);
});
