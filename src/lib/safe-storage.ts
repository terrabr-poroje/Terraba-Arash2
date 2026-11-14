/**
 * Resilient cross-browser Storage helper for Chrome Incognito, Safari Private Mode,
 * partitioned iframes, and restricted mobile in-app WebViews (Telegram, Instagram, Rubika, Eitaa)
 * where direct localStorage/sessionStorage access throws SecurityError / DOMException.
 */

const memoryLocalStore = new Map<string, string>();
const memorySessionStore = new Map<string, string>();

let localAvailable: boolean | null = null;
let sessionAvailable: boolean | null = null;

function probeStorage(kind: "localStorage" | "sessionStorage"): boolean {
  try {
    if (typeof window === "undefined") return false;
    const storage = window[kind];
    if (!storage) return false;
    const probeKey = "__terrabar_storage_probe__";
    storage.setItem(probeKey, "1");
    storage.removeItem(probeKey);
    return true;
  } catch {
    return false;
  }
}

function hasLocalStorage(): boolean {
  if (localAvailable === null) {
    localAvailable = probeStorage("localStorage");
  }
  return localAvailable;
}

function hasSessionStorage(): boolean {
  if (sessionAvailable === null) {
    sessionAvailable = probeStorage("sessionStorage");
  }
  return sessionAvailable;
}

export const safeStorage = {
  getItem(key: string): string | null {
    try {
      if (hasLocalStorage()) {
        const val = window.localStorage.getItem(key);
        if (val !== null) return val;
      }
    } catch {
      localAvailable = false;
    }
    return memoryLocalStore.get(key) ?? null;
  },

  setItem(key: string, value: string): void {
    const stringVal = String(value);
    try {
      if (hasLocalStorage()) {
        window.localStorage.setItem(key, stringVal);
      }
    } catch {
      localAvailable = false;
    }
    memoryLocalStore.set(key, stringVal);
  },

  removeItem(key: string): void {
    try {
      if (hasLocalStorage()) {
        window.localStorage.removeItem(key);
      }
    } catch {
      localAvailable = false;
    }
    memoryLocalStore.delete(key);
  },

  clear(): void {
    try {
      if (hasLocalStorage()) {
        window.localStorage.clear();
      }
    } catch {
      localAvailable = false;
    }
    memoryLocalStore.clear();
  },
};

export const safeSessionStorage = {
  getItem(key: string): string | null {
    try {
      if (hasSessionStorage()) {
        const val = window.sessionStorage.getItem(key);
        if (val !== null) return val;
      }
    } catch {
      sessionAvailable = false;
    }
    return memorySessionStore.get(key) ?? null;
  },

  setItem(key: string, value: string): void {
    const stringVal = String(value);
    try {
      if (hasSessionStorage()) {
        window.sessionStorage.setItem(key, stringVal);
      }
    } catch {
      sessionAvailable = false;
    }
    memorySessionStore.set(key, stringVal);
  },

  removeItem(key: string): void {
    try {
      if (hasSessionStorage()) {
        window.sessionStorage.removeItem(key);
      }
    } catch {
      sessionAvailable = false;
    }
    memorySessionStore.delete(key);
  },

  clear(): void {
    try {
      if (hasSessionStorage()) {
        window.sessionStorage.clear();
      }
    } catch {
      sessionAvailable = false;
    }
    memorySessionStore.clear();
  },
};

/**
 * Active non-blocking cleanup of legacy Service Workers & corrupt CacheStorage entries
 * that can stall page loads across Iranian mobile networks.
 */
export function unregisterServiceWorker(): void {
  if (typeof window === "undefined") return;

  try {
    if (
      "serviceWorker" in navigator &&
      navigator.serviceWorker &&
      typeof navigator.serviceWorker.getRegistrations === "function"
    ) {
      const promise = navigator.serviceWorker.getRegistrations();
      if (promise && typeof promise.then === "function") {
        promise
          .then((registrations) => {
            if (Array.isArray(registrations)) {
              for (const registration of registrations) {
                try {
                  registration.unregister().catch(() => {});
                } catch {
                  // Ignore
                }
              }
            }
          })
          .catch(() => {});
      }
    }
  } catch {
    // Blocked in Incognito or restricted WebView
  }

  try {
    if ("caches" in window && window.caches && typeof window.caches.keys === "function") {
      const promise = window.caches.keys();
      if (promise && typeof promise.then === "function") {
        promise
          .then((keys) => {
            if (Array.isArray(keys)) {
              for (const key of keys) {
                try {
                  window.caches.delete(key).catch(() => {});
                } catch {
                  // Ignore
                }
              }
            }
          })
          .catch(() => {});
      }
    }
  } catch {
    // CacheStorage blocked in Incognito
  }
}

const CHUNK_RELOAD_KEY = "__terrabar_chunk_reload_at__";

/**
 * Recovers cleanly once per 30 seconds if a dynamic ES module chunk drops
 * over lossy mobile networks (e.g., Hamrah-e-Aval / 3G handoff) or after a deploy.
 */
export function isDynamicImportError(reason: unknown): boolean {
  const text = String(
    reason instanceof Error ? `${reason.name} ${reason.message}` : reason || "",
  );
  return (
    text.includes("Failed to fetch dynamically imported module") ||
    text.includes("Importing a module script failed") ||
    text.includes("error loading dynamically imported module") ||
    text.includes("Loading chunk") ||
    text.includes("ChunkLoadError")
  );
}

export function triggerSingleChunkRecoveryReload(): boolean {
  if (typeof window === "undefined") return false;
  try {
    const now = Date.now();
    const last = Number(safeSessionStorage.getItem(CHUNK_RELOAD_KEY) || "0");
    if (now - last > 30_000) {
      safeSessionStorage.setItem(CHUNK_RELOAD_KEY, String(now));
      window.location.reload();
      return true;
    }
  } catch {
    // Ignore
  }
  return false;
}

export function installChunkLoadRecovery(): () => void {
  if (typeof window === "undefined") return () => {};

  const onError = (event: ErrorEvent) => {
    if (isDynamicImportError(event?.error || event?.message)) {
      triggerSingleChunkRecoveryReload();
    }
  };

  const onRejection = (event: PromiseRejectionEvent) => {
    if (isDynamicImportError(event?.reason)) {
      event.preventDefault();
      triggerSingleChunkRecoveryReload();
    }
  };

  window.addEventListener("error", onError);
  window.addEventListener("unhandledrejection", onRejection);
  return () => {
    window.removeEventListener("error", onError);
    window.removeEventListener("unhandledrejection", onRejection);
  };
}
