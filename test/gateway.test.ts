/**
 * V2 Model Gateway 契约测试
 *
 * 覆盖范围：
 * 1. CapabilityRegistry：三态查询、三来源合并规则、跨 route 隔离、证据过期
 * 2. OpenAIAdapter：implements ModelAdapter 接口契约
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

    registry.setAdminOverride(key, "IMAGE_EDIT", "unsupported", {
      reason: "deprecated in this deployment",
    });

    const decision = registry.getCapability(key, "IMAGE_EDIT");
    expect(decision.status).toBe("unsupported");
    expect(decision.source).toBe("admin-declared");
    expect(decision.reason).toBe("deprecated in this deployment");
  });

  it("admin-declared override takes priority over probe", () => {
    registry.recordProbe(key, "FUNCTION_CALLING", "supported");
    registry.setAdminOverride(key, "FUNCTION_CALLING", "unsupported");

    expect(registry.getCapability(key, "FUNCTION_CALLING").status).toBe("unsupported");
  });

  it("official-static takes priority over probe", () => {
    registry.recordProbe(key, "VISION", "unsupported");
    registry.declareOfficialStatic(key, ["VISION"]);

    // official-static (priority 1) > probe (priority 0)
    expect(registry.getCapability(key, "VISION").status).toBe("supported");
    expect(registry.getCapability(key, "VISION").source).toBe("official-static");
  });

  it("expired evidence is treated as unknown", () => {
    const pastTime = new Date(Date.now() - 60_000).toISOString();
    const futureNow = new Date(Date.now() + 1000).toISOString();

    registry.recordProbe(key, "STREAMING", "supported", {
      expiresAt: pastTime,
    });

    // 查询时传入"现在"时间，过期的 evidence 降级为 unknown
    const decision = registry.getCapability(key, "STREAMING", futureNow);
    expect(decision.status).toBe("unknown");
  });

  it("non-expired evidence remains valid", () => {
    const futureExpiry = new Date(Date.now() + 60_000).toISOString();

    registry.recordProbe(key, "STREAMING", "supported", {
      expiresAt: futureExpiry,
    });

    const decision = registry.getCapability(key, "STREAMING");
    expect(decision.status).toBe("supported");
  });

  it("same-priority conflict resolves to more conservative status", () => {
    // 两次 official-static 给出不同状态（模拟更新冲突）
    registry.declareOfficialStatic(key, ["VIDEO_GENERATION"]);

    // 通过 importEntry 用相同来源重新写入 unsupported
    registry.importEntry({
      providerId: key.providerId,
      modelId: key.modelId,
      routeId: key.routeId,
      endpoint: key.endpoint,
      schemaId: key.schemaId,
      adapterKind: "official-native",
      version: 2,
      updatedAt: new Date().toISOString(),
      capabilities: {
        VIDEO_GENERATION: {
          source: "official-static",
          status: "unsupported",
          observedAt: new Date(Date.now() + 1000).toISOString(), // 更新的时间
        },
      },
    });

    // 更新后状态应为 unsupported（更新的记录覆盖旧的同来源记录）
    const decision = registry.getCapability(key, "VIDEO_GENERATION");
    expect(decision.status).toBe("unsupported");
  });

  it("clear resets all state", () => {
    registry.declareOfficialStatic(key, ["TEXT"]);
    expect(registry.getCapability(key, "TEXT").status).toBe("supported");

    registry.clear();
    expect(registry.getCapability(key, "TEXT").status).toBe("unknown");
  });

  it("returns correct source in decision", () => {
    registry.recordProbe(key, "EMBEDDINGS", "supported");

    const decision = registry.getCapability(key, "EMBEDDINGS");
    expect(decision.source).toBe("probe");
  });
});

describe("OpenAIAdapter", () => {
  let adapter: OpenAIAdapter;

  beforeEach(() => {
    adapter = new OpenAIAdapter();
  });

  it("implements ModelAdapter interface", () => {
    expect(typeof adapter.adapterId).toBe("string");
    expect(adapter.kind).toBe("official-native");
    expect(typeof adapter.supports).toBe("function");
    expect(typeof adapter.execute).toBe("function");
  });

  it("supports TEXT and STREAMING by default", () => {
    const key = {
      providerId: "openai",
      modelId: "*",
      routeId: "openai-official",
      endpoint: "https://api.openai.com",
      schemaId: "openai-chat-v1",
    };

    expect(
      adapter.supports({ ...key, capability: "TEXT" }).status,
    ).toBe("supported");

    expect(
      adapter.supports({ ...key, capability: "STREAMING" }).status,
    ).toBe("supported");
  });

  it("returns unknown for unregistered capability", () => {
    const key = {
      providerId: "openai",
      modelId: "*",
      routeId: "openai-official",
      endpoint: "https://api.openai.com",
      schemaId: "openai-chat-v1",
    };

    // VIDEO_GENERATION 未在 OpenAI 静态能力中声明
    expect(
      adapter.supports({ ...key, capability: "VIDEO_GENERATION" }).status,
    ).toBe("unknown");
  });

  it("execute() emits done event (placeholder)", async () => {
    const events: Array<{ type: string }> = [];
    await adapter.execute(
      {
        requestId: "req-001",
        providerId: "openai",
        modelId: "gpt-4o",
        routeId: "openai-official",
        messages: [{ role: "user", content: "hello" }],
      },
      (event) => events.push(event),
    );

    expect(events).toHaveLength(1);
    expect(events[0].type).toBe("done");
  });
});
