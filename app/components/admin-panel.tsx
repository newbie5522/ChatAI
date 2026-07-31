"use client";

import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";

import type { ModelCategory, ModelProvider } from "../config/model-registry";
import { Path } from "../constant";
import { useAccountStore } from "../store";
import {
  getAccountStatusDisplayName,
  getCategoryDisplayName,
  getRoleDisplayName,
} from "../utils/roles";
import { IconButton } from "./button";
import { Modal, showToast } from "./ui-lib";
import styles from "./admin.module.scss";

type AccountRole = "employee" | "admin" | "super_admin";
type AdminTab = "members" | "providers" | "models" | "logs";

interface AdminAccount {
  id: string;
  username: string;
  name: string;
  role: AccountRole;
  status: "active" | "disabled";
  monthlyQuota?: number;
  usedQuota?: number;
  allowedModelIds: string[];
  allowedCategories: ModelCategory[];
  lastLoginAt?: string;
}

interface AdminCredential {
  id: string;
  provider: ModelProvider;
  keyConfigured: boolean;
  keyPreview: string;
  enabled: boolean;
  priority: number;
}

interface AdminModel {
  id: string;
  provider: ModelProvider;
  category: ModelCategory;
  displayName: string;
  model: string;
  endpointType: string;
  enabled: boolean;
  sort: number;
  hasUsableCredential: boolean;
}

interface UsageRecord {
  id: string;
  accountId: string;
  username: string;
  role: string;
  provider: string;
  modelId: string;
  model: string;
  category: ModelCategory;
  promptPreview: string;
  promptContent?: string;
  status: string;
  errorMessage?: string;
  createdAt: string;
}

interface AccountForm {
  id?: string;
  username: string;
  name: string;
  password: string;
  role: AccountRole;
  monthlyQuota: string;
  allowedModelIds: string[];
  allowedCategories: ModelCategory[];
}

interface ProviderForm {
  id?: string;
  provider: ModelProvider;
  apiKey: string;
  enabled: boolean;
}

const PROVIDERS: ModelProvider[] = [
  "openai",
  "anthropic",
  "google",
  "perplexity",
  "xai",
  "deepseek",
  "qwen",
  "mistral",
];

const PROVIDER_NAMES: Record<ModelProvider, string> = {
  openai: "OpenAI",
  anthropic: "Anthropic",
  google: "Google",
  perplexity: "Perplexity",
  xai: "xAI",
  deepseek: "DeepSeek",
  qwen: "Qwen",
  mistral: "Mistral",
};

const CATEGORIES: ModelCategory[] = ["chat", "search", "image", "video"];

const TABS: Array<{ id: AdminTab; label: string }> = [
  { id: "members", label: "成员" },
  { id: "providers", label: "服务商" },
  { id: "models", label: "模型" },
  { id: "logs", label: "日志" },
];

function emptyAccountForm(): AccountForm {
  return {
    username: "",
    name: "",
    password: "",
    role: "employee",
    monthlyQuota: "100000",
    allowedModelIds: [],
    allowedCategories: ["chat"],
  };
}

async function adminFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`/api/admin/${path}`, {
    ...init,
    credentials: "same-origin",
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
  });
  const body = await response.json();
  if (!response.ok || body.error) {
    throw new Error(body.message ?? "管理请求失败");
  }
  return body as T;
}

function formatDate(value?: string) {
  if (!value) return "从未登录";
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? "从未登录"
    : date.toLocaleString("zh-CN");
}

function formatQuota(value?: number) {
  return value === undefined ? "不限" : value.toLocaleString("zh-CN");
}

function getLogStatus(status: string) {
  if (status === "success") return "成功";
  if (status === "failed") return "失败";
  if (status === "blocked") return "已阻止";
  return status || "-";
}

function toggleValue<T>(values: T[], value: T) {
  return values.includes(value)
    ? values.filter((item) => item !== value)
    : [...values, value];
}

export function AdminPanel() {
  const navigate = useNavigate();
  const accountStore = useAccountStore();
  const isSuperAdmin = accountStore.user?.role === "super_admin";
  const [activeTab, setActiveTab] = useState<AdminTab>("members");
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");
  const [accounts, setAccounts] = useState<AdminAccount[]>([]);
  const [credentials, setCredentials] = useState<AdminCredential[]>([]);
  const [models, setModels] = useState<AdminModel[]>([]);
  const [usageRecords, setUsageRecords] = useState<UsageRecord[]>([]);
  const [accountForm, setAccountForm] = useState<AccountForm | null>(null);
  const [resetAccount, setResetAccount] = useState<AdminAccount | null>(null);
  const [resetPassword, setResetPassword] = useState("");
  const [providerForm, setProviderForm] = useState<ProviderForm | null>(null);
  const [logMonth, setLogMonth] = useState(
    new Date().toISOString().slice(0, 7),
  );
  const [logAccountId, setLogAccountId] = useState("");

  const modelsByCategory = useMemo(
    () =>
      CATEGORIES.map((category) => ({
        category,
        models: models
          .filter((model) => model.category === category)
          .sort((a, b) => a.sort - b.sort),
      })),
    [models],
  );

  const visiblePermissionModels = useMemo(
    () =>
      models
        .filter(
          (model) => model.endpointType !== "not_implemented" && model.enabled,
        )
        .sort((a, b) => a.sort - b.sort),
    [models],
  );

  const loadUsageLogs = async (month = logMonth, accountId = logAccountId) => {
    if (!isSuperAdmin) {
      setUsageRecords([]);
      return;
    }
    const params = new URLSearchParams({ month });
    if (accountId) params.set("accountId", accountId);
    const usage = await adminFetch<{ records: UsageRecord[] }>(
      `usage-logs?${params.toString()}`,
    );
    setUsageRecords(usage.records);
  };

  const loadAdminData = async () => {
    setLoading(true);
    setMessage("");
    try {
      const accountResult = await adminFetch<{ accounts: AdminAccount[] }>(
        "accounts",
      );
      setAccounts(accountResult.accounts);
      if (isSuperAdmin) {
        const [credentialResult, modelResult] = await Promise.all([
          adminFetch<{ credentials: AdminCredential[] }>("credentials"),
          adminFetch<{ models: AdminModel[] }>("models"),
        ]);
        setCredentials(credentialResult.credentials);
        setModels(modelResult.models);
        await loadUsageLogs();
      } else {
        setActiveTab("members");
        setCredentials([]);
        setModels([]);
        setUsageRecords([]);
      }
      await accountStore.fetchSession();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "加载管理后台失败");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void accountStore.fetchSession();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (accountStore.loaded && !accountStore.authenticated) {
      navigate(Path.Auth);
      return;
    }
    if (accountStore.authenticated && accountStore.isAdmin()) {
      void loadAdminData();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accountStore.authenticated, accountStore.loaded]);

  useEffect(() => {
    if (!isSuperAdmin && activeTab !== "members") {
      setActiveTab("members");
    }
  }, [activeTab, isSuperAdmin]);

  const canManageAccount = (account: AdminAccount) => {
    if (account.id === accountStore.user?.userId) return false;
    if (accountStore.user?.role === "super_admin") {
      return account.role === "admin" || account.role === "employee";
    }
    return accountStore.user?.role === "admin" && account.role === "employee";
  };

  const roleOptions = () =>
    accountStore.user?.role === "super_admin"
      ? (["admin", "employee"] as AccountRole[])
      : (["employee"] as AccountRole[]);

  const openNewAccount = () => setAccountForm(emptyAccountForm());

  const openEditAccount = (account: AdminAccount) => {
    setAccountForm({
      id: account.id,
      username: account.username,
      name: account.name,
      password: "",
      role: account.role,
      monthlyQuota:
        account.monthlyQuota === undefined ? "" : String(account.monthlyQuota),
      allowedModelIds: account.allowedModelIds ?? [],
      allowedCategories: account.allowedCategories ?? [],
    });
  };

  const saveAccount = async () => {
    if (!accountForm || loading) return;
    setLoading(true);
    try {
      const path = accountForm.id
        ? `accounts/${encodeURIComponent(accountForm.id)}`
        : "accounts";
      await adminFetch(path, {
        method: accountForm.id ? "PUT" : "POST",
        body: JSON.stringify({
          username: accountForm.username,
          name: accountForm.name,
          password: accountForm.password || undefined,
          role: accountForm.role,
          monthlyQuota:
            accountForm.monthlyQuota === "" ? null : accountForm.monthlyQuota,
          allowedModelIds: accountForm.allowedModelIds,
          allowedCategories: accountForm.allowedCategories,
        }),
      });
      setAccountForm(null);
      showToast(accountForm.id ? "成员信息已保存" : "成员已创建");
      await loadAdminData();
    } catch (error) {
      showToast(error instanceof Error ? error.message : "保存成员失败");
    } finally {
      setLoading(false);
    }
  };

  const updateAccountStatus = async (
    account: AdminAccount,
    action: "enable" | "disable",
  ) => {
    setLoading(true);
    try {
      await adminFetch(`accounts/${encodeURIComponent(account.id)}/${action}`, {
        method: "POST",
      });
      showToast(action === "enable" ? "账号已启用" : "账号已禁用");
      await loadAdminData();
    } catch (error) {
      showToast(error instanceof Error ? error.message : "更新账号状态失败");
    } finally {
      setLoading(false);
    }
  };

  const deleteAccount = async (account: AdminAccount) => {
    if (!window.confirm(`确定删除成员“${account.name}”吗？`)) return;
    setLoading(true);
    try {
      await adminFetch(`accounts/${encodeURIComponent(account.id)}`, {
        method: "DELETE",
      });
      showToast("成员已删除");
      await loadAdminData();
    } catch (error) {
      showToast(error instanceof Error ? error.message : "删除成员失败");
    } finally {
      setLoading(false);
    }
  };

  const saveResetPassword = async () => {
    if (!resetAccount || loading) return;
    if (resetPassword.length < 8) {
      showToast("密码至少需要 8 位");
      return;
    }
    setLoading(true);
    try {
      await adminFetch(`accounts/${encodeURIComponent(resetAccount.id)}`, {
        method: "PUT",
        body: JSON.stringify({ password: resetPassword }),
      });
      setResetAccount(null);
      setResetPassword("");
      showToast("密码已重置");
    } catch (error) {
      showToast(error instanceof Error ? error.message : "重置密码失败");
    } finally {
      setLoading(false);
    }
  };

  const primaryCredential = (provider: ModelProvider) =>
    credentials.find((credential) => credential.provider === provider);

  const openProvider = (provider: ModelProvider) => {
    const credential = primaryCredential(provider);
    setProviderForm({
      id: credential?.id,
      provider,
      apiKey: "",
      enabled: credential?.enabled ?? true,
    });
  };

  const saveProvider = async () => {
    if (!providerForm || loading) return;
    setLoading(true);
    try {
      await adminFetch(
        providerForm.id
          ? `credentials/${encodeURIComponent(providerForm.id)}`
          : "credentials",
        {
          method: providerForm.id ? "PUT" : "POST",
          body: JSON.stringify({
            provider: providerForm.provider,
            apiKey: providerForm.apiKey,
            enabled: providerForm.enabled,
          }),
        },
      );
      setProviderForm(null);
      showToast("服务商配置已保存");
      await loadAdminData();
    } catch (error) {
      showToast(error instanceof Error ? error.message : "保存服务商失败");
    } finally {
      setLoading(false);
    }
  };

  const toggleModel = async (model: AdminModel) => {
    setLoading(true);
    try {
      await adminFetch(`models/${encodeURIComponent(model.id)}`, {
        method: "PUT",
        body: JSON.stringify({ enabled: !model.enabled }),
      });
      showToast(model.enabled ? "模型已停用" : "模型已启用");
      await loadAdminData();
    } catch (error) {
      showToast(error instanceof Error ? error.message : "更新模型失败");
    } finally {
      setLoading(false);
    }
  };

  const getModelStatus = (model: AdminModel) => {
    if (model.endpointType === "not_implemented") return "接口待校准";
    if (!model.hasUsableCredential) return "未配置服务商密钥";
    return model.enabled ? "已启用" : "已停用";
  };

  const getLogModelName = (record: UsageRecord) =>
    models.find(
      (model) =>
        model.id === record.modelId ||
        (model.provider === record.provider && model.model === record.model),
    )?.displayName ??
    record.model ??
    "-";

  if (accountStore.loaded && !accountStore.isAdmin()) {
    return (
      <main className={styles.admin}>
        <section className={styles["login-panel"]}>
          <h1>需要管理员权限</h1>
          <IconButton text="返回聊天" onClick={() => navigate(Path.Chat)} />
        </section>
      </main>
    );
  }

  return (
    <main className={styles.admin}>
      <header className={styles.header}>
        <h1>NewbieChat 管理后台</h1>
        <IconButton
          text="返回聊天"
          bordered
          onClick={() => navigate(Path.Chat)}
        />
      </header>

      <nav className={styles.tabs} aria-label="管理后台栏目">
        {(isSuperAdmin ? TABS : TABS.slice(0, 1)).map((tab) => (
          <button
            type="button"
            key={tab.id}
            className={activeTab === tab.id ? styles.active : ""}
            onClick={() => setActiveTab(tab.id)}
          >
            {tab.label}
          </button>
        ))}
      </nav>

      {message && <div className={styles.message}>{message}</div>}

      {activeTab === "members" && (
        <section className={styles.panel}>
          <div className={styles["panel-title"]}>
            <h2>成员账号</h2>
            <IconButton
              text="新增成员"
              type="primary"
              disabled={loading}
              onClick={openNewAccount}
            />
          </div>
          <div className={styles["table-wrap"]}>
            <table>
              <thead>
                <tr>
                  <th>成员名称</th>
                  <th>登录账号</th>
                  <th>角色</th>
                  <th>状态</th>
                  <th>月度额度</th>
                  <th>已使用</th>
                  <th>授权分类</th>
                  <th>授权模型数</th>
                  <th>最后登录</th>
                  <th>操作</th>
                </tr>
              </thead>
              <tbody>
                {accounts.map((account) => (
                  <tr key={account.id}>
                    <td>{account.name}</td>
                    <td>{account.username}</td>
                    <td>{getRoleDisplayName(account.role)}</td>
                    <td>{getAccountStatusDisplayName(account.status)}</td>
                    <td>{formatQuota(account.monthlyQuota)}</td>
                    <td>{formatQuota(account.usedQuota ?? 0)}</td>
                    <td>
                      {(account.allowedCategories ?? [])
                        .map(getCategoryDisplayName)
                        .join("、") || "无"}
                    </td>
                    <td>{account.allowedModelIds?.length ?? 0}</td>
                    <td>{formatDate(account.lastLoginAt)}</td>
                    <td>
                      {canManageAccount(account) ? (
                        <div className={styles["row-actions"]}>
                          <button
                            type="button"
                            onClick={() => openEditAccount(account)}
                          >
                            编辑
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              setResetAccount(account);
                              setResetPassword("");
                            }}
                          >
                            重置密码
                          </button>
                          <button
                            type="button"
                            onClick={() =>
                              void updateAccountStatus(
                                account,
                                account.status === "disabled"
                                  ? "enable"
                                  : "disable",
                              )
                            }
                          >
                            {account.status === "disabled" ? "启用" : "禁用"}
                          </button>
                          <button
                            type="button"
                            onClick={() => void deleteAccount(account)}
                          >
                            删除
                          </button>
                        </div>
                      ) : (
                        <span className={styles.subtle}>不可操作</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {isSuperAdmin && activeTab === "providers" && (
        <section className={styles.panel}>
          <h2>服务商</h2>
          <div className={styles["provider-grid"]}>
            {PROVIDERS.map((provider) => {
              const credential = primaryCredential(provider);
              const providerEnabled = credential?.enabled ?? true;
              return (
                <article className={styles.provider} key={provider}>
                  <div className={styles["provider-header"]}>
                    <strong>{PROVIDER_NAMES[provider]}</strong>
                    <span>
                      {!credential
                        ? "未配置"
                        : providerEnabled
                        ? "已启用"
                        : "已停用"}
                    </span>
                  </div>
                  <div>API Key：{credential?.keyPreview || "未配置"}</div>
                  <div>启用状态：{providerEnabled ? "启用" : "停用"}</div>
                  <IconButton
                    text="配置"
                    disabled={loading}
                    onClick={() => openProvider(provider)}
                  />
                </article>
              );
            })}
          </div>
        </section>
      )}

      {isSuperAdmin && activeTab === "models" && (
        <section className={styles.panel}>
          <h2>模型</h2>
          {modelsByCategory.map((group) => (
            <div className={styles["model-group"]} key={group.category}>
              <h3>{getCategoryDisplayName(group.category)}</h3>
              <div className={styles["table-wrap"]}>
                <table>
                  <thead>
                    <tr>
                      <th>模型名称</th>
                      <th>Provider</th>
                      <th>分类</th>
                      <th>状态</th>
                      <th>启用开关</th>
                    </tr>
                  </thead>
                  <tbody>
                    {group.models.length === 0 ? (
                      <tr>
                        <td colSpan={5}>
                          {group.category === "video"
                            ? "待加入"
                            : "暂无可用模型"}
                        </td>
                      </tr>
                    ) : (
                      group.models.map((model) => (
                        <tr key={model.id}>
                          <td>{model.displayName}</td>
                          <td>{PROVIDER_NAMES[model.provider]}</td>
                          <td>{getCategoryDisplayName(model.category)}</td>
                          <td>{getModelStatus(model)}</td>
                          <td>
                            <button
                              type="button"
                              disabled={
                                loading ||
                                model.endpointType === "not_implemented"
                              }
                              onClick={() => void toggleModel(model)}
                            >
                              {model.enabled ? "停用" : "启用"}
                            </button>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          ))}
        </section>
      )}

      {isSuperAdmin && activeTab === "logs" && (
        <section className={styles.panel}>
          <div className={styles["panel-title"]}>
            <h2>使用日志</h2>
            <div className={styles.filters}>
              <input
                aria-label="月份"
                type="month"
                value={logMonth}
                onChange={(event) => setLogMonth(event.currentTarget.value)}
              />
              <select
                aria-label="账号"
                value={logAccountId}
                onChange={(event) => setLogAccountId(event.currentTarget.value)}
              >
                <option value="">全部账号</option>
                {accounts.map((account) => (
                  <option key={account.id} value={account.id}>
                    {account.username}
                  </option>
                ))}
              </select>
              <IconButton
                text="查询"
                disabled={loading}
                onClick={() => void loadUsageLogs()}
              />
            </div>
          </div>
          <div className={styles["table-wrap"]}>
            <table>
              <thead>
                <tr>
                  <th>时间</th>
                  <th>账号</th>
                  <th>角色</th>
                  <th>Provider</th>
                  <th>模型</th>
                  <th>分类</th>
                  <th>状态</th>
                  <th>成员输入</th>
                  <th>错误</th>
                </tr>
              </thead>
              <tbody>
                {usageRecords.map((record) => (
                  <tr key={record.id}>
                    <td>{formatDate(record.createdAt)}</td>
                    <td>{record.username}</td>
                    <td>{getRoleDisplayName(record.role)}</td>
                    <td>
                      {PROVIDER_NAMES[record.provider as ModelProvider] ??
                        record.provider}
                    </td>
                    <td>{getLogModelName(record)}</td>
                    <td>{getCategoryDisplayName(record.category)}</td>
                    <td>{getLogStatus(record.status)}</td>
                    <td className={styles.preview}>
                      {record.promptContent || record.promptPreview || "-"}
                    </td>
                    <td className={styles.preview}>
                      {record.errorMessage || "-"}
                    </td>
                  </tr>
                ))}
                {usageRecords.length === 0 && (
                  <tr>
                    <td colSpan={9}>暂无日志</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {accountForm && (
        <Modal
          title={accountForm.id ? "编辑成员" : "新增成员"}
          onClose={() => setAccountForm(null)}
          actions={[
            <IconButton
              key="cancel"
              text="取消"
              onClick={() => setAccountForm(null)}
            />,
            <IconButton
              key="save"
              type="primary"
              text="保存"
              disabled={loading}
              onClick={() => void saveAccount()}
            />,
          ]}
        >
          <div className={styles["modal-form"]}>
            <label>
              登录账号
              <input
                type="text"
                autoComplete="off"
                value={accountForm.username}
                onChange={(event) =>
                  setAccountForm({
                    ...accountForm,
                    username: event.currentTarget.value,
                  })
                }
              />
            </label>
            <label>
              成员名称
              <input
                type="text"
                value={accountForm.name}
                onChange={(event) =>
                  setAccountForm({
                    ...accountForm,
                    name: event.currentTarget.value,
                  })
                }
              />
            </label>
            {!accountForm.id && (
              <label>
                密码
                <input
                  type="password"
                  autoComplete="new-password"
                  value={accountForm.password}
                  onChange={(event) =>
                    setAccountForm({
                      ...accountForm,
                      password: event.currentTarget.value,
                    })
                  }
                />
              </label>
            )}
            <label>
              角色
              <select
                value={accountForm.role}
                onChange={(event) =>
                  setAccountForm({
                    ...accountForm,
                    role: event.currentTarget.value as AccountRole,
                  })
                }
              >
                {roleOptions().map((role) => (
                  <option key={role} value={role}>
                    {getRoleDisplayName(role)}
                  </option>
                ))}
              </select>
            </label>
            <label>
              月度额度
              <input
                type="number"
                min="0"
                value={accountForm.monthlyQuota}
                onChange={(event) =>
                  setAccountForm({
                    ...accountForm,
                    monthlyQuota: event.currentTarget.value,
                  })
                }
              />
            </label>
            <fieldset>
              <legend>分类权限</legend>
              <div className={styles.checkboxes}>
                {CATEGORIES.map((category) => (
                  <label key={category}>
                    <input
                      type="checkbox"
                      checked={accountForm.allowedCategories.includes(category)}
                      onChange={() =>
                        setAccountForm({
                          ...accountForm,
                          allowedCategories: toggleValue(
                            accountForm.allowedCategories,
                            category,
                          ),
                        })
                      }
                    />
                    {getCategoryDisplayName(category)}
                  </label>
                ))}
              </div>
            </fieldset>
            <fieldset>
              <legend>额外模型权限</legend>
              <div className={styles.checkboxes}>
                {visiblePermissionModels.map((model) => (
                  <label key={model.id}>
                    <input
                      type="checkbox"
                      checked={accountForm.allowedModelIds.includes(model.id)}
                      onChange={() =>
                        setAccountForm({
                          ...accountForm,
                          allowedModelIds: toggleValue(
                            accountForm.allowedModelIds,
                            model.id,
                          ),
                        })
                      }
                    />
                    {model.displayName}（{PROVIDER_NAMES[model.provider]}）
                  </label>
                ))}
              </div>
            </fieldset>
          </div>
        </Modal>
      )}

      {resetAccount && (
        <Modal
          title={`重置 ${resetAccount.username} 的密码`}
          onClose={() => setResetAccount(null)}
          actions={[
            <IconButton
              key="cancel"
              text="取消"
              onClick={() => setResetAccount(null)}
            />,
            <IconButton
              key="save"
              type="primary"
              text="保存"
              disabled={loading}
              onClick={() => void saveResetPassword()}
            />,
          ]}
        >
          <div className={styles["modal-form"]}>
            <label>
              新密码
              <input
                type="password"
                autoComplete="new-password"
                value={resetPassword}
                onChange={(event) =>
                  setResetPassword(event.currentTarget.value)
                }
              />
            </label>
          </div>
        </Modal>
      )}

      {providerForm && (
        <Modal
          title={`配置 ${PROVIDER_NAMES[providerForm.provider]}`}
          onClose={() => setProviderForm(null)}
          actions={[
            <IconButton
              key="cancel"
              text="取消"
              onClick={() => setProviderForm(null)}
            />,
            <IconButton
              key="save"
              type="primary"
              text="保存"
              disabled={loading}
              onClick={() => void saveProvider()}
            />,
          ]}
        >
          <div className={styles["modal-form"]}>
            <label>
              API Key
              <input
                type="password"
                autoComplete="new-password"
                value={providerForm.apiKey}
                placeholder={
                  providerForm.id ? "留空则保留原 API Key" : "请输入 API Key"
                }
                onChange={(event) =>
                  setProviderForm({
                    ...providerForm,
                    apiKey: event.currentTarget.value,
                  })
                }
              />
            </label>
            <label className={styles["inline-check"]}>
              <input
                type="checkbox"
                checked={providerForm.enabled}
                onChange={(event) =>
                  setProviderForm({
                    ...providerForm,
                    enabled: event.currentTarget.checked,
                  })
                }
              />
              启用
            </label>
          </div>
        </Modal>
      )}
    </main>
  );
}
