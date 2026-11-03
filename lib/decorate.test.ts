// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mountMessageTimes, type FetchTimes } from "./decorate";
import type { MessageTime, MessageTimeKind } from "./message-times";

// vitest.config.ts sets TZ to UTC.
const T = Date.parse("2026-10-30T14:00:00Z");
const ROW = "thr_a:user-seed:1";
const LABEL = "data-mt-label";

function addMessage(rowId: string): HTMLElement {
  const row = document.createElement("div");
  row.setAttribute("data-timeline-row-id", rowId);
  const column = document.createElement("div");
  column.setAttribute("data-message-column", "");
  row.appendChild(column);
  document.body.appendChild(row);
  return column;
}

function sent(rowId: string, at = T): MessageTime {
  return { rowId, role: "user", kind: "sent", at, final: true };
}

function claude(rowId: string, kind: MessageTimeKind, at: number, final: boolean): MessageTime {
  return { rowId, role: "assistant", kind, at, final };
}

const sentForEach: FetchTimes = async (_threadId, rowIds) => rowIds.map((rowId) => sent(rowId));

let controller: AbortController;
let dispose: (() => void) | undefined;

function mount(fetchTimes: FetchTimes) {
  dispose = mountMessageTimes({ signal: controller.signal, fetchTimes, locale: "en-US" });
}

function stop() {
  controller.abort();
  dispose?.();
  dispose = undefined;
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "Date"] });
  vi.setSystemTime(T + 60_000);
  controller = new AbortController();
});

afterEach(() => {
  stop();
  document.head.innerHTML = "";
  document.body.innerHTML = "";
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("mountMessageTimes", () => {
  it("labels a message with its time, its full time, and its role", async () => {
    const column = addMessage(ROW);

    mount(sentForEach);
    await vi.advanceTimersByTimeAsync(0);

    expect(column.getAttribute(LABEL)).toBe("Sent 2:00 PM");
    expect(column.getAttribute("data-mt-full")).toBe("Sent Friday, October 30, 2026 at 2:00:00 PM UTC");
    expect(column.getAttribute("data-mt-role")).toBe("user");
  });

  it("asks once for each thread, with the row ids of that thread", async () => {
    addMessage("thr_a:user-seed:1");
    addMessage("thr_b:user-seed:1");
    addMessage("thr_a:user-seed:2");
    const fetchTimes = vi.fn<FetchTimes>(sentForEach);

    mount(fetchTimes);
    await vi.advanceTimersByTimeAsync(0);

    expect(fetchTimes).toHaveBeenCalledTimes(2);
    expect(fetchTimes).toHaveBeenCalledWith("thr_a", ["thr_a:user-seed:1", "thr_a:user-seed:2"]);
    expect(fetchTimes).toHaveBeenCalledWith("thr_b", ["thr_b:user-seed:1"]);
  });

  it("does not ask again for a time that cannot change", async () => {
    addMessage(ROW);
    const fetchTimes = vi.fn<FetchTimes>(sentForEach);

    mount(fetchTimes);
    await vi.advanceTimersByTimeAsync(60_000);

    expect(fetchTimes).toHaveBeenCalledTimes(1);
  });

  it("asks again while the turn runs and then shows the finish time", async () => {
    const row = "thr_a:assistant:1";
    const column = addMessage(row);
    const fetchTimes = vi
      .fn<FetchTimes>()
      .mockResolvedValueOnce([claude(row, "arrived", T, false)])
      .mockResolvedValueOnce([claude(row, "finished", T + 4 * 60_000, true)]);

    mount(fetchTimes);
    await vi.advanceTimersByTimeAsync(0);
    expect(column.getAttribute(LABEL)).toBe("2:00 PM");

    await vi.advanceTimersByTimeAsync(3_000);
    expect(column.getAttribute(LABEL)).toBe("Finished 2:04 PM");
  });

  it("labels a message that appears later", async () => {
    mount(sentForEach);
    await vi.advanceTimersByTimeAsync(0);

    const column = addMessage(ROW);
    await vi.advanceTimersByTimeAsync(200);

    expect(column.getAttribute(LABEL)).toBe("Sent 2:00 PM");
  });

  it("waits longer after each request that does not find the message", async () => {
    addMessage(ROW);
    const fetchTimes = vi.fn<FetchTimes>(async () => []);

    mount(fetchTimes);
    await vi.advanceTimersByTimeAsync(0);
    expect(fetchTimes).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(3_000);
    expect(fetchTimes).toHaveBeenCalledTimes(2);

    await vi.advanceTimersByTimeAsync(3_000);
    expect(fetchTimes).toHaveBeenCalledTimes(2);

    await vi.advanceTimersByTimeAsync(3_000);
    expect(fetchTimes).toHaveBeenCalledTimes(3);
  });

  it("sends one request at a time for each thread", async () => {
    addMessage(ROW);
    const fetchTimes = vi.fn<FetchTimes>(() => new Promise<MessageTime[]>(() => {}));

    mount(fetchTimes);
    await vi.advanceTimersByTimeAsync(30_000);

    expect(fetchTimes).toHaveBeenCalledTimes(1);
  });

  it("asks again later after a failed request", async () => {
    const column = addMessage(ROW);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const fetchTimes = vi
      .fn<FetchTimes>()
      .mockRejectedValueOnce(new Error("offline"))
      .mockImplementation(sentForEach);

    mount(fetchTimes);
    await vi.advanceTimersByTimeAsync(0);
    expect(column.hasAttribute(LABEL)).toBe(false);
    expect(warn).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(3_000);
    expect(column.getAttribute(LABEL)).toBe("Sent 2:00 PM");
  });

  it("ignores a message whose row id has no thread id", async () => {
    addMessage("user-seed:1");
    const fetchTimes = vi.fn<FetchTimes>(sentForEach);

    mount(fetchTimes);
    await vi.advanceTimersByTimeAsync(0);

    expect(fetchTimes).not.toHaveBeenCalled();
  });

  it("asks for at most 200 rows in one request, newest rows first", async () => {
    const rowIds = Array.from({ length: 250 }, (_, index) => `thr_a:user-seed:${index}`);
    rowIds.forEach(addMessage);
    const fetchTimes = vi.fn<FetchTimes>(sentForEach);

    mount(fetchTimes);
    await vi.advanceTimersByTimeAsync(200);

    expect(fetchTimes).toHaveBeenCalledTimes(2);
    expect(fetchTimes.mock.calls[0]?.[1]).toEqual(rowIds.slice(50));
    expect(fetchTimes.mock.calls[1]?.[1]).toEqual(rowIds.slice(0, 50));
  });

  it("adds the date to the label after midnight", async () => {
    const column = addMessage(ROW);
    vi.setSystemTime(Date.parse("2026-10-30T23:59:00Z"));

    mount(async () => [sent(ROW, Date.parse("2026-10-30T23:58:00Z"))]);
    await vi.advanceTimersByTimeAsync(0);
    expect(column.getAttribute(LABEL)).toBe("Sent 11:58 PM");

    await vi.advanceTimersByTimeAsync(63_000);
    expect(column.getAttribute(LABEL)).toBe("Sent Oct 30, 11:58 PM");
  });

  it("adds a style that shows the full time on hover", async () => {
    mount(sentForEach);

    const style = document.head.querySelector("style[data-message-times]");

    expect(style?.textContent).toContain(`[${LABEL}]:hover::after`);
    expect(style?.textContent).toContain("attr(data-mt-full)");
  });

  it("removes the labels and the style when it stops", async () => {
    const column = addMessage(ROW);
    mount(sentForEach);
    await vi.advanceTimersByTimeAsync(0);

    stop();

    expect(column.hasAttribute(LABEL)).toBe(false);
    expect(column.hasAttribute("data-mt-full")).toBe(false);
    expect(column.hasAttribute("data-mt-role")).toBe(false);
    expect(document.head.querySelector("style[data-message-times]")).toBeNull();
  });

  it("does not label or ask after it stops", async () => {
    const fetchTimes = vi.fn<FetchTimes>(sentForEach);
    mount(fetchTimes);
    await vi.advanceTimersByTimeAsync(0);
    stop();

    const column = addMessage(ROW);
    await vi.advanceTimersByTimeAsync(10_000);

    expect(fetchTimes).not.toHaveBeenCalled();
    expect(column.hasAttribute(LABEL)).toBe(false);
  });
});
