import { execFileSync } from 'node:child_process';
import { mkdtemp, mkdir, readFile, writeFile, rm, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import assert from 'node:assert/strict';

const run = (command, args, cwd) => execFileSync(command, args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
const scratch = await mkdtemp(join(tmpdir(), 'browser-media-cache-package-'));
try {
  const packed = JSON.parse(run('npm', ['pack', '--ignore-scripts', '--json', '--pack-destination', scratch], process.cwd()))[0];
  const paths = packed.files.map(file => file.path);
  assert.ok(paths.includes('LICENSE'));
  assert.ok(paths.includes('dist/index.js') && paths.includes('dist/index.d.ts'));
  assert.ok(paths.includes('README.md') && paths.includes('docs/index.md'));
  assert.ok(paths.includes('docs/0.1.0/en.md') && paths.includes('docs/0.1.0/ru.md'));
  assert.ok(paths.every(path => path.startsWith('dist/') || path.startsWith('docs/') || /^assets\/lang-(en|ru)-(dark|light)\.svg$/.test(path) || ['README.md', 'ROADMAP.md', 'LICENSE', 'package.json'].includes(path)), paths.join('\n'));
  const consumer = join(scratch, 'consumer');
  await mkdir(consumer);
  await writeFile(join(consumer, 'package.json'), JSON.stringify({ private: true, type: 'module' }));
  run('npm', ['install', '--offline', '--ignore-scripts', '--no-audit', '--no-fund', join(scratch, packed.filename)], consumer);
  await assert.rejects(access(join(consumer, 'node_modules/react')));
  const installed = join(consumer, 'node_modules/@59alex/browser-media-cache');
  let checkedLinks = 0;
  for (const path of paths.filter(path => path.endsWith('.md'))) {
    const markdown = await readFile(join(installed, path), 'utf8');
    for (const [, href] of markdown.matchAll(/\]\(([^)]+)\)/g)) {
      if (/^[a-z][a-z\d+.-]*:/i.test(href) || href.startsWith('//')) continue;
      const target = href.split('#')[0];
      if (!target) continue;
      const destination = resolve(installed, dirname(path), decodeURIComponent(target));
      await assert.doesNotReject(access(destination), `${path}: missing packed link target ${href}`);
      checkedLinks++;
    }
  }
  console.log(`Packed documentation: ${checkedLinks} relative file links resolve.`);
  await writeFile(join(consumer, 'consumer.mjs'), `
    import assert from 'node:assert/strict';
    import { MediaCache } from '@59alex/browser-media-cache';
    import { CacheStorageStore } from '@59alex/browser-media-cache/cache-storage';
    assert.equal(typeof CacheStorageStore, 'function');
    const cache = new MediaCache({ load: async () => new Blob(['packed']), maxEntries: 0 });
    const handle = cache.acquire({ namespace: 'consumer', key: 'demo' });
    const { url } = await handle.ready;
    assert.equal(await (await fetch(url)).text(), 'packed');
    handle.release();
    assert.equal(cache.inspect().retainedBytes, 0);
    cache.dispose();
    console.log('Packed ESM imports, lifecycle, and optional React isolation passed.');
  `);
  console.log(run(process.execPath, ['consumer.mjs'], consumer).trim());
  await writeFile(join(consumer, 'consumer.ts'), `
    import { MediaCache, type MediaHandle, type BlobStore } from '@59alex/browser-media-cache';
    import { CacheStorageStore } from '@59alex/browser-media-cache/cache-storage';
    import type { MediaState } from '@59alex/browser-media-cache/react';
    const store: BlobStore = new CacheStorageStore();
    const cache = new MediaCache({ load: async () => new Blob(), store });
    const handle: MediaHandle = cache.acquire({ namespace: 'account', key: 'avatar' });
    handle.release(); cache.dispose();
    function renderState(state: MediaState): string {
      if (state.status === 'idle') return '';
      if (state.status === 'loading') return 'loading';
      if (state.status === 'error') return 'error';
      return state.resource.url;
    }
  `);
  run(resolve('node_modules/.bin/tsc'), ['--noEmit', '--strict', '--module', 'NodeNext', '--target', 'ES2022', '--lib', 'ES2022,DOM', 'consumer.ts'], consumer);
  const metadata = JSON.parse(await readFile(join(consumer, 'node_modules/@59alex/browser-media-cache/package.json'), 'utf8'));
  assert.equal(metadata.version, '0.1.0');
  console.log(`Packed TypeScript consumer passed; ${paths.length} files, ${packed.size} compressed bytes.`);
} finally {
  await rm(scratch, { recursive: true, force: true });
}
