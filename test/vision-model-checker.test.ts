import { isVisionModel } from "../app/utils";
import { useAccessStore } from "../app/store";

jest.mock("../app/components/ui-lib", () => ({ showToast: jest.fn() }));
jest.mock("../app/store", () => ({ useAccessStore: { getState: jest.fn() } }));
jest.mock("../app/utils/stream", () => ({ fetch: jest.fn() }));

describe("isVisionModel", () => {
  beforeEach(() => {
    jest
      .mocked(useAccessStore.getState)
      .mockReturnValue({ visionModels: "" } as ReturnType<
        typeof useAccessStore.getState
      >);
  });

  test("should identify vision models using regex patterns", () => {
    const visionModels = [
      "gpt-4-vision",
      "claude-3-opus",
      "gemini-1.5-pro",
      "gemini-2.0",
      "gemini-exp-vision",
      "learnlm-vision",
      "qwen-vl-max",
      "qwen2-vl-max",
      "gpt-4-turbo",
      "dall-e-3",
    ];

    visionModels.forEach((model) => {
      expect(isVisionModel(model)).toBe(true);
    });
  });

  test("should exclude specific models", () => {
    expect(isVisionModel("claude-3-5-haiku-20241022")).toBe(false);
  });

  test("should not identify non-vision models", () => {
    const nonVisionModels = [
      "gpt-3.5-turbo",
      "gpt-4-turbo-preview",
      "claude-2",
      "regular-model",
    ];

    nonVisionModels.forEach((model) => {
      expect(isVisionModel(model)).toBe(false);
    });
  });

  test("should identify models from the loaded access configuration", () => {
    jest
      .mocked(useAccessStore.getState)
      .mockReturnValue({
        visionModels: "custom-vision-model,another-vision-model",
      } as ReturnType<typeof useAccessStore.getState>);

    expect(isVisionModel("custom-vision-model")).toBe(true);
    expect(isVisionModel("another-vision-model")).toBe(true);
    expect(isVisionModel("unrelated-model")).toBe(false);
  });

  test("should handle empty vision configuration", () => {
    expect(isVisionModel("unrelated-model")).toBe(false);

    expect(isVisionModel("unrelated-model")).toBe(false);
    expect(isVisionModel("gpt-4-vision")).toBe(true);
  });
});
