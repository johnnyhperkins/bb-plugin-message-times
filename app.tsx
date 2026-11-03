import { definePluginApp } from "@get-bb/plugin-sdk/app";
import { mountMessageTimes } from "./lib/decorate";
import type { MessageTime } from "./lib/message-times";

type RpcEnvelope =
  | { ok: true; result: { times: MessageTime[] } }
  | { ok: false; error?: { code?: string; message?: string } };

export default definePluginApp((app) => {
  app.contentScripts.register({
    id: "message-times",
    mount({ pluginId, signal }) {
      return mountMessageTimes({
        signal,
        async fetchTimes(threadId, rowIds) {
          // The content script has no React context for useRpc, so it posts to the documented rpc route.
          const response = await fetch(
            `/api/v1/plugins/${encodeURIComponent(pluginId)}/rpc/messageTimes`,
            {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({ threadId, rowIds }),
              signal,
            },
          );
          const envelope = (await response.json()) as RpcEnvelope;
          if (!envelope.ok) {
            throw new Error(envelope.error?.message ?? `messageTimes failed with HTTP ${response.status}`);
          }
          return envelope.result.times;
        },
      });
    },
  });
});
