/**
 * V2 Model Gateway 契约测试
 * 验证：CapabilityRegistry 的三态/三来源/合并规则、Adapter 接口契约
 */

import { CapabilityRegistry } from "../app/gateway/capability-registry";
import { OpenAIAdapter } from "../app/gateway/adapters/openai-adapter";
import type { CapabilityKey } from "../app/gateway/types";

describe("CapabilityRegistry", () => {
  let registry: CapabilityRegistry;
  let key: CapabilityKey;

  beforeEach(() => {
    registry = new CapabilityRegistry();
    key = {
      providerId: "test-provider",
      modelId: "test-model",
      routeId: "route-1",
      endpoint: "https://test.example.com",
      schemaId: "test-schema-v1",
    };
  });

  it("returns unknown when no evidence exists", () => {
    const decision = registry.getCapability(key, "VISION");
    expect(decision.status).toBe("unknown");
  });

  it("records official-static evidence as supported", () => {
    registry.declareOfficialStatic(key, ["VISION", "STREAMING"]);

    expect(registry.getCapability(key, "VISION").status).toBe("supported");
    expect(registry.getCapability(key, "STREAMING").status).toBe("supported");
    expect(registry.getCapability(key, "IMAGE_EDIT").status).toBe("unknown");
  });

  it("does not leak capability across different routeId (no cross-route inheritance)", () => {
    registry.declareOfficialStatic(key, ["VISION"]);

    const otherRouteKey: CapabilityKey = { ...key, routeId: "route-2" };
    expect(registry.getCapability(otherRouteKey, "VISION").status).toBe("unknown");
  });

  it("admin-declared override takes priority over official-static", () => {
    registry.declareOfficialStatic(key, ["IMAGE_EDIT"]);
    expect(registry.getCapability(key, "IMAGE_EDIT").status).toBe("supported");

    registry.setAdminOverride(
      key,
      "official-native",
      "IMAGE_EDIT",
      "unsupported",
      "manual verification failed",
    );

    const decision = registry.getCapability(key, "IMAGE_EDIT");
    expect(decision.status).toBe("unsupported");
    expect(decision.source).toBe("admin-declared");
  });

  it("probe evidence does not override official-static (lower priority)", () => {
    registry.declareOfficialStatic(key, ["VISION"]);

    registry.recordEvidence(key, "official-native", "VISION", {
      source: "probe",
      status: "unsupported",
      observedAt: new Date().toISOString(),
    });

    // official-static (priority 2) > probe (priority 1)，probe 不应覆盖
    expect(registry.getCapability(key, "VISION").status).toBe("supported");
  });

  it("expired evidence is treated as unknown", () => {
    const pastDate = new Date(Date.now() - 1000).toISOString();
    registry.recordEvidence(key, "relay-compatible", "IMAGE_EDIT", {
      source: "probe",
      status: "supported",
      observedAt: pastDate,
      expiresAt: pastDate, // 已过期
    });

    const decision = registry.getCapability(key, "IMAGE_EDIT");
    expect(decision.status).toBe("unknown");
    expect(decision.reason).toBe("evidence-expired");
  });

  it("getSupportedCapabilities only returns supported (not unsupported/unknown)", () => {
    registry.declareOfficialStatic(key, ["VISION", "STREAMING"]);
    registry.setAdminOverride(
      key,
      "official-native",
      "IMAGE_EDIT",
      "unsupported",
      "test",
    );

    const supported = registry.getSupportedCapabilities(key);
    expect(supported).toContain("VISION");
    expect(supported).toContain("STREAMING");
    expect(supported).not.toContain("IMAGE_EDIT");
  });

  it("same-priority conflict resolves to the more conservative status", () => {
    const now = new Date().toISOString();
    registry.recordEvidence(key, "relay-compatible", "IMAGE_EDIT", {
      source: "probe",
      status: "supported",
      observedAt: now,
    });
    registry.recordEvidence(key, "relay-compatible", "IMAGE_EDIT", {
      source: "probe",
      status: "unknown",
      observedAt: now,
    });

    // unknown 比 supported 更保守，应采用 unknown
    const decision = registry.getCapability(key, "IMAGE_EDIT");
    expect(decision.status).toBe("unknown");
    expect(decision.reason).toContain("conflict-resolved");
  });
});

describe("OpenAIAdapter", () => {
  it("declares official capabilities on construction", () => {
    new OpenAIAdapter();

    // 验证适配器初始化后，注册表中能查到 gpt-4o 的能力
    const registry = new (require("../app/gateway/capability-registry").CapabilityRegistry)();
    // 注：OpenAIAdapter 使用的是全局单例 capabilityRegistry，
    // 这里改用全局单例校验，避免创建重复的注册表实例
    const {
      capabilityRegistry: globalRegistry,
    } = require("../app/gateway/capability-registry");

    const key = {
      providerId: "openai",
      modelId: "gpt-4o",
      routeId: "official-direct",
      endpoint: "https://api.openai.com/v1",
      schemaId: "openai-chat-completions-v1",
    };

    expect(globalRegistry.getCapability(key, "VISION").status).toBe("supported");
    expect(globalRegistry.getCapability(key, "IMAGE_GENERATION").status).toBe(
      "unknown",
    );
  });

  it("emits delta and done events for execute()", async () => {
    const adapter = new OpenAIAdapter();
    const events: any[] = [];

    await adapter.execute(
      {
        requestId: "req-1",
        providerId: "openai",
        modelId: "gpt-4o",
        routeId: "official-direct",
        messages: [{ role: "user", content: "hello" }],
      },
      (event) => events.push(event),
    );

    expect(events.some((e) => e.type === "delta")).toBe(true);
    expect(events.some((e) => e.type === "done")).toBe(true);
  });
});
