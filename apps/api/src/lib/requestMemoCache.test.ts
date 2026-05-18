import { describe, expect, it, vi } from "vitest";
import { memoizedReadWithMeta } from "./requestMemoCache.js";

describe("memoizedReadWithMeta", () => {
  it("dedupes in-flight loads and serves cache hits", async () => {
    const loader = vi.fn(async () => ({ n: 1 }));
    const a = await memoizedReadWithMeta("test:key", 60_000, loader);
    expect(a.cacheHit).toBe(false);
    expect(a.inflightJoined).toBe(false);
    expect(loader).toHaveBeenCalledTimes(1);

    const b = await memoizedReadWithMeta("test:key", 60_000, loader);
    expect(b.cacheHit).toBe(true);
    expect(b.value).toEqual({ n: 1 });
    expect(loader).toHaveBeenCalledTimes(1);
  });
});
