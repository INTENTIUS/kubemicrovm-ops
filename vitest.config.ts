import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/**/*.test.ts", "test/**/*.test.ts"],
    // Several tests shell out to a real `chant build`, deliberately: what they
    // check is the whole pipeline — parameter resolution, the policies wired
    // in chant.config.ts, the serialized output — and a test that stubbed any
    // of that would pass while the thing it stands for was broken. A build
    // takes a few seconds, and more than one of them takes more than vitest's
    // 5s default on a loaded CI runner, which is what failed first.
    testTimeout: 120_000,
    hookTimeout: 300_000,
  },
});
