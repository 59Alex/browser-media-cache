# browser-media-cache 0.1.0

[← Back to documentation and versions / Назад к документации и версиям](../index.md)

**[EN](en.md) · [RU](ru.md)** · [Выбор версии](../index.md) · [README репозитория](../../README.md)

Руководство предназначено для разработчиков браузерных приложений. Ядро владеет
Blob URL; приложение отвечает за DOM, аутентификацию, схему ключей и освобождение
каждого handle. Все примеры используют публичный API 0.1.0.

## Возможности

| Возможность | Пример |
| --- | --- |
| Установка и создание кэша | [Подготовка](#подготовка) |
| Общая загрузка, URL и повторный release | [Владение](#владение-и-общие-загрузки) |
| Отмена одного потребителя и ошибки loader | [Отмена](#отмена-и-ошибки) |
| TTL, LRU-вытеснение и мягкие бюджеты | [Хранение](#хранение-и-бюджеты) |
| Инвалидация ключа и namespace аккаунта | [Инвалидация](#инвалидация-и-logout) |
| Освобождение экземпляра и незавершённой работы | [Dispose](#dispose) |
| Постоянное хранение Blob и политика ошибок | [CacheStorage](#необязательный-cachestorage) |
| React effects и очистка в StrictMode | [React](#необязательный-react-hook) |
| Диагностика и воспроизводимые стресс-проверки | [Демо](#диагностика-и-демо) |

## Подготовка

Сборка использует Node 24, TypeScript 7.0.2 и lockfile. Выходной пакет — ESM с
целевым стандартом ES2022. В нём используются приватные поля JavaScript, Promises
и Web API; это не особые возможности времени выполнения TypeScript.
Импорт ядра не обращается к window, document или CacheStorage и не создаёт URL.
Для работы нужны Blob, URL.createObjectURL/revokeObjectURL,
AbortController/AbortSignal.reason, queueMicrotask, performance и таймеры.
Полифилы не включены.

```sh
npm ci
npm run typecheck
npm test
npm pack
# In a separate application:
npm install /path/to/59alex-browser-media-cache-0.1.0.tgz
```

Предполагаемые координаты — @59alex/browser-media-cache. Они не означают
публикацию или подтверждённое владение scope. До релиза в npm используйте
упакованный артефакт.

Общие объявления для примеров ядра:

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

Выполняйте каждый раздел независимо с новым экземпляром из подготовки.
В частности, пример dispose намеренно делает свой экземпляр непригодным для
следующих операций.

Используйте стабильный версионированный ключ. Включайте в него существенное
представление: например, размер превью или ревизию. Попадание в кэш намеренно
пропускает loader и не выполняет HTTP-валидацию. Не помещайте токены и пароли
в namespace/key.

## Владение и общие загрузки

```ts
const first = cache.acquire(identity);
const second = cache.acquire(identity);
const [a, b] = await Promise.all([first.ready, second.ready]);
console.assert(a.url === b.url);
console.assert(a.blob === b.blob);

first.release();
first.release(); // Idempotent; second still owns the URL.
console.assert(!second.signal.aborted);

// After removing b.url from the UI:
second.release();
```

Пара namespace/key определяет запись внутри одного экземпляра кэша. Один loader
обслуживает параллельные handles. ready возвращает объект { url, blob }, доступный
только для чтения. Сохраняйте владение, пока URL нужен изображению, audio/video,
скачиванию или другому потребителю. Не вызывайте URL.revokeObjectURL для URL кэша
и не используйте его после release.

Для императивного DOM подпишитесь на abort: инвалидация может завершить владение
после успешного ready.

```ts
const image = document.createElement('img');
const handle = cache.acquire(identity);
handle.signal.addEventListener('abort', () => image.removeAttribute('src'), { once: true });
try {
  const resource = await handle.ready;
  if (!handle.released) image.src = resource.url;
} catch (error) {
  console.warn(error);
}
// Component cleanup:
image.removeAttribute('src');
handle.release();
```

Отзыв URL не стирает уже декодированные пиксели, ранее скопированные Blob или
ссылки приложения. Приложение должно очистить свой интерфейс самостоятельно.

## Отмена и ошибки

```ts
const controller = new AbortController();
const first = cache.acquire({ ...identity, signal: controller.signal });
const second = cache.acquire(identity);
controller.abort();
await first.ready.catch(error => console.assert(error.name === 'AbortError'));
await second.ready;
second.release();
```

Отмена или release незавершённого handle отклоняет его ready. Пользовательская
причина отмены сохраняется. Signal loader отменяется, когда у незавершённой
загрузки не остаётся потребителей, либо при явной инвалидации/dispose.
После успешного ready потерю владения сообщает signal: завершённый Promise
невозможно превратить в отклонённый.

Ошибка loader отклоняет все ожидающие handles и удаляет неудачное поколение.
Следующий acquire повторяет попытку. Автоматические повторы и сетевой тайм-аут
задаёт ваш loader, библиотека их не выбирает.

```ts
const failing = new MediaCache({ load: async () => { throw new Error('offline'); } });
await failing.acquire(identity).ready.catch(error => console.assert(error.message === 'offline'));
console.assert(failing.inspect().entries.length === 0);
failing.dispose();
```

Loader должен учитывать AbortSignal. Если он игнорирует отмену и завершается
поздно, проверка поколения не позволяет создать/заменить актуальный URL или начать
устаревшую запись в хранилище. Уже начатую операцию хранилища AbortSignal не
отменяет; для инвалидации используется очередь, описанная ниже.

## Хранение и бюджеты

```ts
const small = new MediaCache({
  load: async () => new Blob(['12345678']),
  idleTtlMs: 1_000,
  maxEntries: 2,
  maxBytes: 4,
});
const owner = small.acquire(identity);
await owner.ready;
console.assert(small.inspect().overBudget);
owner.release();
console.assert(small.inspect().retainedBytes === 0);
small.dispose();
```

| Параметр | По умолчанию | Контракт |
| --- | --- | --- |
| idleTtlMs | 30000 | Отсчёт после последнего release; acquire отменяет ожидание вытеснения |
| maxEntries | 128 | Целевой предел всех записей, включая незавершённые |
| maxBytes | 67108864 | Целевой предел суммы Blob.size готовых записей |
| now | performance.now | Необязательные монотонные часы для детерминированных тестов |
| objectUrls | Нативные методы URL | Необязательная совместимая фабрика для тестов; revoke не должен бросать исключения |

Числовые ограничения — неотрицательные безопасные целые числа; ноль допустим.
TTL и бюджеты вытесняют только записи без потребителей. При давлении бюджета
первой уходит запись, дольше всего остававшаяся неиспользуемой; активное владение
эти политики не прерывают. Один таймер удаляет просроченные записи, а acquire и
collect также проверяют TTL.

retainedBytes учитывает размеры Blob готовых записей, один раз на общую запись.
Сюда не входят буферы незавершённых загрузок/хранилища, декодированное медиа,
внутренние структуры браузера, копии приложения и CacheStorage. Поэтому бюджеты
не ограничивают всю память процесса или произвольно большое активное медиа.
Потоковая передача файлов здесь не заявлена.

```ts
cache.collect();
console.log(cache.inspect().overBudget);
```

collect синхронно применяет TTL и бюджеты к неиспользуемым записям. overBudget
может остаться true, пока есть активные владельцы.

## Инвалидация и logout

```ts
const handle = cache.acquire(identity);
await handle.ready;
await cache.invalidate(identity);
console.assert(handle.released && handle.signal.aborted);

// Clear application media elements before ending account ownership.
await cache.invalidateNamespace('account:42');
```

invalidate действует на одну пару ключей, invalidateNamespace — на все записи
namespace. Они синхронно удаляют старые поколения и отзывают даже активные URL.
Их Promise охватывает очистку постоянного хранилища согласно persistence policy.
Память освобождается даже при отклонённой обязательной очистке хранилища.

Операции хранилища выполняются последовательно для каждого namespace внутри
одного MediaCache. Удаление ставится в очередь до вызова abort listeners, поэтому
повторный acquire из такого обработчика ждёт удаления. Начатая запись завершается
до очистки, а поздний loader не воскрешает инвалидированное поколение.

Это не координация вкладок и не граница аутентификации. Другой экземпляр/вкладка
с теми же prefix и namespace может снова записать данные. Согласуйте жизненный
цикл аккаунтов между всеми экземплярами приложения. Не назначайте namespace
одного аккаунта другому; меняйте версию ключа при изменении медиа.

## Dispose

```ts
cache.dispose();
cache.dispose();
console.assert(cache.inspect().disposed);
console.assert(cache.inspect().activeHandles === 0);
// cache.acquire(identity) now throws: MediaCache is disposed
```

dispose отменяет незавершённые loaders, отклоняет ожидающие handles, завершает
активное владение, отзывает URL и убирает таймер. CacheStorage он не очищает.
Если нужна постоянная очистка при logout, дождитесь invalidateNamespace до
dispose. Игнорирующий отмену loader/store может завершить собственную работу,
но не вернёт данные в память закрытого кэша.

## Необязательный CacheStorage

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

Адаптер создаёт отдельное имя кэша для закодированного namespace, сохраняет тип
Blob, проверяет срок хранения при чтении и удаляет только нужный namespace своего
prefix. Синтетические request keys используются лишь внутри CacheStorage;
сетевые запросы к их адресу .invalid не выполняются. Выбирайте уникальный prefix
приложения.

| Политика | Ошибка чтения/записи | Ошибка delete/clear |
| --- | --- | --- |
| best-effort, по умолчанию | onStoreError, затем loader/память | onStoreError; память очищается, постоянные данные могут остаться |
| required | Отклоняется ready ожидающего handle | Отклоняется Promise очистки; владение в памяти всё равно завершается |

QuotaExceededError, SecurityError и отсутствие CacheStorage подчиняются той же
политике. Даже исключение из onStoreError не нарушает владение ресурсами. Если
при logout вызывающий код должен узнать о неудачном удалении постоянных данных,
выбирайте required и явно обрабатывайте отклонение Promise очистки.

maxAgeMs по умолчанию равен 24 часам и отличается от TTL памяти. Постоянные
записи не ограничиваются maxBytes/maxEntries и не очищаются фоновым LRU.
Истечение срока проверяется при чтении. Квоты и автоматическое удаление браузером
не контролируются библиотекой. Медленная операция хранилища задерживает свой
namespace; встроенного тайм-аута нет.

Собственный BlobStore реализует get(MediaKey), put(MediaKey, Blob), delete(MediaKey)
и clear(namespace), возвращая Promise. При отсутствии данных get возвращает
undefined. Ядро передаёт неизменяемые объекты ключей, а не внутренние записи.
Общий или удалённый store должен сам определять согласованность между клиентами.

## Необязательный React hook

Ядро не импортирует React. Отдельная точка /react использует необязательную
peer-зависимость; установите React в приложении. Проверен React 19.3.1 StrictMode;
объявленный peer-диапазон React 18/19 не означает проверку каждой версии.

```tsx
import { useMedia } from '@59alex/browser-media-cache/react';

// Reuse a stable cache instance across renders.
function Photo({ accountId, mediaId }: { accountId: string; mediaId: string | null }) {
  const state = useMedia(cache, accountId, mediaId);
  if (state.status === 'idle') return null;
  if (state.status === 'loading') return <span>Loading…</span>;
  if (state.status === 'error') return <span>Media unavailable</span>;
  return <img src={state.resource.url} alt="Shared media" />;
}
```

null отключает приобретение и возвращает idle. Effect вызывает acquire при
монтировании/смене ключа и release при очистке; SSR-рендер не приобретает handle.
При смене namespace/key hook сразу скрывает прошлый ресурс, а при отзыве владения
убирает ready. Инвалидация оставляет error: автоматического повторного acquire
нет. Когда повтор уместен, измените ключ, перемонтируйте компонент либо явно
отключите и снова включите hook. Не сохраняйте resource.url после завершения
владения. Не создавайте новый MediaCache на каждом рендере.

## Диагностика и демо

```ts
const state = cache.inspect();
console.log(state.activeHandles, state.loadingEntries, state.idleEntries);
console.log(state.retainedBytes, state.overBudget);
for (const entry of state.entries) {
  console.log(entry.namespace, entry.key, entry.generation, entry.phase, entry.handles);
}
```

Снимки диагностики заморожены и не дают владения ресурсами. Демо использует
inspect и отдельные счётчики URL, чтобы сделать жизненный цикл наблюдаемым.

```sh
npm run demo
npm run test:package
npx playwright install chromium firefox
npm run test:browser
```

Браузерные тесты выполняются headless и сохраняют отчёты/скриншоты в
output/playwright. Они проверяют настоящие URL, изображения и CacheStorage,
500 циклов с двумя потребителями, 100 циклов React StrictMode mount/unmount
и одну смену namespace активного компонента.
[Результаты и ограничения](../VERIFICATION.md).

Если CacheStorage недоступен, используйте localhost/HTTPS и проверьте политику
хранилища браузера либо оставьте только память. Если изображение исчезло после
инвалидации, очистите его состояние и получите новый handle, когда это уместно:
старый URL больше не принадлежит потребителю. Если overBudget остаётся true,
проверьте activeHandles. Ошибка импорта /react обычно означает отсутствие
необязательного React peer; независимый от фреймворка код использует корневой импорт.

[← Back to documentation and versions / Назад к документации и версиям](../index.md)
