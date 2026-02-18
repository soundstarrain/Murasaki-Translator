import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/renderer/src/**/*.test.ts", "src/main/**/*.test.ts"],
    setupFiles: ["src/renderer/src/setupTests.ts"],
  },
});
