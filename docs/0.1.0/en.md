# browser-media-cache 0.1.0

[← Back to documentation and versions / Назад к документации и версиям](../index.md)

**[EN](en.md) · [RU](ru.md)** · [Version index](../index.md) · [Repository README](../../README.md)

This guide targets browser application developers. The core owns Blob URLs;
your application owns DOM elements, authentication, the logical key scheme, and
closing each handle. Every example uses the public 0.1.0 API.

## Capability map

| Capability | Example |
| --- | --- |
| Create a cache and install the package | [Setup](#setup) |
| Shared loads, URLs and idempotent release | [Ownership](#ownership-and-shared-loads) |
| Cancel one consumer and handle loader errors | [Cancellation](#cancellation-and-errors) |
| Idle TTL, LRU eviction and soft active budgets | [Retention](#retention-and-budgets) |
| Invalidate one key or an account namespace | [Invalidation](#invalidation-and-logout) |
| Dispose an instance and pending work | [Disposal](#disposal) |
| Persist Blobs and choose storage error policy | [CacheStorage](#optional-cachestorage) |
| React effect ownership and StrictMode cleanup | [React](#optional-react-hook) |
| Inspect counters and reproduce stress checks | [Diagnostics](#diagnostics-and-demo) |

## Setup

Build tooling uses Node 24, TypeScript 7.0.2 and a lockfile. The runtime artifact is
ESM targeting ES2022. It uses private class fields, Promises and browser Web APIs;
these are not TypeScript-only runtime features. Importing the core does not access
window, document, CacheStorage, or create a URL. Actual media operations require
Blob, URL.createObjectURL/revokeObjectURL, AbortController/AbortSignal.reason,
queueMicrotask, performance and timers. No polyfills are bundled.

```sh
npm ci
npm run typecheck
npm test
npm pack
# In a separate application:
npm install /path/to/59alex-browser-media-cache-0.1.0.tgz
```

The proposed npm coordinate is @59alex/browser-media-cache. It is not a claim of
registry publication or scope ownership. Use the packed artifact until the npm
release is available.

The following definitions are shared by the core examples:

```ts
import { MediaCache } from '@59alex/browser-media-cache';

const cache = new MediaCache({
  load: async ({ key, signal }) => {
    const response = await fetch(`/media/${encodeURIComponent(key)}`, { signal });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return response.blob();
  },
});
const identity = { namespace: 'account:42', key: 'photo:7:v3' };
```

Run each section independently with a fresh setup instance. In particular, the
disposal example intentionally makes its cache unusable for subsequent operations.

Use a stable, versioned logical key. Include the relevant representation in it,
such as thumbnail size or revision. A cache hit intentionally avoids the loader;
it is not HTTP cache validation. Do not put tokens or passwords in namespace/key.

## Ownership and shared loads

```ts
const first = cache.acquire(identity);
const second = cache.acquire(identity);
const [a, b] = await Promise.all([first.ready, second.ready]);
console.assert(a.url === b.url);
console.assert(a.blob === b.blob);

first.release();
first.release(); // Idempotent; the second handle still owns the URL.
console.assert(!second.signal.aborted);

// After removing b.url from the UI:
second.release();
```

The tuple (namespace, key) identifies one entry inside this cache instance. A
single loader serves all concurrent handles. ready resolves to a read-only
{ url, blob } object. Keep ownership while an image, audio element, video element,
download, or other consumer needs that URL. Do not call URL.revokeObjectURL on a
cache-owned URL and do not use it after release.

Attach an abort listener when using an imperative DOM element: invalidation can
end ownership even after ready has resolved.

```ts
const image = document.createElement('img');
const handle = cache.acquire(identity);
handle.signal.addEventListener('abort', () => image.removeAttribute('src'), { once: true });
try {
  const resource = await handle.ready;
  if (!handle.released) image.src = resource.url;
} catch (error) {
  // Render an application-specific error or cancellation state.
  console.warn(error);
}
// Component cleanup:
image.removeAttribute('src');
handle.release();
```

Revoking a URL is not a mechanism for erasing already-decoded pixels, previously
copied Blobs, or application-owned references. The application must clear its UI.

## Cancellation and errors

```ts
const controller = new AbortController();
const first = cache.acquire({ ...identity, signal: controller.signal });
const second = cache.acquire(identity);
controller.abort();
await first.ready.catch(error => console.assert(error.name === 'AbortError'));
await second.ready; // Still completes if the loader succeeds.
second.release();
```

Aborting or releasing a pending handle rejects its ready promise. A custom abort
reason is preserved. The underlying load signal is aborted only when its final
consumer leaves, or when the entry is forcibly invalidated/disposed. Once ready
has resolved, the signal communicates ownership loss; a resolved promise cannot
be changed into a rejection.

Loader errors reject every waiting handle and remove the failed generation. A
later acquire retries. The cache does not perform automatic retries or choose a
network timeout. Give those policies to your loader.

```ts
const failing = new MediaCache({ load: async () => { throw new Error('offline'); } });
await failing.acquire(identity).ready.catch(error => console.assert(error.message === 'offline'));
console.assert(failing.inspect().entries.length === 0);
failing.dispose();
```

A loader should respect its AbortSignal. If it ignores cancellation and completes
late, the generation check prevents it from creating/replacing a current URL or
starting a new stale storage write. Already-started storage work cannot be undone
by an AbortSignal; invalidation uses a storage barrier as described below.

## Retention and budgets

```ts
const small = new MediaCache({
  load: async () => new Blob(['12345678']),
  idleTtlMs: 1_000,
  maxEntries: 2,
  maxBytes: 4,
});
const owner = small.acquire(identity);
await owner.ready;
console.assert(small.inspect().overBudget); // Active 8-byte Blob remains valid.
owner.release();
console.assert(small.inspect().retainedBytes === 0); // Now eligible for eviction.
small.dispose();
```

| Option | Default | Contract |
| --- | --- | --- |
| idleTtlMs | 30000 | Starts at the final release; reacquiring cancels idle expiry |
| maxEntries | 128 | Target for all tracked entries, including pending entries |
| maxBytes | 67108864 | Target for the sum of ready-entry Blob.size values |
| now | performance.now | Optional monotonic clock for deterministic testing |
| objectUrls | Native URL methods | Optional compatible factory for tests; revoke must not throw |

All numeric limits are non-negative safe integers. Zero is valid. TTL and budgets
evict only idle entries. Under pressure, the least recently idle entry goes first;
active handles are never forcibly evicted by these policies. A single timer
reclaims expired idle entries, and acquire/collect also enforce expiry.

retainedBytes counts ready-entry Blob sizes, once per shared entry. It excludes
in-flight network/store buffers, decoded images/video, object URL/browser overhead,
user-held copies, and CacheStorage. The limits are therefore not a bound on total
process memory or arbitrarily large active media. No streaming upload/download
claim is made.

```ts
cache.collect(); // Synchronously enforce idle TTL and budgets now.
console.log(cache.inspect().overBudget); // Can remain true while owners are active.
```

## Invalidation and logout

```ts
const handle = cache.acquire(identity);
await handle.ready;
await cache.invalidate(identity); // Immediately aborts ownership, then deletes persistence.
console.assert(handle.released && handle.signal.aborted);

// Account logout: clear application media elements, then end this namespace.
await cache.invalidateNamespace('account:42');
```

invalidate targets one tuple; invalidateNamespace targets all entries in that
namespace. Both synchronously remove the old generations and revoke even active
URLs. Their promises cover optional storage cleanup according to persistence
policy. Memory cleanup still occurs when required storage cleanup rejects.

Storage operations are serialized per namespace inside one cache instance. The
cleanup barrier is queued before abort listeners run, so a synchronous reacquire
from such a listener waits behind deletion. An in-flight write finishes before
the cleanup, and a late loader cannot repopulate an invalidated generation.

This is not cross-tab coordination or an authentication barrier. Another cache
instance/tab with the same prefix and namespace can write again. Coordinate
account lifecycle across all instances in your application. Do not reuse one
account namespace for another account; version keys when media changes.

## Disposal

```ts
cache.dispose();
cache.dispose(); // Idempotent.
console.assert(cache.inspect().disposed);
console.assert(cache.inspect().activeHandles === 0);
// cache.acquire(identity) now throws: MediaCache is disposed
```

dispose cancels pending loaders, rejects pending handles, ends all active
ownership, revokes owned URLs and clears the idle timer. It does not clear
CacheStorage. Await invalidateNamespace before dispose when persistent logout
cleanup is required. A loader/store that ignores cancellation may finish its own
work, but it cannot repopulate the disposed cache's memory.

## Optional CacheStorage

```ts
import { CacheStorageStore } from '@59alex/browser-media-cache/cache-storage';

const persistent = new MediaCache({
  load: async () => new Blob(['fixture'], { type: 'text/plain' }),
  store: new CacheStorageStore({
    cachePrefix: 'my-app:media:v1:',
    maxAgeMs: 24 * 60 * 60 * 1000,
  }),
  persistence: 'best-effort',
  onStoreError: ({ operation, error }) => console.warn(operation, error),
});
const first = persistent.acquire(identity);
await first.ready;
first.release();
await persistent.invalidateNamespace(identity.namespace);
persistent.dispose();
```

The adapter uses a separate cache name per encoded namespace. It preserves Blob
content type, expires records on read, and clears only the exact namespace under
its prefix. Synthetic request keys are used only inside CacheStorage; no network
request is sent to their .invalid address. Use a unique application prefix.

| Policy | Read/write error | Delete/clear error |
| --- | --- | --- |
| best-effort (default) | Report onStoreError, fall back to loader/memory | Report onStoreError; memory clears, persistent data may remain |
| required | Reject the pending handle | Reject cleanup promise; memory ownership still ends |

QuotaExceededError, SecurityError, or missing CacheStorage follow the same policy.
Diagnostics cannot break ownership even if onStoreError throws. For logout where
failure to remove persisted data must be observable to the caller, choose required
and handle a rejected cleanup promise explicitly.

maxAgeMs defaults to 24 hours and differs from the memory idle TTL. Persistent
entries are not limited by maxBytes/maxEntries and have no background LRU cleanup.
Expiration is enforced only on read. Browser quota and eviction remain outside
this library's control. Operations await the store, so slow storage can delay the
same namespace. No persistence timeout is built in.

A custom BlobStore implements get(MediaKey), put(MediaKey, Blob), delete(MediaKey)
and clear(namespace), returning promises. A missing get returns undefined. The
core gives it immutable identity objects, not internal entries. Any shared or
remote implementation must define its own cross-client consistency guarantees.

## Optional React hook

The core has no React import. The /react entry point is an optional peer adapter;
install React in the consuming application. React 19.3.1 StrictMode was tested;
the declared React 18/19 peer range does not mean every version was tested.

```tsx
import { useMedia } from '@59alex/browser-media-cache/react';

// Reuse a stable cache instance; do not create a new cache on every render.
function Photo({ accountId, mediaId }: { accountId: string; mediaId: string | null }) {
  const state = useMedia(cache, accountId, mediaId);
  if (state.status === 'idle') return null;
  if (state.status === 'loading') return <span>Loading…</span>;
  if (state.status === 'error') return <span>Media unavailable</span>;
  return <img src={state.resource.url} alt="Shared media" />;
}
```

null disables acquisition and produces idle. Effects acquire on mount/key change
and release on cleanup; SSR rendering does not acquire. The hook hides the previous
namespace/key's resource during a change and removes ready state when ownership
is revoked. Invalidation leaves an error state; it does not automatically reacquire
revoked media. Change the key, remount, or explicitly disable/re-enable the hook
when retry is appropriate. A component must not retain resource.url beyond ownership.

## Diagnostics and demo

```ts
const state = cache.inspect();
console.log(state.activeHandles, state.loadingEntries, state.idleEntries);
console.log(state.retainedBytes, state.overBudget);
for (const entry of state.entries) {
  console.log(entry.namespace, entry.key, entry.generation, entry.phase, entry.handles);
}
```

Snapshots are frozen read-only diagnostics. They do not grant resource ownership.
The demo uses inspect and explicit URL counters to expose lifecycle behavior.

```sh
npm run demo
npm run test:package
npx playwright install chromium firefox
npm run test:browser
```

The browser test runs headlessly and saves reports/screenshots in output/playwright.
Tests cover real URL/image and CacheStorage behavior, 500 two-consumer cycles,
100 React StrictMode mount/unmount cycles, and one live namespace switch.
See [verification results](../VERIFICATION.md) for tested versions and limits.

If CacheStorage is unavailable, use localhost/HTTPS and check browser storage
policy, or use memory-only mode. If an image disappears after invalidation, clear
its UI state and reacquire only when appropriate; the old URL no longer belongs
to that consumer. If overBudget remains true, inspect activeHandles before
reducing budgets further. Import errors from /react indicate that the optional
React peer is missing; use the root import for framework-independent code.

[← Back to documentation and versions / Назад к документации и версиям](../index.md)
