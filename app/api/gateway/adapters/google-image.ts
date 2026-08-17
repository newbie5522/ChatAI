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

function dataUrlToInlineData(imageUrl: string):
  | { mimeType: string; data: string }
  | undefined {
  const match = imageUrl.match(
    /^data:(image\/(?:png|jpeg|webp));base64,([a-z0-9+/=]+)$/i,
  );
  if (!match) return undefined;

  return {
    mimeType: match[1].toLowerCase(),
    data: match[2],
  };
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

interface GeminiContentPart {
  text?: string;
  inlineData?: {
    mimeType: string;
    data: string;
  };
}

interface GeminiGenerateContentResponse {
  candidates?: Array<{
    content?: {
      parts?: GeminiContentPart[];
    };
    finishReason?: string;
  }>;
  error?: Record<string, unknown>;
}

function findImagePart(json: GeminiGenerateContentResponse) {
  return json.candidates?.[0]?.content?.parts?.find((part) => part.inlineData);
}

function findTextPart(json: GeminiGenerateContentResponse) {
  return json.candidates?.[0]?.content?.parts?.find(
    (part) => typeof part.text === "string" && part.text.trim(),
  );
}

function isGoogleOfficialHost(baseUrl: string) {
  try {
    const host = new URL(baseUrl).hostname.toLowerCase();
    return (
      host === "generativelanguage.googleapis.com" ||
      host.endsWith(".googleapis.com")
    );
  } catch {
    return false;
  }
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

async function callGeminiNativeImage(
  ctx: GatewayAdapterContext,
  baseUrl: string,
) {
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

  const parts: GeminiContentPart[] = [];
  for (const image of referenceImages) {
    parts.push({
      inlineData: {
        mimeType: image.mime_type,
        data: image.data,
      },
    });
  }
  parts.push({ text: prompt });

  const model = ctx.model.model;
  const upstreamUrl = `${baseUrl}/v1beta/models/${model}:generateContent`;

  const res = await fetch(upstreamUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-goog-api-key": ctx.credential.apiKey,
    },
    body: JSON.stringify({
      contents: [{ role: "user", parts }],
      generationConfig: {
        responseModalities: ["TEXT", "IMAGE"],
      },
    }),
  });

  if (!res.ok) {
    return gatewayJsonError(res.status, await googleErrorMessage(res));
  }

  const json = (await res.json()) as GeminiGenerateContentResponse;
  const imagePart = findImagePart(json);
  if (!imagePart?.inlineData?.data) {
    return gatewayJsonError(
      502,
      "google image response did not include image data",
    );
  }

  const textPart = findTextPart(json);
  const mimeType = imagePart.inlineData.mimeType || "image/png";
  const b64_json = imagePart.inlineData.data;
  const url = `data:${mimeType};base64,${b64_json}`;

  return Response.json(
    {
      created: Math.floor(Date.now() / 1000),
      data: [
        {
          url,
          b64_json,
          revised_prompt: textPart?.text || prompt,
        },
      ],
    },
    { status: 200 },
  );
}

async function callOpenAICompatibleImage(
  ctx: GatewayAdapterContext,
  baseUrl: string,
) {
  const path = "images/generations";
  const res = await fetch(`${baseUrl}/${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${ctx.credential.apiKey}`,
    },
    body: ctx.bodyText,
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "unknown");
    return gatewayJsonError(
      res.status,
      `Google-compatible image error: ${sanitizeGoogleError(text)}`,
    );
  }

  return new Response(res.body, {
    status: res.status,
    statusText: res.statusText,
    headers: {
      "Content-Type": res.headers.get("Content-Type") || "application/json",
    },
  });
}

export async function callGoogleImage(
  ctx: GatewayAdapterContext,
): Promise<Response> {
  const baseUrl = googleBaseRoot(ctx.credential.baseUrl);

  try {
    if (isGoogleOfficialHost(baseUrl)) {
      return await callGeminiNativeImage(ctx, baseUrl);
    }
    return await callOpenAICompatibleImage(ctx, baseUrl);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "google image request failed";
    return gatewayJsonError(502, sanitizeGoogleError(message));
  }
}
