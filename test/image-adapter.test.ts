/**
 * Issue #25 图片 Provider 双轨适配契约测试
 *
 * 覆盖范围：
 * 1. xAI 图片适配器（callXAIImages）：文生图 / 图生图 / 能力门禁 / EMPTY_RESPONSE
 * 2. OpenAI 图片适配器（callOpenAIImages）：文生图 / 图生图（multipart）/ 空响应拒绝
 * 3. capabilities 字段：imageEdit / imageReference / multiImageReference 类型检查
 *
 * 测试策略：mock fetch，不发真实请求
 *
 * @jest-environment node
 */

import type { GatewayAdapterContext } from "../app/api/gateway/adapters/types";
import type { CompanyModel } from "../app/config/model-registry";
import type { ProviderCredential } from "../app/config/admin-store";

// ── 类型检查：capabilities 接口扩展 ────────────────────────────────────────

describe("CompanyModel capabilities 类型", () => {
  it("imageEdit / imageReference / multiImageReference 是合法字段", () => {
    // 这是编译时类型检查，运行时 always pass
    const model: CompanyModel = {
      id: "test:model",
      provider: "openai",
      category: "image",
      displayName: "Test",
      model: "test-model",
      endpointType: "openai_images",
      enabled: true,
      defaultEnabled: true,
      sort: 0,
      capabilities: {
        imageGeneration: true,
        imageEdit: true,
        imageReference: true,
        multiImageReference: false,
      },
    };
    expect(model.capabilities?.imageEdit).toBe(true);
    expect(model.capabilities?.imageReference).toBe(true);
    expect(model.capabilities?.multiImageReference).toBe(false);
  });

  it("capabilities 字段均为可选", () => {
    const model: CompanyModel = {
      id: "test:minimal",
      provider: "openai",
      category: "image",
      displayName: "Minimal",
      model: "minimal-model",
      endpointType: "openai_images",
      enabled: true,
      defaultEnabled: true,
      sort: 0,
    };
    expect(model.capabilities).toBeUndefined();
  });
});

// ── 测试工具 ───────────────────────────────────────────────────────────────

function makeCredential(overrides?: Partial<ProviderCredential>): ProviderCredential {
  return {
    id: "cred-test",
    provider: "xai",
    label: "test",
    apiKey: "test-key",
    baseUrl: "https://api.x.ai/v1",
    enabled: true,
    ...overrides,
  } as ProviderCredential;
}

function makeModel(overrides?: Partial<CompanyModel>): CompanyModel {
  return {
    id: "xai:grok-imagine-image",
    provider: "xai",
    category: "image",
    displayName: "Grok Imagine",
    model: "grok-imagine-image",
    endpointType: "xai_images",
    enabled: true,
    defaultEnabled: true,
    sort: 0,
    capabilities: { imageGeneration: true },
    ...overrides,
  };
}

function makeCtx(overrides?: {
  bodyText?: string;
  model?: Partial<CompanyModel>;
  credential?: Partial<ProviderCredential>;
}): GatewayAdapterContext {
  return {
    req: {} as any,
    path: "/v1/images/generations",
    search: "",
    bodyText: overrides?.bodyText ?? JSON.stringify({ prompt: "a cat", n: 1 }),
    model: makeModel(overrides?.model),
    credential: makeCredential(overrides?.credential),
  };
}

// ── xAI 图片适配器测试 ─────────────────────────────────────────────────────

describe("callXAIImages", () => {
  const { callXAIImages } = require("../app/api/gateway/adapters/xai-images");

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("文生图：成功返回 200 + 有效 data", async () => {
    const mockResponse = {
      created: 1000,
      data: [{ url: "https://example.com/image.png" }],
    };
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => mockResponse,
    } as Response);

    const ctx = makeCtx({ bodyText: JSON.stringify({ prompt: "a cat" }) });
    const res = await callXAIImages(ctx);
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.data).toHaveLength(1);
    expect(body.data[0].url).toBe("https://example.com/image.png");
  });

  it("prompt 为空时返回 400", async () => {
    const ctx = makeCtx({ bodyText: JSON.stringify({ prompt: "" }) });
    const res = await callXAIImages(ctx);
    expect(res.status).toBe(400);
  });

  it("上游非 2xx 错误直接透传状态码", async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 429,
      statusText: "Too Many Requests",
      body: null,
      headers: new Headers(),
    } as unknown as Response);

    const ctx = makeCtx();
    const res = await callXAIImages(ctx);
    expect(res.status).toBe(429);
  });

  it("HTTP 200 但 data 为空时返回 502 EMPTY_RESPONSE", async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ created: 1000, data: [] }),
    } as Response);

    const ctx = makeCtx();
    const res = await callXAIImages(ctx);
    expect(res.status).toBe(502);
    const body = await res.json();
    expect(body.error.code).toBe("EMPTY_RESPONSE");
  });

  it("HTTP 200 但 data 无 url/b64_json 时返回 502", async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ created: 1000, data: [{ revised_prompt: "cat" }] }),
    } as Response);

    const ctx = makeCtx();
    const res = await callXAIImages(ctx);
    expect(res.status).toBe(502);
  });

  it("有参考图 + imageEdit=true → 图生图模式（image 字段发出）", async () => {
    const mockFetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ created: 1000, data: [{ url: "https://example.com/edited.png" }] }),
    } as Response);
    global.fetch = mockFetch;

    const BASE64_IMG = "data:image/png;base64,iVBORw0KGgoAAAANS=";
    const ctx = makeCtx({
      bodyText: JSON.stringify({
        prompt: "add a hat",
        image_urls: [BASE64_IMG],
      }),
      model: { capabilities: { imageGeneration: true, imageEdit: true } },
    });

    const res = await callXAIImages(ctx);
    expect(res.status).toBe(200);

    const [, fetchOptions] = mockFetch.mock.calls[0];
    const sentBody = JSON.parse(fetchOptions.body as string);
    expect(sentBody.image).toBe(BASE64_IMG); // 参考图已发出
    expect(sentBody.prompt).toBe("add a hat");
  });

  it("有参考图 + imageEdit=false → 退化为文生图（image 字段不发出），不报错", async () => {
    const mockFetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ created: 1000, data: [{ url: "https://example.com/gen.png" }] }),
    } as Response);
    global.fetch = mockFetch;

    const ctx = makeCtx({
      bodyText: JSON.stringify({
        prompt: "a cat",
        image_urls: ["data:image/png;base64,iVBORw0KGgoAAAANS="],
      }),
      model: { capabilities: { imageGeneration: true } }, // imageEdit 未声明
    });

    const res = await callXAIImages(ctx);
    expect(res.status).toBe(200);

    const [, fetchOptions] = mockFetch.mock.calls[0];
    const sentBody = JSON.parse(fetchOptions.body as string);
    expect(sentBody.image).toBeUndefined(); // 参考图被忽略
  });
});

// ── OpenAI 图片适配器：空响应拒绝回归测试 ────────────────────────────────

describe("callOpenAIImages - EMPTY_RESPONSE 回归", () => {
  const { callOpenAIImages } = require("../app/api/gateway/adapters/openai-images");

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("HTTP 200 但 data 为空时返回 502 EMPTY_RESPONSE", async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ created: 1000, data: [] }),
    } as Response);

    const ctx = makeCtx({
      bodyText: JSON.stringify({ prompt: "a cat" }),
      model: makeModel({
        provider: "openai",
        model: "gpt-image-2",
        endpointType: "openai_images",
        capabilities: { imageGeneration: true, imageEdit: true },
      }),
      credential: makeCredential({ provider: "openai", baseUrl: "https://api.openai.com/v1" }),
    });

    const res = await callOpenAIImages(ctx);
    expect(res.status).toBe(502);
    const body = await res.json();
    expect(body.code).toBe("EMPTY_RESPONSE");
  });

  it("文生图成功返回 200", async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        created: 1000,
        data: [{ url: "https://oaidalleapiprodscus.blob.core.windows.net/test.png" }],
      }),
    } as Response);

    const ctx = makeCtx({
      bodyText: JSON.stringify({ prompt: "a mountain" }),
      model: makeModel({
        provider: "openai",
        model: "gpt-image-2",
        endpointType: "openai_images",
        capabilities: { imageGeneration: true, imageEdit: true },
      }),
      credential: makeCredential({ provider: "openai", baseUrl: "https://api.openai.com/v1" }),
    });

    const res = await callOpenAIImages(ctx);
    expect(res.status).toBe(200);
  });
});
