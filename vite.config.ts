/* eslint-disable @typescript-eslint/no-explicit-any */
import zlib from "node:zlib";
import { defineConfig } from "@lovable.dev/vite-tanstack-config";
import type { Connect, Plugin } from "vite";

const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, PATCH, DELETE, HEAD, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, Range, X-Requested-With, Accept",
  "Access-Control-Expose-Headers": "Content-Length, Content-Type, Content-Disposition",
  "Access-Control-Max-Age": "86400",
};

function applyFontHeaders(res: any, cleanPath: string): void {
  res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Cross-Origin-Resource-Policy", "cross-origin");
  res.setHeader("Timing-Allow-Origin", "*");

  const lower = cleanPath.toLowerCase();
  if (lower.endsWith(".woff2")) res.setHeader("Content-Type", "font/woff2");
  else if (lower.endsWith(".woff")) res.setHeader("Content-Type", "font/woff");
  else if (lower.endsWith(".ttf")) res.setHeader("Content-Type", "font/ttf");
  else if (lower.endsWith(".otf")) res.setHeader("Content-Type", "font/otf");
  else if (lower.endsWith(".eot")) res.setHeader("Content-Type", "application/vnd.ms-fontobject");
}

function applyCorsHeaders(res: any): void {
  for (const [k, v] of Object.entries(CORS_HEADERS)) {
    res.setHeader(k, v);
  }
  res.setHeader("Vary", "Origin, Accept-Encoding");
}

function sendCompressedBuffer(
  req: Connect.IncomingMessage,
  res: any,
  rawBuf: Buffer,
  contentType: string,
): void {
  const ct = (contentType || "").toLowerCase();
  const isCompressible =
    ct.startsWith("text/") ||
    ct.includes("application/json") ||
    ct.includes("application/javascript") ||
    ct.includes("application/xml") ||
    ct.includes("image/svg+xml");

  const acceptEncoding = String(req.headers["accept-encoding"] || "").toLowerCase();
  let outBuf = rawBuf;

  if (isCompressible && rawBuf.byteLength >= 512) {
    if (/\bbr\b/.test(acceptEncoding)) {
      try {
        const br = zlib.brotliCompressSync(rawBuf, {
          params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 4 },
        });
        if (br.byteLength < rawBuf.byteLength) {
          outBuf = br;
          res.setHeader("Content-Encoding", "br");
        }
      } catch {
        // Fallback to gzip/raw
      }
    } else if (/\bgzip\b/.test(acceptEncoding)) {
      try {
        const gz = zlib.gzipSync(rawBuf, { level: 6 });
        if (gz.byteLength < rawBuf.byteLength) {
          outBuf = gz;
          res.setHeader("Content-Encoding", "gzip");
        }
      } catch {
        // Fallback to raw
      }
    }
  }

  res.setHeader("Content-Length", String(outBuf.byteLength));
  if ((req.method || "GET").toUpperCase() === "HEAD") {
    res.end();
  } else {
    res.end(outBuf);
  }
}

function attachSharedMiddlewares(middlewares: Connect.Server, ssrModuleLoader?: (id: string) => Promise<any>): void {
  middlewares.use(async (req, res, next) => {
    const rawUrl = req.url || "";
    const cleanPath = rawUrl.split("?")[0];

    if (cleanPath.startsWith("/fonts/") || /\.(woff2?|ttf|otf|eot)$/i.test(cleanPath)) {
      applyFontHeaders(res, cleanPath);
    } else if (
      cleanPath.startsWith("/assets/") ||
      cleanPath === "/favicon.svg" ||
      cleanPath === "/favicon.ico" ||
      cleanPath === "/apple-touch-icon.png"
    ) {
      res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
      res.setHeader("Access-Control-Allow-Origin", "*");
    }

    if (!cleanPath.startsWith("/api/")) {
      next();
      return;
    }

    applyCorsHeaders(res);

    const method = (req.method || "GET").toUpperCase();
    if (method === "OPTIONS") {
      res.statusCode = 204;
      res.end();
      return;
    }

    if (!ssrModuleLoader) {
      next();
      return;
    }

    try {
      const fullUrl = new URL(rawUrl, `http://${req.headers.host || "localhost:3000"}`);

      const headers = new Headers();
      for (const [k, v] of Object.entries(req.headers)) {
        if (typeof v === "string") headers.set(k, v);
        else if (Array.isArray(v)) headers.set(k, v.join(", "));
      }

      let body: Uint8Array | undefined;
      if (method !== "GET" && method !== "HEAD") {
        const chunks: Buffer[] = [];
        await new Promise<void>((resolve, reject) => {
          req.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
          req.on("end", () => resolve());
          req.on("error", reject);
        });
        if (chunks.length > 0) {
          body = new Uint8Array(Buffer.concat(chunks));
        }
      }

      const webReq = new Request(fullUrl.toString(), {
        method,
        headers,
        body,
      });

      const { handleApiRequest } = (await ssrModuleLoader("./src/lib/api-router.ts")) as {
        handleApiRequest: (r: Request) => Promise<Response | null>;
      };

      const apiResponse = await handleApiRequest(webReq);
      if (!apiResponse) {
        next();
        return;
      }

      res.statusCode = apiResponse.status;
      apiResponse.headers.forEach((value, key) => {
        const lower = key.toLowerCase();
        if (lower === "set-cookie" || lower === "content-length" || lower === "content-encoding") return;
        res.setHeader(key, value);
      });
      applyCorsHeaders(res);

      const setCookies =
        typeof (apiResponse.headers as any).getSetCookie === "function"
          ? (apiResponse.headers as any).getSetCookie()
          : apiResponse.headers.get("set-cookie")
            ? [apiResponse.headers.get("set-cookie")]
            : [];
      if (setCookies.length > 0) {
        res.setHeader("Set-Cookie", setCookies);
      }

      if (apiResponse.status === 204 || apiResponse.status === 205 || apiResponse.status === 304) {
        res.end();
        return;
      }

      const arrBuf = await apiResponse.arrayBuffer();
      const ct = apiResponse.headers.get("content-type") || "application/json; charset=utf-8";
      sendCompressedBuffer(req, res, Buffer.from(arrBuf), ct);
    } catch (err: any) {
      console.error("[dev api middleware error]", err);
      res.statusCode = 500;
      applyCorsHeaders(res);
      res.setHeader("Content-Type", "application/json; charset=utf-8");
      const errBuf = Buffer.from(
        JSON.stringify({ success: false, message: err?.message || "خطای سرور در پردازش درخواست" }),
        "utf8",
      );
      sendCompressedBuffer(req, res, errBuf, "application/json; charset=utf-8");
    }
  });
}

function terrabarDevApiPlugin(): Plugin {
  return {
    name: "terrabar-dev-api-middleware",
    configureServer(server) {
      attachSharedMiddlewares(server.middlewares, (id) => server.ssrLoadModule(id));
    },
    configurePreviewServer(server) {
      attachSharedMiddlewares(server.middlewares);
    },
  };
}

export default defineConfig({
  vite: {
    plugins: [terrabarDevApiPlugin()],
    server: {
      host: "0.0.0.0",
      port: 3000,
      allowedHosts: true,
      cors: true,
      hmr: false,
      watch: null,
      headers: {
        ...CORS_HEADERS,
        "X-Content-Type-Options": "nosniff",
      },
    },
    preview: {
      host: "0.0.0.0",
      port: 3000,
      allowedHosts: true,
      cors: true,
      headers: {
        ...CORS_HEADERS,
        "X-Content-Type-Options": "nosniff",
      },
    },
    build: {
      target: ["es2015", "edge18", "firefox60", "chrome60", "safari11"],
      cssTarget: ["chrome60", "firefox60", "safari11", "edge18"],
      chunkSizeWarningLimit: 700,
    },
    environments: {
      client: {
        build: {
          rollupOptions: {
            output: {
              manualChunks(id) {
                if (id.includes("node_modules/lucide-react")) {
                  return "lucide-icons";
                }
                if (
                  id.includes("node_modules/react/") ||
                  id.includes("node_modules/react-dom/") ||
                  id.includes("node_modules/scheduler/")
                ) {
                  return "react-vendor";
                }
                if (id.includes("node_modules/@tanstack/")) {
                  return "tanstack-vendor";
                }
                if (id.includes("node_modules/@radix-ui/")) {
                  return "ui-vendor";
                }
                if (id.includes("node_modules/recharts/") || id.includes("node_modules/d3-")) {
                  return "charts-vendor";
                }
              },
            },
          },
        },
      },
    },
    esbuild: {
      target: "es2015",
    },
  },
  tanstackStart: {
    tsr: { autoCodeSplitting: true },
    server: { entry: "server" },
  },
});
