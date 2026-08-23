import path from "path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { sentryVitePlugin } from "@sentry/vite-plugin";
import { createUiDevWatchOptions } from "./src/lib/vite-watch";
import { createApiProxy } from "./src/lib/vite-api-proxy";

const apiProxy = createApiProxy();

export default defineConfig(({ mode }) => {
  const isProduction = mode === "production";

  return {
    plugins: [
      react(),
      tailwindcss(),
      // Source map upload plugin for Sentry — only in production builds
      // when SENTRY_AUTH_TOKEN and SENTRY_ORG/SENTRY_PROJECT are set.
      ...(isProduction
        ? [
            sentryVitePlugin({
              org: process.env.SENTRY_ORG,
              project: process.env.SENTRY_PROJECT,
              authToken: process.env.SENTRY_AUTH_TOKEN,
              release: process.env.SENTRY_RELEASE,
              sourcemaps: {
                // Delete source maps after upload to avoid exposing them
                assets: ["dist/assets/**"],
              },
              // Disable telemetry reporting from the plugin itself
              telemetry: false,
            }),
          ]
        : []),
    ],
    build: {
      minify: "esbuild",
      // Generate source maps for Sentry (even in production)
      sourcemap: isProduction,
    },
    esbuild:
      mode === "production"
        ? {
            drop: ["console", "debugger"],
            legalComments: "none",
          }
        : undefined,
    resolve: {
      alias: {
        "@": path.resolve(__dirname, "./src"),
        lexical: path.resolve(__dirname, "./node_modules/lexical/dist/Lexical.mjs"),
      },
    },
    server: {
      port: 5173,
      watch: createUiDevWatchOptions(process.cwd()),
      proxy: apiProxy,
    },
    preview: {
      port: 3101,
      host: "0.0.0.0",
      allowedHosts: true,
      proxy: apiProxy,
    },
  };
});
