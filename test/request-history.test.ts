import { prepareRequestHistory } from "../app/utils/request-history";
import type { RequestMessage } from "../app/client/api";

const history = (): RequestMessage[] =>
  Array.from({ length: 60 }, (_, i) => ({
    role: i % 2 ? "assistant" : "user",
    content: `${i}:` + "品牌要求".repeat(100),
  }));
test("short conversations do not make a background request", async () => {
  const messages = history().slice(0, 4);
  const summarize = jest.fn();
  expect(await prepareRequestHistory(messages, summarize)).toBe(messages);
  expect(summarize).not.toHaveBeenCalled();
});
test("preflight preserves system rules, recent ten turns and every older message in summary input", async () => {
  const messages = history();
  const original = JSON.stringify(messages);
  const system: RequestMessage = {
    role: "system",
    content: "Immutable system rule",
  };
  const summarize = jest.fn(
    async (_batch: RequestMessage[]) => "品牌约束和待办",
  );
  const prepared = await prepareRequestHistory(
    [system, ...messages],
    summarize,
  );
  expect(prepared[0]).toBe(system);
  expect(prepared.slice(-20)).toEqual(messages.slice(-20));
  expect(summarize.mock.calls.flatMap(([batch]) => batch)).toEqual(
    messages.slice(0, 40),
  );
  expect(JSON.stringify(messages)).toBe(original);
});
test.each(["reject", "empty", "long"])(
  "%s summary cannot silently replace original history",
  async (mode) => {
    const messages = history();
    const original = JSON.stringify(messages);
    await expect(
      prepareRequestHistory(messages, async (batch) => {
        if (mode === "reject") throw new Error("upstream unavailable");
        return mode === "empty" ? "" : batch.map((m) => m.content).join("");
      }),
    ).rejects.toThrow();
    expect(JSON.stringify(messages)).toBe(original);
  },
);
test("image history is never sent through text compaction", async () => {
  const messages = history();
  messages[0].content = [
    { type: "image_url", image_url: { url: "data:image/png;base64,AAAA" } },
  ];
  const summarize = jest.fn();
  expect(await prepareRequestHistory(messages, summarize)).toBe(messages);
  expect(summarize).not.toHaveBeenCalled();
});
test("oversized individual turns are preserved without cutting their contents", async () => {
  const messages = history();
  messages[0].content = "要求".repeat(20000);
  const summarize = jest.fn();
  expect(await prepareRequestHistory(messages, summarize)).toBe(messages);
  expect(summarize).not.toHaveBeenCalled();
});
