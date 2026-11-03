import { describe, expect, it } from "vitest";
import { computeMessageTimes, type ConversationRow, type TurnEnd } from "./message-times";

function user(id: string, createdAt: number): ConversationRow {
  return { id, role: "user", turnId: null, createdAt, nested: false };
}

function assistant(
  id: string,
  turnId: string | null,
  createdAt: number,
  nested = false,
): ConversationRow {
  return { id, role: "assistant", turnId, createdAt, nested };
}

function byId(rows: ConversationRow[], ends: TurnEnd[]) {
  return new Map(computeMessageTimes(rows, ends).map((time) => [time.rowId, time]));
}

describe("computeMessageTimes", () => {
  it("marks a user message as sent at its creation time", () => {
    const times = byId([user("u1", 1_000)], []);

    expect(times.get("u1")).toEqual({
      rowId: "u1",
      role: "user",
      kind: "sent",
      at: 1_000,
      final: true,
    });
  });

  it("gives the last assistant message of a completed turn the turn end time", () => {
    const times = byId(
      [user("u1", 1_000), assistant("a1", "t1", 2_000), assistant("a2", "t1", 3_000)],
      [{ turnId: "t1", endedAt: 9_000, status: "completed" }],
    );

    expect(times.get("a2")).toEqual({
      rowId: "a2",
      role: "assistant",
      kind: "finished",
      at: 9_000,
      final: true,
    });
  });

  it("gives the earlier assistant messages of an ended turn their own arrival time", () => {
    const times = byId(
      [assistant("a1", "t1", 2_000), assistant("a2", "t1", 3_000)],
      [{ turnId: "t1", endedAt: 9_000, status: "completed" }],
    );

    expect(times.get("a1")).toEqual({
      rowId: "a1",
      role: "assistant",
      kind: "arrived",
      at: 2_000,
      final: true,
    });
  });

  it("keeps the assistant messages of a running turn open for a later update", () => {
    const times = byId([assistant("a1", "t1", 2_000), assistant("a2", "t1", 3_000)], []);

    expect(times.get("a1")).toMatchObject({ kind: "arrived", at: 2_000, final: false });
    expect(times.get("a2")).toMatchObject({ kind: "arrived", at: 3_000, final: false });
  });

  it("uses the timeline order, not the creation time, to find the last message", () => {
    const times = byId(
      [assistant("a1", "t1", 5_000), assistant("a2", "t1", 5_000)],
      [{ turnId: "t1", endedAt: 9_000, status: "completed" }],
    );

    expect(times.get("a1")?.kind).toBe("arrived");
    expect(times.get("a2")?.kind).toBe("finished");
  });

  it("marks the last message of an interrupted turn as stopped", () => {
    const times = byId(
      [assistant("a1", "t1", 2_000)],
      [{ turnId: "t1", endedAt: 4_000, status: "interrupted" }],
    );

    expect(times.get("a1")).toMatchObject({ kind: "stopped", at: 4_000, final: true });
  });

  it("marks the last message of a failed turn as failed", () => {
    const times = byId(
      [assistant("a1", "t1", 2_000)],
      [{ turnId: "t1", endedAt: 4_000, status: "failed" }],
    );

    expect(times.get("a1")).toMatchObject({ kind: "failed", at: 4_000, final: true });
  });

  it("never gives the turn end time to a nested message", () => {
    const times = byId(
      [assistant("a1", "t1", 2_000), assistant("sub1", "t1", 3_000, true)],
      [{ turnId: "t1", endedAt: 9_000, status: "completed" }],
    );

    expect(times.get("a1")).toMatchObject({ kind: "finished", at: 9_000 });
    expect(times.get("sub1")).toMatchObject({ kind: "arrived", at: 3_000, final: true });
  });

  it("treats an assistant message without a turn as final", () => {
    const times = byId([assistant("a1", null, 2_000)], []);

    expect(times.get("a1")).toMatchObject({ kind: "arrived", at: 2_000, final: true });
  });

  it("keeps each turn separate", () => {
    const times = byId(
      [
        assistant("a1", "t1", 2_000),
        user("u2", 3_000),
        assistant("a2", "t2", 4_000),
        assistant("a3", "t2", 5_000),
      ],
      [{ turnId: "t1", endedAt: 2_500, status: "completed" }],
    );

    expect(times.get("a1")).toMatchObject({ kind: "finished", at: 2_500, final: true });
    expect(times.get("a2")).toMatchObject({ kind: "arrived", final: false });
    expect(times.get("a3")).toMatchObject({ kind: "arrived", final: false });
  });
});
