// What a card says about where a plugin's code comes from, and the prompt
// that asks an agent to read that code before it is installed.

/** `catalog.installPlan`'s resolved source, as far as this plugin reads it. */
export type ResolvedSource =
  | {
      kind: "git";
      url: string;
      range?: string;
      ref?: string;
      resolvedTag?: string;
      resolvedCommit?: string;
      subdir?: string;
      tagPrefix?: string;
      unresolvedReason?: string;
    }
  | {
      kind: "npm";
      package: string;
      range?: string;
      tag?: string;
      resolvedVersion?: string;
      unresolvedReason?: string;
    };

export interface SourceSummary {
  /** One line: repository or package, then what it lands on. */
  label: string;
  /** Browsable repository URL, when there is one. */
  url: string | null;
  /** True when bb pinned an exact tag/commit or version for this install. */
  exact: boolean;
}

function browsable(url: string): string | null {
  return /^https?:\/\//i.test(url) ? url.replace(/\.git$/i, "") : null;
}

export function summarizeSource(source: ResolvedSource): SourceSummary {
  if (source.kind === "npm") {
    const lands = source.resolvedVersion ?? source.tag ?? source.range;
    return {
      label: lands === undefined ? source.package : `${source.package}@${lands}`,
      url: `https://www.npmjs.com/package/${source.package}`,
      exact: source.resolvedVersion !== undefined,
    };
  }
  const repo = source.url.replace(/^https?:\/\//i, "").replace(/\.git$/i, "");
  const path = source.subdir === undefined ? repo : `${repo}/${source.subdir}`;
  // bb resolves the exact tag and commit only for third-party marketplaces;
  // BB Community entries come back as the range they track.
  if (source.resolvedTag !== undefined || source.resolvedCommit !== undefined) {
    const commit = source.resolvedCommit?.slice(0, 12);
    const at = [source.resolvedTag, commit === undefined ? undefined : `(${commit})`].filter(Boolean).join(" ");
    return { label: `${path} @ ${at}`, url: browsable(source.url), exact: true };
  }
  const tracks = source.ref ?? (source.range === undefined ? undefined : `${source.tagPrefix ?? ""}${source.range}`);
  return {
    label: tracks === undefined ? path : `${path} @ ${tracks}`,
    url: browsable(source.url),
    exact: false,
  };
}

export interface VetSubject {
  displayName: string;
  entryId: string;
  marketplaceDisplayName: string;
  author: string | null;
  source: string;
  sourceLabel: string | null;
  link: string | null;
}

/** The new-thread prompt behind "Vet with an agent". */
export function vetPrompt(subject: VetSubject): string {
  const lines = [
    `Review the bb plugin "${subject.displayName}" (${subject.entryId} from ${subject.marketplaceDisplayName}${
      subject.author === null ? "" : `, by ${subject.author}`
    }) before I install it. Do not install it.`,
    "",
    `Source: ${subject.sourceLabel ?? subject.source}`,
  ];
  if (subject.link !== null) lines.push(`Listing: ${subject.link}`);
  lines.push(
    "",
    "bb plugins are full-trust code that runs inside the bb server and can read all local bb data. Read the code at that source and tell me:",
    "- what it registers: agent tools, hooks, background services, schedules, HTTP routes, CLI commands",
    "- what it reaches over the network, and what files, secrets or other plugins' data it touches",
    "- its runtime dependencies, and anything that runs at install or build time",
    "- whether it does what its listing says, and nothing it doesn't",
    "",
    "End with a verdict: install, install with caveats (name them), or don't install.",
  );
  return lines.join("\n");
}
