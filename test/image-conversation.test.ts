import {
  buildImageConversation,
  prepareImageConversation,
} from "../app/utils/image-conversation";
import type { RequestMessage } from "../app/client/api";

const user = (text: string, urls: string[] = []): RequestMessage => ({
  role: "user",
  content: [
    { type: "text", text },
    ...urls.map((url) => ({ type: "image_url" as const, image_url: { url } })),
  ],
});
const result = (url: string): RequestMessage => ({
  role: "assistant",
  content: [{ type: "image_url", image_url: { url } }],
});

test("keeps the initial prompt without inventing references", () => {
  expect(buildImageConversation([user("product ad")])).toEqual({
    prompt: "product ad",
    imageUrls: [],
  });
});
test("follow-up carries earlier requirements and the latest generated image", () => {
  const request = buildImageConversation([
    user("keep the red packaging", ["original"]),
    result("generated"),
    user("change the background"),
  ]);
  expect(request.prompt).toContain("keep the red packaging");
  expect(request.prompt).toContain("change the background");
  expect(request.imageUrls).toEqual(["generated"]);
});
test("new explicit references take precedence and retain all images", () => {
  expect(
    buildImageConversation([
      user("old", ["old"]),
      result("output"),
      user("new", ["a", "b"]),
    ]).imageUrls,
  ).toEqual(["a", "b"]);
});
test("replaying the original prefix retains original reference images, not its old output", () => {
  const history = [
    user("first", ["a", "b"]),
    result("generated"),
    user("future requirement"),
  ];
  const request = buildImageConversation(history.slice(0, 1));
  expect(request.imageUrls).toEqual(["a", "b"]);
  expect(request.prompt).not.toContain("future requirement");
});
test("understands the existing Markdown image result format", () => {
  expect(
    buildImageConversation([
      {
        role: "assistant",
        content: "![result](https://example.com/image.png)",
      },
      user("edit"),
    ]).imageUrls,
  ).toEqual(["https://example.com/image.png"]);
});
test("retains original native image bytes", async () => {
  const url = "data:image/png;base64,AAAA";
  expect(
    (await prepareImageConversation([user("edit", [url])])).imageUrls,
  ).toEqual([url]);
});
