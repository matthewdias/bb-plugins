import { afterEach, describe, expect, it } from "vitest";
import { createRegistry, normalizeValue, type ComplicationProviderHandle } from "../lib/complications";
import { gitRegistration, pullRequestRegistration } from "../lib/registrations";
import { GIT_ID, PULL_REQUEST_ID } from "../lib/order";

const handles: ComplicationProviderHandle[] = [];
afterEach(() => {
  for (const handle of handles.splice(0)) handle.dispose();
});

describe("registrations", () => {
  it("are accepted by the registry, with samples it keeps", () => {
    const registry = createRegistry();
    handles.push(registry.provide(gitRegistration(() => undefined)));
    handles.push(registry.provide(pullRequestRegistration(() => undefined)));
    expect(registry.providers().map((provider) => [provider.id, provider.subjects, provider.sample !== undefined])).toEqual([
      [GIT_ID, ["thread"], true],
      [PULL_REQUEST_ID, ["thread"], true],
    ]);
    expect(normalizeValue(gitRegistration(() => undefined).sample)).toBeTruthy();
  });

  it("pass on only the thread subjects that become wanted", async () => {
    const registry = createRegistry();
    const asked: string[][] = [];
    handles.push(registry.provide(gitRegistration((ids) => asked.push(ids))));
    registry.want(GIT_ID, { kind: "thread", id: "thr_1" });
    registry.want(GIT_ID, { kind: "project", id: "proj_1" });
    await Promise.resolve();
    expect(asked).toEqual([["thr_1"]]);
  });
});
