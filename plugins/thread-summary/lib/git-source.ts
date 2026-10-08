// Asking bb for a thread's Git status.
//
// Three calls: the thread for its environment, the environment for the branch
// it merges into, then the status against that branch. The second is not
// optional — without `mergeBaseBranch` the status leaves out the merge base,
// and with it the ahead and behind counts and the branch's committed files.
// The thread's environment is read once per thread; the merge-base branch
// every time, because it can be changed in bb while a card is open.
import type { GitStatus } from "./git-value";

export interface GitSdk {
  threads: { get(args: { threadId: string }): Promise<{ environmentId: string | null }> };
  environments: {
    get(args: { environmentId: string }): Promise<{
      mergeBaseBranch: string | null;
      defaultBranch: string | null;
    }>;
    status(args: { environmentId: string; mergeBaseBranch?: string }): Promise<unknown>;
  };
}

/** The status, or `null` when the thread has no environment to ask about. */
export async function readGitStatus(
  sdk: GitSdk,
  threadId: string,
  environment: { current: string | null | undefined },
): Promise<GitStatus | null> {
  if (environment.current === undefined) {
    environment.current = (await sdk.threads.get({ threadId })).environmentId;
  }
  const environmentId = environment.current;
  if (environmentId === null) return null;
  const { mergeBaseBranch, defaultBranch } = await sdk.environments.get({ environmentId });
  const base = mergeBaseBranch ?? defaultBranch;
  return (await sdk.environments.status(
    base === null ? { environmentId } : { environmentId, mergeBaseBranch: base },
  )) as GitStatus;
}
