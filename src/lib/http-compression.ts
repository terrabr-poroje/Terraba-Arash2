/* eslint-disable @typescript-eslint/no-explicit-any */

export const API_CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, PATCH, DELETE, HEAD, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, Range, X-Requested-With, Accept",
  "Access-Control-Expose-Headers": "Content-Length, Content-Type, Content-Disposition",
  "Access-Control-Max-Age": "86400",
};

export function appendVaryHeader(headers: Headers, token: string): void {
  const current = headers.get("vary");
  if (!current) {
    headers.set("Vary", token);
    return;
  }
  const existing = current
    .split(",")
    .map((v) => v.trim().toLowerCase())
    .filter(Boolean);
  if (!existing.includes(token.toLowerCase())) {
    headers.set("Vary", `${current}, ${token}`);
  }
}

export function applyApiCorsHeaders(headers: Headers): Headers {
  for (const [key, value] of Object.entries(API_CORS_HEADERS)) {
    headers.set(key, value);
  }
  appendVaryHeader(headers, "Origin");
  appendVaryHeader(headers, "Accept-Encoding");
  return headers;
}

export function applyFontCacheHeaders(headers: Headers, pathname: string): Headers {
  headers.set("Cache-Control", "public, max-age=31536000, immutable");
  headers.set("Access-Control-Allow-Origin", "*");
  headers.set("Cross-Origin-Resource-Policy", "cross-origin");
  headers.set("Timing-Allow-Origin", "*");

  const lower = pathname.toLowerCase();
  if (lower.endsWith(".woff2")) {
    headers.set("Content-Type", "font/woff2");
  } else if (lower.endsWith(".woff")) {
    headers.set("Content-Type", "font/woff");
  } else if (lower.endsWith(".ttf")) {
    headers.set("Content-Type", "font/ttf");
  } else if (lower.endsWith(".otf")) {
    headers.set("Content-Type", "font/otf");
  } else if (lower.endsWith(".eot")) {
    headers.set("Content-Type", "application/vnd.ms-fontobject");
  }
  return headers;
}

/**
 * Returns an atomic UTF-8 buffered response with exact Content-Length and clean
 * Vary: Accept-Encoding (without setting no-transform or raw Content-Encoding binary,
 * allowing Cloudflare Edge / CDN / upstream proxies to safely negotiate Brotli/Gzip
 * without corrupting or stripping Content-Encoding across proxy hops).
 */
export function buildSafeBufferedResponse(
  rawBytes: Uint8Array,
  status: number,
  headers: Headers,
  request: Request,
): Response {
  const method = (request.method || "GET").toUpperCase();
  headers.delete("transfer-encoding");
  headers.delete("content-encoding");
  appendVaryHeader(headers, "Accept-Encoding");
  headers.set("Content-Length", String(rawBytes.byteLength));

  if (method === "HEAD") {
    return new Response(null, { status, headers });
  }
  return new Response(rawBytes, { status, headers });
}
