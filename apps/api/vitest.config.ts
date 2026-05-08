import { defineConfig } from "vitest/config";

/** Let unit tests import modules that eagerly parse `src/config/env.ts` without real secrets. */
process.env.DATABASE_URL ??= "postgresql://vitest:vitest@127.0.0.1:5432/cpu_vitest";
process.env.JWT_SECRET ??= "012345678901234567890123";

export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
  },
});
