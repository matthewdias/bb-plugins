// Thread Summary — a backend that holds settings.
//
// Everything visible happens in the app: the header button, its card, and the
// Git and pull-request complications. Two settings live here. Whether the
// header shows chips is a bb setting. Which providers the card hides cannot
// be one, because providers are discovered in the app after this backend has
// declared its settings; that list lives in this plugin's storage, behind the
// two methods below, and every write tells every window.
import { defineRpcContract, type BbPluginApi } from "@get-bb/plugin-sdk";
import { z } from "zod";
import {
  COMPLICATION_ID,
  HIDDEN_CHANGED,
  MAX_HIDDEN,
  SHOW_CHIPS_KEY,
  normalizeHidden,
  withHidden,
} from "./lib/hidden";

/** The storage key for the hidden list. */
const HIDDEN_KEY = "hidden-providers";

const hiddenSchema = z.object({ hidden: z.array(z.string()) }).strict();

export const rpcContract = defineRpcContract({
  /** Every provider hidden from the card, in the order they were hidden. */
  hiddenProviders_list: {
    input: z.object({}).strict(),
    output: hiddenSchema,
  },
  /** Hide one provider, or show it again. */
  hiddenProviders_set: {
    input: z.object({ id: z.string().regex(COMPLICATION_ID), hidden: z.boolean() }).strict(),
    output: hiddenSchema,
  },
});

export default function plugin(bb: BbPluginApi) {
  bb.settings.define({
    [SHOW_CHIPS_KEY]: {
      type: "boolean",
      label: "Show chips in the thread header",
      description:
        "Up to three of the thread's most urgent values beside the Thread Summary button. " +
        "Off, the button shows a dot in the most urgent tone instead.",
      default: true,
    },
  });

  const readHidden = async () => normalizeHidden(await bb.storage.kv.get<unknown>(HIDDEN_KEY));

  bb.rpc.register(rpcContract, {
    hiddenProviders_list: async () => ({ hidden: await readHidden() }),
    hiddenProviders_set: async ({ id, hidden: hide }) => {
      const current = await readHidden();
      if (hide && !current.includes(id) && current.length >= MAX_HIDDEN) {
        throw new Error(`Already hiding ${MAX_HIDDEN} providers.`);
      }
      const hidden = withHidden(current, id, hide);
      await bb.storage.kv.set(HIDDEN_KEY, hidden);
      // Every window draws from this, and a window hears only this plugin's
      // own signals — which this is.
      bb.realtime.publish(HIDDEN_CHANGED, { id });
      return { hidden };
    },
  });
}
