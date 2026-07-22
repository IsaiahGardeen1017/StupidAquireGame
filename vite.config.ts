import type { IncomingMessage, ServerResponse } from "node:http";

import { defineConfig, type Plugin } from "vite";

const LIVE_SERVER_URL = "https://acquire.tlstyer.com";
const LOGIN_VERSION_PATTERN = /id=(?:"page-login"|page-login)[^>]*data-version=(?:"([^"]+)"|'([^']+)'|([^\s>]+))/i;

function acquireRuntimeConfigPlugin(): Plugin {
  return {
    name: "acquire-runtime-config",
    configureServer(server) {
      server.middlewares.use("/api/runtime-config", async (req: IncomingMessage, res: ServerResponse, next) => {
        if (req.method !== "GET") {
          next();
          return;
        }

        try {
          const response = await fetch(LIVE_SERVER_URL);
          if (!response.ok) {
            throw new Error(`Failed to fetch live Acquire page: ${response.status} ${response.statusText}`);
          }

          const html = await response.text();
          const versionMatch = html.match(LOGIN_VERSION_PATTERN);
          const version = versionMatch?.[1] ?? versionMatch?.[2] ?? versionMatch?.[3];
          if (version === undefined) {
            throw new Error("Could not find the live Acquire version token in the login page.");
          }

          res.setHeader("Content-Type", "application/json");
          res.end(
            JSON.stringify({
              proxyOrigin: server.resolvedUrls?.local[0] ?? "http://localhost:4173",
              liveServerUrl: LIVE_SERVER_URL,
              version
            })
          );
        } catch (error) {
          res.statusCode = 502;
          res.setHeader("Content-Type", "application/json");
          res.end(
            JSON.stringify({
              error: error instanceof Error ? error.message : "Unknown proxy configuration error."
            })
          );
        }
      });
    }
  };
}

export default defineConfig({
  define: {
    global: "globalThis"
  },
  plugins: [acquireRuntimeConfigPlugin()],
  server: {
    port: 4173,
    proxy: {
      "/sockjs": {
        target: LIVE_SERVER_URL,
        changeOrigin: true,
        secure: true,
        ws: true
      },
      "/server": {
        target: LIVE_SERVER_URL,
        changeOrigin: true,
        secure: true
      }
    }
  }
});
