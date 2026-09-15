import {
  historyStart,
  summaryBoundary,
  summaryBatchEnd,
} from "../app/utils/conversation-history";
import type { RequestMessage } from "../app/client/api";

const messages: RequestMessage[] = Array.from({ length: 60 }, (_, i) => ({
  role: i % 2 === 0 ? "user" : "assistant",
  content: String(i),
}));
test("short conversations retain their first message without a summary", () => {
  expect(historyStart(0, 0, false, false)).toBe(0);
});

test("summary batches cover contiguous complete turns without losing intervening messages", () => {
  const end = summaryBoundary(messages, 0);
  let cursor = 0;
  const covered: RequestMessage[] = [];
  while (cursor < end) {
    const next = summaryBatchEnd(messages, cursor, end, 2);
    expect(next).toBeGreaterThan(cursor);
    expect(messages[next].role).toBe("user");
    covered.push(...messages.slice(cursor, next));
    cursor = next;
  }
  expect([...covered, ...messages.slice(end)]).toEqual(messages);
});
test("summary and raw history cover all messages exactly once", () => {
  const end = summaryBoundary(messages, 0);
  expect(end).toBe(40);
  expect([
    ...messages.slice(0, end),
    ...messages.slice(historyStart(0, end, true, false)),
  ]).toEqual(messages);
});
test("summary respects complete turns and retains short histories", () => {
  expect(summaryBoundary(messages.slice(0, 12), 0)).toBe(0);
  expect(
    messages[
      summaryBoundary([...messages, { role: "assistant", content: "extra" }], 0)
    ].role,
  ).toBe("user");
});
test("replay ignores a summary that may contain future information", () => {
  expect(historyStart(0, 40, true, true)).toBe(0);
});
test("explicitly cleared context stays excluded", () => {
  expect(historyStart(12, 4, true, false)).toBe(12);
  expect(historyStart(12, 40, true, true)).toBe(12);
});
