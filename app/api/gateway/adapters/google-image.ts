import { GEMINI_BASE_URL } from "@/app/constant";

import {
  GatewayAdapterContext,
  copyResponseHeaders,
  gatewayJsonError,
  normalizeBaseUrl,
} from "./types";

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

function imageDataFromGoogle(json: any) {
  const parts = Array.isArray(json?.candidates)
    ? json.candidates.flatMap((candidate: any) =>
        Array.isArray(candidate?.content?.parts) ? candidate.content.parts : [],
      )
    : [];

  const imageData = parts
    .map((part: any) => part?.inlineData?.data ?? part?.inline_data?.data)
    .filter(
      (data: unknown): data is string => typeof data === "string" && !!data,
    );

  return imageData.map((b64_json: string) => ({ b64_json }));
}

function dataUrlToGoogleInlineData(imageUrl: string) {
  const match = imageUrl.match(
    /^data:(image\/(?:png|jpeg|webp));base64,([a-z0-9+/=]+)$/i,
  );
  if (!match) return undefined;

  return {
    inline_data: {
      mime_type: match[1].toLowerCase(),
      data: match[2],
    },
  };
}

export async function callGoogleImage(
  ctx: GatewayAdapterContext,
): Promise<Response> {
  const { prompt, imageUrls } = extractPayload(ctx.bodyText);
  if (!prompt) {
    return gatewayJsonError(400, "image prompt is required");
  }

  const referenceImages = imageUrls
    .map(dataUrlToGoogleInlineData)
    .filter(
      (image): image is { inline_data: { mime_type: string; data: string } } =>
        !!image,
    );
  if (imageUrls.length > 0 && referenceImages.length !== imageUrls.length) {
    return gatewayJsonError(400, "valid reference image data URL is required");
  }
  const parts = [{ text: prompt }, ...referenceImages];

  const baseUrl = googleBaseRoot(ctx.credential.baseUrl);
  const res = await fetch(
    `${baseUrl}/v1/models/${encodeURIComponent(
      ctx.model.model,
    )}:generateContent`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": ctx.credential.apiKey,
      },
      body: JSON.stringify({
        contents: [
          {
            parts,
          },
        ],
        generationConfig: {
          responseModalities: ["IMAGE"],
        },
      }),
    },
  );

  if (!res.ok) {
    return new Response(res.body, {
      status: res.status,
      statusText: res.statusText,
      headers: copyResponseHeaders(res),
    });
  }

  const json = await res.json();
  const data = imageDataFromGoogle(json);
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
