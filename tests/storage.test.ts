import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:net';
import { initialState } from '../shared/state.ts';
import { prepareDataDir, withReservedPort } from '../server/storage.ts';

test('旧文稿只迁移一次；原文件保留，新文稿不被覆盖', async t => {
  const root = await mkdtemp(join(tmpdir(), 'tongpin-migration-')); t.after(() => rm(root, { recursive: true, force: true }));
  const legacy = join(root, 'old'), canonical = join(root, 'app-data'); await mkdir(legacy);
  const original = JSON.stringify({ ...initialState(), text: '原文稿', position: 2 });
  await writeFile(join(legacy, 'session.json'), original);
  assert.equal(prepareDataDir(canonical, [legacy]).migrated, true);
  assert.equal(await readFile(join(canonical, 'session.json'), 'utf8'), original);
  assert.equal(await readFile(join(legacy, 'session.json'), 'utf8'), original);
  const updated = JSON.stringify({ ...initialState(), text: '新文稿' });
  await writeFile(join(canonical, 'session.json'), updated);
  assert.equal(prepareDataDir(canonical, [legacy]).migrated, false);
  assert.equal(await readFile(join(canonical, 'session.json'), 'utf8'), updated);
});
test('旧文稿损坏或目标目录不可用时中止迁移，保留原文件', async t => {
  const root = await mkdtemp(join(tmpdir(), 'tongpin-migration-')); t.after(() => rm(root, { recursive: true, force: true }));
  const legacy = join(root, 'old'); await mkdir(legacy);
  await writeFile(join(legacy, 'session.json'), 'bad json');
  assert.throws(() => prepareDataDir(join(root, 'data'), [legacy]), /原文稿无法读取/);
  assert.equal(await readFile(join(legacy, 'session.json'), 'utf8'), 'bad json');
  await writeFile(join(legacy, 'session.json'), JSON.stringify(initialState()));
  await writeFile(join(root, 'not-a-directory'), 'file');
  assert.throws(() => prepareDataDir(join(root, 'not-a-directory', 'data'), [legacy]));
  assert.ok((await readFile(join(legacy, 'session.json'), 'utf8')).includes('text'));
});
test('端口被占用时不迁移；端口预留期间无法被其他服务占用', async t => {
  const occupied = createServer(); await new Promise<void>(resolve => occupied.listen(0, '0.0.0.0', resolve));
  t.after(() => occupied.close());
  const port = (occupied.address() as { port: number }).port;
  let called = false;
  await assert.rejects(withReservedPort(port, () => { called = true; }), { code: 'EADDRINUSE' });
  assert.equal(called, false);
});
