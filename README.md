# browser-media-cache

A planned TypeScript library for managing browser media lifetimes: shared loads, object URL ownership, bounded caching, and account-scoped cleanup.

**Status: design and implementation planning. No installable release is available yet.**

## Why

Applications displaying the same media in several components need a clear answer to who owns a blob URL, when it can be revoked, and how much cached data may remain after the components disappear.

The library will expose a framework-independent core. React integration will be an optional adapter.

## Planned scope

- Acquire/release handles with idempotent release and explicit ownership.
- Shared in-flight loads with per-consumer cancellation.
- Idle TTL and configurable entry/byte budgets; active consumers retain valid handles.
- Optional persistent CacheStorage adapter with quota-error handling.
- Account/namespace isolation, invalidation and logout cleanup.
- An inspectable demo showing cache hits, live handles, retained bytes and eviction.

Media blobs are deliberately cached. This library is not a bounded-memory transport for arbitrarily large files.

## Implementation

See [the v0.1 plan](ROADMAP.md) and [open issues](https://github.com/59Alex/browser-media-cache/issues).
Public APIs and package coordinates are proposals until the first release.

## License

[MIT](LICENSE).
