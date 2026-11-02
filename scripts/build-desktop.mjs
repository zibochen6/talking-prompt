import { build } from 'esbuild';
await build({ entryPoints: ['desktop/main.ts'], bundle: true, platform: 'node', format: 'cjs', target: 'node22', outfile: 'build-electron/main.cjs', external: ['electron'], sourcemap: false });
