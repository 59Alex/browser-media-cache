# browser-media-cache

<details name="readme-language">
<summary><picture><source media="(prefers-color-scheme: dark)" srcset="assets/lang-en-dark.svg"><img src="assets/lang-en-light.svg" width="42" height="26" alt="EN"></picture></summary>

Version: **[0.1.0](docs/0.1.0/en.md)** · [All documentation](docs/index.md)

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

</details>

<details name="readme-language" open>
<summary><picture><source media="(prefers-color-scheme: dark)" srcset="assets/lang-ru-dark.svg"><img src="assets/lang-ru-light.svg" width="42" height="26" alt="RU"></picture></summary>

Версия: **[0.1.0](docs/0.1.0/ru.md)** · [Вся документация](docs/index.md)

Общая загрузка медиа в браузере с явным владением каждым object URL. Независимое
от фреймворков ядро предоставляет acquire/release handles, индивидуальную отмену,
хранение неиспользуемых записей, вытеснение по бюджету и очистку namespace.
CacheStorage и React подключаются отдельными импортами.

Исходная реализация v0.1.0 и установка упакованного npm-артефакта проверены
локально. Публикация в npm ещё не выполнена; владение предполагаемым scope
@59alex требует проверки. Наличие координат не означает публикацию в реестре.

## Начало работы с локальным пакетом

```sh
npm ci
npm test
npm pack
# В вашем приложении:
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
// Используйте url, пока handle владеет им. Уберите его из интерфейса перед release.
handle.release();
```

Два активных handle одного namespace/key разделяют загрузку и URL. Освобождение
одного сохраняет второй. Последний освобождённый handle незавершённой загрузки
отменяет её. TTL и бюджеты вытесняют только неиспользуемые записи: активные
потребители могут превышать бюджет. Явная инвалидация и dispose завершают даже
активное владение, отменяют signal handle и отзывают URL.

## Возможности и примеры

| Возможность | Руководство |
| --- | --- |
| Acquire/release и общие загрузки | [Владение](docs/0.1.0/ru.md#владение-и-общие-загрузки) |
| Отмена отдельного потребителя и ошибки | [Отмена и ошибки](docs/0.1.0/ru.md#отмена-и-ошибки) |
| TTL, бюджеты записей и байтов | [Хранение и бюджеты](docs/0.1.0/ru.md#хранение-и-бюджеты) |
| Инвалидация ключа, namespace и logout | [Инвалидация](docs/0.1.0/ru.md#инвалидация-и-logout) |
| Полная очистка экземпляра | [Dispose](docs/0.1.0/ru.md#dispose) |
| Необязательный CacheStorage и квоты | [Постоянное хранилище](docs/0.1.0/ru.md#необязательный-cachestorage) |
| Необязательный React hook | [React](docs/0.1.0/ru.md#необязательный-react-hook) |
| Диагностика и лаборатория жизненного цикла | [Диагностика и демо](docs/0.1.0/ru.md#диагностика-и-демо) |

## Язык и требования к среде

Компилятор сборки: TypeScript 7.0.2. Выходной JavaScript: ESM, ES2022; объявления
типов включены. Код использует стандартные приватные поля JavaScript, Promises
и Web API. Нужны Blob, AbortController, AbortSignal.reason,
URL.createObjectURL/revokeObjectURL, queueMicrotask, performance и таймеры.
Это требования платформы, а не новые возможности TypeScript. Для CacheStorage
дополнительно нужны соответствующий API браузера и безопасный контекст.

Локально на Linux проверены Chromium 156.0.8078.4 и Firefox 156.0. React adapter
проверен с React 19.3.1 в development StrictMode. Safari/WebKit, мобильные
устройства, старые браузеры и React 18 не проверялись. Node 24.21.0 используется
для разработки и тестов; импорт ядра и адаптера хранилища без браузерного
окружения безопасен и проверен. Полифилы не включены.
[Методика и результаты](docs/VERIFICATION.md).

## Лаборатория жизненного цикла

```sh
npm run demo
# Откройте выведенный адрес localhost в браузере.
npm run test:package
npx playwright install chromium firefox
npm run test:browser
```

Демо показывает активные handles, байты Blob готовых записей, URL и вытеснение.
Проверки декодируют настоящее изображение, используют CacheStorage и выполняют
500 циклов с двумя потребителями и 100 циклов mount/unmount в React StrictMode.
Это проверка владения ресурсами, а не измерение heap браузера или бенчмарк.

## Границы

Медиа намеренно материализуется в Blob. Библиотека не является потоковым
транспортом для произвольно больших файлов. Учёт байтов исключает незавершённые
загрузки, декодированные медиа, внутренние структуры браузера и постоянное
хранилище. Namespace не заменяет аутентификацию. Очередность работы хранилища и
инвалидация координируются внутри одного экземпляра: другая вкладка или экземпляр
может снова записать тот же namespace. Используйте версионированные ключи и
координацию аккаунтов на уровне приложения.

Реализация написана заново по описанному контракту. Приватные исходники,
конфигурация, история и медиа приложения не копировались.

[MIT](LICENSE). [План и оставшиеся условия релиза](ROADMAP.md).

</details>
