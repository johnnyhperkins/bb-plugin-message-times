import type { BbPluginApi } from "@get-bb/plugin-sdk";
import {
  computeMessageTimes,
  type ConversationRow,
  type MessageTime,
  type TurnEnd,
} from "./message-times";

type Threads = Pick<BbPluginApi["sdk"]["threads"], "timeline" | "events">;

const MAX_TIMELINE_PAGES = 12;
const MAX_EVENT_PAGES = 10;
const EVENT_PAGE_SIZE = 50;

interface RawRow {
  kind?: unknown;
  id?: unknown;
  role?: unknown;
  turnId?: unknown;
  createdAt?: unknown;
  children?: unknown;
}

function collectRows(rows: readonly unknown[], nested: boolean, into: ConversationRow[]): void {
  for (const value of rows) {
    if (!value || typeof value !== "object") continue;
    const row = value as RawRow;
    if (
      row.kind === "conversation" &&
      typeof row.id === "string" &&
      (row.role === "user" || row.role === "assistant") &&
      typeof row.createdAt === "number"
    ) {
      into.push({
        id: row.id,
        role: row.role,
        turnId: typeof row.turnId === "string" ? row.turnId : null,
        createdAt: row.createdAt,
        nested,
      });
    }
    if (Array.isArray(row.children)) {
      // The children of a turn row are the messages of that turn. The children of other rows are nested work.
      collectRows(row.children, nested || row.kind !== "turn", into);
    }
  }
}

async function readTurnEnds(
  threads: Threads,
  threadId: string,
  claudeRows: readonly ConversationRow[],
): Promise<TurnEnd[]> {
  const missing = new Set(claudeRows.flatMap((row) => (row.turnId === null ? [] : [row.turnId])));
  // A turn ends after each of its messages, so an event older than the oldest message cannot end a wanted turn.
  const oldest = Math.min(...claudeRows.map((row) => row.createdAt));
  const ends: TurnEnd[] = [];
  let beforeSeq: string | undefined;

  for (let page = 0; page < MAX_EVENT_PAGES && missing.size > 0; page += 1) {
    const events = await threads.events.list({
      threadId,
      types: ["turn/completed"],
      order: "desc",
      limit: String(EVENT_PAGE_SIZE),
      ...(beforeSeq ? { beforeSeq } : {}),
    });
    for (const event of events) {
      if (event.type !== "turn/completed" || event.scope.kind !== "turn") continue;
      if (missing.delete(event.scope.turnId)) {
        ends.push({ turnId: event.scope.turnId, endedAt: event.createdAt, status: event.data.status });
      }
    }
    const last = events.at(-1);
    if (!last || events.length < EVENT_PAGE_SIZE || last.createdAt < oldest) break;
    beforeSeq = String(last.seq);
  }
  return ends;
}

/** Reads the timeline newest page first until it finds each requested row. */
export async function readMessageTimes(
  threads: Threads,
  threadId: string,
  rowIds: readonly string[],
): Promise<MessageTime[]> {
  const wanted = new Set(rowIds);
  const found = new Set<string>();
  const pagesOldestFirst: ConversationRow[][] = [];
  let cursor: { anchorSeq: number; anchorId: string } | null = null;

  for (let page = 0; page < MAX_TIMELINE_PAGES; page += 1) {
    const timeline: Awaited<ReturnType<Threads["timeline"]>> = await threads.timeline({
      threadId,
      deferContent: "true",
      includeNestedRows: "true",
      ...(cursor ? { beforeAnchorSeq: String(cursor.anchorSeq), beforeAnchorId: cursor.anchorId } : {}),
    });
    const rows: ConversationRow[] = [];
    collectRows(timeline.rows, false, rows);
    pagesOldestFirst.unshift(rows);
    for (const row of rows) if (wanted.has(row.id)) found.add(row.id);
    cursor = timeline.timelinePage.olderCursor;
    if (found.size === wanted.size || !cursor) break;
  }

  const seen = new Set<string>();
  const rows = pagesOldestFirst.flat().filter((row) => !seen.has(row.id) && seen.add(row.id));
  const claudeRows = rows.filter(
    (row) => row.role === "assistant" && row.turnId !== null && wanted.has(row.id),
  );
  const turnEnds = claudeRows.length > 0 ? await readTurnEnds(threads, threadId, claudeRows) : [];
  return computeMessageTimes(rows, turnEnds).filter((time) => wanted.has(time.rowId));
}
