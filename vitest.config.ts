import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

export default defineConfig({
  resolve: {
    alias: {
      "@map0/schema": fileURLToPath(new URL("./packages/schema/src/index.ts", import.meta.url)),
      "@map0/core": fileURLToPath(new URL("./packages/core/src/index.ts", import.meta.url)),
    },
  },
  test: {
    include: ["packages/**/src/**/*.test.ts"],
    environment: "node",
  },
});
