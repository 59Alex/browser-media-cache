# Implementation plan

Deliver a small, framework-independent TypeScript library with a reproducible lifecycle demo.

## 1. Contract and packaging

- [ ] Define acquire/release handles, loading errors, invalidation and disposal.
- [ ] Define what byte accounting includes; specify behavior when active entries exceed the configured budget.
- [ ] Specify account/namespace boundaries and logout semantics.
- [ ] Set up TypeScript exports, declarations, browser-safe imports and unit tests.

## 2. Memory lifecycle

- [ ] Implement refcounted object URLs with idempotent release.
- [ ] Evict idle entries by TTL and documented budget policy.
- [ ] Guard against stale releases, late completions and replacement races.
- [ ] Share in-flight loads; cancel the underlying load only when its final consumer leaves.
- [ ] Ensure dispose releases timers, pending work and owned URLs.

## 3. Persistence and adapters

- [ ] Add optional CacheStorage support with quota/unavailability handling.
- [ ] Scope persisted keys by account/namespace; clear only the requested scope.
- [ ] Add an optional React adapter after the core contract is stable.

## 4. Verification

- [ ] Two consumers share a load; releasing one keeps the other valid.
- [ ] The last release permits eviction; reacquiring cancels an idle eviction.
- [ ] Replacement cannot revoke a newer URL; aborting one consumer does not break another.
- [ ] Failed loads can retry; late completion after logout cannot repopulate the previous account.
- [ ] Budget pressure, quota errors and unavailable storage follow the documented policy.
- [ ] Run real-browser lifecycle tests and a mount/unmount stress demo; record methodology and results.

## 5. Release gate

- [ ] English quickstart and runnable example using only public dependencies.
- [ ] Review license provenance before incorporating existing implementation code.
- [ ] CI for typecheck/build/tests and package-content verification.
- [ ] Choose and verify npm package coordinates; install the packed artifact in a separate consumer.
- [ ] Publish v0.1 with release notes and supported-browser matrix.
- [ ] Record one real application integration and its remaining limitations.

No benchmark or browser-compatibility result is claimed by this initial plan.
