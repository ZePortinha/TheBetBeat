import { describe, expect, it, vi } from "vitest";
import { createMicroCache } from "./micro";

describe("createMicroCache", () => {
  it("shares one load per key within the TTL, then reloads", async () => {
    const cached = createMicroCache<number>(1000);
    const load = vi.fn(async () => 7);
    await Promise.all([cached("s1", load, 0), cached("s1", load, 10), cached("s1", load, 999)]);
    expect(load).toHaveBeenCalledTimes(1);
    await cached("s1", load, 1000);
    expect(load).toHaveBeenCalledTimes(2);
    await cached("s2", load, 1000);
    expect(load).toHaveBeenCalledTimes(3);
  });

  it("does not keep failures", async () => {
    const cached = createMicroCache<number>(1000);
    await expect(cached("k", async () => Promise.reject(new Error("db")), 0)).rejects.toThrow("db");
    await expect(cached("k", async () => 1, 1)).resolves.toBe(1);
  });
});
