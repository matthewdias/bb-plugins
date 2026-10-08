// Asking bb for a thread's Git status.
//
// Two calls: the environment, for the branch it merges into, then the status
// against that branch. The first is not optional — without `mergeBaseBranch`
// the status leaves out the merge base, and with it the ahead and behind counts
// and the branch's committed files. Neither is cached: the merge-base branch
// can be changed in bb while a card is open.
//
// Which environment is the caller's business. The publisher reads it live
// from the sidebar's thread list, as the header does for its file links, so a
// thread that gets an environment, or moves to another, is followed at once.
// `environmentOf` is for a thread that list does not carry.
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

/** The environment's status against the branch it merges into. */
export async function readGitStatus(sdk: GitSdk, environmentId: string): Promise<GitStatus> {
  const { mergeBaseBranch, defaultBranch } = await sdk.environments.get({ environmentId });
  const base = mergeBaseBranch ?? defaultBranch;
  return (await sdk.environments.status(
    base === null ? { environmentId } : { environmentId, mergeBaseBranch: base },
  )) as GitStatus;
}

/** A thread's environment, asked of bb each time: it can be created or replaced. */
export async function environmentOf(sdk: GitSdk, threadId: string): Promise<string | null> {
  return (await sdk.threads.get({ threadId })).environmentId;
}
