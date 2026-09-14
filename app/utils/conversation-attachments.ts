import type { StoredAttachmentMetadata } from "../types/attachment";

type AttachmentMessage = {
  role: string;
  attachments?: StoredAttachmentMetadata[];
};

// Explicit uploads win; otherwise resolve named documents or the last document group.
export function conversationAttachments(
  messages: AttachmentMessage[],
  current: StoredAttachmentMetadata[],
  query: string,
): StoredAttachmentMetadata[] {
  const documents = (items: StoredAttachmentMetadata[]) =>
    items.filter((item) => item.kind !== "image");
  const uploaded = documents(current);
  if (uploaded.length) return uploaded;
  const groups = messages
    .filter((message) => message.role === "user")
    .map((message) => documents(message.attachments ?? []))
    .filter((items) => items.length > 0)
    .reverse();
  const named = groups
    .flat()
    .filter((item) => query.toLowerCase().includes(item.name.toLowerCase()));
  const result = named.length ? named : groups[0] ?? [];
  const unique = new Map<string, StoredAttachmentMetadata>();
  for (const item of result)
    if (!unique.has(item.name)) unique.set(item.name, item);
  return [...unique.values()];
}
