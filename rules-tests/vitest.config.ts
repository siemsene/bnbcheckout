import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["rules.test.ts"],
    // Rules tests hit the emulator; serial execution keeps seeding simple.
    fileParallelism: false,
    testTimeout: 15000,
    hookTimeout: 30000,
  },
});
