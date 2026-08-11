import {
  GatewayAdapterContext,
  copyResponseHeaders,
  gatewayJsonError,
  normalizeBaseUrl,
} from "./types";

/**
 * OpenAI-compatible video adapter.
 *
 * Supports OpenRouter's async video generation API:
 *   POST {baseUrl}/videos         → submit job, returns { id }
 *   GET  {baseUrl}/videos/{id}    → poll status, returns { status, video/url }
 *
 * Also supports sync responses where the video URL is returned directly.
 */

const MAX_POLLS = 120; // 120 × 3s = 6 min max
const POLL_INTERVAL_MS = 3000;

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

function extractPrompt(body: unknown): string {
  if (!body || typeof body !== "object") return "";
  const obj = body as Record<string, unknown>;
  if (typeof obj.prompt === "string") return obj.prompt;
  const messages = obj.messages;
  if (Array.isArray(messages) && messages.length > 0) {
    const last = messages[messages.length - 1];
    if (last && typeof last === "object") {
      const content = (last as Record<string, unknown>).content;
      return textFromContent(content);
    }
  }
  return "";
}

function extractAspectRatio(body: unknown): string | undefined {
  if (!body || typeof body !== "object") return undefined;
  const obj = body as Record<string, unknown>;
  if (typeof obj.aspect_ratio === "string") return obj.aspect_ratio;
  if (typeof obj.size === "string") return obj.size;
  return undefined;
}

/** Try to extract a video URL from various response shapes. */
function extractVideoUrl(data: unknown): string | null {
  if (!data || typeof data !== "object") return null;
  const obj = data as Record<string, unknown>;

  // Direct: { video: { url } }
  if (obj.video && typeof obj.video === "object") {
    const url = (obj.video as Record<string, unknown>).url;
    if (typeof url === "string") return url;
  }
  // Direct: { url }
  if (typeof obj.url === "string") return obj.url;
  // OpenRouter: { output: { url } }
  if (obj.output && typeof obj.output === "object") {
    const url = (obj.output as Record<string, unknown>).url;
    if (typeof url === "string") return url;
  }
  // Array: { data: [{ url }] }
  if (Array.isArray(obj.data) && obj.data.length > 0) {
    const first = obj.data[0];
    if (first && typeof first === "object") {
      const url = (first as Record<string, unknown>).url;
      if (typeof url === "string") return url;
      const video = (first as Record<string, unknown>).video;
      if (video && typeof video === "object") {
        const vUrl = (video as Record<string, unknown>).url;
        if (typeof vUrl === "string") return vUrl;
      }
    }
  }
  return null;
}

/** Extract job/task ID from submission response. */
function extractJobId(data: unknown): string | null {
  if (!data || typeof data !== "object") return null;
  const obj = data as Record<string, unknown>;
  for (const key of ["id", "job_id", "task_id", "request_id"]) {
    if (typeof obj[key] === "string") return obj[key] as string;
  }
  if (obj.data && typeof obj.data === "object") {
    const inner = obj.data as Record<string, unknown>;
    for (const key of ["id", "job_id", "task_id"]) {
      if (typeof inner[key] === "string") return inner[key] as string;
    }
  }
  return null;
}

function isTerminalStatus(status: string): "completed" | "failed" | null {
  const s = status.toLowerCase();
  if (["completed", "succeeded", "success", "done"].includes(s))
    return "completed";
  if (["failed", "error", "canceled", "cancelled"].includes(s)) return "failed";
  return null;
}

export async function callOpenAICompatibleVideo(
  ctx: GatewayAdapterContext,
): Promise<Response> {
  const { credential, bodyText } = ctx;

  const baseUrl = normalizeBaseUrl(
    credential.baseUrl,
    "https://openrouter.ai/api/v1",
  );

  const body = bodyText ? JSON.parse(bodyText) : {};
  const prompt = extractPrompt(body);
  if (!prompt) {
    return gatewayJsonError(400, "视频生成需要提供提示词 (prompt)");
  }

  const aspectRatio = extractAspectRatio(body);
  const requestBody: Record<string, unknown> = {
    model: ctx.model.model,
    prompt,
    ...(aspectRatio && aspectRatio !== "auto"
      ? { aspect_ratio: aspectRatio }
      : {}),
  };

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${credential.apiKey}`,
  };
  if (process.env.OPENROUTER_REFERER) {
    headers["HTTP-Referer"] = process.env.OPENROUTER_REFERER;
  }

  // Step 1: Submit video generation job
  const submitRes = await fetch(`${baseUrl}/videos`, {
    method: "POST",
    headers,
    body: JSON.stringify(requestBody),
  });

  if (!submitRes.ok) {
    const errText = await submitRes.text().catch(() => "");
    return gatewayJsonError(
      submitRes.status,
      `视频生成请求失败: ${submitRes.status} ${errText.slice(0, 500)}`,
    );
  }

  const submitData = await submitRes.json().catch(() => null);

  // Check if video URL is returned directly (sync mode)
  const directUrl = extractVideoUrl(submitData);
  if (directUrl) {
    return Response.json(
      { created: Math.floor(Date.now() / 1000), data: [{ url: directUrl }] },
      { headers: copyResponseHeaders(submitRes) },
    );
  }

  // Async mode: extract job ID and poll
  const jobId = extractJobId(submitData);
  if (!jobId) {
    return gatewayJsonError(502, "视频生成服务未返回任务 ID");
  }

  // Step 2: Poll for completion
  for (let i = 0; i < MAX_POLLS; i++) {
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));

    const pollRes = await fetch(`${baseUrl}/videos/${jobId}`, {
      method: "GET",
      headers,
    });

    if (!pollRes.ok) {
      // Non-fatal: retry on next iteration
      continue;
    }

    const pollData = await pollRes.json().catch(() => null);
    if (!pollData) continue;

    const status =
      typeof (pollData as Record<string, unknown>)?.status === "string"
        ? ((pollData as Record<string, unknown>).status as string)
        : "";

    const terminal = isTerminalStatus(status);
    if (terminal === "failed") {
      return gatewayJsonError(502, "视频生成失败");
    }
    if (terminal === "completed") {
      const videoUrl = extractVideoUrl(pollData);
      if (videoUrl) {
        return Response.json(
          { created: Math.floor(Date.now() / 1000), data: [{ url: videoUrl }] },
          { headers: copyResponseHeaders(pollRes) },
        );
      }
      return gatewayJsonError(502, "视频生成完成但未返回视频 URL");
    }
    // Still processing, continue polling
  }

  return gatewayJsonError(504, `视频生成超时（${MAX_POLLS * POLL_INTERVAL_MS / 1000}秒）`);
}
