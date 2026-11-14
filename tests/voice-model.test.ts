import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { resolveVoiceModel, VOICE_MODEL_DIR_NAME } from '../shared/voice-model.ts';

test('优先使用 int8 模型，也接受放在 .qa 或 models 下的目录', async () => {
  const root = await mkdtemp(join(tmpdir(), 'tongpin-model-'));
  const qa = join(root, '.qa', 'model', VOICE_MODEL_DIR_NAME);
  await mkdir(qa, { recursive: true });
  for (const name of ['encoder-epoch-99-avg-1.onnx', 'encoder-epoch-99-avg-1.int8.onnx', 'decoder-epoch-99-avg-1.onnx', 'joiner-epoch-99-avg-1.int8.onnx', 'tokens.txt']) {
    await writeFile(join(qa, name), name);
  }
  const found = resolveVoiceModel([undefined, root]);
  assert.ok(found);
  assert.equal(found.directory, qa);
  assert.match(found.encoder, /int8\.onnx$/);
  assert.match(found.decoder, /decoder-epoch-99-avg-1\.onnx$/);
  assert.match(found.joiner, /int8\.onnx$/);
  assert.equal(resolveVoiceModel([join(root, 'missing')]), null);
  const direct = resolveVoiceModel([`${qa}/`]);
  assert.ok(direct);
  assert.equal(direct.directory, `${qa}/`);
  assert.match(direct.encoder, /int8\.onnx$/);
  await rm(root, { recursive: true, force: true });
});
