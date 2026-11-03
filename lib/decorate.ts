import { formatFull, formatLabel } from "./format";
import { MAX_ROW_IDS, type MessageTime } from "./message-times";

export type FetchTimes = (threadId: string, rowIds: string[]) => Promise<MessageTime[]>;

export interface MountOptions {
  signal: AbortSignal;
  fetchTimes: FetchTimes;
  locale?: string;
}

const MESSAGE_SELECTOR = "[data-message-column]";
const ROW_ATTR = "data-timeline-row-id";
const LABEL_ATTR = "data-mt-label";
const FULL_ATTR = "data-mt-full";
const ROLE_ATTR = "data-mt-role";
const THREAD_ID = /^thr_[A-Za-z0-9_-]{1,64}$/;

const POLL_MS = 3_000;
const SCAN_DELAY_MS = 100;
const MAX_MISS_WAIT_MS = 5 * 60_000;

// The label is a pseudo-element, so bb's own DOM does not change and copied text stays clean.
const STYLE = `
[${LABEL_ATTR}]::after {
  content: attr(${LABEL_ATTR});
  display: block;
  margin-top: 2px;
  font-size: 11px;
  line-height: 16px;
  font-variant-numeric: tabular-nums;
  color: var(--muted-foreground, #888);
  white-space: nowrap;
  pointer-events: none;
  user-select: none;
  -webkit-user-select: none;
}
[${LABEL_ATTR}]:hover::after { content: attr(${FULL_ATTR}); }
[${ROLE_ATTR}="user"]::after { text-align: right; }
`;

interface Entry {
  time: MessageTime | null;
  checkedAt: number;
  /** The number of requests in a row that did not return this row. */
  misses: number;
}

function threadIdOf(rowId: string): string | null {
  const prefix = rowId.slice(0, Math.max(0, rowId.indexOf(":")));
  return THREAD_ID.test(prefix) ? prefix : null;
}

function isDue(entry: Entry | undefined, now: number): boolean {
  if (!entry) return true;
  if (entry.time?.final) return false;
  const wait = entry.time
    ? POLL_MS
    : Math.min(POLL_MS * 2 ** Math.max(0, entry.misses - 1), MAX_MISS_WAIT_MS);
  return now - entry.checkedAt >= wait;
}

function setAttr(element: Element, name: string, value: string): void {
  if (element.getAttribute(name) !== value) element.setAttribute(name, value);
}

function clear(element: Element): void {
  element.removeAttribute(LABEL_ATTR);
  element.removeAttribute(FULL_ATTR);
  element.removeAttribute(ROLE_ATTR);
}

/** Labels each chat message with its time. Returns the disposer. */
export function mountMessageTimes({ signal, fetchTimes, locale }: MountOptions): () => void {
  const entries = new Map<string, Entry>();
  const inFlight = new Set<string>();
  let scanTimer: ReturnType<typeof setTimeout> | undefined;

  const style = document.createElement("style");
  style.setAttribute("data-message-times", "");
  style.textContent = STYLE;
  document.head.appendChild(style);

  const record = (rowIds: readonly string[], times: readonly MessageTime[]) => {
    const byId = new Map(times.map((time) => [time.rowId, time]));
    const checkedAt = Date.now();
    for (const rowId of rowIds) {
      const time = byId.get(rowId);
      const previous = entries.get(rowId);
      entries.set(
        rowId,
        time
          ? { time, checkedAt, misses: 0 }
          : { time: previous?.time ?? null, checkedAt, misses: (previous?.misses ?? 0) + 1 },
      );
    }
  };

  const load = async (threadId: string, rowIds: string[]) => {
    inFlight.add(threadId);
    try {
      const times = await fetchTimes(threadId, rowIds);
      if (!signal.aborted) record(rowIds, times);
    } catch (error) {
      if (signal.aborted) return;
      console.warn("[message-times] could not load message times", error);
      record(rowIds, []);
    } finally {
      inFlight.delete(threadId);
      scan();
    }
  };

  const scan = () => {
    if (signal.aborted) return;
    const now = Date.now();
    const nowDate = new Date(now);
    const due = new Map<string, Set<string>>();

    for (const column of document.querySelectorAll(MESSAGE_SELECTOR)) {
      const rowId = column.closest(`[${ROW_ATTR}]`)?.getAttribute(ROW_ATTR) ?? "";
      const threadId = threadIdOf(rowId);
      if (!threadId) {
        clear(column);
        continue;
      }
      const entry = entries.get(rowId);
      if (entry?.time) {
        setAttr(column, LABEL_ATTR, formatLabel(entry.time, nowDate, locale));
        setAttr(column, FULL_ATTR, formatFull(entry.time, locale));
        setAttr(column, ROLE_ATTR, entry.time.role);
      } else {
        clear(column);
      }
      if (!inFlight.has(threadId) && isDue(entry, now)) {
        const rowIds = due.get(threadId) ?? new Set<string>();
        rowIds.add(rowId);
        due.set(threadId, rowIds);
      }
    }

    // The newest messages are last on the page and matter most.
    for (const [threadId, rowIds] of due) void load(threadId, [...rowIds].slice(-MAX_ROW_IDS));
  };

  function scheduleScan() {
    if (scanTimer === undefined) {
      scanTimer = setTimeout(() => {
        scanTimer = undefined;
        scan();
      }, SCAN_DELAY_MS);
    }
  }

  // Only added and removed nodes are watched, so the attribute writes of a scan do not start a new scan.
  const observer = new MutationObserver(scheduleScan);
  observer.observe(document.body, { childList: true, subtree: true });
  const poll = setInterval(scan, POLL_MS);
  scan();

  return () => {
    observer.disconnect();
    clearInterval(poll);
    if (scanTimer !== undefined) clearTimeout(scanTimer);
    for (const element of document.querySelectorAll(`[${LABEL_ATTR}], [${ROLE_ATTR}]`)) clear(element);
    style.remove();
  };
}
