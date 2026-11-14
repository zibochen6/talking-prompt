import { createWriteStream } from 'node:fs';
import { mkdir, rename, rm, stat } from 'node:fs/promises';
import { pipeline } from 'node:stream/promises';
import { join } from 'node:path';

const directory = join(process.cwd(), 'models', 'sherpa-onnx-streaming-zipformer-bilingual-zh-en-2023-02-20');
const base = 'https://huggingface.co/csukuangfj/sherpa-onnx-streaming-zipformer-bilingual-zh-en-2023-02-20/resolve/main/';
const files = [
  ['encoder-epoch-99-avg-1.int8.onnx', 181_895_032],
  ['decoder-epoch-99-avg-1.int8.onnx', 13_091_040],
  ['joiner-epoch-99-avg-1.int8.onnx', 3_228_404],
  ['tokens.txt', 56_317],
];

await mkdir(directory, { recursive: true });
for (const [name, bytes] of files) {
  const target = join(directory, name);
  try {
    if ((await stat(target)).size === bytes) {
      console.log(`已存在 ${name}`);
      continue;
    }
  } catch { /* Download it. */ }
  process.stdout.write(`下载 ${name}（${Math.round(bytes / 1_048_576)} MB）…\n`);
  const response = await fetch(`${base}${name}`, { redirect: 'follow' });
  if (!response.ok || !response.body) throw new Error(`下载 ${name} 失败：HTTP ${response.status}。也可从 https://github.com/k2-fsa/sherpa-onnx/releases/tag/asr-models 获取同名模型包。`);
  const partial = `${target}.partial`;
  try {
    await pipeline(response.body, createWriteStream(partial));
    const written = await stat(partial);
    if (written.size !== bytes) throw new Error(`${name} 大小是 ${written.size} 字节，期望 ${bytes} 字节。`);
    await rename(partial, target);
  } catch (error) {
    await rm(partial, { force: true });
    throw error;
  }
}
console.log(`语音模型已放在 ${directory}`);
