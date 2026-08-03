import { GEMINI_BASE_URL } from "@/app/constant";

import {
  GatewayAdapterContext,
  copyResponseHeaders,
  gatewayJsonError,
  normalizeBaseUrl,
} from "./types";

function objectValue(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object"
    ? (value as Record<string, unknown>)
    : undefined;
}

function textFromContent(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .map((part) => {
      if (typeof part === "string") return part;
      const item = objectValue(part);
      return typeof item?.text === "string" ? item.text : "";
    })
    .filter(Boolean)
    .join("\n");
}

function promptFromMessages(messages: unknown) {
  if (!Array.isArray(messages)) return "";
  return (
    messages
      .filter((message) => objectValue(message)?.role === "user")
      .map((message) => textFromContent(objectValue(message)?.content))
      .filter(Boolean)
      .at(-1) ?? ""
  );
}

function extractRequest(bodyText?: string) {
  const images: Array<{ mimeType: string; data: string }> = [];
  if (!bodyText) return { prompt: "", images };
  try {
    const value: unknown = JSON.parse(bodyText);
    const body = objectValue(value) ?? {};
    const visit = (item: unknown) => {
      if (Array.isArray(item)) {
        item.forEach(visit);
        return;
      }
      const record = objectValue(item);
      if (!record) return;
      const imageUrl = objectValue(record.image_url);
      if (typeof imageUrl?.url === "string") {
        const match = imageUrl.url.match(
          /^data:(image\/(?:png|jpeg|webp));base64,([a-z0-9+/=]+)$/i,
        );
        if (match) images.push({ mimeType: match[1], data: match[2] });
      }
      Object.values(record).forEach(visit);
    };
    visit(body);
    return {
      prompt:
        textFromContent(body.prompt).trim() ||
        textFromContent(body.input).trim() ||
        promptFromMessages(body.messages).trim(),
      images,
    };
  } catch {
    return { prompt: "", images };
  }
}

function googleBaseRoot(baseUrl?: string) {
  return normalizeBaseUrl(baseUrl, GEMINI_BASE_URL).replace(
    /\/v1(?:beta)?$/,
    "",
  );
}

function imageDataFromGoogle(value: unknown) {
  const json = objectValue(value);
  const candidateValue = json?.candidates;
  const candidates = Array.isArray(candidateValue) ? candidateValue : [];
  const parts = candidates.flatMap((candidate) => {
    const content = objectValue(objectValue(candidate)?.content);
    const partValue = content?.parts;
    return Array.isArray(partValue) ? partValue : [];
  });
  return parts
    .map((part) => {
      const record = objectValue(part);
      return (
        objectValue(record?.inlineData)?.data ??
        objectValue(record?.inline_data)?.data
      );
    })
    .filter((data): data is string => typeof data === "string" && !!data)
    .map((b64_json) => ({ b64_json }));
}

export async function callGoogleImage(
  ctx: GatewayAdapterContext,
): Promise<Response> {
  const { prompt, images } = extractRequest(ctx.bodyText);
  if (!prompt) return gatewayJsonError(400, "image prompt is required");
  const baseUrl = googleBaseRoot(ctx.credential.baseUrl);
  const res = await fetch(
    `${baseUrl}/v1/models/${encodeURIComponent(
      ctx.model.model,
    )}:generateContent`,
    {
      method: "POST",
      signal: ctx.signal,
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": ctx.credential.apiKey,
      },
      body: JSON.stringify({
        contents: [
          {
            parts: [
              { text: prompt },
              ...images.map((image) => ({
                inlineData: {
                  mimeType: image.mimeType,
                  data: image.data,
                },
              })),
            ],
          },
        ],
        generationConfig: { responseModalities: ["IMAGE"] },
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
  const data = imageDataFromGoogle(await res.json());
  if (!data.length) {
    return gatewayJsonError(
      502,
      "google image response did not include image data",
    );
  }
  return Response.json(
    { created: Math.floor(Date.now() / 1000), data },
    { status: 200 },
  );
}
