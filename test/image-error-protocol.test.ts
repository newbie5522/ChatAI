/**
 * @jest-environment node
 *
 * image-error-protocol.test.ts
 * 验证 callOpenAIImages 对各类上游响应的处理行为。
 */

import { callOpenAIImages } from "../app/api/gateway/adapters/openai-images";
import type { GatewayAdapterContext } from "../app/api/gateway/adapters/types";

// ---------- helpers ----------

function makeCtx(bodyText = '{"prompt":"a cat"}'): GatewayAdapterContext {
  return {
    req: {} as any,
    path: "images/generations",
    search: "",
    bodyText,
    model: {
      id: "openai:gpt-image-2",
      provider: "openai",
      model: "gpt-image-2",
      category: "image",
      endpointType: "openai_images",
      enabled: true,
      defaultEnabled: true,
      legacy: false,
      deprecated: false,
      displayName: "GPT Image 2",
      sort: 615,
    } as any,
    credential: {
      apiKey: "sk-test",
      baseUrl: "https://api.openai.com/v1",
    } as any,
  };
}

function mockFetch(status: number, body: unknown, contentType = "application/json") {
  const responseBody =
    typeof body === "string" ? body : JSON.stringify(body);
  const mockResponse = new Response(responseBody, {
    status,
    headers: { "content-type": contentType },
  });
  global.fetch = jest.fn().mockResolvedValue(mockResponse);
}

// ---------- tests ----------

describe("callOpenAIImages — error protocol", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  // 1. HTTP 200 + 空 data 数组 → 502，不静默通过
  test("HTTP 200 + empty data array → 502 error", async () => {
    mockFetch(200, { created: 1, data: [] });
    const res = await callOpenAIImages(makeCtx());
    expect(res.status).toBe(502);
    const body = await res.json();
    expect(body.error).toBe(true);
    expect(typeof body.message).toBe("string");
    expect(body.message.length).toBeGreaterThan(0);
  });

  // 2. HTTP 200 + error 对象 → 502，透传 error 信息
  test("HTTP 200 + error object in body → 502 error", async () => {
    mockFetch(200, {
      error: { message: "content_policy_violation", type: "invalid_request_error" },
    });
    const res = await callOpenAIImages(makeCtx());
    expect(res.status).toBe(502);
    const body = await res.json();
    expect(body.error).toBe(true);
    expect(body.message).toContain("content_policy_violation");
  });

  // 3. 非 JSON 响应 → 502
  test("non-JSON response → 502 error", async () => {
    mockFetch(200, "Internal Server Error", "text/plain");
    const res = await callOpenAIImages(makeCtx());
    // json() parse will throw → adapter should catch and return error
    expect(res.status).toBeGreaterThanOrEqual(400);
    const body = await res.json();
    expect(body.error).toBe(true);
  });

  // 4. HTTP 401 → 透传 401
  test("HTTP 401 → upstream status is forwarded", async () => {
    mockFetch(401, { error: { message: "Incorrect API key provided" } });
    const res = await callOpenAIImages(makeCtx());
    expect(res.status).toBe(401);
  });

  // 5. HTTP 403 → 透传 403
  test("HTTP 403 → upstream status is forwarded", async () => {
    mockFetch(403, { error: { message: "Forbidden" } });
    const res = await callOpenAIImages(makeCtx());
    expect(res.status).toBe(403);
  });

  // 6. HTTP 429 → 透传 429
  test("HTTP 429 → upstream status is forwarded", async () => {
    mockFetch(429, { error: { message: "Rate limit exceeded" } });
    const res = await callOpenAIImages(makeCtx());
    expect(res.status).toBe(429);
  });

  // 7. HTTP 500 → 透传 5xx
  test("HTTP 500 → upstream status is forwarded", async () => {
    mockFetch(500, { error: { message: "Internal server error" } });
    const res = await callOpenAIImages(makeCtx());
    expect(res.status).toBe(500);
  });

  // 8. 成功响应（含 url）→ 200 正常返回
  test("successful response with url → 200 and data[0].url", async () => {
    mockFetch(200, {
      created: 1700000000,
      data: [{ url: "https://example.com/image.png" }],
    });
    const res = await callOpenAIImages(makeCtx());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body.data)).toBe(true);
    expect(body.data[0].url).toBe("https://example.com/image.png");
  });

  // 9. 成功响应（含 b64_json）→ 200 正常返回
  test("successful response with b64_json → 200 and data[0].b64_json", async () => {
    mockFetch(200, {
      created: 1700000000,
      data: [{ b64_json: "aGVsbG8=" }],
    });
    const res = await callOpenAIImages(makeCtx());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body.data)).toBe(true);
    expect(body.data[0].b64_json).toBe("aGVsbG8=");
  });
});
