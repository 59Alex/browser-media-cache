import type { BlobStore, MediaKey } from "./index.js";

export interface CacheStorageStoreOptions {
  /** Reserve a prefix for this application. Namespaces are encoded after it. */
  readonly cachePrefix?: string;
  /** Default: 24 hours; expiry is enforced on read. Independent of in-memory idle TTL. */
  readonly maxAgeMs?: number;
  readonly storage?: CacheStorage;
  readonly now?: () => number;
}

/** Optional CacheStorage adapter. Storage errors propagate to the core's persistence policy. */
export class CacheStorageStore implements BlobStore {
  readonly #options: CacheStorageStoreOptions;
  readonly #prefix: string;
  readonly #maxAgeMs: number;
  readonly #now: () => number;

  constructor(options: CacheStorageStoreOptions = {}) {
    this.#prefix = options.cachePrefix ?? "browser-media-cache:v1:";
    if (!this.#prefix) throw new TypeError("cachePrefix must not be empty");
    this.#maxAgeMs = options.maxAgeMs ?? 24 * 60 * 60 * 1000;
    if (!Number.isSafeInteger(this.#maxAgeMs) || this.#maxAgeMs < 0) {
      throw new RangeError("maxAgeMs must be a non-negative safe integer");
    }
    this.#options = { ...options };
    this.#now = options.now ?? Date.now;
  }

  async get(key: MediaKey): Promise<Blob | undefined> {
    const storage = this.#storage();
    const name = this.#name(key.namespace);
    if (!await storage.has(name)) return undefined;
    const cache = await storage.open(name);
    const request = this.#request(key.key);
    const response = await cache.match(request);
    if (!response) return undefined;
    const rawExpiry = response.headers.get("x-media-cache-expires");
    const expires = rawExpiry === null ? NaN : Number(rawExpiry);
    if (!Number.isFinite(expires) || expires <= this.#now()) {
      await cache.delete(request);
      return undefined;
    }
    return response.blob();
  }

  async put(key: MediaKey, blob: Blob): Promise<void> {
    const cache = await this.#storage().open(this.#name(key.namespace));
    await cache.put(this.#request(key.key), new Response(blob, { headers: {
      "content-type": blob.type || "application/octet-stream",
      "x-media-cache-expires": String(this.#now() + this.#maxAgeMs),
    } }));
  }

  async delete(key: MediaKey): Promise<void> {
    const storage = this.#storage();
    const name = this.#name(key.namespace);
    if (await storage.has(name)) await (await storage.open(name)).delete(this.#request(key.key));
  }

  async clear(namespace: string): Promise<void> {
    await this.#storage().delete(this.#name(namespace));
  }

  #storage(): CacheStorage {
    const storage = this.#options.storage ?? globalThis.caches;
    if (!storage) throw new Error("CacheStorage is unavailable in this environment");
    return storage;
  }

  #name(namespace: string): string {
    if (typeof namespace !== "string" || !namespace) throw new TypeError("namespace must be a non-empty string");
    return this.#prefix + encodeURIComponent(namespace);
  }

  #request(key: string): Request {
    if (typeof key !== "string" || !key) throw new TypeError("key must be a non-empty string");
    // Synthetic local CacheStorage key. No request is sent to this address.
    return new Request("https://browser-media-cache.invalid/v1/" + encodeURIComponent(key));
  }
}
