import type { RequestMessage } from "../client/api";
import { estimateTokenLength } from "./token";

// Batch complete turns; never advance the coverage marker past unprocessed text.
export function summaryBatchEnd(
  messages: RequestMessage[],
  start: number,
  end: number,
  tokenTarget = 12000,
): number {
  let tokens = 0;
  for (let i = start; i < end; i++) {
    if (i > start && messages[i].role === "user" && tokens >= tokenTarget)
      return i;
    const content = messages[i].content;
    tokens += estimateTokenLength(
      typeof content === "string"
        ? content
        : content.map((part) => part.text ?? "").join("\n"),
    );
  }
  return end;
}

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
