import { defineRpcContract, type BbPluginApi } from "@get-bb/plugin-sdk";
import { z } from "zod";
import { MAX_ROW_IDS } from "./lib/message-times";
import { readMessageTimes } from "./lib/read-times";

export const rpcContract = defineRpcContract({
  messageTimes: {
    input: z
      .object({
        threadId: z.string().regex(/^thr_[A-Za-z0-9_-]{1,64}$/),
        rowIds: z.array(z.string().min(1).max(1_000)).min(1).max(MAX_ROW_IDS),
      })
      .strict(),
    output: z.object({
      times: z.array(
        z.object({
          rowId: z.string(),
          role: z.enum(["user", "assistant"]),
          kind: z.enum(["sent", "arrived", "finished", "stopped", "failed"]),
          at: z.number(),
          final: z.boolean(),
        }),
      ),
    }),
  },
});

export default function plugin(bb: BbPluginApi) {
  bb.rpc.register(rpcContract, {
    async messageTimes({ threadId, rowIds }) {
      return { times: await readMessageTimes(bb.sdk.threads, threadId, rowIds) };
    },
  });
}
