import {
  GatewayAdapterContext,
  copyResponseHeaders,
  gatewayJsonError,
  normalizeBaseUrl,
} from "./types";

const OPENAI_FALLBACK_BASE = "https://api.openai.com/v1";

function textFromContent(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";

  return content
    .map((part) => {
      if (typeof part === "string") return part;
      if (part && typeof part === "object") {
        const item = part as { type?: string; text?: unknown };
        if (item.type && item.type !== "text") return "";
        return typeof item.text === "string" ? item.text : "";
      }
      return "";
    })
    .filter(Boolean)
    .join("\n");
}

function imageUrlsFromContent(content: unknown): string[] {
  if (!Array.isArray(content)) return [];

  return content
    .map((part) => {
      if (!part || typeof part !== "object") return "";
      const item = part as { type?: string; image_url?: unknown };
      if (item.type !== "image_url") return "";
      const imageUrl = item.image_url as { url?: unknown } | undefined;
      return typeof imageUrl?.url === "string" ? imageUrl.url : "";
    })
    .filter(Boolean);
}

function promptFromMessages(messages: unknown) {
  if (!Array.isArray(messages)) return "";

  const userMessages = messages
    .filter(
      (message) =>
        message &&
        typeof message === "object" &&
        (message as { role?: string }).role === "user",
    )
    .map((message) =>
      textFromContent((message as { content?: unknown }).content),
    )
    .filter(Boolean);

  return userMessages.at(-1) ?? "";
}

function imageUrlsFromMessages(messages: unknown) {
  if (!Array.isArray(messages)) return [];

  return messages.flatMap((message) =>
    message && typeof message === "object"
      ? imageUrlsFromContent((message as { content?: unknown }).content)
      : [],
  );
}

function extractImageUrls(body: Record<string, unknown>) {
  const directUrls = Array.isArray(body.image_urls)
    ? body.image_urls.filter((url): url is string => typeof url === "string")
    : [];
  return directUrls.length > 0
    ? directUrls
    : imageUrlsFromMessages(body.messages);
}

function extractPayload(bodyText?: string) {
  if (!bodyText) return { prompt: "", imageUrls: [] };

  try {
    const body = JSON.parse(bodyText) as Record<string, unknown>;
    const prompt =
      textFromContent(body.prompt).trim() ||
      textFromContent(body.input).trim() ||
      promptFromMessages(body.messages).trim();
    return { prompt, imageUrls: extractImageUrls(body) };
  } catch {
    return { prompt: "", imageUrls: [] };
  }
}

function normalizedImageData(json: any) {
  const data = Array.isArray(json?.data)
    ? json.data
        .map((item: any) => {
          const b64_json = item?.b64_json;
          const url = item?.url;
          if (typeof b64_json === "string" && b64_json) return { b64_json };
          if (typeof url === "string" && url) return { url };
          return undefined;
        })
        .filter(Boolean)
    : [];

  return {
    created: json?.created ?? Math.floor(Date.now() / 1000),
    data,
  };
}

function referenceImageFromDataUrl(imageUrl: string, index: number) {
  const match = imageUrl.match(
    /^data:(image\/(?:png|jpeg|webp));base64,([a-z0-9+/=]+)$/i,
  );
  if (!match) return undefined;

  const mimeType = match[1].toLowerCase();
  const extension = mimeType === "image/jpeg" ? "jpg" : mimeType.split("/")[1];
  return {
    blob: new Blob([Buffer.from(match[2], "base64")], { type: mimeType }),
    filename: `reference-${index + 1}.${extension}`,
  };
}

export async function callOpenAIImages(
  ctx: GatewayAdapterContext,
): Promise<Response> {
  const { prompt, imageUrls } = extractPayload(ctx.bodyText);
  if (!prompt) {
    return gatewayJsonError(400, "image prompt is required");
  }

  const baseUrl = normalizeBaseUrl(ctx.credential.baseUrl, OPENAI_FALLBACK_BASE);
  const headers = {
    Authorization: `Bearer ${ctx.credential.apiKey}`,
    ...(ctx.credential.orgId
      ? { "OpenAI-Organization": ctx.credential.orgId }
      : {}),
  };
  const referenceImages = imageUrls
    .map(referenceImageFromDataUrl)
    .filter((image): image is { blob: Blob; filename: string } => !!image);
  if (imageUrls.length > 0 && referenceImages.length !== imageUrls.length) {
    return gatewayJsonError(400, "valid reference image data URL is required");
  }
  const res =
    referenceImages.length > 0
      ? await fetch(`${baseUrl}/images/edits`, {
          method: "POST",
          headers,
          body: (() => {
            const formData = new FormData();
            formData.append("model", ctx.model.model);
            formData.append("prompt", prompt);
            formData.append("n", "1");
            formData.append("size", "1024x1024");
            referenceImages.forEach((image) => {
              formData.append("image", image.blob, image.filename);
            });
            return formData;
          })(),
        })
      : await fetch(`${baseUrl}/images/generations`, {
          method: "POST",
          headers: {
            ...headers,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            model: ctx.model.model,
            prompt,
            n: 1,
            size: "1024x1024",
          }),
        });

  if (!res.ok) {
    return new Response(res.body, {
      status: res.status,
      statusText: res.statusText,
      headers: copyResponseHeaders(res),
    });
  }

  const json = await res.json();
  return Response.json(normalizedImageData(json), { status: 200 });
}
