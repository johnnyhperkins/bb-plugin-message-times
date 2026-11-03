import { describe, expect, it } from "vitest";
import { formatFull, formatLabel } from "./format";
import type { MessageTime, MessageTimeKind } from "./message-times";

// vitest.config.ts sets TZ to UTC.
const NOW = new Date("2026-10-30T18:00:00Z");

function time(kind: MessageTimeKind, iso: string): MessageTime {
  return { rowId: "r1", role: kind === "sent" ? "user" : "assistant", kind, at: Date.parse(iso), final: true };
}

describe("formatLabel", () => {
  it("shows only the time with a verb for a message from today", () => {
    expect(formatLabel(time("sent", "2026-10-30T14:10:00Z"), NOW, "en-US")).toBe("Sent 2:10 PM");
    expect(formatLabel(time("finished", "2026-10-30T14:14:00Z"), NOW, "en-US")).toBe(
      "Finished 2:14 PM",
    );
    expect(formatLabel(time("stopped", "2026-10-30T14:14:00Z"), NOW, "en-US")).toBe(
      "Stopped 2:14 PM",
    );
    expect(formatLabel(time("failed", "2026-10-30T14:14:00Z"), NOW, "en-US")).toBe(
      "Failed 2:14 PM",
    );
  });

  it("shows the time without a verb for a message that arrived in the reply", () => {
    expect(formatLabel(time("arrived", "2026-10-30T14:12:00Z"), NOW, "en-US")).toBe("2:12 PM");
  });

  it("adds the date for a message from an earlier day", () => {
    expect(formatLabel(time("sent", "2026-10-29T14:10:00Z"), NOW, "en-US")).toBe(
      "Sent Oct 29, 2:10 PM",
    );
  });

  it("adds the year for a message from an earlier year", () => {
    expect(formatLabel(time("finished", "2025-12-31T23:59:00Z"), NOW, "en-US")).toBe(
      "Finished Dec 31, 2025, 11:59 PM",
    );
  });

  it("adds the date for a message from before midnight, even minutes ago", () => {
    const justAfterMidnight = new Date("2026-10-30T00:10:00Z");

    expect(formatLabel(time("sent", "2026-10-29T23:50:00Z"), justAfterMidnight, "en-US")).toBe(
      "Sent Oct 29, 11:50 PM",
    );
  });
});

describe("formatFull", () => {
  it("shows the full date and time with the verb", () => {
    expect(formatFull(time("sent", "2026-10-29T14:10:05Z"), "en-US")).toBe(
      "Sent Thursday, October 29, 2026 at 2:10:05 PM UTC",
    );
  });

  it("uses the verb Arrived in the full form of a reply message", () => {
    expect(formatFull(time("arrived", "2026-10-29T14:10:05Z"), "en-US")).toBe(
      "Arrived Thursday, October 29, 2026 at 2:10:05 PM UTC",
    );
  });
});
