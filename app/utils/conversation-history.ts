import type { RequestMessage } from "../client/api";

// Preserve complete recent turns; only older, contiguous messages can be summarized.
export function summaryBoundary(
  messages: RequestMessage[],
  start: number,
  recentTurns = 10,
): number {
  let turns = 0;
  for (let index = messages.length - 1; index >= start; index--) {
    if (messages[index].role === "user" && ++turns === recentTurns)
      return index;
  }
  return start;
}

export function historyStart(
  clearIndex: number,
  summaryIndex: number,
  hasSummary: boolean,
  replay: boolean,
): number {
  return Math.max(clearIndex, hasSummary && !replay ? summaryIndex : 0);
}
