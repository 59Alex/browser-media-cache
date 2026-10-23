# Implementation plan

[← Back to repository README / Назад к README библиотеки](README.md)

Deliver a small, framework-independent TypeScript library with a reproducible lifecycle demo.

## 1. Contract and packaging

- [x] Define acquire/release handles, loading errors, invalidation and disposal.
- [x] Define what byte accounting includes; specify behavior when active entries exceed the configured budget.
- [x] Specify account/namespace boundaries and logout semantics.
- [x] Set up TypeScript exports, declarations, browser-safe imports and unit tests.

## 2. Memory lifecycle

- [x] Implement refcounted object URLs with idempotent release.
- [x] Evict idle entries by TTL and documented budget policy.
- [x] Guard against stale releases, late completions and replacement races.
- [x] Share in-flight loads; cancel the underlying load only when its final consumer leaves.
- [x] Ensure dispose releases timers, pending work and owned URLs.

## 3. Persistence and adapters

- [x] Add optional CacheStorage support with quota/unavailability handling.
- [x] Scope persisted keys by account/namespace; clear only the requested scope.
- [x] Add an optional React adapter after the core contract is stable.

## 4. Verification

- [x] Two consumers share a load; releasing one keeps the other valid.
- [x] The last release permits eviction; reacquiring cancels an idle eviction.
- [x] Replacement cannot revoke a newer URL; aborting one consumer does not break another.
- [x] Failed loads can retry; late completion after logout cannot repopulate the previous account.
- [x] Budget pressure, quota errors and unavailable storage follow the documented policy.
- [x] Run real-browser lifecycle tests and a mount/unmount stress demo; record methodology and results.

## 5. Release gate

- [x] English quickstart and runnable example using only public dependencies.
- [x] Review license provenance before incorporating existing implementation code.
- [x] CI for typecheck/build/tests and package-content verification.
- [x] Install the packed artifact in a separate consumer and check its runtime and types.
- [ ] Choose and verify npm package coordinates.
- [ ] Publish v0.1 with release notes and supported-browser matrix.
- [ ] Record one real application integration and its remaining limitations.

Implementation and local evidence: [verification](docs/VERIFICATION.md). Guides:
[English](docs/0.1.0/en.md) / [Русский](docs/0.1.0/ru.md).

The packed artifact has been installed and typechecked in a separate consumer.
The proposed @59alex npm scope still needs account ownership verification; the
package is not published. CI is configured, but this local implementation report
does not assert a completed remote workflow. No real application integration or
heap/performance benchmark is claimed. Cross-tab coordination is outside v0.1.

[← Back to repository README / Назад к README библиотеки](README.md)
