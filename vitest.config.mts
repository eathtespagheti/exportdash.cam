import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    // The `@/*` alias is defined in tsconfig.json. It is mapped explicitly
    // here rather than through Vite's `resolve.tsconfigPaths` option, which
    // is Vite 8 only and derives the mapping from the tsconfig's include /
    // exclude list - so a file excluded from the root tsconfig (as the test
    // files are) would silently lose the alias.
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  test: {
    environment: "happy-dom",
    setupFiles: ["./vitest.setup.ts"],
    include: ["src/**/*.{test,spec}.{ts,tsx}"],
    coverage: {
      provider: "v8",
      reporter: ["text", "lcov"],
      include: ["src/**/*.{ts,tsx}"],
      exclude: [
        "src/**/*.test.{ts,tsx}",
        "src/**/*.spec.{ts,tsx}",
        "src/**/__tests__/**",
      ],
    },
  },
});
