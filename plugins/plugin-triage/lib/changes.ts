// What an update changes, from GitHub: the commits between the installed
// version and the one on offer, narrowed to the plugin's own folder when it
// shares a repository with others, and the release notes when the new version
// is a release. `fetch` is passed in, so the tests drive it.
//
// A plugin in a shared repository is the case that matters: an update there
// can span dozens of commits, none of which touch this plugin.
import type { VersionLabel } from "./queue.ts";

export interface Commit {
  sha: string;
  subject: string;
  date: string | null;
  author: string | null;
}

export type Changes =
  | {
      kind: "github";
      /** Commits that touch the plugin, newest first, at most COMMITS_SHOWN. */
      commits: Commit[];
      /** How many commits touch the plugin in all. */
      total: number;
      /** How many commits the repository has between the two versions. */
      repoWide: number;
      /** The plugin's folder in its repository, or null for a whole repository. */
      subdirectory: string | null;
      releaseNotes: { name: string; body: string; url: string } | null;
      /** GitHub's compare page for the range. */
      url: string;
    }
  /** Not a range GitHub can describe (npm, another host, a version not a commit). */
  | { kind: "none" }
  /** GitHub could have said, but didn't this time. Not cached. */
  | { kind: "unavailable"; reason: string };

export const COMMITS_SHOWN = 6;

const SHA = /^[0-9a-f]{40}$/i;
const GITHUB = /^https?:\/\/(?:www\.)?github\.com\/([^/\s@]+)\/([^/\s@]+?)(?:\.git)?@/i;
/** A ref that names a release: v1.2.3, 1.2.3, or a prefix like notes/v1.2.3. */
const RELEASE_REF = /(?:^|\/)v?\d+\.\d+(?:\.\d+)?(?:[-+][\w.-]+)?$/;

export interface Repo {
  owner: string;
  repo: string;
}

export function githubRepo(label: VersionLabel): Repo | null {
  const match = GITHUB.exec(label.display);
  return match === null ? null : { owner: match[1]!, repo: match[2]! };
}

/** The ref a version label names ("notes/v1.2.0" from "…@notes/v1.2.0 (0123…)"). */
export function refOf(label: VersionLabel): string | null {
  const at = label.display.lastIndexOf("@");
  if (at < 0) return null;
  const ref = label.display.slice(at + 1).replace(/\s*\([0-9a-f]+\)\s*$/i, "").trim();
  return ref === "" ? null : ref;
}

/** Whether GitHub can describe this range at all; the cache key if so. */
export function changesKey(from: VersionLabel, to: VersionLabel, subdirectory: string | null): string | null {
  const repo = githubRepo(to);
  if (repo === null || !SHA.test(from.version) || !SHA.test(to.version)) return null;
  return `changes:${repo.owner}/${repo.repo}:${subdirectory ?? ""}:${from.version}...${to.version}`;
}

type Fetch = (url: string, init?: { headers?: Record<string, string>; signal?: AbortSignal }) => Promise<{
  ok: boolean;
  status: number;
  headers: { get(name: string): string | null };
  json(): Promise<unknown>;
}>;

class GitHubError extends Error {}

async function get<T>(fetch: Fetch, path: string): Promise<T | null> {
  const response = await fetch(`https://api.github.com${path}`, {
    headers: { Accept: "application/vnd.github+json", "User-Agent": "bb-plugin-triage" },
    signal: AbortSignal.timeout(10_000),
  });
  if (response.status === 404) return null;
  if (!response.ok) {
    const reset = Number(response.headers.get("x-ratelimit-reset"));
    if ((response.status === 403 || response.status === 429) && response.headers.get("x-ratelimit-remaining") === "0") {
      const at = Number.isFinite(reset) && reset > 0 ? new Date(reset * 1000).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }) : null;
      throw new GitHubError(`GitHub's hourly limit for this machine is used up${at === null ? "" : `; try again after ${at}`}.`);
    }
    throw new GitHubError(`GitHub answered ${response.status}.`);
  }
  return (await response.json()) as T;
}

interface ApiCommit {
  sha: string;
  commit: { message: string; author?: { name?: string; date?: string } | null };
  author?: { login?: string } | null;
}

function toCommit(c: ApiCommit): Commit {
  return {
    sha: c.sha,
    subject: c.commit.message.split("\n")[0] ?? "",
    date: c.commit.author?.date ?? null,
    author: c.author?.login ?? c.commit.author?.name ?? null,
  };
}

export async function fetchChanges(
  fetch: Fetch,
  from: VersionLabel,
  to: VersionLabel,
  subdirectory: string | null,
): Promise<Changes> {
  const repo = githubRepo(to);
  if (repo === null || changesKey(from, to, subdirectory) === null) return { kind: "none" };
  const base = `/repos/${encodeURIComponent(repo.owner)}/${encodeURIComponent(repo.repo)}`;
  try {
    const compare = await get<{ total_commits: number; commits: ApiCommit[]; html_url: string }>(
      fetch,
      `${base}/compare/${from.version}...${to.version}`,
    );
    if (compare === null) return { kind: "unavailable", reason: "GitHub doesn't know one of these versions." };

    // Compare lists the range but not what each commit touched; the commits
    // endpoint filters by path but walks the whole history. Together: the
    // range's commits that touch this plugin.
    let relevant = compare.commits;
    if (subdirectory !== null) {
      const touching = await get<ApiCommit[]>(
        fetch,
        `${base}/commits?sha=${to.version}&path=${encodeURIComponent(subdirectory)}&per_page=100`,
      );
      const shas = new Set((touching ?? []).map((c) => c.sha));
      relevant = compare.commits.filter((c) => shas.has(c.sha));
    }

    const ref = refOf(to);
    let releaseNotes: { name: string; body: string; url: string } | null = null;
    if (ref !== null && RELEASE_REF.test(ref)) {
      const release = await get<{ name: string | null; body: string | null; html_url: string }>(
        fetch,
        `${base}/releases/tags/${encodeURIComponent(ref)}`,
      );
      if (release !== null && (release.body ?? "").trim() !== "") {
        releaseNotes = { name: release.name || ref, body: release.body!.trim(), url: release.html_url };
      }
    }

    const commits = relevant.map(toCommit).reverse();
    return {
      kind: "github",
      commits: commits.slice(0, COMMITS_SHOWN),
      total: commits.length,
      repoWide: compare.total_commits,
      subdirectory,
      releaseNotes,
      url: compare.html_url,
    };
  } catch (error) {
    if (error instanceof GitHubError) return { kind: "unavailable", reason: error.message };
    return { kind: "unavailable", reason: "Couldn't reach GitHub." };
  }
}
