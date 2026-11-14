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

export function isCompressibleContentType(contentType: string): boolean {
  const ct = (contentType || "").toLowerCase();
  if (!ct) return false;
  return (
    ct.startsWith("text/") ||
    ct.includes("application/json") ||
    ct.includes("application/javascript") ||
    ct.includes("text/javascript") ||
    ct.includes("application/ecmascript") ||
    ct.includes("application/xml") ||
    ct.includes("application/xhtml+xml") ||
    ct.includes("application/sql") ||
    ct.includes("image/svg+xml")
  );
}

let cachedZlib: any | null | undefined = undefined;

async function getZlib(): Promise<any | null> {
  if (cachedZlib !== undefined) return cachedZlib;
  try {
    const mod = await import("node:zlib");
    cachedZlib = mod?.default ?? mod;
  } catch {
    cachedZlib = null;
  }
  return cachedZlib;
}

async function compressWithWebStream(
  bytes: Uint8Array,
  format: "gzip" | "deflate",
): Promise<Uint8Array | null> {
  if (typeof CompressionStream === "undefined") return null;
  try {
    const cs = new CompressionStream(format);
    const writer = cs.writable.getWriter();
    const copy = new Uint8Array(bytes.byteLength);
    copy.set(bytes);
    void writer.write(copy).then(() => writer.close());
    const compressedBuf = await new Response(cs.readable).arrayBuffer();
    return new Uint8Array(compressedBuf);
  } catch {
    return null;
  }
}

export async function compressBytes(
  bytes: Uint8Array,
  acceptEncoding: string,
): Promise<{ bytes: Uint8Array; encoding: "br" | "gzip" | null }> {
  if (bytes.byteLength < 512) {
    return { bytes, encoding: null };
  }

  const ae = (acceptEncoding || "").toLowerCase();
  const wantsBr = /\bbr\b/.test(ae);
  const wantsGzip = /\bgzip\b/.test(ae);

  if (!wantsBr && !wantsGzip) {
    return { bytes, encoding: null };
  }

  const zlib = await getZlib();

  if (wantsBr && zlib && typeof zlib.brotliCompressSync === "function") {
    try {
      const brOut = zlib.brotliCompressSync(bytes, {
        params: {
          [zlib.constants?.BROTLI_PARAM_QUALITY ?? 11]: 4,
        },
      });
      const outBytes = new Uint8Array(brOut.buffer, brOut.byteOffset, brOut.byteLength);
      if (outBytes.byteLength > 0 && outBytes.byteLength < bytes.byteLength) {
        return { bytes: outBytes, encoding: "br" };
      }
    } catch {
      // Fallback to gzip
    }
  }

  if (wantsGzip) {
    if (zlib && typeof zlib.gzipSync === "function") {
      try {
        const gzOut = zlib.gzipSync(bytes, { level: 6 });
        const outBytes = new Uint8Array(gzOut.buffer, gzOut.byteOffset, gzOut.byteLength);
        if (outBytes.byteLength > 0 && outBytes.byteLength < bytes.byteLength) {
          return { bytes: outBytes, encoding: "gzip" };
        }
      } catch {
        // Fallback to Web CompressionStream
      }
    }

    const webGz = await compressWithWebStream(bytes, "gzip");
    if (webGz && webGz.byteLength > 0 && webGz.byteLength < bytes.byteLength) {
      return { bytes: webGz, encoding: "gzip" };
    }
  }

  return { bytes, encoding: null };
}

export async function buildCompressedResponse(
  rawBytes: Uint8Array,
  status: number,
  headers: Headers,
  request: Request,
): Promise<Response> {
  const method = (request.method || "GET").toUpperCase();
  const contentType = headers.get("content-type") || "";
  const alreadyEncoded = Boolean(headers.get("content-encoding"));

  headers.delete("transfer-encoding");
  appendVaryHeader(headers, "Accept-Encoding");

  if (method === "HEAD") {
    headers.set("Content-Length", String(rawBytes.byteLength));
    return new Response(null, { status, headers });
  }

  if (!alreadyEncoded && isCompressibleContentType(contentType)) {
    const acceptEncoding = request.headers.get("accept-encoding") || "";
    const { bytes: outBytes, encoding } = await compressBytes(rawBytes, acceptEncoding);
    if (encoding) {
      headers.set("Content-Encoding", encoding);
    }
    headers.set("Content-Length", String(outBytes.byteLength));
    return new Response(outBytes, { status, headers });
  }

  headers.set("Content-Length", String(rawBytes.byteLength));
  return new Response(rawBytes, { status, headers });
}
