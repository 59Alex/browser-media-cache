# browser-media-cache

**[EN](README.md) · [RU](README.ru.md)** · Version: **[0.1.0](docs/0.1.0/en.md)** · [All documentation](docs/README.md)

Share browser media loads while keeping ownership of each object URL explicit.
The framework-independent core provides acquire/release handles, consumer-specific
cancellation, idle retention, budget eviction, and namespace cleanup. CacheStorage
and React are optional imports.

The v0.1.0 source implementation and packed npm consumer are verified locally.
The npm release is pending; the proposed @59alex scope still requires account
ownership verification. No package-registry publication is implied.

## Start with a local package

```sh
npm ci
npm test
npm pack
# In your application:
npm install /path/to/59alex-browser-media-cache-0.1.0.tgz
```

```ts
import { MediaCache } from '@59alex/browser-media-cache';

const media = new MediaCache({
  load: async ({ key, signal }) => {
    const response = await fetch(`/media/${encodeURIComponent(key)}`, { signal });
    if (!response.ok) throw new Error(`Media request failed: ${response.status}`);
    return response.blob();
  },
  idleTtlMs: 30_000,
  maxEntries: 128,
  maxBytes: 64 * 1024 * 1024,
});
const handle = media.acquire({ namespace: 'account:42', key: 'avatar:7:v3' });
const { url } = await handle.ready;
// Use url while the handle owns it. Remove it from the UI before releasing.
handle.release();
```

Two live handles for the same namespace/key share one load and one URL. Releasing
one keeps the other valid. Releasing the final pending handle aborts its loader.
Only idle entries are evicted for TTL or budget pressure; active consumers may
exceed the configured budget. Explicit invalidation and disposal end even active
ownership, abort the handle signal, and revoke URLs.

## Capabilities and examples

| Capability | Guide |
| --- | --- |
| Acquire/release and shared loads | [Ownership](docs/0.1.0/en.md#ownership-and-shared-loads) |
| Per-consumer abort and load failures | [Cancellation and errors](docs/0.1.0/en.md#cancellation-and-errors) |
| Idle TTL, entry/byte budgets, accounting | [Retention and budgets](docs/0.1.0/en.md#retention-and-budgets) |
| Key invalidation, namespaces, logout | [Invalidation](docs/0.1.0/en.md#invalidation-and-logout) |
| Full instance cleanup | [Disposal](docs/0.1.0/en.md#disposal) |
| Optional persistent CacheStorage and quota policy | [Persistence](docs/0.1.0/en.md#optional-cachestorage) |
| Optional React hook | [React](docs/0.1.0/en.md#optional-react-hook) |
| Inspectable diagnostics and runnable stress lab | [Diagnostics and demo](docs/0.1.0/en.md#diagnostics-and-demo) |

## Language and runtime baseline

Build compiler: TypeScript 7.0.2. Generated JavaScript: ESM, ES2022; declarations
are included. The implementation uses standard JavaScript private class fields,
Promises and Web APIs. Blob, AbortController, AbortSignal.reason,
URL.createObjectURL/revokeObjectURL, queueMicrotask, performance and timers must be
available. They are platform requirements, not newly invented TypeScript features.
CacheStorage additionally needs its browser API and a secure context.

Tested locally on Linux: Chromium 156.0.8078.4 and Firefox 156.0. React adapter:
React 19.3.1 development StrictMode. Safari/WebKit, mobile devices, older browser
versions and React 18 have not been tested. Node 24.21.0 is the development/test
runtime; an SSR-style import of the core and storage adapter is safe and tested.
No browser polyfills are included. See [verification](docs/VERIFICATION.md).

## Run the lifecycle lab

```sh
npm run demo
# Open the printed localhost address yourself.
npm run test:package
npx playwright install chromium firefox
npm run test:browser
```

The demo exposes live handles, ready-entry Blob bytes, owned URLs, and eviction.
Its checks decode a real image, exercise CacheStorage and run 500 two-consumer
cycles plus 100 React StrictMode mount/unmount cycles. This measures lifecycle
invariants, not browser heap usage or a performance benchmark.

## Boundaries

Media is intentionally materialized as Blobs. This is not a streaming transport
for arbitrarily large files. Byte accounting excludes in-flight buffers, decoded
media, browser internals, and persistent storage. Namespace labels are not an
authentication boundary. Storage ordering and invalidation coordinate one cache
instance; another instance or tab can repopulate the same persistent namespace.
Use versioned keys and application-owned account coordination.

The implementation is new code written against the documented contract; no
private application source, configuration, history, or media fixtures were copied.

[MIT](LICENSE). [Roadmap and remaining release gates](ROADMAP.md).
