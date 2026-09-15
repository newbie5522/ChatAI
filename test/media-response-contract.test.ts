/** @jest-environment node */

import {
  classifyMediaJson,
  extractValidMediaData,
  mediaResponseToMessage,
  readMediaResponse,
} from "../app/utils/media-response";
import {
  isMediaErrorPayload,
  mediaAbortError,
  MediaRequestError,
  sanitizeMediaErrorText,
} from "../app/utils/media-error";
import type { MediaErrorPayload } from "../app/utils/media-error";

const contract = (
  overrides: Partial<MediaErrorPayload> = {},
): MediaErrorPayload => ({
  error: true,
  code: "MEDIA_EMPTY_RESPONSE",
  message: "图片服务没有返回有效图片，请重新生成。",
  retryable: true,
  requestId: "request-15",
  provider: "openai",
  model: "gpt-image-2",
  ...overrides,
});

test("accepts OpenAI URL media", async () => {
  await expect(
    mediaResponseToMessage(
      { data: [{ url: "https://example.com/image.png" }] },
      jest.fn(),
    ),
  ).resolves.toEqual([
    {
      type: "image_url",
      image_url: { url: "https://example.com/image.png" },
    },
  ]);
});

test("accepts OpenAI Base64 media and uploads it", async () => {
  const upload = jest.fn().mockResolvedValue("https://cdn.example/image.png");
  await expect(
    mediaResponseToMessage({ data: [{ b64_json: "AAAA" }] }, upload),
  ).resolves.toEqual([
    {
      type: "image_url",
      image_url: { url: "https://cdn.example/image.png" },
    },
  ]);
  expect(upload).toHaveBeenCalledWith("AAAA");
});

test.each([[{ data: [] }], [{}], [{ data: [{ url: "", b64_json: "" }] }]])(
  "never creates an empty image message from %p",
  async (value) => {
    expect(extractValidMediaData(value)).toEqual([]);
    await expect(
      mediaResponseToMessage(value, jest.fn()),
    ).rejects.toMatchObject({
      code: "MEDIA_EMPTY_RESPONSE",
    });
  },
);

test("rejects a standard HTTP 200 provider error instead of displaying JSON", async () => {
  const response = new Response(
    JSON.stringify(contract({ code: "PROVIDER_ERROR" })),
    {
      status: 200,
      headers: { "content-type": "application/json" },
    },
  );
  await expect(readMediaResponse(response)).rejects.toMatchObject({
    code: "PROVIDER_ERROR",
    requestId: "request-15",
  });
});

test("rejects a legacy HTTP 200 error field instead of displaying it", async () => {
  const response = Response.json(
    { error: { message: "relay failed" } },
    { status: 200 },
  );
  await expect(readMediaResponse(response)).rejects.toMatchObject({
    code: "PROVIDER_ERROR",
  });
});

test.each([400, 500])("normalizes legacy HTTP %i failures", async (status) => {
  const response = new Response(
    JSON.stringify({ error: { message: "upstream" } }),
    {
      status,
      headers: { "content-type": "application/json" },
    },
  );
  await expect(readMediaResponse(response)).rejects.toMatchObject({
    code: "PROVIDER_ERROR",
  });
});

test("rejects non-JSON media responses", async () => {
  await expect(
    readMediaResponse(new Response("gateway html", { status: 502 })),
  ).rejects.toMatchObject({ code: "MEDIA_INVALID_RESPONSE" });
});

test("reports artifact upload failure without an empty URL", async () => {
  await expect(
    mediaResponseToMessage(
      { data: [{ b64_json: "AAAA" }] },
      jest.fn().mockRejectedValue(new Error("disk path secret")),
    ),
  ).rejects.toMatchObject({ code: "ARTIFACT_UPLOAD_FAILED" });
});

test("distinguishes timeout from user cancellation", () => {
  expect(mediaAbortError(true, "google", "image-model")).toMatchObject({
    code: "REQUEST_TIMEOUT",
    retryable: true,
  });
  expect(mediaAbortError(false, "google", "image-model")).toMatchObject({
    code: "REQUEST_ABORTED",
    retryable: false,
  });
});

test("recognizes the complete contract and redacts secrets", () => {
  expect(isMediaErrorPayload(contract())).toBe(true);
  expect(
    sanitizeMediaErrorText(
      "Authorization: Bearer secret-token api_key=sk-example-secret /opt/private/file",
    ),
  ).not.toMatch(/secret-token|sk-example-secret|\/opt\/private/);
  expect(new MediaRequestError(contract()).message).not.toContain("{");
});

test.each([
  [{ data: [] }, "MEDIA_EMPTY_RESPONSE"],
  [{}, "MEDIA_INVALID_RESPONSE"],
  [
    { images: [{ url: "https://example.com/image.png" }] },
    "MEDIA_INVALID_RESPONSE",
  ],
  [{ error: { message: "bad key" } }, "PROVIDER_ERROR"],
])("classifies Gateway media response %p as %s", (value, code) => {
  expect(classifyMediaJson(value)).toMatchObject({ valid: false, code });
});

test.each([
  { data: [{ url: "https://example.com/openai.png" }] },
  { data: [{ b64_json: "AAAA" }] },
])("accepts valid OpenAI, Google, or xAI normalized output", (value) => {
  expect(classifyMediaJson(value)).toEqual({ valid: true });
});
