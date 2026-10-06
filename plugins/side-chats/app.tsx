// Side Chats — frontend entry.
//
// A control in the thread header, shown only while the thread has side chats,
// and a "Side chats" panel that lists them or shows one. Everything they do
// goes through the server's RPC.
import { definePluginApp } from "@get-bb/plugin-sdk/app";
import { SideChatsControl } from "./src/header-control.tsx";
import { SideChatsPanel } from "./src/panel.tsx";
import { PANEL_ACTION } from "./src/use-side-chats.ts";

export default definePluginApp((app) => {
  app.slots.experimental_threadHeaderAction({
    id: "side-chats",
    title: "Side chats",
    component: SideChatsControl,
  });
  app.slots.threadPanelAction({
    id: PANEL_ACTION,
    title: "Side chats",
    icon: "SideChat",
    layout: "flush",
    component: SideChatsPanel,
  });
});
