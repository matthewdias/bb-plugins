// What a finished job says in its toast. Pure, so the tests can check every
// kind without bb's runtime.
import type { Job } from "../lib/queue";

export interface JobToast {
  tone: "success" | "error";
  title: string;
  id: string;
  description?: string;
  /** A button that goes to a bb route. */
  action?: { label: string; to: string };
}

/** The toast for a job that has just finished, or null while it hasn't. */
export function jobToast(job: Job): JobToast | null {
  if (job.state !== "done" && job.state !== "failed") return null;
  const ok = job.state === "done";
  const error = job.error ?? undefined;
  switch (job.kind) {
    case "remove": {
      const id = `triage-remove-${job.pluginId}`;
      return ok
        ? { tone: "success", title: `Removed ${job.displayName}`, id }
        : { tone: "error", title: `Couldn't remove ${job.displayName}`, id, description: error };
    }
    case "update": {
      const id = `triage-update-${job.pluginId}`;
      if (!ok) return { tone: "error", title: `Couldn't update ${job.displayName}`, id, description: error };
      return { tone: "success", title: job.result === "current" ? `${job.displayName} was already up to date` : `Updated ${job.displayName}`, id };
    }
    case "install": {
      const id = `triage-install-${job.key}`;
      if (!ok) return { tone: "error", title: `Couldn't install ${job.displayName}`, id, description: error };
      return {
        tone: "success",
        title: `Installed ${job.displayName}`,
        id,
        action: job.pluginId === null ? undefined : { label: "Open settings", to: `/settings/plugins/${encodeURIComponent(job.pluginId)}` },
      };
    }
  }
}
