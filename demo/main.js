import { MediaCache } from '../dist/index.js';
import { CacheStorageStore } from '../dist/cache-storage.js';
import { useMedia } from '../dist/react.js';
import React, { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const check = (value, message) => { if (!value) throw new Error(message); };
const identity = (key = 'fixture', namespace = 'demo-account') => ({ namespace, key });
const svg = new Blob(['<svg xmlns="http://www.w3.org/2000/svg" width="220" height="100"><rect width="220" height="100" rx="14" fill="#367b8a"/><circle cx="42" cy="50" r="20" fill="#b4f4df"/><text x="78" y="57" fill="white" font-family="sans-serif" font-size="18">shared media</text></svg>'], { type: 'image/svg+xml' });

function tracker() {
  const urls = new Set();
  let created = 0, revoked = 0;
  return {
    urls,
    get created() { return created; }, get revoked() { return revoked; },
    objectUrls: {
      create(blob) { const url = URL.createObjectURL(blob); created++; urls.add(url); return url; },
      revoke(url) { check(urls.delete(url), 'URL revoked exactly once'); revoked++; URL.revokeObjectURL(url); },
    },
  };
}

const mainTracker = tracker();
let mainLoads = 0;
const cache = new MediaCache({ load: async () => { mainLoads++; await sleep(30); return svg; }, idleTtlMs: 3000, maxEntries: 4, objectUrls: mainTracker.objectUrls });
const handles = new Map();
const refresh = () => {
  const state = cache.inspect();
  document.querySelector('#metrics').textContent = JSON.stringify({
    networkLoads: mainLoads, activeHandles: state.activeHandles, idleEntries: state.idleEntries,
    retainedBlobBytes: state.retainedBytes, ownedObjectUrls: mainTracker.urls.size,
    createdUrls: mainTracker.created, revokedUrls: mainTracker.revoked,
    overBudget: state.overBudget,
  }, null, 2);
};
for (const slot of ['a', 'b']) {
  document.querySelector(`#acquire-${slot}`).onclick = async () => {
    if (handles.has(slot)) return;
    const handle = cache.acquire(identity());
    handles.set(slot, handle);
    const img = document.querySelector(`#image-${slot}`);
    handle.signal.addEventListener('abort', () => { img.removeAttribute('src'); handles.delete(slot); refresh(); }, { once: true });
    try { const resource = await handle.ready; if (!handle.released) img.src = resource.url; }
    catch (error) { if (error?.name !== 'AbortError') document.querySelector('#results').textContent = String(error); }
    refresh();
  };
  document.querySelector(`#release-${slot}`).onclick = () => {
    document.querySelector(`#image-${slot}`).removeAttribute('src');
    handles.get(slot)?.release(); handles.delete(slot); refresh();
  };
}
document.querySelector('#logout').onclick = async () => { await cache.invalidateNamespace('demo-account'); refresh(); };
setInterval(refresh, 250);
refresh();

export async function runBrowserChecks() {
  const results = [];
  const metrics = tracker();
  let loads = 0;
  const instance = new MediaCache({ load: async () => { loads++; return svg; }, maxEntries: 0, objectUrls: metrics.objectUrls });
  try {
    const a = instance.acquire(identity()); const b = instance.acquire(identity());
    const one = await a.ready; const two = await b.ready;
    check(one.url === two.url && loads === 1, 'one shared load');
    const img = new Image(); img.src = one.url; await img.decode();
    check(img.naturalWidth === 220, 'real image decoded');
    a.release();
    check(await (await fetch(two.url)).text() === await svg.text(), 'second consumer still owns readable URL');
    img.removeAttribute('src'); b.release();
    check(metrics.urls.size === 0, 'final release evicts with zero idle budget');
    results.push('shared-load, image decode, partial release, final revoke: PASS');
  } finally { instance.dispose(); }

  const ttl = new MediaCache({ load: async () => svg, maxEntries: 1, idleTtlMs: 10, objectUrls: metrics.objectUrls });
  try {
    const a = ttl.acquire(identity('idle')); const old = await a.ready; a.release();
    const b = ttl.acquire(identity('active')); const active = await b.ready;
    check(!metrics.urls.has(old.url), 'entry pressure evicts idle media');
    await sleep(30);
    check(metrics.urls.has(active.url), 'idle TTL does not affect active ownership');
    b.release();
    const deadline = performance.now() + 1500;
    while (ttl.inspect().entries.length && performance.now() < deadline) await sleep(5);
    check(ttl.inspect().entries.length === 0, 'idle timer evicts without further calls');
    results.push('idle-only entry budget, active ownership, automatic idle TTL: PASS');
  } finally { ttl.dispose(); }

  let sourceAborts = 0;
  const pending = new MediaCache({ maxEntries: 0, objectUrls: metrics.objectUrls, load: ({ signal }) => new Promise((resolve, reject) => {
    const timer = setTimeout(() => resolve(svg), 30);
    signal.addEventListener('abort', () => { sourceAborts++; clearTimeout(timer); reject(signal.reason); }, { once: true });
  }) });
  try {
    const abort = new AbortController();
    const a = pending.acquire({ ...identity(), signal: abort.signal });
    const b = pending.acquire(identity());
    await sleep(0); abort.abort();
    await a.ready.catch(error => check(error.name === 'AbortError', 'per-handle abort reason'));
    await b.ready; check(sourceAborts === 0, 'other handle preserves load'); b.release();
    results.push('per-consumer cancellation: PASS');
  } finally { pending.dispose(); }

  let finishOld; let calls = 0;
  const race = new MediaCache({ maxEntries: 0, objectUrls: metrics.objectUrls, load: () => ++calls === 1 ? new Promise(resolve => { finishOld = resolve; }) : Promise.resolve(svg) });
  try {
    const old = race.acquire(identity()); await sleep(0);
    await race.invalidateNamespace('demo-account');
    await old.ready.catch(error => check(error.name === 'AbortError', 'logout aborts pending owner'));
    const fresh = race.acquire(identity()); const resource = await fresh.ready;
    finishOld(new Blob(['obsolete'])); await sleep(0); old.release();
    check(metrics.urls.has(resource.url) && race.inspect().retainedBytes === svg.size, 'late completion cannot replace fresh resource');
    fresh.release();
    results.push('logout generation guard and stale release: PASS');
  } finally { race.dispose(); }

  const prefix = `browser-media-cache:browser-test:${crypto.randomUUID()}:`;
  const store = new CacheStorageStore({ cachePrefix: prefix });
  let persistenceLoads = 0;
  const load = async () => { persistenceLoads++; return svg; };
  const first = new MediaCache({ store, load, persistence: 'required', objectUrls: metrics.objectUrls });
  const second = new MediaCache({ store, load, persistence: 'required', objectUrls: metrics.objectUrls });
  try {
    await first.acquire(identity('shared', 'alpha')).ready;
    first.dispose();
    const restored = second.acquire(identity('shared', 'alpha'));
    const resource = await restored.ready;
    check(persistenceLoads === 1 && resource.blob.type === 'image/svg+xml', 'persistent hit skips loader');
    await second.acquire(identity('shared', 'beta')).ready;
    await second.invalidateNamespace('alpha');
    check(restored.signal.aborted && !metrics.urls.has(resource.url), 'logout ends active resource ownership');
    check(await store.get(identity('shared', 'alpha')) === undefined, 'alpha storage cleared');
    check(await store.get(identity('shared', 'beta')) instanceof Blob, 'beta storage preserved');
    results.push('real CacheStorage hit, content type, namespace-only logout: PASS');
  } finally {
    first.dispose(); second.dispose();
    await store.clear('alpha'); await store.clear('beta');
  }
  check(metrics.urls.size === 0 && metrics.created === metrics.revoked, 'all scenario URLs reclaimed');
  return { status: 'PASS', checks: results, createdUrls: metrics.created, revokedUrls: metrics.revoked, browser: navigator.userAgent };
}

function Preview({ instance, namespace, mediaKey }) {
  const state = useMedia(instance, namespace, mediaKey);
  return state.status === 'ready'
    ? React.createElement('img', { src: state.resource.url, alt: 'React shared fixture', 'data-ready': 'true' })
    : React.createElement('span', { 'data-state': state.status }, state.status);
}

export async function runStressChecks() {
  const metrics = tracker();
  let loads = 0;
  const instance = new MediaCache({ load: async () => { loads++; return svg; }, maxEntries: 0, objectUrls: metrics.objectUrls });
  const started = performance.now();
  try {
    for (let i = 0; i < 500; i++) {
      const a = instance.acquire(identity(String(i))); const b = instance.acquire(identity(String(i)));
      const [one, two] = await Promise.all([a.ready, b.ready]);
      check(one.url === two.url, 'stress shared URL');
      if (i % 50 === 0) { const img = new Image(); img.src = one.url; await img.decode(); img.removeAttribute('src'); }
      a.release(); check(metrics.urls.has(two.url), 'stress second consumer protected'); b.release();
      check(instance.inspect().retainedBytes === 0 && metrics.urls.size === 0, 'stress returns to zero');
    }
    const host = document.querySelector('#react-lab');
    for (let i = 0; i < 100; i++) {
      const root = createRoot(host);
      try {
        flushSync(() => root.render(React.createElement(StrictMode, null,
          React.createElement(Preview, { instance, namespace: 'react', mediaKey: String(i) }),
          React.createElement(Preview, { instance, namespace: 'react', mediaKey: String(i) }))));
        const deadline = performance.now() + 3000;
        while (host.querySelectorAll('[data-ready]').length !== 2 && performance.now() < deadline) await sleep(2);
        check(host.querySelectorAll('[data-ready]').length === 2, 'two React consumers ready');
        check(instance.inspect().activeHandles === 2, 'StrictMode has no phantom handles');
        if (i === 0) {
          flushSync(() => root.render(React.createElement(StrictMode, null,
            React.createElement(Preview, { instance, namespace: 'react-next', mediaKey: String(i) }),
            React.createElement(Preview, { instance, namespace: 'react-next', mediaKey: String(i) }))));
          check(host.querySelectorAll('img').length === 0, 'namespace switch hides old account immediately');
          const nextDeadline = performance.now() + 3000;
          while (host.querySelectorAll('[data-ready]').length !== 2 && performance.now() < nextDeadline) await sleep(2);
          check(host.querySelectorAll('[data-ready]').length === 2, 'new namespace resolves both consumers');
          await instance.invalidateNamespace('react');
          check(instance.inspect().activeHandles === 2, 'old namespace cleanup does not affect new account');
          await instance.invalidateNamespace('react-next');
          await sleep(5);
          check(host.querySelectorAll('img').length === 0, 'React removes revoked media on logout');
        }
      } finally { flushSync(() => root.unmount()); }
      check(instance.inspect().activeHandles === 0 && metrics.urls.size === 0, 'React cleanup returns to zero');
    }
  } finally { instance.dispose(); }
  check(metrics.created === metrics.revoked, 'every stress URL was revoked once');
  return { status: 'PASS', vanillaCycles: 500, reactStrictModeCycles: 100, namespaceSwitches: 1, loads,
    createdUrls: metrics.created, revokedUrls: metrics.revoked, activeHandles: instance.inspect().activeHandles,
    retainedBytes: instance.inspect().retainedBytes, elapsedMs: Math.round(performance.now() - started), browser: navigator.userAgent };
}

async function showResult(button, operation) {
  const buttons = [...document.querySelectorAll('#checks, #stress')];
  buttons.forEach(item => { item.disabled = true; });
  document.querySelector('#results').textContent = 'Running…';
  try {
    const result = await operation();
    window.lastResult = result;
    document.querySelector('#results').textContent = JSON.stringify(result, null, 2);
    button.dataset.result = 'pass';
  } catch (error) {
    window.lastResult = { status: 'FAIL', error: String(error), stack: error.stack };
    document.querySelector('#results').textContent = JSON.stringify(window.lastResult, null, 2);
    button.dataset.result = 'fail';
  } finally { buttons.forEach(item => { item.disabled = false; }); }
}
document.querySelector('#checks').onclick = event => showResult(event.currentTarget, runBrowserChecks);
document.querySelector('#stress').onclick = event => showResult(event.currentTarget, runStressChecks);
window.runBrowserChecks = runBrowserChecks;
window.runStressChecks = runStressChecks;
