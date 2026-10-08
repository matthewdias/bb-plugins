import { describe, expect, it } from "vitest";
import { createLimiter } from "../lib/limit";

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("createLimiter", () => {
  it("runs at most `max` tasks at once, the rest in order as slots free", async () => {
    const limit = createLimiter(2);
    const started: number[] = [];
    const finish: (() => void)[] = [];
    const results = [0, 1, 2, 3].map((index) =>
      limit(() => {
        started.push(index);
        return new Promise<number>((resolve) => finish.push(() => resolve(index)));
      }),
    );
    await tick();
    expect(started).toEqual([0, 1]);
    finish[1]();
    await tick();
    expect(started).toEqual([0, 1, 2]);
    finish[0]();
    await tick();
    expect(started).toEqual([0, 1, 2, 3]);
    finish[2]();
    finish[3]();
    expect(await Promise.all(results)).toEqual([0, 1, 2, 3]);
  });

  it("frees a slot when a task fails, however it fails", async () => {
    const limit = createLimiter(1);
    await expect(limit(() => Promise.reject(new Error("no")))).rejects.toThrow("no");
    await expect(
      limit(() => {
        throw new Error("sync");
      }),
    ).rejects.toThrow("sync");
    expect(await limit(async () => "next")).toBe("next");
  });
});
