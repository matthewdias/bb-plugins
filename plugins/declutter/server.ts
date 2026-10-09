// Declutter — server entry.
//
// Keeps two things, so every window and device agrees: the catalog of items
// any window has seen on screen, and the keys of the ones you hid. The app
// does the hiding (lib/items.ts); this only remembers.
//
// Windows report what they find on their own, so two can write at once. All
// writes go through one queue: kv has no transactions, and a lost report would
// only be re-sent, but a lost hide would be a toggle that silently undid itself.
import { defineRpcContract, type BbPluginApi } from "@get-bb/plugin-sdk";
import { z } from "zod";
import { CHANGED, CATALOG_MAX, REPORT_MAX } from "./lib/state";
import { itemOf, keyOf, LABEL_MAX, PLUGIN_ID_MAX, SURFACES, type Item } from "./lib/items";

const itemSchema = z
  .object({
    surface: z.enum(SURFACES),
    pluginId: z.string().min(1).max(PLUGIN_ID_MAX).nullable(),
    label: z.string().min(1).max(LABEL_MAX).nullable(),
  })
  .strict();

const seenSchema = z.object({ key: z.string(), item: itemSchema, firstSeen: z.number() }).strict();
type Seen = z.infer<typeof seenSchema>;

const KEY_MAX = PLUGIN_ID_MAX + LABEL_MAX + 64;
const stateSchema = z.object({ items: z.array(seenSchema), hidden: z.array(z.string()) }).strict();

export const rpcContract = defineRpcContract({
  state_get: { input: z.null(), output: stateSchema },
  /** Add whatever the caller found that is not in the catalog yet. */
  items_report: {
    input: z.object({ items: z.array(itemSchema).max(REPORT_MAX) }).strict(),
    output: z.object({ added: z.number().int() }).strict(),
  },
  hidden_set: {
    input: z.object({ key: z.string().min(1).max(KEY_MAX), hidden: z.boolean() }).strict(),
    output: z.object({ hidden: z.array(z.string()) }).strict(),
  },
  /** Show everything again. */
  hidden_reset: { input: z.null(), output: z.object({ hidden: z.array(z.string()) }).strict() },
});

const CATALOG = "catalog";
const HIDDEN = "hidden";

export default async function plugin(bb: BbPluginApi) {
  async function catalog(): Promise<Seen[]> {
    const parsed = z.array(seenSchema).safeParse(await bb.storage.kv.get<unknown>(CATALOG));
    return parsed.success ? parsed.data : [];
  }

  async function hidden(): Promise<string[]> {
    const parsed = z.array(z.string()).safeParse(await bb.storage.kv.get<unknown>(HIDDEN));
    return parsed.success ? parsed.data : [];
  }

  let queue: Promise<unknown> = Promise.resolve();
  function serially<T>(write: () => Promise<T>): Promise<T> {
    const next = queue.then(write, write);
    queue = next.catch(() => undefined);
    return next;
  }

  async function saveHidden(keys: string[]): Promise<string[]> {
    await bb.storage.kv.set(HIDDEN, keys);
    bb.realtime.publish(CHANGED, null);
    return keys;
  }

  bb.rpc.register(rpcContract, {
    state_get: async () => ({ items: await catalog(), hidden: await hidden() }),

    items_report: ({ items }) =>
      serially(async () => {
        const seen = await catalog();
        const known = new Set(seen.map((entry) => entry.key));
        const now = Date.now();
        let added = 0;
        for (const item of items as Item[]) {
          const key = keyOf(item);
          if (known.has(key) || seen.length >= CATALOG_MAX) continue;
          known.add(key);
          seen.push({ key, item, firstSeen: now });
          added += 1;
        }
        if (added > 0) {
          await bb.storage.kv.set(CATALOG, seen);
          bb.realtime.publish(CHANGED, null);
        }
        return { added };
      }),

    hidden_set: ({ key, hidden: hide }) =>
      serially(async () => {
        if (itemOf(key) === null) throw new Error(`Not an item key: ${key}`);
        const keys = (await hidden()).filter((existing) => existing !== key);
        return { hidden: await saveHidden(hide ? [...keys, key] : keys) };
      }),

    hidden_reset: () => serially(async () => ({ hidden: await saveHidden([]) })),
  });
}
