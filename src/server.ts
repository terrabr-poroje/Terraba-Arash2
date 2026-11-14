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
      const url = new URL(request.url);

      // Serve static assets via Cloudflare Workers ASSETS binding if available
      const isStaticAsset =
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
              headers.set("Access-Control-Allow-Origin", "*");

              if (
                url.pathname.startsWith("/assets/") ||
                url.pathname.startsWith("/fonts/") ||
                url.pathname.startsWith("/_build/") ||
                /\.(woff2?|ttf|otf|eot)$/i.test(url.pathname)
              ) {
                headers.set("Cache-Control", "public, max-age=31536000, immutable");
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

              // 304/204 responses MUST have a null body in Fetch/Cloudflare Workers; passing assetResponse.body throws and caused 404 on Safari reloads
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

        return new Response("Asset not found", {
          status: 404,
          headers: {
            "content-type":
              url.pathname.endsWith(".js") || url.pathname.endsWith(".mjs")
                ? "application/javascript; charset=utf-8"
                : url.pathname.endsWith(".css")
                  ? "text/css; charset=utf-8"
                  : "text/plain",
            "Access-Control-Allow-Origin": "*",
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
      responseHeaders.delete("x-frame-options");
      responseHeaders.set("Access-Control-Allow-Origin", "*");
      responseHeaders.set("X-Content-Type-Options", "nosniff");
      responseHeaders.set("Cache-Control", "private, no-cache, no-transform");

      if (normalized.status === 304 || normalized.status === 204 || normalized.status === 205) {
        return new Response(null, {
          status: normalized.status,
          headers: responseHeaders,
        });
      }

      return new Response(normalized.body, {
        status: normalized.status,
        headers: responseHeaders,
      });
    } catch (error) {
      console.error(error);
      return new Response(renderErrorPage(), {
        status: 500,
        headers: { "content-type": "text/html; charset=utf-8" },
      });
    }
  },
};
