import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
    // `packaged-artifacts.test.ts` shells out to `npm pack` (and potentially
    // `pnpm build` when dist artifacts are stale), which can take 30-60s on
    // a cold checkout. vitest's default 5000ms testTimeout has never been
    // appropriate here; the inline 30_000ms budget was removed so this
    // config-level value is the sole source of truth.
    testTimeout: 60000,
  },
});
