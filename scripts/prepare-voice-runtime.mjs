import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, rmSync } from 'node:fs';
import { basename, join } from 'node:path';

const root = join(process.cwd(), 'node_modules');
const arch = process.env.PROMPT_SHERPA_ARCH || process.arch;
const platform = process.platform === 'win32' ? 'win' : process.platform;
const keep = `sherpa-onnx-${platform}-${arch}`;

if (existsSync(root)) {
  for (const name of readdirSync(root)) {
    if (!name.startsWith('sherpa-onnx-') || name === 'sherpa-onnx-node' || name === keep) continue;
    rmSync(join(root, name), { recursive: true, force: true });
    console.log(`已移出非目标识别运行库 ${name}`);
  }
}

const library = join(root, keep);
if (!existsSync(library)) {
  console.warn(`未找到 ${keep}。Mac 安装包里的声控跟随需要这个运行库；匀速滚动不受影响。`);
  process.exit(0);
}
if (process.platform !== 'darwin') {
  console.log('当前不是 macOS，跳过识别库的安装名修正。');
  process.exit(0);
}

const names = new Set(readdirSync(library));
function dependencies(file) {
  const output = execFileSync('otool', ['-L', file], { encoding: 'utf8' });
  return output.split('\n').slice(1).map(line => line.trim().split(/\s+/)[0]).filter(Boolean);
}
for (const name of names) {
  if (!name.endsWith('.dylib') && !name.endsWith('.node')) continue;
  const file = join(library, name);
  if (name.endsWith('.dylib')) execFileSync('install_name_tool', ['-id', `@loader_path/${name}`, file]);
  for (const dependency of dependencies(file)) {
    const linked = basename(dependency);
    if (!names.has(linked) || dependency === `@loader_path/${linked}`) continue;
    execFileSync('install_name_tool', ['-change', dependency, `@loader_path/${linked}`, file]);
    console.log(`已把 ${name} 的 ${linked} 改为 @loader_path`);
  }
}
console.log(`识别运行库 ${keep} 已按本机加载路径整理。`);
