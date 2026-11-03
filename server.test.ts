import { createFakePluginHost } from "@get-bb/plugin-sdk/testing";
import { describe, expect, it } from "vitest";
import plugin from "./server";

const THREAD = "thr_test1";

type Row = Record<string, unknown>;
type TurnEndEvent = Row & { seq: number; createdAt: number };

function userRow(id: string, createdAt: number): Row {
  return { kind: "conversation", id, role: "user", initiator: "user", turnId: null, createdAt };
}

function claudeRow(id: string, turnId: string, createdAt: number): Row {
  return { kind: "conversation", id, role: "assistant", initiator: "agent", turnId, createdAt };
}

function workRow(id: string, children: Row[]): Row {
  return { kind: "work", id, children };
}

function turnEnd(seq: number, turnId: string, createdAt: number, status = "completed"): TurnEndEvent {
  return {
    id: `ev_${seq}`,
    seq,
    createdAt,
    threadId: THREAD,
    type: "turn/completed",
    scope: { kind: "turn", turnId },
    data: { status },
  };
}

/** Each argument is one timeline page, newest page first. */
function timelinePages(...pages: Row[][]) {
  return pages.map((rows, index) => ({
    rows,
    timelinePage: {
      olderCursor:
        index + 1 < pages.length ? { anchorSeq: index + 1, anchorId: `anchor-${index + 1}` } : null,
    },
  }));
}

async function setup(options: { pages: ReturnType<typeof timelinePages>; events?: TurnEndEvent[] }) {
  const events = options.events ?? [];
  const { bb, harness } = createFakePluginHost({
    pluginId: "message-times",
    sdk: {
      threads: {
        timeline: async (args) => {
          const index = args.beforeAnchorId ? Number(args.beforeAnchorId.replace("anchor-", "")) : 0;
          return options.pages[index];
        },
        events: {
          list: async (args) => {
            const before = args.beforeSeq ? Number(args.beforeSeq) : Number.POSITIVE_INFINITY;
            return events
              .filter((event) => event.seq < before)
              .sort((a, b) => b.seq - a.seq)
              .slice(0, Number(args.limit ?? "100"));
          },
        },
      },
    },
  });
  await plugin(bb);
  const call = (rowIds: string[], threadId = THREAD) =>
    harness.behavior.callRpc("messageTimes", { threadId, rowIds }) as Promise<{
      times: Array<Record<string, unknown>>;
    }>;
  return { call, sdk: harness.inspection.sdk };
}

describe("messageTimes rpc", () => {
  it("returns the sent time of a user message", async () => {
    const { call } = await setup({ pages: timelinePages([userRow("u1", 1_000)]) });

    await expect(call(["u1"])).resolves.toEqual({
      times: [{ rowId: "u1", role: "user", kind: "sent", at: 1_000, final: true }],
    });
  });

  it("gives the last Claude message of a completed turn the turn end time", async () => {
    const { call } = await setup({
      pages: timelinePages([userRow("u1", 1_000), claudeRow("a1", "t1", 2_000), claudeRow("a2", "t1", 3_000)]),
      events: [turnEnd(10, "t1", 9_000)],
    });

    const { times } = await call(["a1", "a2"]);

    expect(times).toEqual([
      { rowId: "a1", role: "assistant", kind: "arrived", at: 2_000, final: true },
      { rowId: "a2", role: "assistant", kind: "finished", at: 9_000, final: true },
    ]);
  });

  it("returns only the requested messages", async () => {
    const { call } = await setup({
      pages: timelinePages([userRow("u1", 1_000), claudeRow("a1", "t1", 2_000)]),
    });

    const { times } = await call(["u1"]);

    expect(times.map((time) => time.rowId)).toEqual(["u1"]);
  });

  it("reads the timeline without message text and with nested rows", async () => {
    const { call, sdk } = await setup({ pages: timelinePages([userRow("u1", 1_000)]) });

    await call(["u1"]);

    expect(sdk.callsTo("threads.timeline")[0]?.[0]).toMatchObject({
      threadId: THREAD,
      deferContent: "true",
      includeNestedRows: "true",
    });
  });

  it("reads older pages until it finds each requested message", async () => {
    const { call, sdk } = await setup({
      pages: timelinePages([claudeRow("a2", "t1", 3_000)], [userRow("u1", 1_000), claudeRow("a1", "t1", 2_000)]),
      events: [turnEnd(10, "t1", 9_000)],
    });

    const { times } = await call(["a1"]);

    expect(sdk.callsTo("threads.timeline")[1]?.[0]).toMatchObject({
      beforeAnchorSeq: "1",
      beforeAnchorId: "anchor-1",
    });
    // a2 on the newer page is the last message of the turn, so a1 keeps its own time.
    expect(times).toEqual([{ rowId: "a1", role: "assistant", kind: "arrived", at: 2_000, final: true }]);
  });

  it("stops after 12 pages when a message is not found", async () => {
    const endless = Array.from({ length: 20 }, (_, index) => [userRow(`old${index}`, 1_000 - index)]);
    const { call, sdk } = await setup({ pages: timelinePages(...endless) });

    const { times } = await call(["missing"]);

    expect(times).toEqual([]);
    expect(sdk.callsTo("threads.timeline")).toHaveLength(12);
  });

  it("does not read turn events when no Claude message is requested", async () => {
    const { call, sdk } = await setup({ pages: timelinePages([userRow("u1", 1_000)]) });

    await call(["u1"]);

    expect(sdk.callsTo("threads.events.list")).toHaveLength(0);
  });

  it("reads only turn end events, newest first", async () => {
    const { call, sdk } = await setup({
      pages: timelinePages([claudeRow("a1", "t1", 2_000)]),
      events: [turnEnd(10, "t1", 9_000)],
    });

    await call(["a1"]);

    expect(sdk.callsTo("threads.events.list")[0]?.[0]).toMatchObject({
      threadId: THREAD,
      types: ["turn/completed"],
      order: "desc",
    });
  });

  it("reads more event pages until it finds the turn end", async () => {
    const laterTurns = Array.from({ length: 120 }, (_, index) =>
      turnEnd(100 + index, `later${index}`, 10_000 + index),
    );
    const { call } = await setup({
      pages: timelinePages([claudeRow("a1", "t1", 2_000)]),
      events: [turnEnd(50, "t1", 3_000), ...laterTurns],
    });

    const { times } = await call(["a1"]);

    expect(times[0]).toMatchObject({ kind: "finished", at: 3_000, final: true });
  });

  it("stops reading events when they are older than the requested messages", async () => {
    const olderTurns = Array.from({ length: 120 }, (_, index) => turnEnd(1 + index, `old${index}`, 1_000 + index));
    const { call, sdk } = await setup({
      pages: timelinePages([claudeRow("a1", "running", 5_000)]),
      events: olderTurns,
    });

    const { times } = await call(["a1"]);

    expect(times[0]).toMatchObject({ kind: "arrived", at: 5_000, final: false });
    expect(sdk.callsTo("threads.events.list")).toHaveLength(1);
  });

  it("gives the turn end time to the last top-level message, not to a nested one", async () => {
    const { call } = await setup({
      pages: timelinePages([
        claudeRow("a1", "t1", 2_000),
        workRow("w1", [claudeRow("sub1", "t1", 2_500)]),
      ]),
      events: [turnEnd(10, "t1", 9_000)],
    });

    const { times } = await call(["a1", "sub1"]);

    expect(times).toEqual([
      { rowId: "a1", role: "assistant", kind: "finished", at: 9_000, final: true },
      { rowId: "sub1", role: "assistant", kind: "arrived", at: 2_500, final: true },
    ]);
  });

  it("rejects a thread id in an unknown format", async () => {
    const { call } = await setup({ pages: timelinePages([]) });

    await expect(call(["u1"], "../threads")).rejects.toMatchObject({ code: "invalid_input" });
  });

  it("rejects more than 200 row ids", async () => {
    const { call } = await setup({ pages: timelinePages([]) });

    await expect(call(Array.from({ length: 201 }, (_, index) => `r${index}`))).rejects.toMatchObject({
      code: "invalid_input",
    });
  });
});
