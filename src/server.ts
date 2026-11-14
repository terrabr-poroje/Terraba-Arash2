/* eslint-disable @typescript-eslint/no-explicit-any */
import "./lib/error-capture";

import { consumeLastCapturedError } from "./lib/error-capture";
import { renderErrorPage } from "./lib/error-page";
import { handleApiRequest } from "./lib/api-router";
import { toPersianErrorMessage } from "./lib/error-messages";

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
  headers.set("Access-Control-Allow-Origin", "*");
  headers.set("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, HEAD, OPTIONS");
  headers.set("Access-Control-Allow-Headers", "Content-Type, Range, Authorization");
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

export default {
  async fetch(request: Request, env: unknown, ctx: unknown) {
    try {
      if (request.method.toUpperCase() === "OPTIONS") {
        const preflightHeaders = new Headers();
        applyBaselineHeaders(preflightHeaders);
        preflightHeaders.set("Access-Control-Max-Age", "86400");
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
              } else if (
                url.pathname.startsWith("/assets/") ||
                url.pathname.startsWith("/fonts/") ||
                url.pathname.startsWith("/_build/") ||
                /\.(woff2?|ttf|otf|eot)$/i.test(url.pathname)
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
              } else if (url.pathname.endsWith(".woff2")) {
                headers.set("Content-Type", "font/woff2");
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

        return new Response("فایل مورد نظر یافت نشد", {
          status: 404,
          headers: {
            "content-type":
              url.pathname.endsWith(".js") || url.pathname.endsWith(".mjs")
                ? "application/javascript; charset=utf-8"
                : url.pathname.endsWith(".css")
                  ? "text/css; charset=utf-8"
                  : "text/plain; charset=utf-8",
            "Access-Control-Allow-Origin": "*",
            "X-Content-Type-Options": "nosniff",
          },
        });
      }

      // Unified API router
      if (url.pathname.startsWith("/api/")) {
        try {
          const resolvedEnv =
            env ??
            (request as any)?.runtime?.cloudflare?.env ??
            (globalThis as any)?.__env__;
          const apiResponse = await handleApiRequest(request, resolvedEnv);
          if (apiResponse) return apiResponse;
        } catch (apiError: any) {
          console.error("[server API error]", apiError);
          return new Response(
            JSON.stringify({
              success: false,
              message: toPersianErrorMessage(apiError, "خطای داخلی سرور در پردازش درخواست."),
            }),
            {
              status: 500,
              headers: {
                "content-type": "application/json; charset=utf-8",
                "cache-control": "no-store, no-cache, must-revalidate",
              },
            },
          );
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

      // Buffer SSR HTML completely with exact byte Content-Length and strip Link preload bloat
      // so chunked streaming & HTTP/2 header bursts do not stall over Hamrah-e-Aval (MCI) mobile DPI.
      const contentType = (responseHeaders.get("content-type") ?? "").toLowerCase();
      if (contentType.includes("text/html") && request.method.toUpperCase() !== "HEAD") {
        const htmlText = await normalized.text();
        const htmlBytes = new TextEncoder().encode(htmlText);
        responseHeaders.delete("link");
        responseHeaders.delete("transfer-encoding");
        responseHeaders.set("Content-Type", "text/html; charset=utf-8");
        responseHeaders.set("Content-Length", String(htmlBytes.byteLength));
        responseHeaders.set("Cache-Control", "public, max-age=0, must-revalidate");
        responseHeaders.set("Vary", "Accept-Encoding");

        return new Response(htmlBytes, {
          status: normalized.status,
          headers: responseHeaders,
        });
      }

      responseHeaders.set("Cache-Control", "private, no-cache, no-transform");
      return new Response(normalized.body, {
        status: normalized.status,
        headers: responseHeaders,
      });
    } catch (error) {
      console.error(error);
      const errBytes = new TextEncoder().encode(renderErrorPage());
      return new Response(errBytes, {
        status: 500,
        headers: {
          "content-type": "text/html; charset=utf-8",
          "content-length": String(errBytes.byteLength),
          "cache-control": "no-store",
        },
      });
    }
  },
};
