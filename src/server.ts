/* eslint-disable @typescript-eslint/no-explicit-any */
import "./lib/error-capture";

import { consumeLastCapturedError } from "./lib/error-capture";
import { renderErrorPage } from "./lib/error-page";
import { handleApiRequest } from "./lib/api-router";
import { toPersianErrorMessage } from "./lib/error-messages";
import {
  appendVaryHeader,
  applyApiCorsHeaders,
  applyFontCacheHeaders,
  buildSafeBufferedResponse,
} from "./lib/http-compression";

type ServerEntry = {
  fetch: (request: Request, env: unknown, ctx: unknown) => Promise<Response> | Response;
};

let cachedServerEntry: ServerEntry | undefined;

async function getServerEntry(): Promise<ServerEntry> {
  if (cachedServerEntry) return cachedServerEntry;
  const mod = await import("@tanstack/react-start/server-entry");
  cachedServerEntry = (mod.default ?? mod) as ServerEntry;
  return cachedServerEntry;
}

function applyBaselineHeaders(headers: Headers): void {
  headers.delete("x-frame-options");
  applyApiCorsHeaders(headers);
  headers.set("X-Content-Type-Options", "nosniff");
  headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  headers.set("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
}

async function normalizeCatastrophicSsrResponse(response: Response): Promise<Response> {
  if (response.status < 500) return response;
  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.includes("application/json")) return response;

  const body = await response.clone().text();
  if (!isH3SwallowedErrorBody(body)) return response;

  console.error(consumeLastCapturedError() ?? new Error(`h3 swallowed SSR error: ${body}`));
  return new Response(renderErrorPage(), {
    status: 500,
    headers: { "content-type": "text/html; charset=utf-8" },
  });
}

function isH3SwallowedErrorBody(body: string): boolean {
  try {
    const payload = JSON.parse(body) as { unhandled?: unknown; message?: unknown };
    return payload.unhandled === true && payload.message === "HTTPError";
  } catch {
    return false;
  }
}

function isFontPath(pathname: string): boolean {
  return (
    pathname.startsWith("/fonts/") ||
    /\.(woff2?|ttf|otf|eot)$/i.test(pathname)
  );
}

export default {
  async fetch(request: Request, env: unknown, ctx: unknown) {
    try {
      if (request.method.toUpperCase() === "OPTIONS") {
        const preflightHeaders = new Headers();
        applyBaselineHeaders(preflightHeaders);
        return new Response(null, { status: 204, headers: preflightHeaders });
      }

      const url = new URL(request.url);

      // Serve static assets via Cloudflare Workers ASSETS binding if available
      const isStaticAsset =
        url.pathname === "/sw.js" ||
        url.pathname.startsWith("/assets/") ||
        url.pathname.startsWith("/fonts/") ||
        url.pathname.startsWith("/_build/") ||
        url.pathname === "/favicon.ico" ||
        url.pathname === "/favicon.svg" ||
        url.pathname === "/apple-touch-icon.png" ||
        url.pathname === "/robots.txt" ||
        url.pathname === "/sitemap.xml" ||
        /\.(js|mjs|css|woff2?|ttf|otf|eot|svg|ico|png|jpe?g|webp|gif|json|xml|txt)$/i.test(url.pathname);

      if (isStaticAsset) {
        if (env && (env as any).ASSETS && typeof (env as any).ASSETS.fetch === "function") {
          try {
            const assetResponse = await (env as any).ASSETS.fetch(request);
            if (assetResponse && assetResponse.status < 400) {
              const headers = new Headers(assetResponse.headers);
              applyBaselineHeaders(headers);

              if (url.pathname === "/sw.js") {
                headers.set("Content-Type", "application/javascript; charset=utf-8");
                headers.set("Cache-Control", "no-cache, no-store, must-revalidate");
              } else if (isFontPath(url.pathname)) {
                applyFontCacheHeaders(headers, url.pathname);
              } else if (
                url.pathname.startsWith("/assets/") ||
                url.pathname.startsWith("/_build/")
              ) {
                headers.set("Cache-Control", "public, max-age=31536000, immutable");
              } else if (url.pathname === "/robots.txt" || url.pathname === "/sitemap.xml") {
                headers.set("Cache-Control", "public, max-age=3600");
              } else {
                headers.set("Cache-Control", "public, max-age=2592000, stale-while-revalidate=86400");
              }

              if (url.pathname.endsWith(".js") || url.pathname.endsWith(".mjs")) {
                headers.set("Content-Type", "application/javascript; charset=utf-8");
              } else if (url.pathname.endsWith(".css")) {
                headers.set("Content-Type", "text/css; charset=utf-8");
              } else if (url.pathname.endsWith(".svg")) {
                headers.set("Content-Type", "image/svg+xml");
              } else if (url.pathname.endsWith(".webp")) {
                headers.set("Content-Type", "image/webp");
              }

              // 304/204 responses MUST have a null body in Fetch/Cloudflare Workers
              if (assetResponse.status === 304 || assetResponse.status === 204 || assetResponse.status === 205) {
                return new Response(null, {
                  status: assetResponse.status,
                  headers,
                });
              }

              return new Response(assetResponse.body, {
                status: assetResponse.status,
                headers,
              });
            }
          } catch {
            // Asset fetch exception
          }
        }

        const notFoundHeaders = new Headers({
          "content-type":
            url.pathname.endsWith(".js") || url.pathname.endsWith(".mjs")
              ? "application/javascript; charset=utf-8"
              : url.pathname.endsWith(".css")
                ? "text/css; charset=utf-8"
                : "text/plain; charset=utf-8",
          "X-Content-Type-Options": "nosniff",
        });
        applyApiCorsHeaders(notFoundHeaders);
        return new Response("فایل مورد نظر یافت نشد", {
          status: 404,
          headers: notFoundHeaders,
        });
      }

      // Unified API router with universal CORS headers
      if (url.pathname.startsWith("/api/")) {
        try {
          const resolvedEnv =
            env ??
            (request as any)?.runtime?.cloudflare?.env ??
            (globalThis as any)?.__env__;
          const apiResponse = await handleApiRequest(request, resolvedEnv);
          if (apiResponse) {
            const apiHeaders = new Headers(apiResponse.headers);
            applyBaselineHeaders(apiHeaders);
            appendVaryHeader(apiHeaders, "Accept-Encoding");

            if (apiResponse.status === 204 || apiResponse.status === 205 || apiResponse.status === 304) {
              return new Response(null, { status: apiResponse.status, headers: apiHeaders });
            }

            return new Response(apiResponse.body, {
              status: apiResponse.status,
              headers: apiHeaders,
            });
          }
        } catch (apiError: any) {
          console.error("[server API error]", apiError);
          const errHeaders = new Headers({
            "content-type": "application/json; charset=utf-8",
            "cache-control": "no-store, no-cache, must-revalidate",
          });
          applyBaselineHeaders(errHeaders);
          const errBytes = new TextEncoder().encode(
            JSON.stringify({
              success: false,
              message: toPersianErrorMessage(apiError, "خطای داخلی سرور در پردازش درخواست."),
            }),
          );
          return buildSafeBufferedResponse(errBytes, 500, errHeaders, request);
        }
      }

      const handler = await getServerEntry();
      const response = await handler.fetch(request, env, ctx);
      const normalized = await normalizeCatastrophicSsrResponse(response);

      const responseHeaders = new Headers(normalized.headers);
      applyBaselineHeaders(responseHeaders);

      if (normalized.status === 304 || normalized.status === 204 || normalized.status === 205) {
        return new Response(null, {
          status: normalized.status,
          headers: responseHeaders,
        });
      }

      // Buffer SSR HTML as clean UTF-8 with exact Content-Length (without no-transform),
      // so Cloudflare Edge applies Brotli/Gzip cleanly and proxies never misrender raw binary.
      const contentType = (responseHeaders.get("content-type") ?? "").toLowerCase();
      if (contentType.includes("text/html")) {
        responseHeaders.delete("link");
        responseHeaders.set("Content-Type", "text/html; charset=utf-8");
        responseHeaders.set("Cache-Control", "public, max-age=0, must-revalidate");
        if (request.method.toUpperCase() === "HEAD") {
          responseHeaders.delete("content-encoding");
          appendVaryHeader(responseHeaders, "Accept-Encoding");
          return new Response(null, { status: normalized.status, headers: responseHeaders });
        }
        const htmlText = await normalized.text();
        const htmlBytes = new TextEncoder().encode(htmlText);
        return buildSafeBufferedResponse(htmlBytes, normalized.status, responseHeaders, request);
      }

      responseHeaders.set("Cache-Control", "private, no-cache");
      appendVaryHeader(responseHeaders, "Accept-Encoding");
      return new Response(normalized.body, {
        status: normalized.status,
        headers: responseHeaders,
      });
    } catch (error) {
      console.error(error);
      const errHeaders = new Headers({
        "content-type": "text/html; charset=utf-8",
        "cache-control": "no-store",
      });
      applyBaselineHeaders(errHeaders);
      const errBytes = new TextEncoder().encode(renderErrorPage());
      return buildSafeBufferedResponse(errBytes, 500, errHeaders, request);
    }
  },
};
