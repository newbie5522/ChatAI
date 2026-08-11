import {
  GatewayAdapterContext,
  copyResponseHeaders,
  gatewayJsonError,
  normalizeBaseUrl,
} from "./types";

const OPENAI_FALLBACK_BASE = "https://api.openai.com/v1";

const MAX_POLL_ATTEMPTS = 120;
const POLL_INTERVAL_MS = 3000;

function requestBody(bodyText?: string): Record<string, unknown> | undefined {
  if (!bodyText) return undefined;
  try {
    const value: unknown = JSON.parse(bodyText);
    return value && typeof value === "object"
      ? (value as Record<string, unknown>)
      : undefined;
  } catch {
    return undefined;
  }
}

function extractPrompt(body: Record<string, unknown>): string {
  const prompt = body.prompt;
  if (typeof prompt === "string" && prompt.trim()) return prompt.trim();

  const messages = body.messages;
  if (Array.isArray(messages)) {
    const lastUser = [...messages]
      .reverse()
      .find(
        (m) =>
          m && typeof m === "object" && (m as { role?: string }).role === "user",
      );
    if (lastUser) {
      const content = (lastUser as { content?: unknown }).content;
      if (typeof content === "string") return content.trim();
      if (Array.isArray(content)) {
        const textPart = content.find(
          (p) =>
            p && typeof p === "object" && (p as { type?: string }).type === "text",
        );
        if (textPart) {
          const text = (textPart as { text?: unknown }).text;
          if (typeof text === "string") return text.trim();
        }
      }
    }
  }
  return "";
}

function extractTaskId(json: unknown): string | undefined {
  if (!json || typeof json !== "object") return undefined;
  const obj = json as Record<string, unknown>;
  const id =
    obj.task_id ?? obj.id ?? obj.request_id ?? obj.requestId ?? obj.taskId;
  return typeof id === "string" ? id : undefined;
}

function isCompleted(json: unknown): boolean {
  if (!json || typeof json !== "object") return false;
  const obj = json as Record<string, unknown>;
  const status = String(obj.status ?? "").toLowerCase();
  return status === "completed" || status === "succeeded" || status === "success";
}

function isFailed(json: unknown): boolean {
  if (!json || typeof json !== "object") return false;
  const obj = json as Record<string, unknown>;
  const status = String(obj.status ?? "").toLowerCase();
  return status === "failed" || status === "error" || status === "canceled";
}

function extractVideoUrl(json: unknown): string | undefined {
  if (!json || typeof json !== "object") return undefined;
  const obj = json as Record<string, unknown>;

  if (typeof obj.video_url === "string") return obj.video_url;
  if (typeof obj.url === "string") return obj.url;

  const output = obj.output;
  if (output && typeof output === "object") {
    const out = output as Record<string, unknown>;
    if (typeof out.video_url === "string") return out.video_url;
    if (typeof out.url === "string") return out.url;
  }

  const data = obj.data;
  if (Array.isArray(data) && data.length > 0) {
    const first = data[0];
    if (first && typeof first === "object") {
      const item = first as Record<string, unknown>;
      if (typeof item.video_url === "string") return item.video_url;
      if (typeof item.url === "string") return item.url;
    }
  }

  return undefined;
}

export async function callOpenAICompatibleVideo(
  ctx: GatewayAdapterContext,
): Promise<Response> {
  const input = requestBody(ctx.bodyText);
  if (!input) {
    return gatewayJsonError(400, "invalid JSON request body");
  }

  const prompt = extractPrompt(input);
  if (!prompt) {
    return gatewayJsonError(400, "video prompt is required");
  }

  const baseUrl = normalizeBaseUrl(ctx.credential.baseUrl, OPENAI_FALLBACK_BASE);
  const model = ctx.model.model;
  const headers = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${ctx.credential.apiKey}`,
  };

  const submitBody: Record<string, unknown> = { model, prompt };
  for (const field of ["size", "quality", "duration", "aspect_ratio", "n"]) {
    if (input[field] !== undefined) {
      submitBody[field] = input[field];
    }
  }

  console.log(
    `[Video] model=${model} baseUrl=${baseUrl} prompt="${prompt.slice(0, 80)}"`,
  );

  const submitRes = await fetch(`${baseUrl}/videos/generations`, {
    method: "POST",
    headers,
    body: JSON.stringify(submitBody),
  });

  if (!submitRes.ok) {
    const errorText = await submitRes.clone().text();
    console.error(
      `[Video] submit error ${submitRes.status} ${submitRes.statusText} model=${model} body=${errorText.slice(0, 1000)}`,
    );
    return new Response(submitRes.body, {
      status: submitRes.status,
      statusText: submitRes.statusText,
      headers: copyResponseHeaders(submitRes),
    });
  }

  const submitJson = await submitRes.json().catch(() => ({}));

  // If the response already contains a video URL, return it directly
  const directUrl = extractVideoUrl(submitJson);
  if (directUrl) {
    return Response.json(
      { created: Math.floor(Date.now() / 1000), data: [{ url: directUrl }] },
      { status: 200 },
    );
  }

  // If the response is async (has a task ID), poll for completion
  const taskId = extractTaskId(submitJson);
  if (!taskId) {
    // No task ID and no video URL — return the response as-is
    return Response.json(submitJson, { status: 200 });
  }

  console.log(`[Video] async task started: ${taskId} model=${model}`);

  for (let attempt = 0; attempt < MAX_POLL_ATTEMPTS; attempt++) {
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));

    const pollRes = await fetch(`${baseUrl}/videos/${taskId}`, {
      method: "GET",
      headers,
    });

    if (!pollRes.ok) {
      console.error(
        `[Video] poll error ${pollRes.status} ${pollRes.statusText} task=${taskId}`,
      );
      continue;
    }

    const pollJson = await pollRes.json().catch(() => ({}));

    if (isFailed(pollJson)) {
      const errorMsg =
        (pollJson as Record<string, unknown>).error ?? "video generation failed";
      return gatewayJsonError(502, String(errorMsg));
    }

    if (isCompleted(pollJson)) {
      const videoUrl = extractVideoUrl(pollJson);
      if (videoUrl) {
        console.log(`[Video] task completed: ${taskId} model=${model}`);
        return Response.json(
          { created: Math.floor(Date.now() / 1000), data: [{ url: videoUrl }] },
          { status: 200 },
        );
      }
      return gatewayJsonError(502, "video generation completed but no URL found");
    }
  }

  return gatewayJsonError(504, "video generation timed out");
}
