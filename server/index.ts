import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createPromptServer } from './app.ts';
import { defaultDataDir, legacyDataDirs, prepareDataDir, withReservedPort } from './storage.ts';
const root = fileURLToPath(new URL('..', import.meta.url));
const dev = process.argv.includes('--dev');
const port = Number(process.env.PORT ?? 3210);
if (!Number.isInteger(port) || port < 1 || port > 65535) { console.error('端口无效，请设置 1–65535 之间的 PORT。'); process.exit(1); }
const dataDir = process.env.PROMPT_DATA_DIR ?? defaultDataDir();
try {
  await withReservedPort(port, () => prepareDataDir(dataDir, process.env.PROMPT_DATA_DIR ? [] : legacyDataDirs(root)));
} catch (error) {
  console.error((error as NodeJS.ErrnoException).code === 'EADDRINUSE' ? `端口 ${port} 已被占用。请关闭已运行的提词器。` : `启动失败：${error instanceof Error ? error.message : error}`);
  process.exit(1);
}
const app = createPromptServer({ dataDir, distDir: resolve(root, 'dist'), dev });
let vite: Awaited<ReturnType<typeof import('vite')['createServer']>> | undefined;
if (dev) {
  const { createServer } = await import('vite');
  vite = await createServer({ root, server: { middlewareMode: true, hmr: { server: app.server } }, appType: 'spa' });
  app.setDevHandler(vite.middlewares);
}
app.server.on('error', error => {
  console.error((error as NodeJS.ErrnoException).code === 'EADDRINUSE' ? `端口 ${port} 已被占用。请关闭已运行的提词器，或设置其他 PORT。` : `启动失败：${error.message}`);
  process.exit(1);
});
app.server.listen(port, '0.0.0.0', () => {
  console.log(`\n  同频 · 局域网提词器\n  本机打开：http://localhost:${port}\n  点击网页中的「连接设备」，让 iPhone 扫码加入。\n  保持此窗口开启，按 Control+C 停止服务。\n`);
  process.send?.({ type: 'ready', port });
});
let stopping = false;
async function stop() { if (stopping) return; stopping = true; await vite?.close(); await app.close(); process.exit(0); }
process.on('SIGINT', stop); process.on('SIGTERM', stop);
