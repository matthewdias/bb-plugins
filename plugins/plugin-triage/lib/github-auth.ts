// The GitHub login the change lists use, found the way bb finds its own:
// bb's server runs `gh auth token --hostname github.com` for git credentials,
// and lets a GH_TOKEN in the environment stand in for it. Using that login
// lifts GitHub's limit from 60 requests an hour to 5,000.
//
// The token stays in memory, is never stored or logged, and is only ever sent
// to api.github.com, for the read-only requests in lib/changes.ts.

/** Runs gh with these arguments and resolves to its stdout. */
export type RunGh = (command: string, args: string[]) => Promise<string>;

/**
 * Where gh may be when the server's PATH is launchd's bare one. The bare name
 * comes first, as bb itself calls it.
 */
const GH_COMMANDS = ["gh", "/opt/homebrew/bin/gh", "/usr/local/bin/gh", "/home/linuxbrew/.linuxbrew/bin/gh"];

const TOKEN = /^[^\s\x00]+$/u;
/** How long a found (or missing) login is trusted before asking gh again. */
export const LOGIN_TTL_MS = 10 * 60 * 1000;

export interface GitHubLogin {
  /** The token, or null to send requests without one. */
  token(): Promise<string | null>;
  /** GitHub refused the token: forget it until the next lookup. */
  reject(): void;
}

export function gitHubLogin(options: {
  enabled: () => boolean | Promise<boolean>;
  env: Record<string, string | undefined>;
  runGh: RunGh;
  now?: () => number;
}): GitHubLogin {
  const now = options.now ?? Date.now;
  let cached: { token: string | null; at: number } | null = null;

  async function lookUp(): Promise<string | null> {
    const fromEnv = (options.env.GH_TOKEN ?? options.env.GITHUB_TOKEN)?.trim();
    if (fromEnv && TOKEN.test(fromEnv)) return fromEnv;
    for (const command of GH_COMMANDS) {
      try {
        const token = (await options.runGh(command, ["auth", "token", "--hostname", "github.com"])).trim();
        return TOKEN.test(token) ? token : null;
      } catch (error) {
        // Not at this path: try the next. Anything else (not logged in) is final.
        if ((error as NodeJS.ErrnoException)?.code !== "ENOENT") return null;
      }
    }
    return null;
  }

  return {
    async token() {
      if (!(await options.enabled())) return null;
      if (cached === null || now() - cached.at > LOGIN_TTL_MS) cached = { token: await lookUp(), at: now() };
      return cached.token;
    },
    reject() {
      cached = { token: null, at: now() };
    },
  };
}
