import {
  GatewayAdapterContext,
  copyResponseHeaders,
  gatewayJsonError,
  normalizeBaseUrl,
} from "./types";

const XAI_FALLBACK_BASE = "https://api.x.ai/v1";

/**
 * xAI Aurora 图片生成适配器
 *
 * 支持能力（基于 xAI Aurora API 文档）：
 * - 文生图（text-to-image）：标准 /v1/images/generations
 * - 图生图（image-to-image）：通过 prompt + image 参数发起（xAI 兼容 OpenAI 格式）
 *
 * 注意：xAI 官方 Aurora 只支持 base64 格式的参考图，
 * 不支持 HTTP URL 直接引用（需客户端转 base64 后传入）。
 */

function parseImageBody(bodyText?: string): {
  prompt: string;
  imageDataUrl?: string;
  options: {
    n?: number;
    responseFormat?: string;
    size?: string;
  };
} {
  if (!bodyText) {
    return { prompt: "", options: {} };
  }

  try {
    const body = JSON.parse(bodyText) as Record<string, unknown>;

    // 提取 prompt（兼容 prompt / input 字段）
    const prompt =
      typeof body.prompt === "string"
        ? body.prompt.trim()
        : typeof body.input === "string"
          ? body.input.trim()
          : "";

    // 提取参考图（base64 data URL）
    // 支持 image_urls[]（网关统一格式）或直接 image 字段
    let imageDataUrl: string | undefined;
    if (Array.isArray(body.image_urls) && body.image_urls.length > 0) {
      const first = body.image_urls[0];
      if (typeof first === "string" && first.startsWith("data:image/")) {
        imageDataUrl = first;
      }
    } else if (
      typeof body.image === "string" &&
      body.image.startsWith("data:image/")
    ) {
      imageDataUrl = body.image;
    }

    return {
      prompt,
      imageDataUrl,
      options: {
        n: typeof body.n === "number" ? body.n : 1,
        responseFormat:
          typeof body.response_format === "string"
            ? body.response_format
            : "url",
        size: typeof body.size === "string" ? body.size : undefined,
      },
    };
  } catch {
    return { prompt: "", options: {} };
  }
}

export async function callXAIImages(
  ctx: GatewayAdapterContext,
): Promise<Response> {
  const { prompt, imageDataUrl, options } = parseImageBody(ctx.bodyText);

  if (!prompt) {
    return gatewayJsonError(400, "image prompt is required");
  }

  const model = ctx.model.model;
  const baseUrl = normalizeBaseUrl(ctx.credential.baseUrl, XAI_FALLBACK_BASE);
  const isImageToImage = !!imageDataUrl;

  // 验证图生图能力声明
  // imageEdit = true 时才允许图生图；否则有参考图也退化为文生图并警告
  const supportsEdit = ctx.model.capabilities?.imageEdit === true;
  const effectiveImageUrl =
    isImageToImage && supportsEdit ? imageDataUrl : undefined;

  if (isImageToImage && !supportsEdit) {
    console.warn(
      `[XAIImages] model=${model} does not declare imageEdit capability; ` +
        `falling back to text-to-image (reference image ignored). ` +
        `Set capabilities.imageEdit=true in model-registry to enable.`,
    );
  }

  console.log(
    `[XAIImages] model=${model} mode=${effectiveImageUrl ? "img2img" : "txt2img"} prompt="${prompt.slice(0, 80)}"`,
  );

  // 构建请求体
  const requestBody: Record<string, unknown> = {
    model,
    prompt,
    response_format: options.responseFormat ?? "url",
    n: options.n ?? 1,
  };

  // 图生图：通过 image 字段传 base64 data URL
  if (effectiveImageUrl) {
    requestBody.image = effectiveImageUrl;
  }

  const res = await fetch(`${baseUrl}/images/generations`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${ctx.credential.apiKey}`,
    },
    body: JSON.stringify(requestBody),
    redirect: "manual",
  });

  if (!res.ok) {
    console.error(
      `[XAIImages] upstream error ${res.status} ${res.statusText} model=${model} mode=${effectiveImageUrl ? "img2img" : "txt2img"}`,
    );
    return new Response(res.body, {
      status: res.status,
      statusText: res.statusText,
      headers: copyResponseHeaders(res),
    });
  }

  // Issue #15: 验证响应内容有效性，拒绝 HTTP 200 但无有效媒体内容的响应
  const json = await res.json();
  const data = Array.isArray(json?.data)
    ? json.data.filter(
        (item: unknown) =>
          item &&
          typeof item === "object" &&
          ((item as Record<string, unknown>).url ||
            (item as Record<string, unknown>).b64_json),
      )
    : [];

  if (data.length === 0) {
    console.error(
      `[XAIImages] EMPTY_RESPONSE: HTTP 200 but no valid media content model=${model} json=${JSON.stringify(json)}`,
    );
    return new Response(
      JSON.stringify({
        error: {
          message: "Provider returned empty response",
          code: "EMPTY_RESPONSE",
          provider: "xai",
          model,
        },
      }),
      { status: 502, headers: { "Content-Type": "application/json" } },
    );
  }

  console.log(
    `[XAIImages] success model=${model} mode=${effectiveImageUrl ? "img2img" : "txt2img"} data.length=${data.length}`,
  );
  return Response.json({ ...json, data }, { status: 200 });
}
