// How this plugin registers its two complications. Here rather than in the
// publisher so a test can prove the registry accepts them: a registration the
// registry refuses throws inside an effect, where all anyone sees is a card
// that never shows a branch.
import type {
  ComplicationProviderRegistration,
  ComplicationSubject,
} from "./complications";
import { GIT_ID, PULL_REQUEST_ID } from "./order";

function threadsOf(subjects: readonly ComplicationSubject[]): string[] {
  return subjects.filter((subject) => subject.kind === "thread").map((subject) => subject.id);
}

export function gitRegistration(ask: (threadIds: string[]) => void): ComplicationProviderRegistration {
  return {
    id: GIT_ID,
    name: "Git",
    description: "The thread's branch against its base: commits ahead and behind, and uncommitted changes.",
    subjects: ["thread"],
    sample: { icon: "GitBranch", label: "feature → main", text: "↑3", tone: "default" },
    onWanted: (subjects) => ask(threadsOf(subjects)),
  };
}

export function pullRequestRegistration(
  ask: (threadIds: string[]) => void,
): ComplicationProviderRegistration {
  return {
    id: PULL_REQUEST_ID,
    name: "Pull request",
    description: "The pull request for the thread's branch: checks, review and whether it can merge.",
    subjects: ["thread"],
    sample: { icon: "GitPullRequest", label: "#42 Add the card", text: "review requested", tone: "info" },
    onWanted: (subjects) => ask(threadsOf(subjects)),
  };
}
