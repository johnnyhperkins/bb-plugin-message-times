export type Role = "user" | "assistant";

export interface ConversationRow {
  id: string;
  role: Role;
  turnId: string | null;
  createdAt: number;
  /** A message inside a work row, such as a subagent message. */
  nested: boolean;
}

export type TurnEndStatus = "completed" | "interrupted" | "failed";

export interface TurnEnd {
  turnId: string;
  endedAt: number;
  status: TurnEndStatus;
}

export type MessageTimeKind = "sent" | "arrived" | "finished" | "stopped" | "failed";

export interface MessageTime {
  rowId: string;
  role: Role;
  kind: MessageTimeKind;
  at: number;
  /** False while the turn runs, because the time can still change. */
  final: boolean;
}

const END_KIND: Record<TurnEndStatus, MessageTimeKind> = {
  completed: "finished",
  interrupted: "stopped",
  failed: "failed",
};

/** Rows must be in timeline order, oldest first. */
export function computeMessageTimes(
  rows: readonly ConversationRow[],
  turnEnds: readonly TurnEnd[],
): MessageTime[] {
  const endByTurn = new Map(turnEnds.map((end) => [end.turnId, end]));
  const lastRowOfTurn = new Map<string, string>();
  for (const row of rows) {
    if (row.role === "assistant" && row.turnId !== null && !row.nested) {
      lastRowOfTurn.set(row.turnId, row.id);
    }
  }

  return rows.map((row): MessageTime => {
    const base = { rowId: row.id, role: row.role };
    if (row.role === "user") {
      return { ...base, kind: "sent", at: row.createdAt, final: true };
    }
    if (row.turnId === null) {
      return { ...base, kind: "arrived", at: row.createdAt, final: true };
    }
    const end = endByTurn.get(row.turnId);
    if (end && lastRowOfTurn.get(row.turnId) === row.id) {
      return { ...base, kind: END_KIND[end.status], at: end.endedAt, final: true };
    }
    return { ...base, kind: "arrived", at: row.createdAt, final: end !== undefined };
  });
}

/** The most row ids that one messageTimes call accepts. */
export const MAX_ROW_IDS = 200;
