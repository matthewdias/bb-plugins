// Shared by the UI tests: a registry seeded with providers and values, and a
// backend for the hidden list that keeps what it is told.
import type { PluginSidebarThread } from "@get-bb/plugin-sdk/app";
import {
  getComplications,
  type ComplicationProviderHandle,
  type ComplicationProviderRegistration,
} from "../../lib/complications";

export const registry = getComplications()!;
const handles: ComplicationProviderHandle[] = [];

/** Register a provider and publish one value per thread. */
export function provide(
  registration: Omit<ComplicationProviderRegistration, "subjects"> & { subjects?: string[] },
  values: Record<string, unknown>,
): ComplicationProviderHandle {
  const handle = registry.provide({ subjects: ["thread"], ...registration });
  for (const [threadId, value] of Object.entries(values)) {
    handle.set({ kind: "thread", id: threadId }, value as never);
  }
  handles.push(handle);
  return handle;
}

export function disposeProviders(): void {
  for (const handle of handles.splice(0)) handle.dispose();
}

let threads = 0;
/** The registry outlives each render, as in a bb window: every test gets its own threads. */
export const freshThread = (): string => `thr_ui${++threads}`;

export function hiddenBackend(initial: string[] = []) {
  let stored = [...initial];
  return {
    hiddenProviders_list: async () => ({ hidden: stored }),
    hiddenProviders_set: async ({ id, hidden }: { id: string; hidden: boolean }) => {
      stored = stored.filter((entry) => entry !== id);
      if (hidden) stored.push(id);
      return { hidden: stored };
    },
  };
}

export function sidebarThread(id: string, environmentId: string | null = "env_1", status = "idle"): PluginSidebarThread {
  return {
    id,
    projectId: "proj_1",
    status,
    environment: environmentId === null ? null : { id: environmentId },
  } as unknown as PluginSidebarThread;
}
