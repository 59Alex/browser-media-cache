import test from 'node:test';
import assert from 'node:assert/strict';
import { CacheStorageStore } from '../dist/cache-storage.js';

function fakeStorage() {
  const stores = new Map();
  return {
    stores,
    has: async name => stores.has(name),
    delete: async name => stores.delete(name),
    async open(name) {
      if (!stores.has(name)) stores.set(name, new Map());
      const values = stores.get(name);
      return {
        async match(request) { return values.get(request.url)?.clone(); },
        async put(request, response) { values.set(request.url, response.clone()); },
        async delete(request) { return values.delete(request.url); },
      };
    },
  };
}

test('CacheStorage round trip preserves content type and scopes namespaces/keys', async () => {
  const storage = fakeStorage();
  const store = new CacheStorageStore({ storage, cachePrefix: 'test:' });
  const a = { namespace: 'a/b', key: 'x?part=#%' };
  const b = { namespace: 'a%2Fb', key: 'x?part=#%' };
  await store.put(a, new Blob(['first'], { type: 'image/png' }));
  await store.put(b, new Blob(['second'], { type: 'video/webm' }));
  assert.equal((await store.get(a)).type, 'image/png');
  assert.equal(await (await store.get(a)).text(), 'first');
  await store.clear(a.namespace);
  assert.equal(await store.get(a), undefined);
  assert.equal(await (await store.get(b)).text(), 'second');
  assert.equal(storage.stores.size, 1);
});

test('max age expires on read and single-key deletion preserves siblings', async () => {
  let now = 100;
  const storage = fakeStorage();
  const store = new CacheStorageStore({ storage, maxAgeMs: 10, now: () => now });
  const a = { namespace: 'n', key: 'a' };
  const b = { namespace: 'n', key: 'b' };
  await store.put(a, new Blob(['a'])); await store.put(b, new Blob(['b']));
  await store.delete(a);
  assert.equal(await store.get(a), undefined);
  now = 109; assert.equal(await (await store.get(b)).text(), 'b');
  now = 110; assert.equal(await store.get(b), undefined);
});

test('misses do not create empty stores and unavailable storage rejects', async () => {
  const storage = fakeStorage();
  const store = new CacheStorageStore({ storage });
  assert.equal(await store.get({ namespace: 'n', key: 'a' }), undefined);
  assert.equal(storage.stores.size, 0);
  await assert.rejects(new CacheStorageStore().get({ namespace: 'n', key: 'a' }), /unavailable/);
});

test('quota and security errors remain observable to persistence policy', async () => {
  const quota = new DOMException('full', 'QuotaExceededError');
  const store = new CacheStorageStore({ storage: { open: async () => ({ put: async () => { throw quota; } }) } });
  await assert.rejects(store.put({ namespace: 'n', key: 'a' }, new Blob()), error => error === quota);
  const denied = new CacheStorageStore({ storage: { has: async () => { throw new DOMException('blocked', 'SecurityError'); } } });
  await assert.rejects(denied.get({ namespace: 'n', key: 'a' }), { name: 'SecurityError' });
});
