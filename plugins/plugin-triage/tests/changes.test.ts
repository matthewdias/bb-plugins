import { describe, expect, it, vi } from "vitest";
import { changesKey, fetchChanges, githubRepo, refOf } from "../lib/changes";

const A = "a".repeat(40);
const B = "b".repeat(40);
const label = (sha: string, ref = "HEAD") => ({ version: sha, display: `https://github.com/acme/plugins.git@${ref} (${sha.slice(0, 12)})` });

const commit = (sha: string, subject: string) => ({ sha, commit: { message: `${subject}\n\nbody`, author: { name: "Ada", date: "2026-10-01T00:00:00Z" } }, author: { login: "ada" } });

/** A GitHub that answers by path, and records what was asked. */
function github(
  routes: Record<string, unknown>,
  status: Record<string, { status: number; headers?: Record<string, string> }> = {},
  okHeaders: Record<string, string> = {},
) {
  const asked: string[] = [];
  const auth: (string | null)[] = [];
  const fetch = vi.fn(async (url: string, init?: { headers?: Record<string, string> }) => {
    const path = url.replace("https://api.github.com", "");
    asked.push(path);
    const authorization = init?.headers?.Authorization ?? null;
    auth.push(authorization);
    if (authorization === "Bearer revoked") return { ok: false, status: 401, headers: { get: () => null }, json: async () => ({}) };
    const failure = Object.entries(status).find(([prefix]) => path.startsWith(prefix))?.[1];
    if (failure) return { ok: false, status: failure.status, headers: { get: (n: string) => failure.headers?.[n] ?? null }, json: async () => ({}) };
    const body = Object.entries(routes).find(([prefix]) => path.startsWith(prefix))?.[1];
    if (body === undefined) return { ok: false, status: 404, headers: { get: () => null }, json: async () => ({}) };
    return { ok: true, status: 200, headers: { get: (n: string) => okHeaders[n] ?? null }, json: async () => body };
  });
  return { fetch, asked, auth };
}

const compare = {
  total_commits: 4,
  html_url: "https://github.com/acme/plugins/compare/a...b",
  commits: [commit("c1", "Change Notes"), commit("c2", "Fix Diff Comment's header"), commit("c3", "Change Now"), commit("c4", "Polish Diff Comment")],
};

describe("what an update changes", () => {
  it("lists only the commits that touch the plugin's folder, newest first", async () => {
    const { fetch, asked } = github({
      "/repos/acme/plugins/compare/": compare,
      "/repos/acme/plugins/commits": [commit("c4", "Polish Diff Comment"), commit("c2", "Fix Diff Comment's header"), commit("old", "Add Diff Comment")],
    });
    const changes = await fetchChanges(fetch, label(A), label(B), "bb-plugin-diff-comment");
    expect(changes).toMatchObject({ kind: "github", total: 2, repoWide: 4, subdirectory: "bb-plugin-diff-comment" });
    expect(changes.kind === "github" && changes.commits.map((c) => c.subject)).toEqual(["Polish Diff Comment", "Fix Diff Comment's header"]);
    expect(asked[1]).toBe(`/repos/acme/plugins/commits?sha=${B}&path=bb-plugin-diff-comment&per_page=100`);
  });

  it("says so when none of the range touches the plugin", async () => {
    const { fetch } = github({ "/repos/acme/plugins/compare/": compare, "/repos/acme/plugins/commits": [commit("old", "Add Diff Comment")] });
    expect(await fetchChanges(fetch, label(A), label(B), "bb-plugin-diff-comment")).toMatchObject({ kind: "github", total: 0, repoWide: 4, commits: [] });
  });

  it("lists the whole range for a plugin that is its whole repository", async () => {
    const { fetch, asked } = github({ "/repos/acme/plugins/compare/": compare });
    const changes = await fetchChanges(fetch, label(A), label(B), null);
    expect(changes).toMatchObject({ kind: "github", total: 4, subdirectory: null });
    expect(asked).toHaveLength(1);
  });

  it("keeps every commit, for the open card to list", async () => {
    const many = { ...compare, total_commits: 9, commits: Array.from({ length: 9 }, (_, i) => commit(`c${i}`, `Change ${i}`)) };
    const changes = await fetchChanges(github({ "/repos/acme/plugins/compare/": many }).fetch, label(A), label(B), null);
    expect(changes.kind === "github" && [changes.commits.length, changes.total, changes.commits[0]!.subject]).toEqual([9, 9, "Change 8"]);
  });

  it("brings the release notes when the new version is a release", async () => {
    const { fetch } = github({
      "/repos/acme/plugins/compare/": compare,
      "/repos/acme/plugins/releases/tags/notes%2Fv1.2.0": { name: "Notes 1.2.0", body: "## What's new\n- Things", html_url: "https://github.com/acme/plugins/releases/tag/notes/v1.2.0" },
    });
    const changes = await fetchChanges(fetch, label(A, "notes/v1.1.0"), label(B, "notes/v1.2.0"), null);
    expect(changes.kind === "github" && changes.releaseNotes).toEqual({
      name: "Notes 1.2.0",
      body: "## What's new\n- Things",
      url: "https://github.com/acme/plugins/releases/tag/notes/v1.2.0",
    });
  });

  it("does not look for release notes on a branch", async () => {
    const { fetch, asked } = github({ "/repos/acme/plugins/compare/": compare });
    await fetchChanges(fetch, label(A, "main"), label(B, "main"), null);
    expect(asked.some((p) => p.includes("/releases/"))).toBe(false);
  });

  it("explains a used-up rate limit, with when to try again", async () => {
    const { fetch } = github({}, { "/repos/acme/plugins/compare/": { status: 403, headers: { "x-ratelimit-remaining": "0", "x-ratelimit-reset": "1791300000" } } });
    const changes = await fetchChanges(fetch, label(A), label(B), null);
    expect(changes.kind).toBe("unavailable");
    expect(changes.kind === "unavailable" && changes.reason).toMatch(/hourly limit .* try again after/);
  });

  it("can't describe what isn't a GitHub commit range, and doesn't ask", async () => {
    const { fetch } = github({});
    expect(await fetchChanges(fetch, { version: "1.0.0", display: "@acme/x@1.0.0" }, { version: "1.1.0", display: "@acme/x@1.1.0" }, null)).toEqual({ kind: "none" });
    expect(await fetchChanges(fetch, { version: A, display: `https://gitlab.com/a/b.git@HEAD (x)` }, { version: B, display: `https://gitlab.com/a/b.git@HEAD (y)` }, null)).toEqual({ kind: "none" });
    expect(fetch).not.toHaveBeenCalled();
  });
});

describe("labels", () => {
  it("reads the repository and ref out of bb's version labels", () => {
    expect(githubRepo(label(A))).toEqual({ owner: "acme", repo: "plugins" });
    expect(refOf(label(A, "notes/v1.2.0"))).toBe("notes/v1.2.0");
    expect(changesKey(label(A), label(B), "sub")).toBe(`changes:v2:acme/plugins:sub:${A}...${B}`);
    expect(changesKey({ version: "1.0.0", display: "x@1.0.0" }, label(B), null)).toBeNull();
  });
});

describe("asking GitHub with a login", () => {
  it("sends the login with every request", async () => {
    const { fetch, auth } = github({ "/repos/acme/plugins/compare/": compare, "/repos/acme/plugins/commits": [] });
    await fetchChanges(fetch, label(A), label(B), "sub", { token: "gho_x" });
    expect(auth).toEqual(["Bearer gho_x", "Bearer gho_x"]);
  });

  it("drops a refused login and asks again without it", async () => {
    const { fetch, auth } = github({ "/repos/acme/plugins/compare/": compare });
    const onUnauthorized = vi.fn();
    const changes = await fetchChanges(fetch, label(A), label(B), null, { token: "revoked", onUnauthorized });
    expect(changes.kind).toBe("github");
    expect(auth).toEqual(["Bearer revoked", null]);
    expect(onUnauthorized).toHaveBeenCalledTimes(1);
  });

  it("reports what is left of the hourly limit", async () => {
    const { fetch } = github({ "/repos/acme/plugins/compare/": compare }, {}, {
      "x-ratelimit-remaining": "4987",
      "x-ratelimit-limit": "5000",
      "x-ratelimit-reset": "1791300000",
    });
    const onBudget = vi.fn();
    await fetchChanges(fetch, label(A), label(B), null, { token: "gho_x", onBudget });
    expect(onBudget).toHaveBeenCalledWith({ remaining: 4987, limit: 5000, resetAt: 1791300000_000 });
  });
});
