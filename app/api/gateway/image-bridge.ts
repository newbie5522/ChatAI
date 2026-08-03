import {
  listCompanyModels,
  selectProviderCredentialForModel,
} from "@/app/config/admin-store";
import { getImageAttachmentRouteMode } from "@/app/config/image-input-router";
import type { CompanyModel, ModelProvider } from "@/app/config/model-registry";
import {
  ANTHROPIC_BASE_URL,
  GEMINI_BASE_URL,
  OPENAI_BASE_URL,
} from "@/app/constant";

interface ImageData {
  mimeType: string;
  data: string;
  dataUrl: string;
}

const COMPATIBLE_CHAT_ENDPOINTS: Partial<Record<ModelProvider, string>> = {
  xai: "https://api.x.ai/v1/chat/completions",
  deepseek: "https://api.deepseek.com/chat/completions",
  qwen: "https://dashscope-intl.aliyuncs.com/compatible-mode/v1/chat/completions",
  mistral: "https://api.mistral.ai/v1/chat/completions",
  zhipu: "https://open.bigmodel.cn/api/paas/v4/chat/completions",
};

export interface PreparedImageInput {
  bodyText?: string;
  routeMode?: ReturnType<typeof getImageAttachmentRouteMode>;
  bridgeProvider?: ModelProvider;
  bridgeModel?: string;
  imageCount: number;
}

function objectValue(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object"
    ? (value as Record<string, unknown>)
    : undefined;
}

function parseDataUrl(value: string): ImageData | undefined {
  const match = value.match(
    /^data:(image\/(?:png|jpeg|webp));base64,([a-z0-9+/=]+)$/i,
  );
  return match
    ? { mimeType: match[1].toLowerCase(), data: match[2], dataUrl: value }
    : undefined;
}

function collectImages(value: unknown, images: ImageData[] = []) {
  if (Array.isArray(value)) {
    value.forEach((item) => collectImages(item, images));
    return images;
  }
  const record = objectValue(value);
  if (!record) return images;
  const imageUrl = objectValue(record.image_url);
  if (typeof imageUrl?.url === "string") {
    const image = parseDataUrl(imageUrl.url);
    if (image) images.push(image);
  }
  const inlineData =
    objectValue(record.inlineData) ?? objectValue(record.inline_data);
  if (
    typeof inlineData?.data === "string" &&
    typeof (inlineData.mimeType ?? inlineData.mime_type) === "string"
  ) {
    const mimeType = String(inlineData.mimeType ?? inlineData.mime_type);
    const image = parseDataUrl(`data:${mimeType};base64,${inlineData.data}`);
    if (image) images.push(image);
  }
  const source = objectValue(record.source);
  if (
    record.type === "image" &&
    source?.type === "base64" &&
    typeof source.media_type === "string" &&
    typeof source.data === "string"
  ) {
    const image = parseDataUrl(
      `data:${source.media_type};base64,${source.data}`,
    );
    if (image) images.push(image);
  }
  Object.values(record).forEach((item) => collectImages(item, images));
  return images;
}

function normalizeBaseUrl(value: string | undefined, fallback: string) {
  const raw = (value || fallback).replace(/\/$/, "");
  return raw.startsWith("http") ? raw : `https://${raw}`;
}

function responseText(value: unknown) {
  const body = objectValue(value);
  if (typeof body?.output_text === "string") return body.output_text;
  const choiceValue = body?.choices;
  const choices = Array.isArray(choiceValue) ? choiceValue : [];
  for (const choice of choices) {
    const content = objectValue(objectValue(choice)?.message)?.content;
    if (typeof content === "string") return content;
  }
  const candidateValue = body?.candidates;
  const candidates = Array.isArray(candidateValue) ? candidateValue : [];
  for (const candidate of candidates) {
    const parts = objectValue(objectValue(candidate)?.content)?.parts;
    if (Array.isArray(parts)) {
      const text = parts
        .map((part) => objectValue(part)?.text)
        .filter((item): item is string => typeof item === "string")
        .join("\n");
      if (text) return text;
    }
  }
  const contentValue = body?.content;
  const content = Array.isArray(contentValue) ? contentValue : [];
  return content
    .map((part) => objectValue(part)?.text)
    .filter((item): item is string => typeof item === "string")
    .join("\n");
}

function selectBridgeModel(target: CompanyModel) {
  return listCompanyModels()
    .filter(
      (model) =>
        model.enabled &&
        model.capabilities?.vision === true &&
        model.category === "chat" &&
        model.endpointType !== "not_implemented" &&
        !model.legacy &&
        !model.deprecated &&
        Boolean(selectProviderCredentialForModel(model)),
    )
    .sort((left, right) => {
      const providerPriority =
        Number(right.provider === target.provider) -
        Number(left.provider === target.provider);
      return providerPriority || left.sort - right.sort;
    })[0];
}

async function describeWithBridge(
  model: CompanyModel,
  images: ImageData[],
  instruction: string,
  signal: AbortSignal,
) {
  const credential = selectProviderCredentialForModel(model);
  if (!credential) throw new Error("没有可用的图片理解桥接模型");
  let response: Response;
  if (
    model.endpointType === "google_generate_content" ||
    model.endpointType === "google_interactions"
  ) {
    const baseUrl = normalizeBaseUrl(
      credential.baseUrl,
      GEMINI_BASE_URL,
    ).replace(/\/v1(?:beta)?$/, "");
    response = await fetch(
      `${baseUrl}/v1beta/models/${encodeURIComponent(
        model.model,
      )}:generateContent`,
      {
        method: "POST",
        signal,
        headers: {
          "Content-Type": "application/json",
          "x-goog-api-key": credential.apiKey,
        },
        body: JSON.stringify({
          contents: [
            {
              role: "user",
              parts: [
                { text: instruction },
                ...images.map((image) => ({
                  inlineData: { mimeType: image.mimeType, data: image.data },
                })),
              ],
            },
          ],
        }),
      },
    );
  } else if (model.endpointType === "anthropic_messages") {
    const baseUrl = normalizeBaseUrl(credential.baseUrl, ANTHROPIC_BASE_URL);
    response = await fetch(`${baseUrl}/v1/messages`, {
      method: "POST",
      signal,
      headers: {
        "Content-Type": "application/json",
        "x-api-key": credential.apiKey,
        "anthropic-version": credential.apiVersion || "2023-06-01",
      },
      body: JSON.stringify({
        model: model.model,
        max_tokens: 1200,
        messages: [
          {
            role: "user",
            content: [
              ...images.map((image) => ({
                type: "image",
                source: {
                  type: "base64",
                  media_type: image.mimeType,
                  data: image.data,
                },
              })),
              { type: "text", text: instruction },
            ],
          },
        ],
      }),
    });
  } else if (model.endpointType === "openai_compatible_chat") {
    const endpoint = COMPATIBLE_CHAT_ENDPOINTS[model.provider];
    if (!endpoint) throw new Error("图片理解桥接 Provider 未实现");
    response = await fetch(endpoint, {
      method: "POST",
      signal,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${credential.apiKey}`,
      },
      body: JSON.stringify({
        model: model.model,
        stream: false,
        messages: [
          {
            role: "user",
            content: [
              { type: "text", text: instruction },
              ...images.map((image) => ({
                type: "image_url",
                image_url: { url: image.dataUrl },
              })),
            ],
          },
        ],
      }),
    });
  } else if (model.endpointType === "openai_responses") {
    const baseUrl = normalizeBaseUrl(credential.baseUrl, OPENAI_BASE_URL);
    response = await fetch(`${baseUrl}/v1/responses`, {
      method: "POST",
      signal,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${credential.apiKey}`,
      },
      body: JSON.stringify({
        model: model.model,
        input: [
          {
            role: "user",
            content: [
              { type: "input_text", text: instruction },
              ...images.map((image) => ({
                type: "input_image",
                image_url: image.dataUrl,
              })),
            ],
          },
        ],
      }),
    });
  } else {
    throw new Error("图片理解桥接模型端点未实现");
  }
  if (!response.ok) throw new Error("图片理解桥接失败");
  const description = responseText(await response.json()).trim();
  if (!description) throw new Error("图片理解桥接没有返回有效内容");
  return description;
}

function replaceImagesWithDescription(
  parsed: Record<string, unknown>,
  description: string,
) {
  const messages = Array.isArray(parsed.messages) ? parsed.messages : [];
  let lastUserMessage = -1;
  messages.forEach((messageValue, index) => {
    if (objectValue(messageValue)?.role === "user") lastUserMessage = index;
  });
  parsed.messages = messages.map((messageValue, index) => {
    const message = objectValue(messageValue);
    if (!message || !Array.isArray(message.content)) return messageValue;
    const content = message.content.filter((partValue) => {
      const part = objectValue(partValue);
      return part?.type !== "image_url" && part?.type !== "image";
    });
    if (message.role === "user" && index === lastUserMessage) {
      content.push({ type: "text", text: `参考图片分析：\n${description}` });
    }
    return { ...message, content };
  });
  const contents = Array.isArray(parsed.contents) ? parsed.contents : [];
  let lastUserContent = -1;
  contents.forEach((contentValue, index) => {
    if (objectValue(contentValue)?.role !== "model") lastUserContent = index;
  });
  parsed.contents = contents.map((contentValue, index) => {
    const content = objectValue(contentValue);
    if (!content || !Array.isArray(content.parts)) return contentValue;
    const parts = content.parts.filter((partValue) => {
      const part = objectValue(partValue);
      return !part?.inlineData && !part?.inline_data;
    });
    if (content.role !== "model" && index === lastUserContent) {
      parts.push({ text: `参考图片分析：\n${description}` });
    }
    return { ...content, parts };
  });
  const prompt = typeof parsed.prompt === "string" ? parsed.prompt : "";
  parsed.prompt = `${prompt}\n\n参考图片分析：\n${description}`.trim();
  return JSON.stringify(parsed);
}

export async function prepareGatewayImageInput(input: {
  bodyText?: string;
  targetModel: CompanyModel;
  signal: AbortSignal;
}): Promise<PreparedImageInput> {
  if (!input.bodyText) return { bodyText: input.bodyText, imageCount: 0 };
  let parsed: Record<string, unknown>;
  try {
    const value: unknown = JSON.parse(input.bodyText);
    parsed = objectValue(value) ?? {};
  } catch {
    return { bodyText: input.bodyText, imageCount: 0 };
  }
  const images = collectImages(parsed).slice(
    0,
    input.targetModel.capabilities?.maxInputImages ?? 4,
  );
  if (!images.length) return { bodyText: input.bodyText, imageCount: 0 };
  const routeMode = getImageAttachmentRouteMode(input.targetModel);
  if (
    routeMode === "native_understanding" ||
    routeMode === "native_image_edit" ||
    routeMode === "native_image_to_video"
  ) {
    return { bodyText: input.bodyText, routeMode, imageCount: images.length };
  }
  const bridgeModel = selectBridgeModel(input.targetModel);
  if (!bridgeModel) throw new Error("当前没有可用的图片理解桥接模型");
  const instruction =
    routeMode === "bridge_to_image_prompt"
      ? "请详细描述这些参考图片的主体、构图、风格、颜色、文字与应保留的视觉特征，用于生成图片提示词。"
      : routeMode === "bridge_to_video_prompt"
      ? "请详细描述这些参考图片的场景、主体、镜头、动作潜力与视觉风格，用于生成视频提示词。"
      : "请准确分析这些图片中的内容、文字、对象、关系和关键细节，供后续模型回答用户问题。";
  const description = await describeWithBridge(
    bridgeModel,
    images,
    instruction,
    input.signal,
  );
  return {
    bodyText: replaceImagesWithDescription(parsed, description),
    routeMode,
    bridgeProvider: bridgeModel.provider,
    bridgeModel: bridgeModel.model,
    imageCount: images.length,
  };
}
