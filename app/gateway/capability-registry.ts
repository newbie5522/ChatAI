/**
 * V2 Model Gateway - 能力注册表
 *
 * 设计原则：
 * 1. 三态状态：supported | unsupported | unknown（不压缩为布尔）
 * 2. 三种证据来源：official-static / probe / admin-declared
 * 3. 合并规则：admin-declared > official-static > probe
 *    同优先级冲突时取更保守状态并记录冲突供审计
 * 4. 不跨 routeId 继承能力（同模型不同线路能力可不同）
 * 5. 证据过期（expiresAt）自动降级为 unknown
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

// 来源优先级（值越大优先级越高）
const SOURCE_PRIORITY: Record<CapabilitySource, number> = {
  "official-static": 1,
  probe: 0,
  "admin-declared": 2,
};

// 保守性排序（值越小越保守）
const CONSERVATISM: Record<CapabilityStatus, number> = {
  unsupported: 0,
  unknown: 1,
  supported: 2,
};

function makeKey(key: CapabilityKey): string {
  return [
    key.providerId,
    key.modelId,
    key.routeId,
    key.endpoint,
    key.schemaId,
  ].join("\0");
}

function isExpired(evidence: CapabilityEvidence, now: string): boolean {
  if (!evidence.expiresAt) return false;
  return evidence.expiresAt < now;
}

export class CapabilityRegistry {
  // key = makeKey(CapabilityKey) + "\0" + capability
  private store = new Map<string, CapabilityEvidence[]>();

  // 审计冲突日志（同优先级来源对同一 key+capability 给出不同状态）
  private conflicts: Array<{
    keyStr: string;
    capability: Capability;
    existing: CapabilityEvidence;
    incoming: CapabilityEvidence;
    resolution: CapabilityStatus;
  }> = [];

  // ---- 写入接口 ----

  /**
   * 声明官方静态能力（一次声明多个 capability，均为 supported）。
   * 用于 Adapter 初始化时批量注册已知支持的能力。
   */
  declareOfficialStatic(
    key: CapabilityKey,
    capabilities: Capability[],
    opts?: { observedAt?: string; evidenceRef?: string },
  ): void {
    const observedAt = opts?.observedAt ?? new Date().toISOString();
    for (const cap of capabilities) {
      this._upsert(key, cap, {
        source: "official-static",
        status: "supported",
        observedAt,
        evidenceRef: opts?.evidenceRef,
      });
    }
  }

  /**
   * 记录探测（probe）结果。
   * probe 优先级最低，但可覆盖同来源的旧记录。
   * 可以设置 expiresAt 让结果在一段时间后自动降级为 unknown。
   */
  recordProbe(
    key: CapabilityKey,
    capability: Capability,
    status: CapabilityStatus,
    opts?: { observedAt?: string; expiresAt?: string; reason?: string },
  ): void {
    this._upsert(key, capability, {
      source: "probe",
      status,
      observedAt: opts?.observedAt ?? new Date().toISOString(),
      expiresAt: opts?.expiresAt,
      reason: opts?.reason,
    });
  }

  /**
   * 管理员覆盖（最高优先级）。
   * 可以强制设为 supported / unsupported / unknown。
   */
  setAdminOverride(
    key: CapabilityKey,
    capability: Capability,
    status: CapabilityStatus,
    opts?: { reason?: string; observedAt?: string },
  ): void {
    this._upsert(key, capability, {
      source: "admin-declared",
      status,
      observedAt: opts?.observedAt ?? new Date().toISOString(),
      reason: opts?.reason,
    });
  }

  /**
   * 从 ProviderCapabilityEntry 批量导入（用于从配置文件加载）。
   */
  importEntry(entry: ProviderCapabilityEntry): void {
    const key: CapabilityKey = {
      providerId: entry.providerId,
      modelId: entry.modelId,
      routeId: entry.routeId,
      endpoint: entry.endpoint,
      schemaId: entry.schemaId,
    };
    for (const [cap, evidence] of Object.entries(entry.capabilities)) {
      if (evidence) {
        this._upsert(key, cap as Capability, evidence);
      }
    }
  }

  // ---- 查询接口 ----

  /**
   * 查询某 key+capability 的最终决策。
   * - 过期的 evidence 视为 unknown。
   * - 以最高优先级来源的结果为准。
   * - 同优先级取更保守（保守 = unsupported > unknown > supported）。
   */
  getCapability(
    key: CapabilityKey,
    capability: Capability,
    now?: string,
  ): CapabilityDecision {
    const nowStr = now ?? new Date().toISOString();
    const storeKey = makeKey(key) + "\0" + capability;
    const evidences = this.store.get(storeKey);

    if (!evidences || evidences.length === 0) {
      return { status: "unknown" };
    }

    // 过滤过期的 evidence，过期降级为 unknown
    const effective = evidences.map((e) => {
      if (isExpired(e, nowStr)) {
        return { ...e, status: "unknown" as CapabilityStatus };
      }
      return e;
    });

    // 按优先级分组，取最高优先级
    let bestPriority = -1;
    let bestEvidence: CapabilityEvidence | null = null;

    for (const e of effective) {
      const p = SOURCE_PRIORITY[e.source];
      if (p > bestPriority) {
        bestPriority = p;
        bestEvidence = e;
      } else if (p === bestPriority && bestEvidence) {
        // 同优先级：取更保守的
        if (CONSERVATISM[e.status] < CONSERVATISM[bestEvidence.status]) {
          bestEvidence = e;
        }
      }
    }

    if (!bestEvidence) return { status: "unknown" };

    return {
      status: bestEvidence.status,
      source: bestEvidence.source,
      observedAt: bestEvidence.observedAt,
      reason: bestEvidence.reason,
    };
  }

  /** 获取审计冲突日志（用于监控/调试） */
  getConflicts() {
    return [...this.conflicts];
  }

  /** 清空所有数据（用于测试） */
  clear(): void {
    this.store.clear();
    this.conflicts = [];
  }

  // ---- 内部方法 ----

  private _upsert(
    key: CapabilityKey,
    capability: Capability,
    evidence: CapabilityEvidence,
  ): void {
    const storeKey = makeKey(key) + "\0" + capability;
    const existing = this.store.get(storeKey) ?? [];

    // 检查是否有同来源的记录（更新同来源的旧记录）
    const sameSourceIdx = existing.findIndex(
      (e) => e.source === evidence.source,
    );

    if (sameSourceIdx >= 0) {
      const old = existing[sameSourceIdx];
      // 同优先级来源但状态不同 → 记录冲突
      if (
        old.status !== evidence.status &&
        old.source === evidence.source &&
        old.observedAt !== evidence.observedAt
      ) {
        const resolved =
          CONSERVATISM[old.status] <= CONSERVATISM[evidence.status]
            ? old.status
            : evidence.status;
        this.conflicts.push({
          keyStr: storeKey,
          capability,
          existing: old,
          incoming: evidence,
          resolution: resolved,
        });
      }
      existing[sameSourceIdx] = evidence;
    } else {
      existing.push(evidence);
    }

    this.store.set(storeKey, existing);
  }
}
