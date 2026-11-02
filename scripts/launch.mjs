import { spawn, spawnSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
const root = fileURLToPath(new URL('..', import.meta.url));
process.chdir(root);
const [major, minor] = process.versions.node.split('.').map(Number);
if (major < 22 || (major === 22 && minor < 12)) { console.error('请先安装 Node.js 24 或更新的长期支持版本：https://nodejs.org/'); process.exit(1); }
const port = Number(process.env.PORT ?? 3210);
if (!Number.isInteger(port) || port < 1 || port > 65535) { console.error('启动失败：PORT 端口设置无效。'); process.exit(1); }
const url = `http://localhost:${port}`;
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
function run(args) { const result = spawnSync(npm, args, { cwd: root, stdio: 'inherit' }); if (result.status !== 0) { console.error('准备失败，请检查网络、Node.js 和文件夹权限，然后重新双击启动。'); process.exit(1); } }
function hashInputs() {
  const hash = createHash('sha256');
  for (const name of ['package.json', 'package-lock.json']) if (existsSync(name)) hash.update(readFileSync(name));
  return hash.digest('hex');
}
const installStamp = resolve(root, 'node_modules/.tongpin-dependencies');
let inputHash = hashInputs();
if (!existsSync(installStamp) || readFileSync(installStamp, 'utf8') !== inputHash) {
  console.log('首次准备或依赖已更新，正在安装所需组件…');
  run([existsSync('package-lock.json') ? 'ci' : 'install', '--no-audit', '--no-fund']);
  inputHash = hashInputs(); writeFileSync(installStamp, inputHash);
}
// Rebuild on source changes; normal subsequent launches work without internet.
const { readdirSync } = await import('node:fs');
function sourceHash() {
  const hash = createHash('sha256').update(inputHash);
  function walk(folder) { for (const entry of readdirSync(folder, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) { const path = resolve(folder, entry.name); if (entry.isDirectory()) walk(path); else hash.update(path).update(readFileSync(path)); } }
  walk(resolve(root, 'src')); walk(resolve(root, 'shared')); walk(resolve(root, 'public'));
  for (const path of ['index.html', 'vite.config.ts', 'tsconfig.json']) hash.update(readFileSync(path));
  return hash.digest('hex');
}
const source = sourceHash();
const buildStamp = resolve(root, 'dist/.tongpin-build');
if (!existsSync('dist/index.html') || !existsSync(buildStamp) || readFileSync(buildStamp, 'utf8') !== source) {
  console.log('正在准备提词界面…'); run(['run', 'build']); mkdirSync(resolve(root, 'dist'), { recursive: true }); writeFileSync(buildStamp, source);
}
console.log('正在启动同频…');
const child = spawn(process.execPath, ['--import', 'tsx', 'server/index.ts'], { cwd: root, stdio: ['inherit', 'inherit', 'inherit', 'ipc'], env: process.env });
let stopping = false;
let ready = false;
const timeout = setTimeout(() => {
  if (!ready && !stopping) { console.error('启动超时，请查看上方错误信息。'); child.kill('SIGTERM'); process.exitCode = 1; }
}, 15_000);
child.on('message', message => {
  if (message?.type !== 'ready' || ready || stopping) return;
  ready = true; clearTimeout(timeout);
  console.log(`\n准备好了：${url}\n保持此窗口开启，Mac 请勿休眠。\n`);
  if (process.platform === 'darwin' && !process.env.PROMPT_NO_OPEN) spawn('open', [url], { stdio: 'ignore' }).unref();
});
child.on('error', error => { clearTimeout(timeout); console.error(`启动失败：${error.message}`); process.exitCode = 1; });
child.on('exit', code => { clearTimeout(timeout); stopping = true; process.exitCode = code ?? 0; });
for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.on(signal, () => { stopping = true; clearTimeout(timeout); child.kill(signal); });
