# v0.1.0 verification

[← Back to documentation and versions / Назад к документации и версиям](index.md)

[Documentation index](index.md) · [EN guide](0.1.0/en.md) · [RU](0.1.0/ru.md)

Verification date: 2026-10-24, Asia/Yekaterinburg. Source implementation tested
locally on Linux. This document describes observed behavior, not a guarantee for
all browsers or application integrations.

## Environment

| Component | Tested version |
| --- | --- |
| Node / npm | 24.21.0 / 11.19.0 |
| TypeScript / emitted target | 7.0.2 / ES2022 ESM |
| React / React DOM | 19.3.1 / 19.3.1, development StrictMode |
| Playwright runner | 1.64.1 |
| Chromium | 156.0.8078.4, headless Linux |
| Firefox | 156.0, headless Linux |

Browser runs used existing local executables through
BROWSER_EXECUTABLE_CHROMIUM and BROWSER_EXECUTABLE_FIREFOX. The runner also supports
the normal Playwright-installed executables; CI installs them explicitly. No
desktop browser window or existing personal browser profile was used.

## Checks and outcomes

| Check | Result |
| --- | --- |
| Typecheck and ESM/declaration build | Pass |
| Guide examples | 26 README and EN/RU TypeScript/TSX examples typechecked with documented setup and installed React peer types |
| Node unit/race suite | 31 passed, zero failures/skips |
| Packed artifact installed in an isolated consumer | Pass; dist, package metadata, EN/RU documentation, roadmap and MIT license |
| Documentation navigation in the installed package | All 58 relative file links and 34 Markdown heading anchors resolve |
| Consumer TypeScript imports and actual URL lifecycle | Pass |
| Core/storage import without a browser or installed React | Pass |
| Real-browser demo controls | Shared A/B URL, A release preserves B, logout clears both |
| Real-browser lifecycle suite | Pass on both tested browsers |
| Real CacheStorage round trip | Preserved content type, hit skips loader, clear affects only selected namespace |
| Real-browser idle policy | Entry pressure removes idle media; active handle survives TTL; idle timer reclaims it after release |
| Stress per browser | 500 two-consumer cycles + 100 React StrictMode cycles + one namespace switch |
| Stress resource accounting | 601 created URLs, 601 revoked URLs, zero active handles, zero ready-entry Blob bytes at completion |
| Browser errors in automated checks | Zero |

The unit suite explicitly exercises last-consumer abort, already-aborted requests,
failed-load retry, ignored late completions, generation replacement, reentrant
invalidation, an in-flight persistence write followed by logout, and storage
failure policies. QuotaExceededError, SecurityError, and unavailable storage are
simulated in unit tests; browser storage was not deliberately filled to quota.

The independent lifecycle review added three regression cases. Budget eviction
now rechecks candidates after synchronous abort listeners: a listener can invalidate
another key or reacquire an idle sibling, and the sibling must keep its URL.
Acquire rechecks disposal after collecting idle entries, so a disposal triggered
by an eviction listener cannot leave a new, permanently pending handle. Storage
diagnostics observe rejected async callbacks without waiting for them or changing
best-effort/required storage semantics. The first two regressions failed against
the previous implementation and passed after these fixes.

The optional React adapter and CacheStorage adapter were reviewed without adding
a second ownership or persistence mechanism. React still acquires in effects,
filters resources by cache/namespace/key, and releases during cleanup. Persistence
still uses the existing per-namespace barriers; quotas do not become memory budgets.

Stress counters count cache-owned URLs and ready-entry Blob.size. They are not
heap snapshots, decoded-media measurements, process RSS measurements, or evidence
that the browser immediately returns memory to the operating system. Elapsed times
in raw reports are diagnostic timings and not a comparative benchmark.

## Reproduce

```sh
npm ci
npm run typecheck
npm test
npm run test:package
npx playwright install chromium firefox
npm run test:browser
```

The browser script starts an isolated localhost demo server on an available port,
tests both engines headlessly, closes the browsers/server, and writes JSON plus
screenshots to output/playwright. A normalized local run is recorded in
[verification/browser-results.json](verification/browser-results.json).

The npm package-content test creates a temporary consumer, installs the packed
artifact offline, verifies that optional React was not installed, executes the
core, checks declarations, and removes only that temporary directory.

## Remaining limits

- Safari/WebKit, mobile devices, older Chromium/Firefox, and React 18 are not tested.
- No real application has been integrated yet.
- No cross-tab or cross-instance storage coordination is implemented.
- No runtime polyfills are shipped, and Service Worker object URL support is not claimed.
- No remote CI result is asserted by this local report.
- npm publication and @59alex scope ownership are not completed; only local packing is verified.

## Provenance

The implementation was written from the public lifecycle plan and platform APIs.
No private application code, configuration, repository history, credentials, or
media were copied. The existing MIT license is preserved. Third-party libraries
are declared dependencies; generated demo bundles and node_modules are excluded
from the package and source control.

[← Back to documentation and versions / Назад к документации и версиям](index.md)
