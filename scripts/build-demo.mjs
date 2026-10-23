import { build } from 'esbuild';

await build({
  entryPoints: ['demo/main.js'], outfile: 'demo/bundle.js',
  bundle: true, format: 'esm', platform: 'browser', target: 'es2022',
  define: { 'process.env.NODE_ENV': '"development"' },
});
console.log('Built demo/bundle.js (React development mode for StrictMode checks).');
