// Promote Side Chat — frontend entry.
//
// One control in the thread header, shown only while the thread has side
// chats to promote. Everything it does goes through the server's RPC.
import { definePluginApp } from "@get-bb/plugin-sdk/app";
import { SideChatsControl } from "./src/header-control.tsx";

export default definePluginApp((app) => {
  app.slots.experimental_threadHeaderAction({
    id: "promote-side-chat",
    title: "Side chats",
    component: SideChatsControl,
  });
});
