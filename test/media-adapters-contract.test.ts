/** @jest-environment node */

import { callGoogleImage } from "../app/api/gateway/adapters/google-image";
import { callOpenAIImages } from "../app/api/gateway/adapters/openai-images";
import type { GatewayAdapterContext } from "../app/api/gateway/adapters/types";
import { callXAIImages } from "../app/api/gateway/adapters/xai-images";
import { classifyMediaJson } from "../app/utils/media-response";

const originalFetch = globalThis.fetch;

function context(
  provider: "openai" | "google" | "xai",
  baseUrl: string,
): GatewayAdapterContext {
  return {
    req: {
      signal: new AbortController().signal,
    } as GatewayAdapterContext["req"],
    path: "images/generations",
    search: "",
    bodyText: JSON.stringify({ model: "image-model", prompt: "draw" }),
    model: {
      id: `${provider}-image`,
      displayName: "Image Model",
      model: "image-model",
      provider,
      category: "image",
      endpointType:
        provider === "google"
          ? "google_image"
          : provider === "xai"
          ? "xai_images"
          : "openai_images",
      enabled: true,
      defaultEnabled: true,
      sort: 1,
    },
    credential: {
      id: "credential",
      provider,
      name: "test",
      apiKey: "secret",
      baseUrl,
      categoryScope: "image",
      enabled: true,
      verified: true,
      useCompatibleMode: false,
      priority: 1,
      createdAt: "2026-09-15T00:00:00.000Z",
      updatedAt: "2026-09-15T00:00:00.000Z",
    },
    signal: new AbortController().signal,
  };
}

afterEach(() => {
  globalThis.fetch = originalFetch;
  jest.restoreAllMocks();
});

test.each([
  [{ data: [{ url: "https://example.com/openai.png" }] }, { valid: true }],
  [{ data: [{ b64_json: "AAAA" }] }, { valid: true }],
  [{ data: [] }, { valid: false, code: "MEDIA_EMPTY_RESPONSE" }],
  [{ unexpected: true }, { valid: false, code: "MEDIA_INVALID_RESPONSE" }],
  [
    { error: { message: "relay failed" } },
    { valid: false, code: "PROVIDER_ERROR" },
  ],
])("preserves OpenAI-compatible response semantics", async (body, expected) => {
  jest.spyOn(console, "log").mockImplementation(() => undefined);
  globalThis.fetch = jest
    .fn()
    .mockResolvedValue(Response.json(body, { status: 200 }));
  const response = await callOpenAIImages(
    context("openai", "https://relay.example/v1"),
  );
  expect(classifyMediaJson(await response.json())).toMatchObject(expected);
});

test("passes OpenAI-compatible HTTP errors to Gateway normalization", async () => {
  jest.spyOn(console, "error").mockImplementation(() => undefined);
  jest.spyOn(console, "log").mockImplementation(() => undefined);
  globalThis.fetch = jest
    .fn()
    .mockResolvedValue(
      Response.json({ error: { message: "denied" } }, { status: 403 }),
    );
  const response = await callOpenAIImages(
    context("openai", "https://relay.example/v1"),
  );
  expect(response.status).toBe(403);
});

test("normalizes Google native image output", async () => {
  globalThis.fetch = jest.fn().mockResolvedValue(
    Response.json({
      candidates: [
        {
          content: {
            parts: [{ inlineData: { mimeType: "image/png", data: "AAAA" } }],
          },
        },
      ],
    }),
  );
  const response = await callGoogleImage(
    context("google", "https://generativelanguage.googleapis.com"),
  );
  expect(classifyMediaJson(await response.json())).toEqual({ valid: true });
});

test("Google native missing image is a non-success response", async () => {
  globalThis.fetch = jest
    .fn()
    .mockResolvedValue(
      Response.json({
        candidates: [{ content: { parts: [{ text: "no image" }] } }],
      }),
    );
  const response = await callGoogleImage(
    context("google", "https://generativelanguage.googleapis.com"),
  );
  expect(response.status).toBe(502);
});

test("xAI response remains available for Gateway contract validation", async () => {
  globalThis.fetch = jest
    .fn()
    .mockResolvedValue(
      Response.json({ data: [{ url: "https://example.com/xai.png" }] }),
    );
  const response = await callXAIImages(context("xai", "https://api.x.ai/v1"));
  expect(classifyMediaJson(await response.json())).toEqual({ valid: true });
});
