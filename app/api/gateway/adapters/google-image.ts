import { GEMINI_BASE_URL } from "@/app/constant";

import {
  GatewayAdapterContext,
  gatewayJsonError,
  normalizeBaseUrl,
} from "./types";

interface InteractionImageBlock {
  type: "image";
  data: string;
  mime_type: string;
}

function textFromContent(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";

  return content
    .map((part) => {
      if (typeof part === "string") return part;
      if (part && typeof part === "object") {
        const item = part as { text?: unknown };
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

function promptFromContents(contents: unknown) {
  if (!Array.isArray(contents)) return "";

  const textItems = contents
    .filter(
      (content) =>
        content &&
        typeof content === "object" &&
        (content as { role?: string }).role !== "model",
    )
    .map((content) => textFromContent((content as { parts?: unknown }).parts))
    .filter(Boolean);

  return textItems.at(-1) ?? "";
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
      promptFromMessages(body.messages).trim() ||
      promptFromContents(body.contents).trim();
    return { prompt, imageUrls: extractImageUrls(body) };
  } catch {
    return { prompt: "", imageUrls: [] };
  }
}

function googleBaseRoot(baseUrl?: string) {
  return normalizeBaseUrl(baseUrl, GEMINI_BASE_URL).replace(
    /\/v1(?:beta)?$/,
    "",
  );
}

function objectValue(value: unknown) {
  return value && typeof value === "object"
    ? (value as Record<string, unknown>)
    : undefined;
}

function stringValue(value: unknown) {
  return typeof value === "string" && value.trim() ? value : undefined;
}

function dataUrlToInteractionImage(imageUrl: string) {
  const match = imageUrl.match(
    /^data:(image\/(?:png|jpeg|webp));base64,([a-z0-9+/=]+)$/i,
  );
  if (!match) return undefined;

  return {
    type: "image" as const,
    data: match[2],
    mime_type: match[1].toLowerCase(),
  };
}

function collectImageData(value: unknown, output: Set<string>) {
  const item = objectValue(value);
  if (!item) return;

  const data = stringValue(item.data);
  const mimeType = stringValue(item.mime_type) ?? stringValue(item.mimeType);
  if (item.type === "image" && data) {
    output.add(data);
  } else if (data && mimeType?.startsWith("image/")) {
    output.add(data);
  }

  const outputImage = objectValue(item.output_image);
  const outputImageData = stringValue(outputImage?.data);
  if (outputImageData) {
    output.add(outputImageData);
  }

  const steps = Array.isArray(item.steps) ? item.steps : [];
  steps.forEach((step) => {
    const stepObject = objectValue(step);
    if (!stepObject) return;
    for (const field of ["content", "summary"]) {
      const blocks = stepObject[field];
      if (Array.isArray(blocks)) {
        blocks.forEach((block) => collectImageData(block, output));
      }
    }
  });

  for (const field of ["output", "outputs", "output_images", "images"]) {
    const nested = item[field];
    if (Array.isArray(nested)) {
      nested.forEach((block) => collectImageData(block, output));
    } else {
      collectImageData(nested, output);
    }
  }
}

function extractInteractionImages(json: unknown) {
  const imageData = new Set<string>();
  collectImageData(json, imageData);

  return Array.from(imageData).map((b64_json) => ({ b64_json }));
}

function sanitizeGoogleError(message: string) {
  return message
    .replace(/data:image\/[a-z0-9.+-]+;base64,[a-z0-9+/=]+/gi, "[image]")
    .replace(/\bAIza[0-9A-Za-z_-]{20,}\b/g, "[redacted]")
    .replace(/\bBearer\s+[A-Za-z0-9._~+/-]+=*/gi, "Bearer [redacted]")
    .replace(/\b[A-Za-z0-9+/]{120,}={0,2}\b/g, "[image]")
    .trim()
    .slice(0, 600);
}

function errorMessageFromDetails(value: unknown): string | undefined {
  const item = objectValue(value);
  if (!item) return stringValue(value);

  for (const key of ["message", "detail", "reason"]) {
    const message = stringValue(item[key]);
    if (message) return message;
  }

  const details = item.details;
  if (Array.isArray(details)) {
    for (const detail of details) {
      const message = errorMessageFromDetails(detail);
      if (message) return message;
    }
  } else {
    const message = errorMessageFromDetails(details);
    if (message) return message;
  }

  return undefined;
}

async function googleErrorMessage(res: Response) {
  const fallback = `google image request failed (${res.status})`;
  const text = await res.text();
  if (!text) return fallback;

  try {
    const json = JSON.parse(text) as Record<string, unknown>;
    const error = objectValue(json.error);
    const message =
      stringValue(error?.message) ??
      stringValue(json.message) ??
      errorMessageFromDetails(json.details) ??
      errorMessageFromDetails(error?.details);

    return message ? sanitizeGoogleError(message) : fallback;
  } catch {
    return sanitizeGoogleError(text) || fallback;
  }
}

export async function callGoogleImage(
  ctx: GatewayAdapterContext,
): Promise<Response> {
  const { prompt, imageUrls } = extractPayload(ctx.bodyText);
  if (!prompt) {
    return gatewayJsonError(400, "image prompt is required");
  }

  const referenceImages = imageUrls
    .map(dataUrlToInteractionImage)
    .filter((image): image is InteractionImageBlock => !!image);
  if (imageUrls.length > 0 && referenceImages.length !== imageUrls.length) {
    return gatewayJsonError(400, "valid reference image data URL is required");
  }
  const input =
    referenceImages.length > 0
      ? [{ type: "text", text: prompt }, ...referenceImages]
      : prompt;

  const baseUrl = googleBaseRoot(ctx.credential.baseUrl);
  const res = await fetch(`${baseUrl}/v1beta/interactions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-goog-api-key": ctx.credential.apiKey,
    },
    body: JSON.stringify({
      model: ctx.model.model,
      input,
      response_format: {
        type: "image",
      },
    }),
  });

  if (!res.ok) {
    return gatewayJsonError(res.status, await googleErrorMessage(res));
  }

  const json = await res.json();
  const data = extractInteractionImages(json);
  if (data.length === 0) {
    return gatewayJsonError(
      502,
      "google image response did not include image data",
    );
  }

  return Response.json(
    {
      created: Math.floor(Date.now() / 1000),
      data,
    },
    { status: 200 },
  );
}
