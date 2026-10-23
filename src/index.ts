/** A stable logical media identity. Namespaces are isolation labels, not credentials. */
export interface MediaKey {
  readonly namespace: string;
  readonly key: string;
}

export interface LoadContext extends MediaKey {
  readonly signal: AbortSignal;
}

/** Optional persistence port. The cache serializes operations per namespace. */
export interface BlobStore {
  get(key: MediaKey): Promise<Blob | undefined>;
  put(key: MediaKey, blob: Blob): Promise<void>;
  delete(key: MediaKey): Promise<void>;
  clear(namespace: string): Promise<void>;
}

export type StoreOperation = "get" | "put" | "delete" | "clear";

export interface StoreFailure {
  readonly operation: StoreOperation;
  readonly namespace: string;
  readonly key?: string;
  readonly error: unknown;
}

export interface MediaCacheOptions {
  readonly load: (context: LoadContext) => Promise<Blob>;
  /** Idle retention after the final release. Default: 30 seconds. */
  readonly idleTtlMs?: number;
  /** Total entry target. Only idle entries are evicted; active entries may exceed it. Default: 128. */
  readonly maxEntries?: number;
  /** Ready-entry Blob.size target; excludes in-flight work, decoded media, and storage. Default: 64 MiB. */
  readonly maxBytes?: number;
  readonly store?: BlobStore;
  /** Best effort falls back to memory/network on storage errors; required rejects. */
  readonly persistence?: "best-effort" | "required";
  readonly onStoreError?: (failure: StoreFailure) => void;
  /** Optional platform hooks for tests or compatible non-window runtimes. */
  readonly objectUrls?: {
    create(blob: Blob): string;
    revoke(url: string): void;
  };
  /** Monotonic milliseconds, used for idle retention. Defaults to performance.now(). */
  readonly now?: () => number;
}

export interface MediaResource {
  readonly url: string;
  readonly blob: Blob;
}

/** Owns a resource until release, abort, invalidation, or cache disposal. */
export interface MediaHandle {
  readonly ready: Promise<MediaResource>;
  /** Aborted when ownership ends, including forced invalidation after ready resolves. */
  readonly signal: AbortSignal;
  readonly released: boolean;
  release(): void;
}

export interface AcquireOptions extends MediaKey {
  readonly signal?: AbortSignal;
}

export interface EntrySnapshot extends MediaKey {
  readonly generation: number;
  readonly phase: "loading" | "ready";
  readonly handles: number;
  readonly bytes: number;
  readonly idleSince: number | undefined;
}

export interface CacheSnapshot {
  readonly disposed: boolean;
  readonly entries: readonly EntrySnapshot[];
  readonly activeHandles: number;
  readonly idleEntries: number;
  readonly loadingEntries: number;
  readonly retainedBytes: number;
  readonly overBudget: boolean;
}

interface Consumer {
  live: boolean;
  controller: AbortController;
  resolve: (resource: MediaResource) => void;
  reject: (reason: unknown) => void;
  removeExternalListener: () => void;
}

interface Entry extends MediaKey {
  id: string;
  generation: number;
  live: boolean;
  controller: AbortController;
  consumers: Set<Consumer>;
  resource: MediaResource | undefined;
  idleSince: number | undefined;
  lastUsed: number;
}

function abortError(message: string): DOMException {
  return new DOMException(message, "AbortError");
}

function label(value: string, name: string): void {
  if (typeof value !== "string" || value.length === 0) {
    throw new TypeError(`${name} must be a non-empty string`);
  }
}

function budget(value: number, name: string): number {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new RangeError(`${name} must be a non-negative safe integer`);
  }
  return value;
}

/** Framework-independent, per-instance owner of shared Blob URLs. */
export class MediaCache {
  readonly #options: MediaCacheOptions;
  readonly #idleTtlMs: number;
  readonly #maxEntries: number;
  readonly #maxBytes: number;
  readonly #now: () => number;
  readonly #urls: { create(blob: Blob): string; revoke(url: string): void };
  readonly #entries = new Map<string, Entry>();
  readonly #storeQueues = new Map<string, Promise<void>>();
  #sequence = 0;
  #timer: ReturnType<typeof setTimeout> | undefined;
  #disposed = false;

  constructor(options: MediaCacheOptions) {
    if (typeof options.load !== "function") throw new TypeError("load must be a function");
    this.#idleTtlMs = budget(options.idleTtlMs ?? 30_000, "idleTtlMs");
    this.#maxEntries = budget(options.maxEntries ?? 128, "maxEntries");
    this.#maxBytes = budget(options.maxBytes ?? 64 * 1024 * 1024, "maxBytes");
    if (options.persistence !== undefined && !["best-effort", "required"].includes(options.persistence)) {
      throw new TypeError("persistence must be best-effort or required");
    }
    this.#options = { ...options };
    this.#now = options.now ?? (() => performance.now());
    this.#urls = options.objectUrls ?? {
      create: blob => URL.createObjectURL(blob),
      revoke: url => URL.revokeObjectURL(url),
    };
  }

  acquire(options: AcquireOptions): MediaHandle {
    this.#assertOpen();
    label(options.namespace, "namespace");
    label(options.key, "key");
    this.collect();
    let resolve!: Consumer["resolve"];
    let reject!: Consumer["reject"];
    const ready = new Promise<MediaResource>((yes, no) => { resolve = yes; reject = no; });
    // Cleanup may precede the caller's await; the original promise still rejects normally.
    void ready.catch(() => undefined);
    const consumer: Consumer = {
      live: true, controller: new AbortController(), resolve, reject,
      removeExternalListener: () => undefined,
    };
    let entry: Entry | undefined;
    const release = (reason: unknown = abortError("Media handle released")) => {
      if (!consumer.live) return;
      consumer.live = false;
      consumer.removeExternalListener();
      consumer.reject(reason);
      if (entry?.live) {
        entry.consumers.delete(consumer);
        if (entry.consumers.size === 0) {
          if (!entry.resource) this.#destroy(entry, reason);
          else {
            entry.idleSince = this.#now();
            entry.lastUsed = ++this.#sequence;
            this.collect();
          }
        }
      }
      consumer.controller.abort(reason);
    };
    const handle: MediaHandle = Object.freeze({
      ready, signal: consumer.controller.signal,
      get released() { return !consumer.live; },
      release: () => release(),
    });
    if (options.signal?.aborted) {
      release(options.signal.reason ?? abortError("Media request aborted"));
      return handle;
    }
    const id = JSON.stringify([options.namespace, options.key]);
    entry = this.#entries.get(id);
    const fresh = !entry;
    if (!entry) {
      entry = {
        id, namespace: options.namespace, key: options.key, generation: ++this.#sequence,
        live: true, controller: new AbortController(), consumers: new Set(),
        resource: undefined, idleSince: undefined, lastUsed: this.#sequence,
      };
      this.#entries.set(id, entry);
    }
    entry.consumers.add(consumer);
    entry.idleSince = undefined;
    entry.lastUsed = ++this.#sequence;
    if (options.signal) {
      const signal = options.signal;
      const onAbort = () => release(signal.reason ?? abortError("Media request aborted"));
      signal.addEventListener("abort", onAbort, { once: true });
      consumer.removeExternalListener = () => signal.removeEventListener("abort", onAbort);
    }
    if (entry.resource) {
      const resource = entry.resource;
      queueMicrotask(() => { if (consumer.live) consumer.resolve(resource); });
    } else if (fresh) {
      const loadingEntry = entry;
      queueMicrotask(() => { void this.#load(loadingEntry); });
    }
    this.collect();
    return handle;
  }

  /** Immediately ends ownership, then removes this key from optional persistence. */
  invalidate(key: MediaKey): Promise<void> {
    this.#assertOpen();
    label(key.namespace, "namespace");
    label(key.key, "key");
    // Queue the barrier before abort listeners can synchronously reacquire.
    const identity = Object.freeze({ namespace: key.namespace, key: key.key });
    const cleanup = this.#store(identity, "delete", store => store.delete(identity));
    const entry = this.#entries.get(JSON.stringify([key.namespace, key.key]));
    if (entry) this.#destroy(entry, abortError("Media key invalidated"));
    this.#schedule();
    return cleanup.then(() => undefined);
  }

  /**
   * Logout boundary for this instance. Memory ownership ends synchronously.
   * The returned promise follows persistence policy: required rejects on failure;
   * best-effort reports it through onStoreError and may leave persistent data.
   */
  invalidateNamespace(namespace: string): Promise<void> {
    this.#assertOpen();
    label(namespace, "namespace");
    const cleanup = this.#store({ namespace }, "clear", store => store.clear(namespace));
    const entries = [...this.#entries.values()].filter(entry => entry.namespace === namespace);
    // Invalidate all generations before notifying any consumer.
    for (const entry of entries) this.#unlink(entry);
    for (const entry of entries) this.#destroy(entry, abortError("Media namespace invalidated"));
    this.#schedule();
    return cleanup.then(() => undefined);
  }

  /** Evicts expired idle entries, then oldest idle entries under budget pressure. */
  collect(): void {
    if (this.#disposed) return;
    const now = this.#now();
    for (const entry of this.#entries.values()) {
      if (entry.idleSince !== undefined && now - entry.idleSince >= this.#idleTtlMs) {
        this.#destroy(entry, abortError("Idle media expired"));
      }
    }
    const idle = [...this.#entries.values()].filter(entry => entry.consumers.size === 0)
      .sort((a, b) => a.lastUsed - b.lastUsed);
    let bytes = this.#bytes();
    for (const entry of idle) {
      if (this.#entries.size <= this.#maxEntries && bytes <= this.#maxBytes) break;
      bytes -= entry.resource?.blob.size ?? 0;
      this.#destroy(entry, abortError("Idle media evicted"));
    }
    this.#schedule();
  }

  /** Read-only diagnostic snapshot; it grants no ownership of media resources. */
  inspect(): CacheSnapshot {
    const entries = [...this.#entries.values()].map(entry => Object.freeze({
      namespace: entry.namespace, key: entry.key, generation: entry.generation,
      phase: entry.resource ? "ready" as const : "loading" as const,
      handles: entry.consumers.size, bytes: entry.resource?.blob.size ?? 0,
      idleSince: entry.idleSince,
    }));
    const retainedBytes = entries.reduce((sum, entry) => sum + entry.bytes, 0);
    return Object.freeze({
      disposed: this.#disposed, entries: Object.freeze(entries), retainedBytes,
      activeHandles: entries.reduce((sum, entry) => sum + entry.handles, 0),
      idleEntries: entries.filter(entry => entry.handles === 0).length,
      loadingEntries: entries.filter(entry => entry.phase === "loading").length,
      overBudget: entries.length > this.#maxEntries || retainedBytes > this.#maxBytes,
    });
  }

  /** Ends all ownership and cancels pending work. Does not clear persistent storage. */
  dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    if (this.#timer !== undefined) clearTimeout(this.#timer);
    this.#timer = undefined;
    const entries = [...this.#entries.values()];
    for (const entry of entries) this.#unlink(entry);
    for (const entry of entries) this.#destroy(entry, abortError("Media cache disposed"));
  }

  #assertOpen(): void {
    if (this.#disposed) throw new Error("MediaCache is disposed");
  }

  #current(entry: Entry): boolean {
    return !this.#disposed && entry.live && this.#entries.get(entry.id) === entry;
  }

  async #load(entry: Entry): Promise<void> {
    if (!this.#current(entry)) return;
    try {
      const identity = Object.freeze({ namespace: entry.namespace, key: entry.key });
      let blob = await this.#store(identity, "get", store => this.#current(entry) ? store.get(identity) : undefined);
      if (!this.#current(entry)) return;
      if (blob === undefined) {
        blob = await this.#options.load({ namespace: entry.namespace, key: entry.key, signal: entry.controller.signal });
        if (!this.#current(entry)) return;
        if (!blob || !Number.isFinite(blob.size) || blob.size < 0 || typeof blob.arrayBuffer !== "function") {
          throw new TypeError("Loader must resolve to a Blob");
        }
        const loaded = blob;
        await this.#store(identity, "put", store => this.#current(entry) ? store.put(identity, loaded) : undefined);
      }
      if (!this.#current(entry)) return;
      if (!blob || !Number.isFinite(blob.size) || blob.size < 0 || typeof blob.arrayBuffer !== "function") {
        throw new TypeError("Store must resolve to a Blob or undefined");
      }
      const url = this.#urls.create(blob);
      if (!this.#current(entry)) { this.#urls.revoke(url); return; }
      entry.resource = Object.freeze({ url, blob });
      for (const consumer of entry.consumers) if (consumer.live) consumer.resolve(entry.resource);
      this.collect();
    } catch (error) {
      if (this.#current(entry)) {
        this.#destroy(entry, error);
        this.#schedule();
      }
    }
  }

  #unlink(entry: Entry): void {
    if (this.#entries.get(entry.id) === entry) this.#entries.delete(entry.id);
    entry.live = false;
  }

  #destroy(entry: Entry, reason: unknown): void {
    this.#unlink(entry);
    const resource = entry.resource;
    entry.resource = undefined;
    const consumers = [...entry.consumers];
    entry.consumers.clear();
    for (const consumer of consumers) {
      consumer.live = false;
      consumer.removeExternalListener();
      consumer.reject(reason);
    }
    if (resource) this.#urls.revoke(resource.url);
    entry.controller.abort(reason);
    for (const consumer of consumers) consumer.controller.abort(reason);
  }

  #bytes(): number {
    let bytes = 0;
    for (const entry of this.#entries.values()) bytes += entry.resource?.blob.size ?? 0;
    return bytes;
  }

  #schedule(): void {
    if (this.#timer !== undefined) clearTimeout(this.#timer);
    this.#timer = undefined;
    if (this.#disposed) return;
    let earliest = Infinity;
    for (const entry of this.#entries.values()) {
      if (entry.idleSince !== undefined) earliest = Math.min(earliest, entry.idleSince + this.#idleTtlMs);
    }
    if (earliest !== Infinity) {
      this.#timer = setTimeout(() => this.collect(), Math.min(2_147_483_647, Math.max(0, earliest - this.#now())));
    }
  }

  #store<T>(scope: { namespace: string; key?: string }, operation: StoreOperation,
      run: (store: BlobStore) => T | Promise<T>): Promise<T | undefined> {
    const store = this.#options.store;
    if (!store) return Promise.resolve(undefined);
    const previous = this.#storeQueues.get(scope.namespace) ?? Promise.resolve();
    const result = previous.then(async () => {
      try { return await run(store); }
      catch (error) {
        try { this.#options.onStoreError?.({ ...scope, operation, error }); }
        catch { /* Diagnostics must not change cache ownership or storage policy. */ }
        if (this.#options.persistence === "required") throw error;
        return undefined;
      }
    });
    const barrier = result.then(() => undefined, () => undefined);
    this.#storeQueues.set(scope.namespace, barrier);
    void barrier.then(() => {
      if (this.#storeQueues.get(scope.namespace) === barrier) this.#storeQueues.delete(scope.namespace);
    });
    return result;
  }
}
