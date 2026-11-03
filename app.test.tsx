// @vitest-environment jsdom
import { loadPluginApp, mountPluginContentScripts } from "@get-bb/plugin-sdk/testing/app";
import { afterEach, describe, expect, it, vi } from "vitest";

const ROW = "thr_a:user-seed:1";
const AT = Date.parse("2026-10-30T14:00:00Z");

function addMessage(rowId: string): HTMLElement {
  const row = document.createElement("div");
  row.setAttribute("data-timeline-row-id", rowId);
  const column = document.createElement("div");
  column.setAttribute("data-message-column", "");
  row.appendChild(column);
  document.body.appendChild(row);
  return column;
}

function respondWith(body: unknown, status = 200) {
  return vi.fn(async () => new Response(JSON.stringify(body), { status }));
}

async function mount() {
  const app = await loadPluginApp(() => import("./app"));
  return mountPluginContentScripts(app, { pluginId: "message-times" });
}

afterEach(() => {
  document.head.innerHTML = "";
  document.body.innerHTML = "";
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("message times content script", () => {
  it("posts the row ids of each thread to the plugin rpc", async () => {
    addMessage(ROW);
    const fetch = respondWith({ ok: true, result: { times: [] } });
    vi.stubGlobal("fetch", fetch);

    const scripts = await mount();

    await vi.waitFor(() => expect(fetch).toHaveBeenCalled());
    const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("/api/v1/plugins/message-times/rpc/messageTimes");
    expect(init.method).toBe("POST");
    expect(JSON.parse(String(init.body))).toEqual({ threadId: "thr_a", rowIds: [ROW] });
    await scripts.lifecycle.dispose();
  });

  it("labels the message with the time from the rpc", async () => {
    const column = addMessage(ROW);
    vi.stubGlobal(
      "fetch",
      respondWith({
        ok: true,
        result: { times: [{ rowId: ROW, role: "user", kind: "sent", at: AT, final: true }] },
      }),
    );

    const scripts = await mount();

    await vi.waitFor(() => expect(column.getAttribute("data-mt-label")).toMatch(/^Sent /));
    await scripts.lifecycle.dispose();
    expect(column.hasAttribute("data-mt-label")).toBe(false);
  });

  it("reports an rpc error as a failed request", async () => {
    const column = addMessage(ROW);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.stubGlobal("fetch", respondWith({ ok: false, error: { code: "x", message: "broken" } }, 500));

    const scripts = await mount();

    await vi.waitFor(() => expect(warn).toHaveBeenCalled());
    expect(column.hasAttribute("data-mt-label")).toBe(false);
    await scripts.lifecycle.dispose();
  });
});
