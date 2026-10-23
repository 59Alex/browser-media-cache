import { useEffect, useState } from "react";
import type { MediaCache, MediaResource } from "./index.js";

export type MediaState =
  | { readonly status: "idle" }
  | { readonly status: "loading" }
  | { readonly status: "ready"; readonly resource: MediaResource }
  | { readonly status: "error"; readonly error: unknown };

interface OwnedState {
  cache: MediaCache;
  namespace: string;
  key: string;
  state: MediaState;
  signal?: AbortSignal;
}

/** Acquire in an effect and release on key change/unmount. Pass null to disable. */
export function useMedia(cache: MediaCache, namespace: string, key: string | null): MediaState {
  const [owned, setOwned] = useState<OwnedState | undefined>();
  useEffect(() => {
    if (key === null) return;
    let mounted = true;
    let handle;
    try { handle = cache.acquire({ namespace, key }); }
    catch (error) {
      setOwned({ cache, namespace, key, state: { status: "error", error } });
      return;
    }
    const publish = (state: MediaState) => {
      if (mounted) setOwned({ cache, namespace, key, state, signal: handle.signal });
    };
    publish({ status: "loading" });
    const onAbort = () => publish({ status: "error", error: handle.signal.reason });
    handle.signal.addEventListener("abort", onAbort, { once: true });
    void handle.ready.then(resource => {
      if (!handle.released) publish({ status: "ready", resource });
    }, error => publish({ status: "error", error }));
    return () => {
      mounted = false;
      handle.signal.removeEventListener("abort", onAbort);
      handle.release();
    };
  }, [cache, namespace, key]);
  if (key === null) return { status: "idle" };
  // Never expose the previous account/key's URL while a replacement effect is pending.
  if (owned?.cache !== cache || owned.namespace !== namespace || owned.key !== key) return { status: "loading" };
  if (owned.state.status === "ready" && owned.signal?.aborted) return { status: "loading" };
  return owned.state;
}
