/* eslint-disable @typescript-eslint/no-explicit-any */
import { defineConfig } from "@lovable.dev/vite-tanstack-config";
import type { Plugin } from "vite";

function terrabarDevApiPlugin(): Plugin {
  return {
    name: "terrabar-dev-api-middleware",
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        if (
          req.url &&
          (req.url.startsWith("/fonts/") ||
            req.url.startsWith("/assets/") ||
            req.url === "/favicon.svg" ||
            req.url === "/favicon.ico" ||
            req.url === "/apple-touch-icon.png")
        ) {
          res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
        }

        if (!req.url || !req.url.startsWith("/api/")) {
          next();
          return;
        }

        try {
          const method = (req.method || "GET").toUpperCase();
          const fullUrl = new URL(req.url, `http://${req.headers.host || "localhost:3000"}`);

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

          const { handleApiRequest } = (await server.ssrLoadModule("./src/lib/api-router.ts")) as {
            handleApiRequest: (r: Request) => Promise<Response | null>;
          };

          const apiResponse = await handleApiRequest(webReq);
          if (!apiResponse) {
            next();
            return;
          }

          res.statusCode = apiResponse.status;
          apiResponse.headers.forEach((value, key) => {
            if (key.toLowerCase() === "set-cookie") return;
            res.setHeader(key, value);
          });

          const setCookies =
            typeof (apiResponse.headers as any).getSetCookie === "function"
              ? (apiResponse.headers as any).getSetCookie()
              : apiResponse.headers.get("set-cookie")
                ? [apiResponse.headers.get("set-cookie")]
                : [];
          if (setCookies.length > 0) {
            res.setHeader("Set-Cookie", setCookies);
          }

          const arrBuf = await apiResponse.arrayBuffer();
          res.end(Buffer.from(arrBuf));
        } catch (err: any) {
          console.error("[dev api middleware error]", err);
          res.statusCode = 500;
          res.setHeader("Content-Type", "application/json; charset=utf-8");
          res.end(JSON.stringify({ success: false, message: err?.message || "خطای سرور در پردازش درخواست" }));
        }
      });
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
        "Access-Control-Allow-Origin": "*",
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
