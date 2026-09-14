import { conversationAttachments } from "../app/utils/conversation-attachments";
import { toStoredAttachmentMetadata } from "../app/utils/attachments";
import type { StoredAttachmentMetadata } from "../app/types/attachment";

const doc = (name: string, id = name): StoredAttachmentMetadata => ({
  id,
  name,
  kind: "document",
  size: 1,
  mimeType: "text/plain",
  text: `source ${id}`,
});
test("direct text and analysis references survive message storage", () => {
  expect(toStoredAttachmentMetadata(doc("brief"))).toEqual(doc("brief"));
  expect(
    toStoredAttachmentMetadata({
      ...doc("report"),
      analysisId: "index",
      expiresAt: "later",
    }).analysisId,
  ).toBe("index");
});
test("follow-up reuses latest documents, with named older documents and new uploads taking precedence", () => {
  const first = doc("first.pdf");
  const latest = doc("latest.pdf");
  const messages = [
    { role: "user", attachments: [first] },
    { role: "user", attachments: [latest] },
  ];
  expect(conversationAttachments(messages, [], "继续分析")).toEqual([latest]);
  expect(
    conversationAttachments(messages, [], "比较 first.pdf 和 latest.pdf"),
  ).toEqual([latest, first]);
  expect(conversationAttachments(messages, [first], "继续分析")).toEqual([
    first,
  ]);
});
test("same-name uploads use latest source and images are not recalled as documents", () => {
  const old = doc("report", "old");
  const next = doc("report", "new");
  expect(
    conversationAttachments(
      [
        { role: "user", attachments: [old] },
        { role: "user", attachments: [next] },
      ],
      [],
      "report",
    ),
  ).toEqual([next]);
  expect(
    conversationAttachments(
      [{ role: "user", attachments: [{ ...old, kind: "image" }] }],
      [],
      "继续",
    ),
  ).toEqual([]);
});
