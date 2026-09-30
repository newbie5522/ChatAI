/**
 * Capability Registry - 能力注册表实现
 *
 * 对应 ADR-006 的核心设计：
 * - 三态能力（supported/unsupported/unknown），不压缩为布尔值
 * - 三种来源（official-static/probe/admin-declared），有明确合并优先级
 * - 只在同一 CapabilityKey 内合并证据，不跨 Route 继承
 */

import type {
  Capability,
  CapabilityDecision,
  CapabilityEvidence,
  CapabilityKey,
  CapabilitySource,
  CapabilityStatus,
  ProviderCapabilityEntry,
} from "./types";

function keyToString(key: CapabilityKey): string {
  return `${key.providerId}::${key.modelId}::${key.routeId}::${key.endpoint}::${key.schemaId}`;
}

function isExpired(evidence: CapabilityEvidence): boolean {
  if (!evidence.expiresAt) return false;
  return new Date(evidence.expiresAt).getTime() < Date.now();
}

/**
 * 来源优先级（数值越大优先级越高）。
 * admin-declared > official-static > probe
 * 依据 ADR-006「来源合并规则」：有效的管理员显式覆盖决定当前运行状态。
 */
const SOURCE_PRIORITY: Record<CapabilitySource, number> = {
  "admin-declared": 3,
  "official-static": 2,
  probe: 1,
};

/**
 * 状态保守度：unknown 最保守，其次 unsupported，最后 supported。
 * 用于「发生冲突时采用更保守状态」规则。
 */
const STATUS_CONSERVATISM: Record<CapabilityStatus, number> = {
  unknown: 2,
  unsupported: 1,
  supported: 0,
};

export class CapabilityRegistry {
  private entries = new Map<string, ProviderCapabilityEntry>();

  private lookup(key: CapabilityKey): ProviderCapabilityEntry | undefined {
    return this.entries.get(keyToString(key));
  }

  private upsertEntry(
    key: CapabilityKey,
    adapterKind: ProviderCapabilityEntry["adapterKind"],
  ): ProviderCapabilityEntry {
    const k = keyToString(key);
    let entry = this.entries.get(k);
    if (!entry) {
      entry = {
        ...key,
        adapterKind,
        capabilities: {},
        version: 1,
        updatedAt: new Date().toISOString(),
      };
      this.entries.set(k, entry);
    }
    return entry;
  }

  /**
   * 查询某能力的当前决策。
   * 无记录或证据过期时返回 unknown，不得默认为 supported 或 unsupported。
   */
  getCapability(key: CapabilityKey, capability: Capability): CapabilityDecision {
    const entry = this.lookup(key);
    if (!entry) return { status: "unknown" };

    const evidence = entry.capabilities[capability];
    if (!evidence) return { status: "unknown" };
    if (isExpired(evidence)) {
      return { status: "unknown", reason: "evidence-expired" };
    }

    return {
      status: evidence.status,
      source: evidence.source,
      reason: evidence.reason,
      observedAt: evidence.observedAt,
    };
  }

  getSupportedCapabilities(key: CapabilityKey): Capability[] {
    const entry = this.lookup(key);
    if (!entry) return [];

    const result: Capability[] = [];
    for (const [cap, evidence] of Object.entries(entry.capabilities)) {
      if (evidence && !isExpired(evidence) && evidence.status === "supported") {
        result.push(cap as Capability);
      }
    }
    return result;
  }

  /**
   * 写入一条能力证据。若已有证据来源优先级更高且未过期，
   * 按合并规则决定是否覆盖：
   * - 高优先级来源覆盖低优先级
   * - 同优先级时，取更保守的状态并记录冲突
   */
  recordEvidence(
    key: CapabilityKey,
    adapterKind: ProviderCapabilityEntry["adapterKind"],
    capability: Capability,
    evidence: CapabilityEvidence,
  ): void {
    const entry = this.upsertEntry(key, adapterKind);
    const existing = entry.capabilities[capability];

    if (!existing || isExpired(existing)) {
      entry.capabilities[capability] = evidence;
    } else if (SOURCE_PRIORITY[evidence.source] > SOURCE_PRIORITY[existing.source]) {
      entry.capabilities[capability] = evidence;
    } else if (SOURCE_PRIORITY[evidence.source] === SOURCE_PRIORITY[existing.source]) {
      // 同优先级冲突：取更保守状态，并在 reason 中记录冲突供审计
      const conservative =
        STATUS_CONSERVATISM[evidence.status] >= STATUS_CONSERVATISM[existing.status]
          ? evidence
          : existing;
      entry.capabilities[capability] = {
        ...conservative,
        reason: `conflict-resolved:${existing.status}-vs-${evidence.status}`,
      };
    }
    // 优先级更低的新证据：忽略，不覆盖已有的高优先级判定

    entry.version += 1;
    entry.updatedAt = new Date().toISOString();
  }

  /** 便捷方法：声明官方静态能力（用于官方 Adapter 初始化） */
  declareOfficialStatic(
    key: CapabilityKey,
    capabilities: Capability[],
  ): void {
    const now = new Date().toISOString();
    for (const cap of capabilities) {
      this.recordEvidence(key, "official-native", cap, {
        source: "official-static",
        status: "supported",
        observedAt: now,
      });
    }
  }

  /** 便捷方法：管理员覆盖（记录审计所需的 reason） */
  setAdminOverride(
    key: CapabilityKey,
    adapterKind: ProviderCapabilityEntry["adapterKind"],
    capability: Capability,
    status: CapabilityStatus,
    reason: string,
  ): void {
    this.recordEvidence(key, adapterKind, capability, {
      source: "admin-declared",
      status,
      observedAt: new Date().toISOString(),
      reason,
    });
  }

  /** 导出全部记录，供调试/审计使用 */
  exportAll(): ProviderCapabilityEntry[] {
    return Array.from(this.entries.values());
  }
}

// 单例：进程内共享的注册表实例
export const capabilityRegistry = new CapabilityRegistry();
