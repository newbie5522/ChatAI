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
  if (!bodyText) return { prompt: "", imageUrls: [], options: {} };

  try {
    const body = JSON.parse(bodyText) as Record<string, unknown>;
    const prompt =
      textFromContent(body.prompt).trim() ||
      textFromContent(body.input).trim() ||
      promptFromMessages(body.messages).trim();
    return {
      prompt,
      imageUrls: extractImageUrls(body),
      options: {
        size: typeof body.size === "string" ? body.size : undefined,
        quality: typeof body.quality === "string" ? body.quality : undefined,
        background:
          typeof body.background === "string" ? body.background : undefined,
        outputFormat:
          typeof body.output_format === "string" ? body.output_format : undefined,
        outputCompression:
          typeof body.output_compression === "number"
            ? body.output_compression
            : undefined,
        moderation:
          typeof body.moderation === "string" ? body.moderation : undefined,
      },
    };
  } catch {
    return { prompt: "", imageUrls: [], options: {} };
  }
}

function isGptImageModel(model: string) {
  return model.toLowerCase().startsWith("gpt-image-");
}

function appendFormDataField(
  formData: FormData,
  key: string,
  value: string | number | undefined,
) {
  if (value !== undefined) formData.append(key, String(value));
}

function upstreamErrorResponse(res: Response) {
  return new Response(res.body, {
    status: res.status,
    statusText: res.statusText,
    headers: copyResponseHeaders(res),
  });
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
    dataUrl: imageUrl,
  };
}

/**
 * 检测 baseUrl 是否为 OpenRouter
 */
function isOpenRouter(baseUrl: string): boolean {
  return baseUrl.includes("openrouter.ai");
}

/**
 * OpenRouter 模型 ID 必须带 provider 前缀（如 openai/gpt-image-2）
 */
function openRouterModelId(provider: string, model: string): string {
  if (model.includes("/")) return model;
  return `${provider}/${model}`;
}

/**
 * 将 size 参数转换为 OpenRouter 的 aspect_ratio
 * 输入可能是 "1:1"、"16:9"、"1024x1024"、"auto" 等
 */
function toAspectRatio(size: string | undefined): string | undefined {
  if (!size || size === "auto" || size === "custom") return undefined;
  if (size.includes(":")) return size;
  // 像素格式（如 1024x1024）不转换，让 OpenRouter 自行处理
  return undefined;
}

/**
 * OpenRouter 图片生成（文生图 + 图生图统一走 /images 端点）
 *
 * 文档确认：
 * - OpenRouter 只有 /images 一个端点，没有 /images/edits
 * - 图生图通过 input_references 参数传参考图（base64 data URL 或 HTTP URL）
 * - model 必须带 provider 前缀（如 openai/gpt-image-2）
 * - supported_parameters: aspect_ratio / quality / background / n / input_references / output_compression
 * - allowed_passthrough_parameters: moderation
 *
 * 实现原则：只发必要参数，不加多余参数，避免上游拒绝
 */
async function callOpenRouterImages(
  model: string,
  prompt: string,
  options: {
    size?: string;
    quality?: string;
  },
  referenceImages: { blob: Blob; filename: string; dataUrl: string }[],
  headers: Record<string, string>,
  baseUrl: string,
): Promise<Response> {
  const isImageToImage = referenceImages.length > 0;
  const aspectRatio = toAspectRatio(options.size);

  console.log(
    `[OpenRouterImages] model=${model} mode=${isImageToImage ? "img2img" : "txt2img"} aspectRatio=${aspectRatio ?? "auto"} quality=${options.quality ?? "auto"} references=${referenceImages.length} prompt="${prompt.slice(0, 80)}"`,
  );

  // 最简请求体：只发必要参数
  const requestBody: Record<string, unknown> = {
    model,
    prompt,
  };

  // aspect_ratio（仅当有有效值时传）
  if (aspectRatio) {
    requestBody.aspect_ratio = aspectRatio;
  }

  // quality（仅当非 auto 时传）
  if (options.quality && options.quality !== "auto") {
    requestBody.quality = options.quality;
  }

  // 图生图：通过 input_references 传参考图
  if (isImageToImage) {
    requestBody.input_references = referenceImages.map((image) => ({
      type: "image_url",
      image_url: { url: image.dataUrl },
    }));
  }

  const res = await fetch(`${baseUrl}/images`, {
    method: "POST",
    headers: {
      ...headers,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(requestBody),
  });

  if (!res.ok) {
    const errorText = await res.clone().text();
    console.error(
      `[OpenRouterImages] upstream error ${res.status} ${res.statusText} model=${model} mode=${isImageToImage ? "img2img" : "txt2img"} body=${errorText.slice(0, 1000)}`,
    );
    return upstreamErrorResponse(res);
  }

  const json = await res.json();
  console.log(
    `[OpenRouterImages] success model=${model} mode=${isImageToImage ? "img2img" : "txt2img"} data.length=${json?.data?.length}`,
  );
  return Response.json(normalizedImageData(json), { status: 200 });
}

export async function callOpenAIImages(
  ctx: GatewayAdapterContext,
): Promise<Response> {
  const { prompt, imageUrls, options } = extractPayload(ctx.bodyText);
  if (!prompt) {
    return gatewayJsonError(400, "image prompt is required");
  }

  const model = ctx.model.model;
  const isImageToImage = imageUrls.length > 0;
  const isGptImage = isGptImageModel(model);
  const baseUrl = normalizeBaseUrl(ctx.credential.baseUrl, OPENAI_FALLBACK_BASE);
  const isOpenRouterUrl = isOpenRouter(baseUrl);
  // OpenRouter 需要带 provider 前缀（如 openai/gpt-image-2）
  const effectiveModel = isOpenRouterUrl
    ? openRouterModelId(ctx.model.provider, model)
    : model;
  console.log(
    `[OpenAIImages] model=${effectiveModel} isOpenRouter=${isOpenRouterUrl} imageToImage=${isImageToImage} baseUrl=${baseUrl} prompt="${prompt.slice(0, 80)}"`,
  );

  const headers = {
    Authorization: `Bearer ${ctx.credential.apiKey}`,
    ...(ctx.credential.orgId
      ? { "OpenAI-Organization": ctx.credential.orgId }
      : {}),
  };
  const referenceImages = imageUrls
    .map(referenceImageFromDataUrl)
    .filter(
      (image): image is { blob: Blob; filename: string; dataUrl: string } =>
        !!image,
    );
  if (imageUrls.length > 0 && referenceImages.length !== imageUrls.length) {
    return gatewayJsonError(400, "valid reference image data URL is required");
  }

  // OpenRouter 文生图 + 图生图：统一走 /images 端点
  // 文档确认 OpenRouter 只有 /images 一个端点，图生图通过 input_references 传参考图
  if (isOpenRouterUrl) {
    return callOpenRouterImages(
      effectiveModel,
      prompt,
      options,
      referenceImages,
      headers,
      baseUrl,
    );
  }
  const res =
    referenceImages.length > 0
      ? await fetch(`${baseUrl}/images/edits`, {
          method: "POST",
          headers,
          body: (() => {
            const formData = new FormData();
            formData.append("model", effectiveModel);
            formData.append("prompt", prompt);

            // GPT Image 图生图使用 OpenAI 官方 multipart 字段 image[]，且默认只发必填字段。
            referenceImages.forEach((image) => {
              formData.append(
                isGptImage ? "image[]" : "image",
                image.blob,
                image.filename,
              );
            });
            if (!isGptImage) {
              formData.append("n", "1");
              appendFormDataField(formData, "size", options.size ?? "1024x1024");
              appendFormDataField(formData, "quality", options.quality);
            }
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
            model: effectiveModel,
            prompt,
            n: 1,
            ...(options.size ? { size: options.size } : {}),
            ...(options.quality ? { quality: options.quality } : {}),
            ...(options.background ? { background: options.background } : {}),
            ...(options.outputFormat
              ? { output_format: options.outputFormat }
              : {}),
            ...(options.outputCompression !== undefined
              ? { output_compression: options.outputCompression }
              : {}),
            ...(options.moderation ? { moderation: options.moderation } : {}),
          }),
        });

  if (!res.ok) {
    const errorText = await res.clone().text();
    console.error(
      `[OpenAIImages] upstream error ${res.status} ${res.statusText} model=${effectiveModel} body=${errorText.slice(0, 1000)}`,
    );
    return upstreamErrorResponse(res);
  }

  const json = await res.json();
  console.log(
    `[OpenAIImages] success model=${effectiveModel} data.length=${json?.data?.length}`,
  );
  return Response.json(normalizedImageData(json), { status: 200 });
}
