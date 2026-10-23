import { spawn } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { chromium, firefox } from 'playwright';

const server = spawn(process.execPath, ['scripts/serve-demo.mjs'], {
  env: { ...process.env, PORT: '0' }, stdio: ['ignore', 'pipe', 'inherit'],
});
const reports = [];
await mkdir('output/playwright', { recursive: true });
try {
  const baseUrl = await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Demo server startup timed out')), 10_000);
    server.once('error', error => { clearTimeout(timeout); reject(error); });
    server.once('exit', code => { clearTimeout(timeout); reject(new Error(`Demo server exited: ${code}`)); });
    server.stdout.on('data', data => {
      const match = data.toString().match(/Demo: (http:\/\/127\.0\.0\.1:\d+)/);
      if (match) { clearTimeout(timeout); resolve(match[1]); }
    });
  });
  const engines = { chromium, firefox };
  for (const name of (process.env.BROWSERS ?? 'chromium,firefox').split(',')) {
    assert.ok(engines[name], `Unknown browser ${name}`);
    const executablePath = process.env[`BROWSER_EXECUTABLE_${name.toUpperCase()}`];
    const browser = await engines[name].launch({ headless: true, ...(executablePath ? { executablePath } : {}) });
    try {
      const page = await browser.newPage({ viewport: { width: 1280, height: 960 } });
      const errors = [];
      page.on('pageerror', error => errors.push(String(error)));
      page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
      await page.goto(baseUrl);
      await page.click('#acquire-a');
      await page.click('#acquire-b');
      await page.waitForFunction(() => [...document.querySelectorAll('#image-a, #image-b')]
        .every(image => image.complete && image.naturalWidth === 220));
      assert.equal(await page.evaluate(() => JSON.parse(document.querySelector('#metrics').textContent).networkLoads), 1);
      assert.equal(await page.evaluate(() => document.querySelector('#image-a').src === document.querySelector('#image-b').src), true);
      await page.click('#release-a');
      assert.equal(await page.evaluate(() => JSON.parse(document.querySelector('#metrics').textContent).activeHandles), 1);
      assert.equal(await page.evaluate(() => document.querySelector('#image-b').hasAttribute('src')), true);
      await page.click('#logout');
      await page.waitForFunction(() => JSON.parse(document.querySelector('#metrics').textContent).ownedObjectUrls === 0);
      assert.equal(await page.evaluate(() => document.querySelectorAll('#image-a[src], #image-b[src]').length), 0);
      await page.click('#checks');
      await page.waitForFunction(() => window.lastResult?.checks || window.lastResult?.status === 'FAIL');
      const lifecycle = await page.evaluate(() => window.lastResult);
      assert.equal(lifecycle.status, 'PASS', JSON.stringify(lifecycle));
      await page.click('#stress');
      await page.waitForFunction(() => window.lastResult?.vanillaCycles || window.lastResult?.status === 'FAIL', null, { timeout: 60_000 });
      const stress = await page.evaluate(() => window.lastResult);
      assert.equal(stress.status, 'PASS', JSON.stringify(stress));
      assert.deepEqual(errors, [], 'No browser errors during lifecycle and stress checks');
      await page.screenshot({ path: `output/playwright/${name}.png`, fullPage: true });
      const report = { engine: name, version: browser.version(), demoControls: 'PASS', lifecycle, stress, errors };
      reports.push(report);
      console.log(`${name} ${browser.version()}: lifecycle PASS; ${stress.vanillaCycles} vanilla + ${stress.reactStrictModeCycles} React cycles PASS; ${stress.createdUrls}/${stress.revokedUrls} URLs; ${stress.activeHandles} handles; ${stress.retainedBytes} retained bytes.`);
    } finally { await browser.close(); }
  }
  await writeFile('output/playwright/results.json', JSON.stringify({ timestamp: new Date().toISOString(), reports }, null, 2) + '\n');
} finally { server.kill('SIGTERM'); }
