import type { RequestMessage } from "../client/api";

function text(message: RequestMessage): string {
  return typeof message.content === "string"
    ? message.content
    : message.content
        .filter((part) => part.type === "text")
        .map((part) => part.text ?? "")
        .join("\n");
}

function images(message: RequestMessage): string[] {
  if (Array.isArray(message.content)) {
    return message.content.flatMap((part) =>
      part.type === "image_url" && part.image_url?.url
        ? [part.image_url.url]
        : [],
    );
  }
  if (message.role !== "assistant") return [];
  return Array.from(
    message.content.matchAll(/!\[[^\]]*\]\(([^\s)]+)\)/g),
    (match) => match[1],
  );
}

// Explicit new references start a new visual base. Otherwise continue the latest result.
export function buildImageConversation(messages: RequestMessage[]) {
  let lastUserIndex = messages.length - 1;
  while (lastUserIndex >= 0 && messages[lastUserIndex].role !== "user")
    lastUserIndex--;
  if (lastUserIndex < 0) return { prompt: "", imageUrls: [] as string[] };
  const current = messages[lastUserIndex];
  const explicit = images(current);
  let imageUrls = explicit;
  if (!imageUrls.length) {
    for (let i = lastUserIndex - 1; i >= 0; i--) {
      imageUrls = images(messages[i]);
      if (imageUrls.length) break;
    }
  }
  const history = messages
    .slice(0, lastUserIndex)
    .filter((message) => message.role === "user" || message.role === "system")
    .map(text)
    .filter(Boolean);
  const prompt = history.length
    ? `此前创作要求（如有冲突，以当前要求为准）：\n${history.join(
        "\n\n",
      )}\n\n当前要求：\n${text(current)}`
    : text(current);
  return { prompt, imageUrls: [...new Set(imageUrls)] };
}

export async function prepareImageConversation(messages: RequestMessage[]) {
  const context = buildImageConversation(messages);
  const imageUrls = await Promise.all(
    context.imageUrls.map(async (url) => {
      if (url.startsWith("data:image/")) return url;
      const response = await fetch(url, { signal: AbortSignal.timeout(30000) });
      if (!response.ok) throw new Error("参考图已不可用，请重新上传图片。");
      const blob = await response.blob();
      if (!/^image\/(png|jpeg|webp)$/.test(blob.type))
        throw new Error("参考图格式不支持，请使用 PNG、JPEG 或 WebP 图片。");
      return new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result));
        reader.onerror = () =>
          reject(new Error("参考图读取失败，请重新上传图片。"));
        reader.readAsDataURL(blob);
      });
    }),
  );
  return { ...context, imageUrls };
}
