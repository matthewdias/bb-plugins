import { describe, expect, it, vi } from "vitest";
import { LOGIN_TTL_MS, gitHubLogin } from "../lib/github-auth";

const missing = () => Object.assign(new Error("not found"), { code: "ENOENT" });

function login(options: { enabled?: boolean; env?: Record<string, string>; gh?: (command: string) => string | Error } = {}) {
  let clock = 1_000;
  const runGh = vi.fn(async (command: string, _args: string[]) => {
    const answer = options.gh?.(command) ?? "gho_fromgh\n";
    if (answer instanceof Error) throw answer;
    return answer;
  });
  const it = gitHubLogin({ enabled: () => options.enabled ?? true, env: options.env ?? {}, runGh, now: () => clock });
  return { login: it, runGh, tick: (ms: number) => (clock += ms) };
}

describe("the GitHub login", () => {
  it("asks gh for the token the way bb does", async () => {
    const { login: l, runGh } = login();
    expect(await l.token()).toBe("gho_fromgh");
    expect(runGh).toHaveBeenCalledWith("gh", ["auth", "token", "--hostname", "github.com"]);
  });

  it("prefers GH_TOKEN, then GITHUB_TOKEN, from the environment, without running gh", async () => {
    const a = login({ env: { GH_TOKEN: "env_gh", GITHUB_TOKEN: "env_github" } });
    expect(await a.login.token()).toBe("env_gh");
    expect(a.runGh).not.toHaveBeenCalled();
    expect(await login({ env: { GITHUB_TOKEN: "env_github" } }).login.token()).toBe("env_github");
  });

  it("finds gh where a bare PATH would miss it", async () => {
    const { login: l, runGh } = login({ gh: (command) => (command === "gh" ? missing() : "gho_brew") });
    expect(await l.token()).toBe("gho_brew");
    expect(runGh.mock.calls[1]![0]).toBe("/opt/homebrew/bin/gh");
  });

  it("goes without a login when gh is there but logged out, rather than trying elsewhere", async () => {
    const { login: l, runGh } = login({ gh: () => new Error("not logged in") });
    expect(await l.token()).toBeNull();
    expect(runGh).toHaveBeenCalledTimes(1);
  });

  it("goes without when gh is nowhere", async () => {
    expect(await login({ gh: () => missing() }).login.token()).toBeNull();
  });

  it("uses no login when the setting is off, and doesn't look", async () => {
    const { login: l, runGh } = login({ enabled: false, env: { GH_TOKEN: "env_gh" } });
    expect(await l.token()).toBeNull();
    expect(runGh).not.toHaveBeenCalled();
  });

  it("keeps the token for a while, then looks again", async () => {
    const { login: l, runGh, tick } = login();
    await l.token();
    await l.token();
    expect(runGh).toHaveBeenCalledTimes(1);
    tick(LOGIN_TTL_MS + 1);
    await l.token();
    expect(runGh).toHaveBeenCalledTimes(2);
  });

  it("drops a token GitHub refused until it looks again", async () => {
    const { login: l, tick } = login();
    expect(await l.token()).toBe("gho_fromgh");
    l.reject();
    expect(await l.token()).toBeNull();
    tick(LOGIN_TTL_MS + 1);
    expect(await l.token()).toBe("gho_fromgh");
  });

  it("refuses a token with whitespace or worse in it", async () => {
    expect(await login({ gh: () => "two words" }).login.token()).toBeNull();
  });
});
