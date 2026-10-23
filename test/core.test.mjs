import test from 'node:test';
import assert from 'node:assert/strict';
import { setTimeout as sleep, setImmediate as tick } from 'node:timers/promises';
import { MediaCache } from '../dist/index.js';

const key = (id = 'image', namespace = 'account-a') => ({ namespace, key: id });
function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
function fixture(t, options = {}) {
  let next = 0;
  const live = new Map();
  const revoked = [];
  const cache = new MediaCache({
    load: async () => new Blob(['media']),
    idleTtlMs: 60_000,
    objectUrls: {
      create(blob) { const url = `blob:test-${++next}`; live.set(url, blob); return url; },
      revoke(url) { assert.ok(live.delete(url), `revoke once: ${url}`); revoked.push(url); },
    },
    ...options,
  });
  t.after(() => cache.dispose());
  return { cache, live, revoked };
}

test('two handles share one load and URL; releasing one preserves the other', async t => {
  let loads = 0;
  const { cache, live } = fixture(t, { load: async () => { loads++; return new Blob(['abc']); } });
  const first = cache.acquire(key());
  const second = cache.acquire(key());
  const [a, b] = await Promise.all([first.ready, second.ready]);
  assert.equal(loads, 1);
  assert.equal(a, b);
  assert.equal(cache.inspect().activeHandles, 2);
  first.release(); first.release();
  assert.equal(first.released, true);
  assert.equal(first.signal.aborted, true);
  assert.equal(second.signal.aborted, false);
  assert.ok(live.has(b.url));
  second.release();
  assert.equal(cache.inspect().idleEntries, 1);
  assert.equal(cache.inspect().retainedBytes, 3);
});

test('one aborted consumer does not cancel shared load; final pending release does', async t => {
  const gate = deferred();
  let sourceSignal;
  const { cache } = fixture(t, { load: async ({ signal }) => { sourceSignal = signal; return gate.promise; } });
  const abort = new AbortController();
  const a = cache.acquire({ ...key(), signal: abort.signal });
  const b = cache.acquire(key());
  await tick();
  abort.abort(new Error('caller left'));
  await assert.rejects(a.ready, /caller left/);
  assert.equal(sourceSignal.aborted, false);
  b.release();
  await assert.rejects(b.ready, { name: 'AbortError' });
  assert.equal(sourceSignal.aborted, true);
  assert.equal(cache.inspect().entries.length, 0);
  gate.resolve(new Blob(['late']));
  await tick();
  assert.equal(cache.inspect().retainedBytes, 0);
});

test('already aborted acquire and immediate release never invoke the loader', async t => {
  let loads = 0;
  const { cache } = fixture(t, { load: async () => { loads++; return new Blob(); } });
  const a = cache.acquire({ ...key(), signal: AbortSignal.abort() });
  const b = cache.acquire(key());
  b.release();
  await assert.rejects(a.ready, { name: 'AbortError' });
  await assert.rejects(b.ready, { name: 'AbortError' });
  await tick();
  assert.equal(loads, 0);
});

test('abort after ready releases only its ownership', async t => {
  const { cache, live } = fixture(t, { maxEntries: 0 });
  const abort = new AbortController();
  const first = cache.acquire({ ...key(), signal: abort.signal });
  const second = cache.acquire(key());
  const { url } = await first.ready;
  await second.ready;
  abort.abort();
  assert.equal(cache.inspect().activeHandles, 1);
  assert.ok(live.has(url));
  second.release();
  assert.equal(live.size, 0);
});

test('failed loads reject all consumers and retry with a new generation', async t => {
  let attempts = 0;
  const problem = new Error('network failed');
  const { cache } = fixture(t, { load: async () => {
    if (++attempts === 1) throw problem;
    return new Blob(['retry']);
  } });
  const a = cache.acquire(key());
  const b = cache.acquire(key());
  const generation = cache.inspect().entries[0].generation;
  await assert.rejects(a.ready, error => error === problem);
  await assert.rejects(b.ready, error => error === problem);
  assert.equal(a.signal.aborted, true);
  const replacement = cache.acquire(key());
  assert.ok(cache.inspect().entries[0].generation > generation);
  await replacement.ready;
  assert.equal(attempts, 2);
});

test('late completion and stale release cannot overwrite or revoke replacement', async t => {
  const old = deferred();
  let loads = 0;
  const { cache, live, revoked } = fixture(t, { load: () => ++loads === 1 ? old.promise : Promise.resolve(new Blob(['new'])) });
  const first = cache.acquire(key());
  await tick();
  first.release();
  await assert.rejects(first.ready);
  const second = cache.acquire(key());
  const fresh = await second.ready;
  old.resolve(new Blob(['obsolete much bigger payload']));
  await tick();
  first.release();
  assert.equal(await fresh.blob.text(), 'new');
  assert.equal(cache.inspect().retainedBytes, 3);
  assert.deepEqual([...live.keys()], [fresh.url]);
  assert.equal(revoked.length, 0);
});

test('idle TTL expires from last release and reacquire protects the URL', async t => {
  let now = 0;
  const { cache, live } = fixture(t, { idleTtlMs: 1000, now: () => now });
  const first = cache.acquire(key());
  const resource = await first.ready;
  first.release();
  now = 999;
  const second = cache.acquire(key());
  assert.equal(await second.ready, resource);
  now = 2000; cache.collect();
  assert.ok(live.has(resource.url));
  second.release();
  now = 2999; cache.collect();
  assert.ok(live.has(resource.url));
  now = 3000; cache.collect();
  assert.equal(live.size, 0);
});

test('a timer automatically collects idle URLs without another acquire', async t => {
  const { cache, live } = fixture(t, { idleTtlMs: 5 });
  const handle = cache.acquire(key());
  await handle.ready;
  handle.release();
  const deadline = Date.now() + 1000;
  while (live.size && Date.now() < deadline) await sleep(5);
  assert.equal(live.size, 0);
  assert.equal(cache.inspect().idleEntries, 0);
});

test('entry pressure evicts the least recently idle entry, never an active handle', async t => {
  const { cache, live } = fixture(t, { maxEntries: 2 });
  const a = cache.acquire(key('a')); const ar = await a.ready; a.release();
  const b = cache.acquire(key('b')); const br = await b.ready; b.release();
  const aAgain = cache.acquire(key('a')); await aAgain.ready; aAgain.release();
  const c = cache.acquire(key('c')); await c.ready;
  assert.ok(live.has(ar.url));
  assert.equal(live.has(br.url), false);
  assert.deepEqual(cache.inspect().entries.map(entry => entry.key).sort(), ['a', 'c']);
});

test('active bytes may exceed the budget; final release makes them evictable', async t => {
  const { cache, live } = fixture(t, { maxBytes: 2, load: async () => new Blob(['oversize']) });
  const a = cache.acquire(key()); const resource = await a.ready;
  assert.equal(cache.inspect().overBudget, true);
  assert.equal(cache.inspect().retainedBytes, 8);
  assert.ok(live.has(resource.url));
  a.release();
  assert.equal(live.size, 0);
  assert.equal(cache.inspect().overBudget, false);
});

test('budget eviction does not revoke an idle sibling reacquired by an abort listener', async t => {
  let replacement;
  const { cache, live } = fixture(t, { maxBytes: 13, load: async ({ key: id, signal }) => {
    if (id === 'a') signal.addEventListener('abort', () => {
      void cache.invalidate(key('c'));
      replacement = cache.acquire(key('b'));
    });
    return new Blob([id === 'large' ? '0123456789' : 'abc']);
  } });
  const a = cache.acquire(key('a')); await a.ready; a.release();
  const b = cache.acquire(key('b')); const resource = await b.ready; b.release();
  const c = cache.acquire(key('c')); await c.ready; c.release();
  const large = cache.acquire(key('large')); await large.ready;
  assert.equal(replacement.released, false);
  assert.equal(await replacement.ready, resource);
  assert.ok(live.has(resource.url));
  assert.equal(cache.inspect().activeHandles, 2);
  assert.equal(cache.inspect().overBudget, false);
});

test('acquire cannot resurrect a cache disposed by idle eviction callbacks', async t => {
  let now = 0;
  const { cache } = fixture(t, { idleTtlMs: 100, now: () => now,
    load: async ({ signal }) => {
      signal.addEventListener('abort', () => cache.dispose());
      return new Blob(['a']);
    } });
  const a = cache.acquire(key('a')); await a.ready; a.release();
  now = 100;
  assert.throws(() => cache.acquire(key('new')), /disposed/);
  assert.equal(cache.inspect().disposed, true);
  assert.equal(cache.inspect().entries.length, 0);
});

test('namespace identity is collision-free and invalidation is scoped', async t => {
  const { cache, live } = fixture(t);
  const a = cache.acquire(key('b:c', 'a'));
  const b = cache.acquire(key('c', 'a:b'));
  const ar = await a.ready; const br = await b.ready;
  assert.notEqual(ar.url, br.url);
  await cache.invalidateNamespace('a');
  assert.equal(a.signal.aborted, true);
  assert.equal(a.released, true);
  assert.equal(b.signal.aborted, false);
  assert.equal(live.has(ar.url), false);
  assert.ok(live.has(br.url));
});

test('logout prevents ignored loader completion from recreating a URL', async t => {
  const gate = deferred();
  const { cache, live } = fixture(t, { load: () => gate.promise });
  const handle = cache.acquire(key());
  await tick();
  await cache.invalidateNamespace('account-a');
  gate.resolve(new Blob(['old-account']));
  await assert.rejects(handle.ready, { name: 'AbortError' });
  await tick();
  assert.equal(cache.inspect().entries.length, 0);
  assert.equal(live.size, 0);
});

test('invalidation unlinks every old generation before reentrant acquire', async t => {
  const { cache, live } = fixture(t);
  const first = cache.acquire(key('a'));
  const sibling = cache.acquire(key('b'));
  const old = await sibling.ready; await first.ready;
  let replacement;
  first.signal.addEventListener('abort', () => { replacement = cache.acquire(key('b')); });
  await cache.invalidateNamespace('account-a');
  const fresh = await replacement.ready;
  assert.notEqual(fresh.url, old.url);
  assert.ok(live.has(fresh.url));
  assert.equal(replacement.signal.aborted, false);
});

test('single-key invalidate revokes active URL and allows replacement', async t => {
  const { cache, live } = fixture(t);
  const first = cache.acquire(key()); const old = await first.ready;
  await cache.invalidate(key());
  const next = cache.acquire(key()); const fresh = await next.ready;
  first.release();
  assert.equal(first.signal.aborted, true);
  assert.equal(live.has(old.url), false);
  assert.ok(live.has(fresh.url));
});

test('dispose aborts pending work, revokes ready URLs, and prevents reuse', async t => {
  const gate = deferred();
  const { cache, live, revoked } = fixture(t, { load: ({ key }) => key === 'pending' ? gate.promise : Promise.resolve(new Blob(['ready'])) });
  const ready = cache.acquire(key('ready')); await ready.ready;
  const pending = cache.acquire(key('pending')); await tick();
  cache.dispose(); cache.dispose();
  await assert.rejects(pending.ready, { name: 'AbortError' });
  gate.resolve(new Blob(['ignored'])); await tick();
  assert.equal(ready.signal.aborted, true);
  assert.equal(live.size, 0);
  assert.equal(revoked.length, 1);
  assert.equal(cache.inspect().disposed, true);
  assert.throws(() => cache.acquire(key()), /disposed/);
  assert.throws(() => cache.invalidateNamespace('account-a'), /disposed/);
});

test('invalid options fail explicitly and diagnostics cannot be mutated', async t => {
  assert.throws(() => new MediaCache({ load: async () => new Blob(), maxBytes: -1 }), RangeError);
  assert.throws(() => new MediaCache({ load: async () => new Blob(), idleTtlMs: Infinity }), RangeError);
  const { cache } = fixture(t);
  assert.throws(() => cache.acquire(key('', 'account')), /key/);
  assert.throws(() => cache.acquire(key('image', '')), /namespace/);
  const handle = cache.acquire(key()); await handle.ready;
  assert.throws(() => cache.inspect().entries.push({}), TypeError);
  assert.throws(() => { cache.inspect().entries[0].handles = 900; }, TypeError);
  assert.equal(cache.inspect().activeHandles, 1);
});

test('loader and object URL creation errors remove the failed generation', async t => {
  const invalid = fixture(t, { load: async () => undefined }).cache;
  await assert.rejects(invalid.acquire(key()).ready, /Blob/);
  assert.equal(invalid.inspect().entries.length, 0);
  const broken = fixture(t, { objectUrls: { create() { throw new Error('no URL support'); }, revoke() {} } }).cache;
  await assert.rejects(broken.acquire(key()).ready, /no URL support/);
  assert.equal(broken.inspect().entries.length, 0);
});

test('best-effort store failures preserve loading; required mode rejects', async t => {
  const failure = new DOMException('quota', 'QuotaExceededError');
  const events = [];
  const store = { get: async () => { throw failure; }, put: async () => { throw failure; }, delete: async () => {}, clear: async () => {} };
  const { cache } = fixture(t, { store, onStoreError: event => { events.push(event.operation); throw new Error('observer failed'); } });
  await cache.acquire(key()).ready;
  assert.deepEqual(events, ['get', 'put']);
  const required = fixture(t, { store, persistence: 'required' }).cache;
  await assert.rejects(required.acquire(key()).ready, error => error === failure);
  assert.equal(required.inspect().entries.length, 0);
});

test('required storage write failure rejects before creating a URL', async t => {
  const store = { get: async () => undefined, put: async () => { throw new Error('disk full'); }, delete: async () => {}, clear: async () => {} };
  const { cache, live } = fixture(t, { store, persistence: 'required' });
  await assert.rejects(cache.acquire(key()).ready, /disk full/);
  assert.equal(live.size, 0);
});

test('async diagnostic failures cannot reject successful loads or replace required storage errors', async t => {
  const failure = new DOMException('quota', 'QuotaExceededError');
  const store = { get: async () => { throw failure; }, put: async () => {}, delete: async () => {}, clear: async () => {} };
  let diagnostics = 0;
  const options = { store, onStoreError: async () => { diagnostics++; throw new Error('diagnostic failed'); } };
  const bestEffort = fixture(t, options).cache;
  await bestEffort.acquire(key()).ready;
  const required = fixture(t, { ...options, persistence: 'required' }).cache;
  await assert.rejects(required.acquire(key()).ready, error => error === failure);
  await tick(); // An unhandled observer rejection would fail the Node test runner.
  assert.equal(diagnostics, 2);
});

test('persistent hit skips the loader and retains its Blob metadata', async t => {
  const blob = new Blob(['cached'], { type: 'image/png' });
  let loads = 0;
  const store = { get: async () => blob, put: async () => assert.fail('no rewrite'), delete: async () => {}, clear: async () => {} };
  const { cache } = fixture(t, { store, load: async () => { loads++; return new Blob(); } });
  assert.equal((await cache.acquire(key()).ready).blob, blob);
  assert.equal(loads, 0);
});

test('logout queues clear after an in-flight write; new acquire waits for the barrier', async t => {
  const write = deferred();
  const started = deferred();
  let persisted;
  const operations = [];
  let puts = 0;
  const store = {
    async get() { operations.push('get'); return persisted; },
    async put(_key, blob) { operations.push('put'); if (++puts === 1) { started.resolve(); await write.promise; } persisted = blob; },
    async delete() { persisted = undefined; },
    async clear() { operations.push('clear'); persisted = undefined; },
  };
  let loads = 0;
  const { cache } = fixture(t, { store, load: async () => new Blob([String(++loads)]) });
  const old = cache.acquire(key()); await started.promise;
  const cleared = cache.invalidateNamespace('account-a');
  let fresh;
  // An ordinary new request also queues behind the existing write and logout clear.
  fresh = cache.acquire(key());
  write.resolve(); await cleared;
  await assert.rejects(old.ready, { name: 'AbortError' });
  assert.equal(await (await fresh.ready).blob.text(), '2');
  assert.deepEqual(operations, ['get', 'put', 'clear', 'get', 'put']);
});

test('reentrant request from logout abort listener cannot read old persistence', async t => {
  let persisted = new Blob(['old']);
  const events = [];
  const store = {
    async get() { events.push('get'); return persisted; },
    async put(_key, blob) { events.push('put'); persisted = blob; },
    async delete() { persisted = undefined; },
    async clear() { events.push('clear'); persisted = undefined; },
  };
  const { cache } = fixture(t, { store, load: async () => new Blob(['new']) });
  const old = cache.acquire(key()); await old.ready;
  let fresh;
  old.signal.addEventListener('abort', () => { fresh = cache.acquire(key()); });
  await cache.invalidateNamespace('account-a');
  assert.equal(await (await fresh.ready).blob.text(), 'new');
  assert.deepEqual(events, ['get', 'clear', 'get', 'put']);
});

test('storage keys are immutable public identities, not mutable cache entries', async t => {
  const identities = [];
  const store = { async get(identity) { identities.push(identity); return undefined; },
    async put(identity) { identities.push(identity); }, async delete(identity) { identities.push(identity); }, async clear() {} };
  const { cache } = fixture(t, { store });
  await cache.acquire(key()).ready;
  const mutable = key();
  const removed = cache.invalidate(mutable);
  mutable.key = 'other';
  await removed;
  for (const identity of identities) {
    assert.deepEqual(Object.keys(identity).sort(), ['key', 'namespace']);
    assert.equal(identity.key, 'image');
    assert.ok(Object.isFrozen(identity));
  }
});

test('required clear error propagates but memory ownership is still ended', async t => {
  const store = { get: async () => undefined, put: async () => {}, delete: async () => {}, clear: async () => { throw new Error('denied'); } };
  const { cache, live } = fixture(t, { store, persistence: 'required' });
  const handle = cache.acquire(key()); await handle.ready;
  await assert.rejects(cache.invalidateNamespace('account-a'), /denied/);
  assert.equal(handle.signal.aborted, true);
  assert.equal(live.size, 0);
});
