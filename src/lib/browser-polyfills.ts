/**
 * Lightweight Browser Compatibility Polyfills & Guards
 * Keeps head inline script minimal (~1.8KB) for fast iOS Safari startup while protecting
 * Safari / WebKit / in-app WebViews from sealed crypto, sandboxed history, or missing APIs.
 */

export const POLYFILL_INLINE_SCRIPT = `
(function() {
  try {
    if (typeof globalThis === 'undefined' && typeof window !== 'undefined') {
      window.globalThis = window;
    }
    if (typeof window !== 'undefined') {
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

export function initBrowserPolyfills(): void {
  if (typeof window === "undefined") return;
  if ("__terrabar_polyfills_ready__" in window) return;
  try {
    const fn = new Function(POLYFILL_INLINE_SCRIPT);
    fn();
  } catch {
    // Already inlined or eval disabled
  }
}
