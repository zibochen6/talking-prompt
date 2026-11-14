import { build } from 'esbuild';

await build({
  entryPoints: {
    main: 'desktop/main.ts',
    preload: 'desktop/preload.ts',
    'speech-worker': 'desktop/speech-worker.ts',
  },
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node22',
  outdir: 'build-electron',
  outExtension: { '.js': '.cjs' },
  external: ['electron', 'sherpa-onnx-node'],
  sourcemap: false,
});
