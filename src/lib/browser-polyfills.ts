/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Cross-Browser & Restricted WebView Compatibility Polyfills & Boot Guards
 * - Inline <head> guard protects restricted WebViews, Chrome Incognito, and Safari Private Mode
 *   from SecurityError on localStorage/sessionStorage, missing console, sealed crypto, or history APIs.
 * - Runtime polyfills ensure ES2019+/WebKit compatibility for older mobile browsers.
 */

export const POLYFILL_INLINE_SCRIPT = `
(function() {
  try {
    if (typeof globalThis === 'undefined' && typeof window !== 'undefined') {
      window.globalThis = window;
    }
    if (typeof window !== 'undefined') {
      if (!window.console) {
        window.console = { log: function(){}, warn: function(){}, error: function(){}, info: function(){} };
      }
      var storageBlocked = false;
      try {
        var probe = '__tb_probe__';
        window.localStorage.setItem(probe, probe);
        window.localStorage.removeItem(probe);
      } catch (err) {
        storageBlocked = true;
      }
      if (storageBlocked) {
        var createMemoryStore = function() {
          var data = {};
          return {
            getItem: function(k) { return Object.prototype.hasOwnProperty.call(data, k) ? data[k] : null; },
            setItem: function(k, v) { data[k] = String(v); },
            removeItem: function(k) { delete data[k]; },
            clear: function() { data = {}; },
            get length() { return Object.keys(data).length; },
            key: function(i) { return Object.keys(data)[i] || null; }
          };
        };
        try { Object.defineProperty(window, 'localStorage', { value: createMemoryStore(), configurable: true, writable: true }); } catch (e) {}
        try { Object.defineProperty(window, 'sessionStorage', { value: createMemoryStore(), configurable: true, writable: true }); } catch (e) {}
      }
      var c = window.crypto || window.msCrypto;
      if (c && !c.randomUUID) {
        var uuidFn = function() {
          return '10000000-1000-4000-8000-100000000000'.replace(/[018]/g, function(ch) {
            var n = Number(ch);
            var rnd = c.getRandomValues ? c.getRandomValues(new Uint8Array(1))[0] : Math.floor(Math.random() * 256);
            return (n ^ (rnd & (15 >> (n / 4)))).toString(16);
          });
        };
        try { c.randomUUID = uuidFn; } catch (e) {
          try { Object.defineProperty(c, 'randomUUID', { value: uuidFn, configurable: true, writable: true }); } catch (e2) {}
        }
      }
      if (window.history) {
        var origPush = window.history.pushState;
        if (typeof origPush === 'function') {
          window.history.pushState = function() {
            try { return origPush.apply(window.history, arguments); } catch (err) {}
          };
        }
        var origReplace = window.history.replaceState;
        if (typeof origReplace === 'function') {
          window.history.replaceState = function() {
            try { return origReplace.apply(window.history, arguments); } catch (err) {}
          };
        }
      }
      if (!window.requestIdleCallback) {
        window.requestIdleCallback = function(cb) {
          var start = Date.now();
          return setTimeout(function() {
            cb({ didTimeout: false, timeRemaining: function() { return Math.max(0, 50 - (Date.now() - start)); } });
          }, 1);
        };
      }
      if (!window.cancelIdleCallback) {
        window.cancelIdleCallback = function(id) { clearTimeout(id); };
      }
      if (typeof window.ResizeObserver === 'undefined') {
        window.ResizeObserver = function() { this.observe = function() {}; this.unobserve = function() {}; this.disconnect = function() {}; };
      }
      window.addEventListener('unhandledrejection', function(event) {
        if (event && event.reason) {
          var s = String(event.reason);
          if (s.indexOf('ResizeObserver') !== -1 || s.indexOf('SecurityError') !== -1 || s.indexOf('AbortError') !== -1) {
            event.preventDefault();
          }
        }
      });
      window.__terrabar_polyfills_ready__ = true;
    }
  } catch (e) {}
})();
`;

let runtimePolyfillsApplied = false;

export function applyRuntimeBrowserPolyfills(): void {
  if (typeof window === "undefined" || runtimePolyfillsApplied) return;
  runtimePolyfillsApplied = true;

  try {
    if (typeof Object.fromEntries !== "function") {
      Object.defineProperty(Object, "fromEntries", {
        value: function (entries: any): Record<string, any> {
          if (!entries) return {};
          const obj: Record<string, any> = {};
          if (Array.isArray(entries)) {
            for (let i = 0; i < entries.length; i++) {
              const item = entries[i];
              if (item && item.length >= 2) obj[item[0]] = item[1];
            }
          } else if (typeof entries[Symbol.iterator] === "function") {
            for (const [key, val] of entries) obj[key] = val;
          }
          return obj;
        },
        writable: true,
        configurable: true,
      });
    }
  } catch {
    // Safe
  }

  try {
    if (!Array.prototype.flat) {
      Object.defineProperty(Array.prototype, "flat", {
        value: function (depth = 1): any[] {
          const d = typeof depth === "number" ? depth : 1;
          const stack = Array.prototype.slice.call(this);
          const res: any[] = [];
          while (stack.length) {
            const next = stack.pop();
            if (Array.isArray(next) && d > 0) {
              for (let i = 0; i < next.length; i++) stack.push(next[i]);
            } else {
              res.push(next);
            }
          }
          return res.reverse();
        },
        writable: true,
        configurable: true,
      });
    }
    if (!Array.prototype.flatMap) {
      Object.defineProperty(Array.prototype, "flatMap", {
        value: function (fn: any, thisArg?: any): any[] {
          return (this as any).map(fn, thisArg).flat();
        },
        writable: true,
        configurable: true,
      });
    }
    if (!Array.prototype.at) {
      Object.defineProperty(Array.prototype, "at", {
        value: function (this: any[], n: number) {
          n = Math.trunc(n) || 0;
          if (n < 0) n += this.length;
          if (n < 0 || n >= this.length) return undefined;
          return this[n];
        },
        writable: true,
        configurable: true,
      });
    }
    if (!String.prototype.at) {
      Object.defineProperty(String.prototype, "at", {
        value: function (this: string, n: number): string {
          n = Math.trunc(n) || 0;
          if (n < 0) n += this.length;
          if (n < 0 || n >= this.length) return "";
          return this.charAt(n);
        },
        writable: true,
        configurable: true,
      });
    }
    if (!String.prototype.replaceAll) {
      Object.defineProperty(String.prototype, "replaceAll", {
        value: function (this: string, searchValue: any, replaceValue: any): string {
          if (searchValue instanceof RegExp) return this.replace(searchValue, replaceValue);
          const escaped = String(searchValue).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
          return this.replace(new RegExp(escaped, "g"), replaceValue);
        },
        writable: true,
        configurable: true,
      });
    }
  } catch {
    // Safe
  }

  try {
    if (!Promise.allSettled) {
      Object.defineProperty(Promise, "allSettled", {
        value: function (promises: Iterable<any>) {
          return Promise.all(
            Array.from(promises).map((p) =>
              Promise.resolve(p).then(
                (value) => ({ status: "fulfilled" as const, value }),
                (reason) => ({ status: "rejected" as const, reason }),
              ),
            ),
          );
        },
        writable: true,
        configurable: true,
      });
    }
  } catch {
    // Safe
  }

  try {
    if (typeof window.queueMicrotask !== "function") {
      window.queueMicrotask = function (callback: () => void) {
        Promise.resolve()
          .then(callback)
          .catch((err) => {
            setTimeout(() => {
              throw err;
            }, 0);
          });
      };
    }
    if (typeof (window as any).structuredClone !== "function") {
      (window as any).structuredClone = function (obj: any): any {
        if (obj === undefined) return undefined;
        try {
          return JSON.parse(JSON.stringify(obj));
        } catch {
          if (typeof obj === "object" && obj !== null) {
            return Array.isArray(obj) ? [...obj] : { ...obj };
          }
          return obj;
        }
      };
    }
  } catch {
    // Safe
  }

  try {
    if (typeof window.matchMedia === "function") {
      const testMql = window.matchMedia("(min-width: 0px)");
      if (testMql && typeof testMql.addEventListener !== "function") {
        const originalMatchMedia = window.matchMedia;
        const patchedMatchMedia = function (query: string): MediaQueryList {
          const mql = originalMatchMedia.call(window, query);
          if (mql && typeof mql.addEventListener !== "function") {
            (mql as any).addEventListener = function (type: string, listener: any) {
              if (type === "change" && typeof mql.addListener === "function") {
                mql.addListener(listener);
              }
            };
            (mql as any).removeEventListener = function (type: string, listener: any) {
              if (type === "change" && typeof mql.removeListener === "function") {
                mql.removeListener(listener);
              }
            };
          }
          return mql;
        };
        try {
          Object.defineProperty(window, "matchMedia", {
            value: patchedMatchMedia,
            writable: true,
            configurable: true,
          });
        } catch {
          try {
            (window as any).matchMedia = patchedMatchMedia;
          } catch {
            // Read-only
          }
        }
      }
    }
  } catch {
    // Safe
  }

  try {
    if (typeof Element !== "undefined") {
      if (!Element.prototype.matches) {
        (Element.prototype as any).matches =
          (Element.prototype as any).msMatchesSelector ||
          (Element.prototype as any).webkitMatchesSelector ||
          function (this: Element, s: string): boolean {
            const doc = this.ownerDocument || document;
            const matches = doc.querySelectorAll(s);
            let i = matches.length;
            while (--i >= 0 && matches.item(i) !== this) {
              /* scan matching elements */
            }
            return i > -1;
          };
      }
      if (!Element.prototype.closest) {
        Element.prototype.closest = function (this: Element, s: string): Element | null {
          if (this.matches && this.matches(s)) return this;
          let el: any = this.parentElement || this.parentNode;
          while (el !== null && el.nodeType === 1) {
            if (el.matches && el.matches(s)) return el;
            el = el.parentElement || el.parentNode;
          }
          return null;
        };
      }
    }
    if (typeof Node !== "undefined" && !Node.prototype.contains) {
      Node.prototype.contains = function (otherNode: any): boolean {
        if (!otherNode) return false;
        let node = otherNode;
        while (node) {
          if (node === this) return true;
          node = node.parentNode;
        }
        return false;
      };
    }
  } catch {
    // Safe
  }
}

export function initBrowserPolyfills(): void {
  if (typeof window === "undefined") return;
  applyRuntimeBrowserPolyfills();
  if ("__terrabar_polyfills_ready__" in window) return;
  try {
    const fn = new Function(POLYFILL_INLINE_SCRIPT);
    fn();
  } catch {
    // Already inlined or eval disabled
  }
}
