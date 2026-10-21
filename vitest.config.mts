import { defineConfig } from "vitest/config";

export default defineConfig({
  // The `@/*` alias is defined in tsconfig.json. Vite resolves tsconfig paths
  // natively, so the `vite-tsconfig-paths` plugin is not needed.
  resolve: {
    tsconfigPaths: true,
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
